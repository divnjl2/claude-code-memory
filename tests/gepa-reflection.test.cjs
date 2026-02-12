#!/usr/bin/env node
/**
 * Tests for gepa-reflection.cjs
 * Validates: module exports, graceful handling without DB
 */

'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { reflect, promote, deprecate, resurrect } = require('../src/lib/gepa-reflection.cjs');

describe('gepa-reflection', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-reflect-'));
    const memDir = path.join(tmpDir, '.claude-memory');
    fs.mkdirSync(path.join(memDir, 'db'), { recursive: true });
    fs.mkdirSync(path.join(memDir, 'gepa'), { recursive: true });
    fs.writeFileSync(path.join(memDir, 'config.json'), JSON.stringify({
      gepa: { enabled: true, quarantineCycles: 20, minFitnessForPromotion: 0.8, diversityQuota: 3 },
    }));
    fs.writeFileSync(path.join(memDir, 'gepa', 'state.json'), JSON.stringify({
      cycle: 0, lastReflection: null,
    }));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('reflect', () => {
    it('returns error when no database', () => {
      const result = reflect(tmpDir);
      assert.equal(result.success, false);
      assert.ok(result.error);
    });

    it('returns expected structure', () => {
      const result = reflect(tmpDir);
      assert.ok('checks' in result);
      assert.ok('actions' in result);
      assert.ok('cycle' in result);
    });
  });

  describe('promote', () => {
    it('returns error when no database', () => {
      const result = promote(tmpDir, 'test-id');
      assert.equal(result.success, false);
    });
  });

  describe('deprecate', () => {
    it('returns error when no database', () => {
      const result = deprecate(tmpDir, 'test-id');
      assert.equal(result.success, false);
    });
  });

  describe('resurrect', () => {
    it('returns error when no database', () => {
      const result = resurrect(tmpDir, 'test-id');
      assert.equal(result.success, false);
    });
  });

  describe('module exports', () => {
    it('exports all functions', () => {
      assert.equal(typeof reflect, 'function');
      assert.equal(typeof promote, 'function');
      assert.equal(typeof deprecate, 'function');
      assert.equal(typeof resurrect, 'function');
    });
  });
});
