#!/usr/bin/env node
/**
 * Tests for gepa.cjs CLI command
 * Validates: command dispatch, module loading
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const gepa = require('../src/commands/gepa.cjs');

describe('gepa CLI', () => {
  it('exports a function', () => {
    assert.equal(typeof gepa, 'function');
  });

  it('handles empty flags (shows help)', () => {
    // Should not throw
    gepa({});
  });

  it('handles unknown subcommand', () => {
    // Should not throw, just show help
    gepa({ _sub: 'unknown-command' });
  });

  it('handles status subcommand without crashing', () => {
    // Status should work even without initialized project
    gepa({ _sub: 'status' });
  });
});
