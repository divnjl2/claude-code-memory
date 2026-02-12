#!/usr/bin/env node
/**
 * Tests for gepa-fitness.cjs
 * Validates: fitness engine exports exist and handle missing DB gracefully.
 * SQLite-dependent tests are integration-only (need Python + DB).
 */

'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { updateFitness, paretoSelect, applyDecay } = require('../src/lib/gepa-fitness.cjs');

describe('gepa-fitness', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-fitness-'));
    fs.mkdirSync(path.join(tmpDir, '.claude-memory', 'db'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('updateFitness', () => {
    it('returns error when no database', () => {
      const result = updateFitness(tmpDir);
      assert.equal(result.updated, 0);
      assert.ok(result.error);
    });

    it('accepts options', () => {
      const result = updateFitness(tmpDir, { layer: 'mutating', maxAgeDays: 60 });
      assert.equal(result.updated, 0);
    });
  });

  describe('paretoSelect', () => {
    it('returns empty when no database', () => {
      const result = paretoSelect(tmpDir, 5);
      assert.deepEqual(result.candidates, []);
      assert.equal(result.preserved, 0);
    });

    it('accepts diversity quota', () => {
      const result = paretoSelect(tmpDir, 5, { diversityQuota: 2 });
      assert.deepEqual(result.candidates, []);
    });
  });

  describe('applyDecay', () => {
    it('returns 0 when no database', () => {
      const result = applyDecay(tmpDir);
      assert.equal(result.decayed, 0);
    });

    it('accepts options', () => {
      const result = applyDecay(tmpDir, {
        inactivityThresholdDays: 7,
        decayRate: 0.02,
        minImportance: 0.2,
      });
      assert.equal(result.decayed, 0);
    });
  });

  describe('module exports', () => {
    it('exports all functions', () => {
      assert.equal(typeof updateFitness, 'function');
      assert.equal(typeof paretoSelect, 'function');
      assert.equal(typeof applyDecay, 'function');
    });
  });
});
