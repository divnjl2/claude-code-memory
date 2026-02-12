#!/usr/bin/env node
/**
 * path-resolver.cjs — Cross-platform path resolution for claude-code-memory.
 *
 * Resolves paths for:
 *   - Global hooks dir (~/.claude/hooks/)
 *   - Global settings (~/.claude/settings.json)
 *   - Project memory dir (.claude-memory/)
 *   - Hook commands (with forward-slash normalization)
 *
 * Zero dependencies — Node.js built-ins only.
 */

'use strict';

const path = require('path');
const os = require('os');

/** Get user home directory (cross-platform) */
function getHome() {
  return process.env.USERPROFILE || process.env.HOME || os.homedir();
}

/** Get global Claude config dir: ~/.claude/ */
function getClaudeDir() {
  return path.join(getHome(), '.claude');
}

/** Get global hooks dir: ~/.claude/hooks/ */
function getGlobalHooksDir() {
  return path.join(getClaudeDir(), 'hooks');
}

/** Get global settings path: ~/.claude/settings.json */
function getGlobalSettingsPath() {
  return path.join(getClaudeDir(), 'settings.json');
}

/** Get project settings path: <projectRoot>/.claude/settings.json */
function getProjectSettingsPath(projectRoot) {
  return path.join(projectRoot, '.claude', 'settings.json');
}

/** Get memory dir for a project: <projectRoot>/.claude-memory/ */
function getMemoryDir(projectRoot) {
  return path.join(projectRoot, '.claude-memory');
}

/** Get memory DB path: <projectRoot>/.claude-memory/db/memory.db */
function getMemoryDbPath(projectRoot) {
  return path.join(getMemoryDir(projectRoot), 'db', 'memory.db');
}

/** Get bridge cache dir: <projectRoot>/.claude-memory/bridge/ */
function getBridgeDir(projectRoot) {
  return path.join(getMemoryDir(projectRoot), 'bridge');
}

/** Get manifest path: ~/.claude/.claude-code-memory-manifest.json */
function getManifestPath() {
  return path.join(getClaudeDir(), '.claude-code-memory-manifest.json');
}

/**
 * Resolve a hook command with forward slashes (works on Windows + Unix).
 * @param {string} hooksDir - Directory containing hook scripts
 * @param {string} script - Script filename (e.g., 'hook-runner.cjs')
 * @param {string} subcmd - Subcommand (e.g., 'pre-edit')
 * @param {string[]} [args] - Additional arguments
 * @returns {string} Full command string
 */
function resolveHookCommand(hooksDir, script, subcmd, args) {
  const scriptPath = path.join(hooksDir, script).replace(/\\/g, '/');
  const parts = ['node', `"${scriptPath}"`, subcmd];
  if (args && args.length > 0) {
    parts.push(...args);
  }
  return parts.join(' ');
}

/**
 * Normalize a path to use forward slashes (for settings.json compatibility).
 * @param {string} p - Path to normalize
 * @returns {string} Normalized path
 */
function forwardSlash(p) {
  return p.replace(/\\/g, '/');
}

/**
 * Get the auto-memory projects dir: ~/.claude/projects/
 * @returns {string}
 */
function getAutoMemoryDir() {
  return path.join(getClaudeDir(), 'projects');
}

module.exports = {
  getHome,
  getClaudeDir,
  getGlobalHooksDir,
  getGlobalSettingsPath,
  getProjectSettingsPath,
  getMemoryDir,
  getMemoryDbPath,
  getBridgeDir,
  getManifestPath,
  resolveHookCommand,
  forwardSlash,
  getAutoMemoryDir,
};
