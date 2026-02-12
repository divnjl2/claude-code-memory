#!/usr/bin/env node
/**
 * memory-repo.cjs — Separate git repo manager for .claude-memory/.
 *
 * Manages an isolated git repository for memory storage,
 * keeping it separate from the main project's git history.
 *
 * Zero dependencies.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { getMemoryDir, getBridgeDir, getMemoryDbPath } = require('./path-resolver.cjs');

/** Default config for .claude-memory/config.json */
const DEFAULT_CONFIG = {
  version: 1,
  maxSizeMB: 10,
  ttlDays: 30,
  minImportance: 0.3,
  encryption: false,
  autoCommit: true,
  autoPush: false, // Push to remote after auto-commit at session-end
  autoCleanupThreshold: 0.8, // 80% of maxSizeMB triggers auto-cleanup
};

/**
 * Ensure a directory exists.
 * @param {string} dir
 */
function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ok */ }
}

/**
 * Initialize the .claude-memory/ directory structure + git repo.
 *
 * @param {string} projectRoot - Project root directory
 * @param {object} [options]
 * @param {boolean} [options.encrypt] - Enable encryption
 * @param {string} [options.remote] - Remote git URL
 * @returns {{ created: boolean, memoryDir: string, gitInit: boolean }}
 */
function initMemoryRepo(projectRoot, options = {}) {
  const memoryDir = getMemoryDir(projectRoot);
  const dbDir = path.join(memoryDir, 'db');
  const bridgeDir = path.join(memoryDir, 'bridge');
  const historyDir = path.join(memoryDir, 'history');

  // Create structure
  ensureDir(dbDir);
  ensureDir(bridgeDir);
  ensureDir(historyDir);

  // Write config
  const configPath = path.join(memoryDir, 'config.json');
  if (!fs.existsSync(configPath)) {
    const config = { ...DEFAULT_CONFIG };
    if (options.encrypt) config.encryption = true;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  }

  // Write .gitignore for memory repo
  const gitignorePath = path.join(memoryDir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, [
      '# Temp files',
      '*.tmp',
      '*.bak',
      '*.swp',
      '',
      '# SQLite journals',
      '*.db-journal',
      '*.db-wal',
      '*.db-shm',
      '',
    ].join('\n'));
  }

  // Initialize git repo
  let gitInit = false;
  const gitDir = path.join(memoryDir, '.git');
  if (!fs.existsSync(gitDir)) {
    try {
      execFileSync('git', ['init'], {
        cwd: memoryDir,
        encoding: 'utf-8',
        timeout: 10000,
        stdio: 'pipe',
      });
      gitInit = true;

      // Initial commit
      execFileSync('git', ['add', '.'], {
        cwd: memoryDir,
        encoding: 'utf-8',
        timeout: 10000,
        stdio: 'pipe',
      });
      execFileSync('git', ['commit', '-m', 'Initial memory repo setup'], {
        cwd: memoryDir,
        encoding: 'utf-8',
        timeout: 10000,
        stdio: 'pipe',
      });
    } catch {
      // Git not available — still works without versioning
    }
  }

  // Add remote if specified
  if (options.remote) {
    try {
      execFileSync('git', ['remote', 'add', 'origin', options.remote], {
        cwd: memoryDir,
        encoding: 'utf-8',
        timeout: 10000,
        stdio: 'pipe',
      });
    } catch {
      // Remote might already exist
      try {
        execFileSync('git', ['remote', 'set-url', 'origin', options.remote], {
          cwd: memoryDir,
          encoding: 'utf-8',
          timeout: 10000,
          stdio: 'pipe',
        });
      } catch { /* ok */ }
    }
  }

  // Add .claude-memory to main project's .gitignore
  addToMainGitignore(projectRoot);

  return { created: true, memoryDir, gitInit };
}

/**
 * Add .claude-memory to the main project's .gitignore.
 * @param {string} projectRoot
 */
function addToMainGitignore(projectRoot) {
  const gitignorePath = path.join(projectRoot, '.gitignore');
  const entry = '.claude-memory/';

  try {
    let content = '';
    if (fs.existsSync(gitignorePath)) {
      content = fs.readFileSync(gitignorePath, 'utf-8');
    }

    if (!content.includes(entry)) {
      const newline = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
      fs.writeFileSync(gitignorePath, content + newline + '\n# Claude Code Memory (private)\n' + entry + '\n');
    }
  } catch { /* ok */ }
}

/**
 * Commit current memory state.
 * @param {string} projectRoot
 * @param {string} [message]
 * @returns {boolean}
 */
function syncMemoryRepo(projectRoot, message) {
  const memoryDir = getMemoryDir(projectRoot);
  if (!fs.existsSync(path.join(memoryDir, '.git'))) return false;

  try {
    // Check for changes
    const status = execFileSync('git', ['status', '--porcelain'], {
      cwd: memoryDir,
      encoding: 'utf-8',
      timeout: 10000,
      stdio: 'pipe',
    }).trim();

    if (!status) return true; // Nothing to commit

    execFileSync('git', ['add', '-A'], {
      cwd: memoryDir,
      encoding: 'utf-8',
      timeout: 10000,
      stdio: 'pipe',
    });

    const commitMsg = message || `Memory sync ${new Date().toISOString().split('T')[0]}`;
    execFileSync('git', ['commit', '-m', commitMsg], {
      cwd: memoryDir,
      encoding: 'utf-8',
      timeout: 10000,
      stdio: 'pipe',
    });

    return true;
  } catch {
    return false;
  }
}

/**
 * Set up or update remote for memory repo.
 * @param {string} projectRoot
 * @param {string} url - Remote URL
 * @returns {boolean}
 */
function setupRemote(projectRoot, url) {
  const memoryDir = getMemoryDir(projectRoot);
  if (!fs.existsSync(path.join(memoryDir, '.git'))) return false;

  try {
    // Check if remote exists
    const remotes = execFileSync('git', ['remote'], {
      cwd: memoryDir,
      encoding: 'utf-8',
      timeout: 5000,
      stdio: 'pipe',
    }).trim();

    if (remotes.includes('origin')) {
      execFileSync('git', ['remote', 'set-url', 'origin', url], {
        cwd: memoryDir,
        encoding: 'utf-8',
        timeout: 5000,
        stdio: 'pipe',
      });
    } else {
      execFileSync('git', ['remote', 'add', 'origin', url], {
        cwd: memoryDir,
        encoding: 'utf-8',
        timeout: 5000,
        stdio: 'pipe',
      });
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Get memory config.
 * @param {string} projectRoot
 * @returns {object}
 */
function getConfig(projectRoot) {
  const configPath = path.join(getMemoryDir(projectRoot), 'config.json');
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(configPath, 'utf-8')) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Get memory repo size in bytes.
 * @param {string} projectRoot
 * @returns {number}
 */
function getMemorySize(projectRoot) {
  const memoryDir = getMemoryDir(projectRoot);
  if (!fs.existsSync(memoryDir)) return 0;

  let totalSize = 0;
  function walkDir(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.name === '.git') continue; // Skip .git
        if (entry.isDirectory()) {
          walkDir(fullPath);
        } else {
          try {
            totalSize += fs.statSync(fullPath).size;
          } catch { /* ok */ }
        }
      }
    } catch { /* ok */ }
  }
  walkDir(memoryDir);
  return totalSize;
}

module.exports = {
  DEFAULT_CONFIG,
  initMemoryRepo,
  addToMainGitignore,
  syncMemoryRepo,
  setupRemote,
  getConfig,
  getMemorySize,
};
