#!/usr/bin/env node
/**
 * python-detector.cjs — Detect Python availability for Layer 4 (GraphMemory).
 *
 * Checks for Python 3 in PATH and returns info about the installation.
 * Zero dependencies.
 */

'use strict';

const { execFileSync } = require('child_process');

/**
 * Detect Python installation.
 * @returns {{ available: boolean, command: string, version: string|null, hasMinVersion: boolean }}
 */
function detectPython() {
  const candidates = process.platform === 'win32'
    ? ['python', 'python3', 'py -3']
    : ['python3', 'python'];

  for (const cmd of candidates) {
    try {
      const parts = cmd.split(' ');
      const result = execFileSync(parts[0], [...parts.slice(1), '--version'], {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();

      const versionMatch = result.match(/Python\s+(\d+)\.(\d+)\.(\d+)/);
      if (versionMatch) {
        const major = parseInt(versionMatch[1]);
        const minor = parseInt(versionMatch[2]);
        const patch = parseInt(versionMatch[3]);
        const version = `${major}.${minor}.${patch}`;
        const hasMinVersion = major >= 3 && minor >= 8;

        return {
          available: true,
          command: parts[0],
          version,
          hasMinVersion,
        };
      }
    } catch {
      // Try next candidate
    }
  }

  return {
    available: false,
    command: null,
    version: null,
    hasMinVersion: false,
  };
}

/**
 * Check if sqlite3 module is available in Python.
 * @param {string} pythonCmd - Python command
 * @returns {boolean}
 */
function hasSqlite3(pythonCmd) {
  try {
    execFileSync(pythonCmd, ['-c', 'import sqlite3; print("ok")'], {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

module.exports = { detectPython, hasSqlite3 };
