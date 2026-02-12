#!/usr/bin/env node
/**
 * Tests for gepa-validator.cjs
 * Validates: importance scoring, rate limiting (file-based, no SQLite needed)
 */

'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  calculateImportance, BASE_IMPORTANCE,
  checkRateLimit, consumeRateLimit, resetRateLimits,
} = require('../src/lib/gepa-validator.cjs');

describe('gepa-validator', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-validator-'));
    const memDir = path.join(tmpDir, '.claude-memory');
    fs.mkdirSync(path.join(memDir, 'db'), { recursive: true });
    fs.mkdirSync(path.join(memDir, 'gepa'), { recursive: true });
    fs.writeFileSync(path.join(memDir, 'config.json'), JSON.stringify({
      gepa: {
        enabled: true,
        rateLimits: {
          user: { max: 3, window: 'day' },
          promotion: { max: 2, window: 'cycle' },
          verifier: { max: 1, window: '10cycles' },
        },
      },
    }));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('calculateImportance', () => {
    it('uses base score for type', () => {
      assert.equal(calculateImportance('some pattern content here', 'pattern'), 0.8);
    });

    it('returns default for unknown type', () => {
      assert.equal(calculateImportance('something here for you', 'unknown'), 0.5);
    });

    it('boosts for user-explicit', () => {
      const score = calculateImportance('some explicit content here', 'fact', { isUserExplicit: true });
      assert.ok(score > BASE_IMPORTANCE.fact);
    });

    it('boosts for critical keywords', () => {
      const normal = calculateImportance('use semicolons everywhere', 'fact');
      const critical = calculateImportance('always use semicolons everywhere', 'fact');
      assert.ok(critical > normal);
    });

    it('penalizes short content', () => {
      const short = calculateImportance('hi', 'fact');
      const long = calculateImportance('this is a much longer piece of content', 'fact');
      assert.ok(short < long);
    });

    it('boosts for high mention count', () => {
      const normal = calculateImportance('use TypeScript for types', 'fact');
      const mentioned = calculateImportance('use TypeScript for types', 'fact', { mentionCount: 5 });
      assert.ok(mentioned > normal);
    });

    it('caps at 1.0', () => {
      const score = calculateImportance('always critical pattern', 'pattern', {
        isUserExplicit: true, mentionCount: 10,
      });
      assert.ok(score <= 1.0);
    });

    it('never goes below 0.1', () => {
      const score = calculateImportance('x', 'file');
      assert.ok(score >= 0.1);
    });
  });

  describe('checkRateLimit', () => {
    it('allows first request', () => {
      const result = checkRateLimit(tmpDir, 'user');
      assert.equal(result.allowed, true);
      assert.equal(result.remaining, 3);
    });

    it('blocks when limit exceeded', () => {
      // Consume all tokens
      consumeRateLimit(tmpDir, 'user');
      consumeRateLimit(tmpDir, 'user');
      consumeRateLimit(tmpDir, 'user');

      const result = checkRateLimit(tmpDir, 'user');
      assert.equal(result.allowed, false);
      assert.equal(result.remaining, 0);
    });

    it('allows unknown hook types', () => {
      const result = checkRateLimit(tmpDir, 'unknown_type');
      assert.equal(result.allowed, true);
      assert.equal(result.remaining, Infinity);
    });
  });

  describe('consumeRateLimit', () => {
    it('returns true when allowed', () => {
      assert.equal(consumeRateLimit(tmpDir, 'user'), true);
    });

    it('returns false when exceeded', () => {
      consumeRateLimit(tmpDir, 'user');
      consumeRateLimit(tmpDir, 'user');
      consumeRateLimit(tmpDir, 'user');
      assert.equal(consumeRateLimit(tmpDir, 'user'), false);
    });

    it('tracks count correctly', () => {
      consumeRateLimit(tmpDir, 'user');
      const check = checkRateLimit(tmpDir, 'user');
      assert.equal(check.remaining, 2);
    });
  });

  describe('resetRateLimits', () => {
    it('resets specific hook type', () => {
      consumeRateLimit(tmpDir, 'user');
      consumeRateLimit(tmpDir, 'user');
      consumeRateLimit(tmpDir, 'user');

      resetRateLimits(tmpDir, 'user');
      const result = checkRateLimit(tmpDir, 'user');
      assert.equal(result.allowed, true);
      assert.equal(result.remaining, 3);
    });

    it('resets cycle-based limits', () => {
      consumeRateLimit(tmpDir, 'promotion');
      consumeRateLimit(tmpDir, 'promotion');

      resetRateLimits(tmpDir); // Reset all cycle-based
      const result = checkRateLimit(tmpDir, 'promotion');
      assert.equal(result.allowed, true);
    });
  });

  describe('BASE_IMPORTANCE', () => {
    it('has scores for all node types', () => {
      assert.ok(BASE_IMPORTANCE.pattern >= 0.7);
      assert.ok(BASE_IMPORTANCE.decision >= 0.6);
      assert.ok(BASE_IMPORTANCE.error >= 0.6);
      assert.ok(BASE_IMPORTANCE.task >= 0.4);
      assert.ok(BASE_IMPORTANCE.fact >= 0.4);
      assert.ok(BASE_IMPORTANCE.file >= 0.3);
    });
  });
});
