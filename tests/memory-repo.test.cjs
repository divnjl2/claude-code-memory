#!/usr/bin/env node
/**
 * Tests for memory-repo.cjs
 * Validates: directory creation, config, gitignore integration
 */

'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { initMemoryRepo, getConfig, getMemorySize, addToMainGitignore, DEFAULT_CONFIG } = require('../src/lib/memory-repo.cjs');

describe('memory-repo', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-repo-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('initMemoryRepo', () => {
    it('creates directory structure', () => {
      const result = initMemoryRepo(tmpDir);
      assert.ok(result.created);
      assert.ok(fs.existsSync(path.join(tmpDir, '.claude-memory')));
      assert.ok(fs.existsSync(path.join(tmpDir, '.claude-memory', 'db')));
      assert.ok(fs.existsSync(path.join(tmpDir, '.claude-memory', 'bridge')));
      assert.ok(fs.existsSync(path.join(tmpDir, '.claude-memory', 'history')));
    });

    it('creates config.json with defaults', () => {
      initMemoryRepo(tmpDir);
      const configPath = path.join(tmpDir, '.claude-memory', 'config.json');
      assert.ok(fs.existsSync(configPath));
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      assert.equal(config.maxSizeMB, 10);
      assert.equal(config.ttlDays, 30);
      assert.equal(config.minImportance, 0.3);
    });

    it('creates .gitignore for memory repo', () => {
      initMemoryRepo(tmpDir);
      const gitignore = path.join(tmpDir, '.claude-memory', '.gitignore');
      assert.ok(fs.existsSync(gitignore));
      const content = fs.readFileSync(gitignore, 'utf-8');
      assert.ok(content.includes('*.tmp'));
      assert.ok(content.includes('*.db-journal'));
    });

    it('does not overwrite existing config', () => {
      const memDir = path.join(tmpDir, '.claude-memory');
      fs.mkdirSync(memDir, { recursive: true });
      fs.writeFileSync(path.join(memDir, 'config.json'), JSON.stringify({ maxSizeMB: 50 }));

      initMemoryRepo(tmpDir);
      const config = JSON.parse(fs.readFileSync(path.join(memDir, 'config.json'), 'utf-8'));
      assert.equal(config.maxSizeMB, 50);
    });

    it('sets encryption in config when requested', () => {
      initMemoryRepo(tmpDir, { encrypt: true });
      const config = JSON.parse(fs.readFileSync(path.join(tmpDir, '.claude-memory', 'config.json'), 'utf-8'));
      assert.equal(config.encryption, true);
    });
  });

  describe('addToMainGitignore', () => {
    it('adds .claude-memory/ to .gitignore', () => {
      addToMainGitignore(tmpDir);
      const content = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf-8');
      assert.ok(content.includes('.claude-memory/'));
    });

    it('does not duplicate entry', () => {
      addToMainGitignore(tmpDir);
      addToMainGitignore(tmpDir);
      const content = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf-8');
      const matches = content.match(/\.claude-memory\//g);
      assert.equal(matches.length, 1);
    });

    it('appends to existing .gitignore', () => {
      fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'node_modules/\n');
      addToMainGitignore(tmpDir);
      const content = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf-8');
      assert.ok(content.includes('node_modules/'));
      assert.ok(content.includes('.claude-memory/'));
    });
  });

  describe('getConfig', () => {
    it('returns defaults when no config file', () => {
      const config = getConfig(tmpDir);
      assert.deepEqual(config, DEFAULT_CONFIG);
    });

    it('merges with defaults', () => {
      const memDir = path.join(tmpDir, '.claude-memory');
      fs.mkdirSync(memDir, { recursive: true });
      fs.writeFileSync(path.join(memDir, 'config.json'), JSON.stringify({ maxSizeMB: 20 }));
      const config = getConfig(tmpDir);
      assert.equal(config.maxSizeMB, 20);
      assert.equal(config.ttlDays, 30); // from defaults
    });
  });

  describe('getMemorySize', () => {
    it('returns 0 for non-existent dir', () => {
      assert.equal(getMemorySize(path.join(tmpDir, 'nonexistent')), 0);
    });

    it('returns correct size for files', () => {
      initMemoryRepo(tmpDir);
      const dbPath = path.join(tmpDir, '.claude-memory', 'db', 'test.db');
      fs.writeFileSync(dbPath, 'x'.repeat(1000));
      const size = getMemorySize(tmpDir);
      assert.ok(size >= 1000);
    });
  });
});
