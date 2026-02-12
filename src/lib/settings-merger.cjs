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

  // Strip trailing `2>/dev/null || true` and similar noise
  const cleanCmd = command.replace(/\s+2>\/dev\/null.*$/, '').replace(/\s+2>nul.*$/, '').trim();

  // Match: node "path/to/script.cjs" subcommand
  const match = cleanCmd.match(/node\s+"?([^"]+\.(?:cjs|js|mjs))"?\s+(\S+)/);
  if (match) {
    const script = path.basename(match[1]);
    const subcmd = match[2];
    return `${script}::${subcmd}`;
  }

  // Match: node "path/to/script.cjs" (no subcommand, e.g. inherit-params.cjs)
  const nodeOnlyMatch = cleanCmd.match(/node\s+"?([^"]+\.(?:cjs|js|mjs))"?\s*$/);
  if (nodeOnlyMatch) {
    return `${path.basename(nodeOnlyMatch[1])}::run`;
  }

  // Match: python "path/to/script.py" subcommand
  const pyMatch = cleanCmd.match(/python\d?\s+"?([^"]+\.py)"?\s+(\S+)/);
  if (pyMatch) {
    const script = path.basename(pyMatch[1]);
    const subcmd = pyMatch[2];
    return `${script}::${subcmd}`;
  }

  // Match: bash "path/to/script.sh" (no subcommand)
  const bashMatch = cleanCmd.match(/bash\s+"?([^"]+\.sh)"?/);
  if (bashMatch) {
    return `${path.basename(bashMatch[1])}::run`;
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
 * Extract all signatures from a hook group's hooks array.
 * @param {object} group - { matcher?, hooks: [...] }
 * @returns {Set<string>}
 */
function extractGroupSignatures(group) {
  const sigs = new Set();
  if (!group || !group.hooks) return sigs;
  for (const h of group.hooks) {
    const sig = extractSignature(h.command);
    if (sig) sigs.add(sig);
  }
  return sigs;
}

/**
 * Merge new hook groups into existing hook groups for a specific event.
 *
 * Claude Code settings.json uses nested format:
 *   [{ matcher: "^(Edit|Write)$", hooks: [{ type, command, timeout, continueOnError }] }]
 *
 * For events without matchers (SessionStart, Stop, Notification):
 *   [{ hooks: [{ type, command, timeout, continueOnError }] }]
 *
 * Strategy:
 *   1. Match groups by `matcher` (or lack thereof)
 *   2. Within each group, match individual hooks by signature
 *   3. Update existing, add new, never remove foreign hooks
 *
 * @param {Array} existing - Current hook groups for this event
 * @param {Array} newGroups - New hook groups to merge
 * @returns {Array} Merged hook groups array
 */
function mergeHookArray(existing, newGroups) {
  if (!existing || !Array.isArray(existing)) existing = [];
  if (!newGroups || !Array.isArray(newGroups)) return existing;

  const result = JSON.parse(JSON.stringify(existing)); // deep clone

  for (const newGroup of newGroups) {
    const newMatcher = newGroup.matcher || null;

    // Find matching existing group
    let matchedGroupIdx = -1;
    for (let i = 0; i < result.length; i++) {
      const existingMatcher = result[i].matcher || null;
      if (newMatcher === existingMatcher) {
        matchedGroupIdx = i;
        break;
      }
    }

    if (matchedGroupIdx >= 0) {
      // Merge hooks within the matched group
      const existingGroup = result[matchedGroupIdx];
      if (!existingGroup.hooks) existingGroup.hooks = [];

      // Build signature map of existing hooks in this group
      const existingSigMap = new Map();
      for (let i = 0; i < existingGroup.hooks.length; i++) {
        const sig = extractSignature(existingGroup.hooks[i].command);
        if (sig) existingSigMap.set(sig, i);
      }

      for (const newHook of (newGroup.hooks || [])) {
        const sig = extractSignature(newHook.command);
        if (sig && existingSigMap.has(sig)) {
          // Update existing hook in place
          existingGroup.hooks[existingSigMap.get(sig)] = newHook;
        } else {
          // Add new hook to this group
          existingGroup.hooks.push(newHook);
        }
      }
    } else {
      // No matching group — add new group
      result.push(newGroup);
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

  // Count what changes (nested format)
  let added = 0;
  let updated = 0;
  const existingHooks = existing.hooks || {};

  for (const [event, newGroups] of Object.entries(newHooks)) {
    const currentGroups = existingHooks[event] || [];
    for (const newGroup of newGroups) {
      const newMatcher = newGroup.matcher || null;
      const matchedGroup = currentGroups.find(g => (g.matcher || null) === newMatcher);

      if (matchedGroup && matchedGroup.hooks) {
        // Count hooks within matched group
        const existingSigs = new Set(matchedGroup.hooks.map(h => extractSignature(h.command)).filter(Boolean));
        for (const newHook of (newGroup.hooks || [])) {
          const sig = extractSignature(newHook.command);
          if (sig && existingSigs.has(sig)) updated++;
          else added++;
        }
      } else {
        // Entire group is new
        added += (newGroup.hooks || []).length;
      }
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
 * Works with nested format: removes individual hooks from groups,
 * and removes entire groups if they become empty.
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
    if (!Array.isArray(settings.hooks[event])) continue;

    for (const group of settings.hooks[event]) {
      if (group.hooks && Array.isArray(group.hooks)) {
        // Nested format: filter hooks within each group
        const before = group.hooks.length;
        group.hooks = group.hooks.filter(h => !isOurHook(h.command));
        removed += before - group.hooks.length;
      } else if (group.command) {
        // Flat format (legacy): mark for removal at group level
        if (isOurHook(group.command)) {
          group._remove = true;
          removed++;
        }
      }
    }

    // Remove empty groups and flat-format marked groups
    settings.hooks[event] = settings.hooks[event].filter(g => {
      if (g._remove) return false;
      if (g.hooks && g.hooks.length === 0) return false;
      return true;
    });

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
