#!/usr/bin/env node
/**
 * hooks-template.cjs — Generate hooks configuration for settings.json.
 *
 * Generates hooks in Claude Code's native format:
 *   { matcher: "^(Edit|Write)$", hooks: [{ type: "command", command: "...", timeout, continueOnError }] }
 *
 * This is the format used by Claude Code's settings.json (nested hooks[] array).
 *
 * Zero dependencies.
 */

'use strict';

const path = require('path');

/**
 * Build a hook command string with error suppression.
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
  return parts.join(' ') + ' 2>/dev/null || true';
}

/**
 * Create a single hook entry in Claude Code's native format.
 * @param {string} command - Full command string
 * @param {number} timeout - Timeout in ms
 * @returns {object}
 */
function hookEntry(command, timeout) {
  return {
    type: 'command',
    command,
    timeout,
    continueOnError: true,
  };
}

/**
 * Create a matcher group (for PreToolUse/PostToolUse).
 * @param {string} matcher - Regex matcher string
 * @param {object[]} hooks - Array of hook entries
 * @returns {object}
 */
function matcherGroup(matcher, hooks) {
  return { matcher, hooks };
}

/**
 * Create a non-matcher group (for SessionStart/Stop/Notification).
 * @param {object[]} hooks - Array of hook entries
 * @returns {object}
 */
function hookGroup(hooks) {
  return { hooks };
}

/**
 * Generate full hooks configuration for settings.json.
 *
 * Uses Claude Code's native nested format:
 *   PreToolUse: [{ matcher, hooks: [{ type, command, timeout, continueOnError }] }]
 *
 * @param {string} hooksDir - Absolute path to hooks directory (e.g., ~/.claude/hooks/)
 * @returns {object} Hooks object keyed by event name
 */
function generateHooks(hooksDir) {
  return {
    // ── PreToolUse hooks ──
    PreToolUse: [
      matcherGroup('^(Write|Edit|MultiEdit)$', [
        hookEntry(cmd(hooksDir, 'hook-runner.cjs', 'pre-edit', ['--file', '"$TOOL_INPUT_file_path"']), 3000),
        hookEntry(cmd(hooksDir, 'memory-bridge.cjs', 'on-pre-edit', ['--file', '"$TOOL_INPUT_file_path"']), 2000),
      ]),
      matcherGroup('^Bash$', [
        hookEntry(cmd(hooksDir, 'hook-runner.cjs', 'pre-command', ['--command', '"$TOOL_INPUT_command"']), 3000),
      ]),
      matcherGroup('^Task$', [
        hookEntry(cmd(hooksDir, 'hook-runner.cjs', 'pre-task', ['--description', '"$TOOL_INPUT_prompt"']), 3000),
        hookEntry(cmd(hooksDir, 'inherit-params.cjs'), 3000),
      ]),
    ],

    // ── PostToolUse hooks ──
    PostToolUse: [
      matcherGroup('^(Write|Edit|MultiEdit)$', [
        hookEntry(cmd(hooksDir, 'hook-runner.cjs', 'post-edit', ['--file', '"$TOOL_INPUT_file_path"', '--success', '"${TOOL_SUCCESS:-true}"']), 3000),
        hookEntry(cmd(hooksDir, 'memory-bridge.cjs', 'on-planning-edit', ['--file', '"$TOOL_INPUT_file_path"']), 2000),
      ]),
      matcherGroup('^Bash$', [
        hookEntry(cmd(hooksDir, 'hook-runner.cjs', 'post-command', ['--command', '"$TOOL_INPUT_command"', '--success', '"${TOOL_SUCCESS:-true}"']), 3000),
      ]),
      matcherGroup('^Task$', [
        hookEntry(cmd(hooksDir, 'hook-runner.cjs', 'post-task', ['--task-id', '"$TOOL_RESULT_agent_id"', '--success', '"${TOOL_SUCCESS:-true}"']), 3000),
      ]),
    ],

    // ── UserPromptSubmit hooks ──
    UserPromptSubmit: [
      hookGroup([
        hookEntry(cmd(hooksDir, 'hook-runner.cjs', 'route', ['--task', '"$PROMPT"']), 2000),
      ]),
    ],

    // ── Session hooks ──
    SessionStart: [
      hookGroup([
        hookEntry(cmd(hooksDir, 'hook-runner.cjs', 'session-start', ['--session-id', '"$SESSION_ID"']), 5000),
        hookEntry(cmd(hooksDir, 'memory-bridge.cjs', 'load-context'), 3000),
      ]),
    ],

    // ── Stop hooks ──
    Stop: [
      hookGroup([
        hookEntry(cmd(hooksDir, 'memory-bridge.cjs', 'persist'), 5000),
        hookEntry(cmd(hooksDir, 'hook-runner.cjs', 'session-end'), 3000),
      ]),
    ],

    // ── Notification hooks ──
    Notification: [
      hookGroup([
        hookEntry(cmd(hooksDir, 'hook-runner.cjs', 'notify', ['--message', '"$NOTIFICATION_MESSAGE"']), 2000),
      ]),
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
      matcherGroup('^(Write|Edit|MultiEdit)$', [
        hookEntry(cmd(hooksDir, 'hook-runner.cjs', 'pre-edit', ['--file', '"$TOOL_INPUT_file_path"']), 3000),
      ]),
      matcherGroup('^Bash$', [
        hookEntry(cmd(hooksDir, 'hook-runner.cjs', 'pre-command', ['--command', '"$TOOL_INPUT_command"']), 3000),
      ]),
    ],
    PostToolUse: [
      matcherGroup('^(Write|Edit|MultiEdit)$', [
        hookEntry(cmd(hooksDir, 'hook-runner.cjs', 'post-edit', ['--file', '"$TOOL_INPUT_file_path"', '--success', '"${TOOL_SUCCESS:-true}"']), 3000),
      ]),
      matcherGroup('^Bash$', [
        hookEntry(cmd(hooksDir, 'hook-runner.cjs', 'post-command', ['--command', '"$TOOL_INPUT_command"', '--success', '"${TOOL_SUCCESS:-true}"']), 3000),
      ]),
    ],
    SessionStart: [
      hookGroup([
        hookEntry(cmd(hooksDir, 'hook-runner.cjs', 'session-start', ['--session-id', '"$SESSION_ID"']), 5000),
      ]),
    ],
    Stop: [
      hookGroup([
        hookEntry(cmd(hooksDir, 'hook-runner.cjs', 'session-end'), 3000),
      ]),
    ],
  };
}

module.exports = { generateHooks, generateMinimalHooks };
