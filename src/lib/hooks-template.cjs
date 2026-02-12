#!/usr/bin/env node
/**
 * hooks-template.cjs — Generate hooks configuration for settings.json.
 *
 * Takes a hooks directory path and returns the full hooks object
 * with 12 hook points that wire up the 4-layer memory system.
 *
 * Zero dependencies.
 */

'use strict';

const path = require('path');

/**
 * Build a hook command string.
 * @param {string} hooksDir - Absolute path to hooks directory
 * @param {string} script - Script filename
 * @param {string} subcmd - Subcommand
 * @param {string[]} [extraArgs] - Additional args
 * @returns {string}
 */
function cmd(hooksDir, script, subcmd, extraArgs) {
  const scriptPath = path.join(hooksDir, script).replace(/\\/g, '/');
  const parts = ['node', `"${scriptPath}"`, subcmd];
  if (extraArgs) parts.push(...extraArgs);
  return parts.join(' ');
}

/**
 * Generate full hooks configuration for settings.json.
 *
 * @param {string} hooksDir - Absolute path to hooks directory (e.g., ~/.claude/hooks/)
 * @returns {object} Hooks object keyed by event name
 */
function generateHooks(hooksDir) {
  return {
    // ── PreToolUse hooks ──
    PreToolUse: [
      {
        matcher: 'Edit|Write',
        command: cmd(hooksDir, 'memory-bridge.cjs', 'on-pre-edit'),
        timeout: 3000,
      },
      {
        matcher: 'Edit|Write',
        command: cmd(hooksDir, 'hook-runner.cjs', 'pre-edit'),
        timeout: 3000,
      },
      {
        matcher: 'Bash',
        command: cmd(hooksDir, 'hook-runner.cjs', 'pre-command'),
        timeout: 3000,
      },
      {
        matcher: 'Task',
        command: cmd(hooksDir, 'hook-runner.cjs', 'pre-task'),
        timeout: 5000,
      },
    ],

    // ── PostToolUse hooks ──
    PostToolUse: [
      {
        matcher: 'Edit|Write',
        command: cmd(hooksDir, 'memory-bridge.cjs', 'on-planning-edit'),
        timeout: 3000,
      },
      {
        matcher: 'Edit|Write',
        command: cmd(hooksDir, 'hook-runner.cjs', 'post-edit'),
        timeout: 3000,
      },
      {
        matcher: 'Bash',
        command: cmd(hooksDir, 'hook-runner.cjs', 'post-command'),
        timeout: 3000,
      },
      {
        matcher: 'Task',
        command: cmd(hooksDir, 'hook-runner.cjs', 'post-task'),
        timeout: 5000,
      },
    ],

    // ── Session hooks ──
    SessionStart: [
      {
        command: cmd(hooksDir, 'memory-bridge.cjs', 'load-context'),
        timeout: 10000,
      },
      {
        command: cmd(hooksDir, 'hook-runner.cjs', 'session-start'),
        timeout: 5000,
      },
    ],

    // ── Stop hooks ──
    Stop: [
      {
        command: cmd(hooksDir, 'memory-bridge.cjs', 'persist'),
        timeout: 10000,
      },
      {
        command: cmd(hooksDir, 'hook-runner.cjs', 'session-end'),
        timeout: 5000,
      },
    ],

    // ── Notification hooks ──
    Notification: [
      {
        command: cmd(hooksDir, 'hook-runner.cjs', 'notify'),
        timeout: 3000,
      },
    ],
  };
}

/**
 * Generate a minimal hooks config (without memory-bridge, for --global-only).
 * @param {string} hooksDir
 * @returns {object}
 */
function generateMinimalHooks(hooksDir) {
  return {
    PreToolUse: [
      {
        matcher: 'Edit|Write',
        command: cmd(hooksDir, 'hook-runner.cjs', 'pre-edit'),
        timeout: 3000,
      },
      {
        matcher: 'Bash',
        command: cmd(hooksDir, 'hook-runner.cjs', 'pre-command'),
        timeout: 3000,
      },
    ],
    PostToolUse: [
      {
        matcher: 'Edit|Write',
        command: cmd(hooksDir, 'hook-runner.cjs', 'post-edit'),
        timeout: 3000,
      },
      {
        matcher: 'Bash',
        command: cmd(hooksDir, 'hook-runner.cjs', 'post-command'),
        timeout: 3000,
      },
    ],
    SessionStart: [
      {
        command: cmd(hooksDir, 'hook-runner.cjs', 'session-start'),
        timeout: 5000,
      },
    ],
    Stop: [
      {
        command: cmd(hooksDir, 'hook-runner.cjs', 'session-end'),
        timeout: 5000,
      },
    ],
  };
}

module.exports = { generateHooks, generateMinimalHooks };
