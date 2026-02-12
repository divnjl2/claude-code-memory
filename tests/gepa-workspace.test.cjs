#!/usr/bin/env node
/**
 * Tests for gepa-workspace.cjs
 * Validates: workspace creation, trace saving, status
 */

'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { ensureWorkspace, saveTrace, workspaceStatus } = require('../src/lib/gepa-workspace.cjs');

describe('gepa-workspace', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-ws-'));
    const memDir = path.join(tmpDir, '.claude-memory');
    fs.mkdirSync(path.join(memDir, 'db'), { recursive: true });
    fs.mkdirSync(path.join(memDir, 'gepa'), { recursive: true });
    fs.writeFileSync(path.join(memDir, 'config.json'), JSON.stringify({
      gepa: { enabled: true },
    }));
    fs.writeFileSync(path.join(memDir, 'gepa', 'state.json'), JSON.stringify({
      cycle: 0,
    }));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('ensureWorkspace', () => {
    it('creates all subdirectories', () => {
      ensureWorkspace(tmpDir);
      const gepaDir = path.join(tmpDir, '.claude-memory', 'gepa');
      assert.ok(fs.existsSync(path.join(gepaDir, 'constant')));
      assert.ok(fs.existsSync(path.join(gepaDir, 'traces')));
      assert.ok(fs.existsSync(path.join(gepaDir, 'archive')));
    });

    it('is idempotent', () => {
      ensureWorkspace(tmpDir);
      ensureWorkspace(tmpDir);
      assert.ok(fs.existsSync(path.join(tmpDir, '.claude-memory', 'gepa', 'constant')));
    });
  });

  describe('saveTrace', () => {
    it('saves trace to traces directory', () => {
      ensureWorkspace(tmpDir);
      const tracePath = saveTrace(tmpDir, 'test-123', { goal: 'test', duration: '5m' });
      assert.ok(fs.existsSync(tracePath));
      const trace = JSON.parse(fs.readFileSync(tracePath, 'utf-8'));
      assert.equal(trace.sessionId, 'test-123');
      assert.equal(trace.goal, 'test');
    });
  });

  describe('workspaceStatus', () => {
    it('returns exists=false when workspace missing', () => {
      const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-empty-'));
      fs.mkdirSync(path.join(emptyDir, '.claude-memory'), { recursive: true });
      const status = workspaceStatus(emptyDir);
      assert.equal(status.exists, false);
      fs.rmSync(emptyDir, { recursive: true, force: true });
    });

    it('returns correct counts', () => {
      ensureWorkspace(tmpDir);
      saveTrace(tmpDir, 'test-1', {});
      saveTrace(tmpDir, 'test-2', {});

      const status = workspaceStatus(tmpDir);
      assert.equal(status.exists, true);
      assert.equal(status.hasState, true);
      assert.equal(status.traces, 2);
      assert.equal(status.constantSnapshots, 0);
      assert.equal(status.archives, 0);
    });
  });
});
