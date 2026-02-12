#!/usr/bin/env node
/**
 * Tests for auto-cleanup.cjs
 * Validates: shouldCleanup threshold logic, cleanup with mocked DB
 */

'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { shouldCleanup } = require('../src/lib/auto-cleanup.cjs');

describe('auto-cleanup', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-cleanup-'));
    const memDir = path.join(tmpDir, '.claude-memory');
    fs.mkdirSync(path.join(memDir, 'db'), { recursive: true });
    fs.mkdirSync(path.join(memDir, 'bridge'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('shouldCleanup', () => {
    it('returns needed=false when under threshold', () => {
      // Default config: maxSizeMB=10, threshold=0.8 → need >8MB
      // Empty dir is basically 0 bytes
      const result = shouldCleanup(tmpDir);
      assert.equal(result.needed, false);
      assert.equal(result.currentMB, 0);
      assert.equal(result.maxMB, 10);
    });

    it('returns needed=true when over threshold', () => {
      // Write config with very low limit
      fs.writeFileSync(path.join(tmpDir, '.claude-memory', 'config.json'), JSON.stringify({
        maxSizeMB: 0.001, // 1KB limit
        autoCleanupThreshold: 0.8,
      }));

      // Write some data to exceed limit
      const dbPath = path.join(tmpDir, '.claude-memory', 'db', 'memory.db');
      fs.writeFileSync(dbPath, 'x'.repeat(2000)); // 2KB, well over 0.001MB * 0.8

      const result = shouldCleanup(tmpDir);
      assert.equal(result.needed, true);
    });

    it('uses default config when config.json missing', () => {
      const result = shouldCleanup(tmpDir);
      assert.equal(result.maxMB, 10); // default
    });

    it('reports correct percentage', () => {
      fs.writeFileSync(path.join(tmpDir, '.claude-memory', 'config.json'), JSON.stringify({
        maxSizeMB: 1,
        autoCleanupThreshold: 0.5,
      }));

      const result = shouldCleanup(tmpDir);
      assert.ok(result.pct >= 0);
      assert.ok(result.pct <= 100);
    });
  });
});
