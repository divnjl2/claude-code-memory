#!/usr/bin/env node
/**
 * settings-merger.cjs — Non-destructive merge of hooks into Claude Code settings.json.
 *
 * CRITICAL module: must never lose user's existing hooks or settings.
 *
 * Strategy:
 *   1. Extract a "signature" from each hook command (script + subcommand)
 *   2. Merge by signature: update existing, add new, never remove foreign hooks
 *   3. Atomic write: temp file + rename
 *   4. Write manifest for clean uninstall
 *
 * Zero dependencies.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Extract a unique signature from a hook command string.
 * E.g., 'node "/path/to/hook-runner.cjs" pre-edit --file' → 'hook-runner.cjs::pre-edit'
 * @param {string} command
 * @returns {string|null}
 */
function extractSignature(command) {
  if (!command || typeof command !== 'string') return null;

  // Match: node "path/to/script.cjs" subcommand
  const match = command.match(/node\s+"?([^"]+\.(?:cjs|js|mjs))"?\s+(\S+)/);
  if (match) {
    const script = path.basename(match[1]);
    const subcmd = match[2];
    return `${script}::${subcmd}`;
  }

  // Match: python "path/to/script.py" subcommand
  const pyMatch = command.match(/python\d?\s+"?([^"]+\.py)"?\s+(\S+)/);
  if (pyMatch) {
    const script = path.basename(pyMatch[1]);
    const subcmd = pyMatch[2];
    return `${script}::${subcmd}`;
  }

  return null;
}

/**
 * Check if a hook entry was installed by claude-code-memory.
 * @param {string} command
 * @returns {boolean}
 */
function isOurHook(command) {
  if (!command) return false;
  return command.includes('hook-runner.cjs') ||
         command.includes('memory-bridge.cjs') ||
         command.includes('memory-hook.cjs') ||
         command.includes('memory-cli.py') ||
         command.includes('inherit-params.cjs');
}

/**
 * Merge new hooks into existing hooks array for a specific event.
 * Does NOT duplicate, does NOT remove foreign hooks.
 *
 * @param {Array} existing - Current hooks array for this event
 * @param {Array} newHooks - New hooks to merge
 * @returns {Array} Merged hooks array
 */
function mergeHookArray(existing, newHooks) {
  if (!existing || !Array.isArray(existing)) existing = [];
  if (!newHooks || !Array.isArray(newHooks)) return existing;

  // Build signature map of existing hooks
  const existingSigs = new Map();
  for (let i = 0; i < existing.length; i++) {
    const sig = extractSignature(existing[i].command);
    if (sig) existingSigs.set(sig, i);
  }

  const result = [...existing];

  for (const newHook of newHooks) {
    const sig = extractSignature(newHook.command);
    if (sig && existingSigs.has(sig)) {
      // Update existing hook in place
      result[existingSigs.get(sig)] = newHook;
    } else {
      // Add new hook
      result.push(newHook);
    }
  }

  return result;
}

/**
 * Merge hooks configuration into settings.json.
 *
 * @param {object} existingSettings - Current settings.json content
 * @param {object} newHooks - New hooks object (event → hook array)
 * @returns {object} Merged settings
 */
function mergeSettings(existingSettings, newHooks) {
  const settings = JSON.parse(JSON.stringify(existingSettings || {}));

  if (!settings.hooks) settings.hooks = {};

  for (const [event, hooks] of Object.entries(newHooks)) {
    settings.hooks[event] = mergeHookArray(settings.hooks[event], hooks);
  }

  return settings;
}

/**
 * Read settings.json, merge hooks, write atomically.
 *
 * @param {string} settingsPath - Path to settings.json
 * @param {object} newHooks - Hooks to merge
 * @returns {{ success: boolean, added: number, updated: number, path: string }}
 */
function mergeIntoFile(settingsPath, newHooks) {
  // Read existing
  let existing = {};
  try {
    existing = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  } catch {
    // File doesn't exist or invalid JSON — start fresh
  }

  // Count what changes
  let added = 0;
  let updated = 0;
  const existingHooks = existing.hooks || {};

  for (const [event, hooks] of Object.entries(newHooks)) {
    const currentArr = existingHooks[event] || [];
    for (const newHook of hooks) {
      const sig = extractSignature(newHook.command);
      const existsIdx = currentArr.findIndex(h => extractSignature(h.command) === sig);
      if (existsIdx >= 0) updated++;
      else added++;
    }
  }

  // Merge
  const merged = mergeSettings(existing, newHooks);

  // Atomic write: temp + rename
  const dir = path.dirname(settingsPath);
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ok */ }

  const tmpPath = path.join(dir, `.settings.json.tmp.${process.pid}`);
  fs.writeFileSync(tmpPath, JSON.stringify(merged, null, 2));
  fs.renameSync(tmpPath, settingsPath);

  return { success: true, added, updated, path: settingsPath };
}

/**
 * Remove all claude-code-memory hooks from settings.json.
 *
 * @param {string} settingsPath - Path to settings.json
 * @returns {{ success: boolean, removed: number }}
 */
function removeOurHooks(settingsPath) {
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  } catch {
    return { success: true, removed: 0 };
  }

  if (!settings.hooks) return { success: true, removed: 0 };

  let removed = 0;
  for (const event of Object.keys(settings.hooks)) {
    const before = settings.hooks[event].length;
    settings.hooks[event] = settings.hooks[event].filter(h => !isOurHook(h.command));
    removed += before - settings.hooks[event].length;

    // Clean up empty arrays
    if (settings.hooks[event].length === 0) {
      delete settings.hooks[event];
    }
  }

  // Clean up empty hooks object
  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  // Atomic write
  const dir = path.dirname(settingsPath);
  const tmpPath = path.join(dir, `.settings.json.tmp.${process.pid}`);
  fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2));
  fs.renameSync(tmpPath, settingsPath);

  return { success: true, removed };
}

/**
 * Write installation manifest for clean uninstall.
 * @param {string} manifestPath
 * @param {object} manifest
 */
function writeManifest(manifestPath, manifest) {
  const dir = path.dirname(manifestPath);
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ok */ }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

/**
 * Read installation manifest.
 * @param {string} manifestPath
 * @returns {object|null}
 */
function readManifest(manifestPath) {
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch {
    return null;
  }
}

module.exports = {
  extractSignature,
  isOurHook,
  mergeHookArray,
  mergeSettings,
  mergeIntoFile,
  removeOurHooks,
  writeManifest,
  readManifest,
};
