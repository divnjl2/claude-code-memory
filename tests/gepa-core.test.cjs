#!/usr/bin/env node
/**
 * Tests for gepa-core.cjs
 * Validates: constants, layer classification, state CRUD, config, migration
 */

'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  LAYERS, DEFAULT_GEPA_CONFIG, GEPA_SCHEMA_VERSION,
  classifyLayer, getState, updateState, incrementCycle,
  getGepaConfig, isEnabled, setEnabled, getGepaDir, getPopulation,
} = require('../src/lib/gepa-core.cjs');

describe('gepa-core', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-gepa-'));
    const memDir = path.join(tmpDir, '.claude-memory');
    fs.mkdirSync(path.join(memDir, 'db'), { recursive: true });
    fs.mkdirSync(path.join(memDir, 'bridge'), { recursive: true });
    fs.mkdirSync(path.join(memDir, 'gepa'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('LAYERS', () => {
    it('has three layers', () => {
      assert.equal(LAYERS.CONSTANT, 'constant');
      assert.equal(LAYERS.MUTATING, 'mutating');
      assert.equal(LAYERS.FILE, 'file');
    });
  });

  describe('DEFAULT_GEPA_CONFIG', () => {
    it('is disabled by default', () => {
      assert.equal(DEFAULT_GEPA_CONFIG.enabled, false);
    });

    it('has quarantine cycles', () => {
      assert.equal(DEFAULT_GEPA_CONFIG.quarantineCycles, 20);
    });

    it('has rate limits', () => {
      assert.ok(DEFAULT_GEPA_CONFIG.rateLimits.user);
      assert.ok(DEFAULT_GEPA_CONFIG.rateLimits.promotion);
    });

    it('has context budget', () => {
      assert.equal(DEFAULT_GEPA_CONFIG.contextBudget.total, 10000);
      assert.equal(DEFAULT_GEPA_CONFIG.contextBudget.constant, 4000);
    });
  });

  describe('classifyLayer', () => {
    it('classifies pattern with high importance as constant', () => {
      assert.equal(classifyLayer('pattern', 0.9), 'constant');
    });

    it('classifies pattern with low importance as mutating', () => {
      assert.equal(classifyLayer('pattern', 0.5), 'mutating');
    });

    it('classifies decision with high importance as constant', () => {
      assert.equal(classifyLayer('decision', 0.8), 'constant');
    });

    it('classifies file type as file layer', () => {
      assert.equal(classifyLayer('file', 0.9), 'file');
    });

    it('classifies fact as mutating', () => {
      assert.equal(classifyLayer('fact', 0.5), 'mutating');
    });

    it('classifies error as mutating', () => {
      assert.equal(classifyLayer('error', 0.9), 'mutating');
    });

    it('classifies task as mutating', () => {
      assert.equal(classifyLayer('task', 0.5), 'mutating');
    });
  });

  describe('state management', () => {
    it('returns defaults when no state file', () => {
      const state = getState(tmpDir);
      assert.equal(state.cycle, 0);
      assert.equal(state.lastReflection, null);
    });

    it('updates state', () => {
      updateState(tmpDir, { cycle: 5, lastReflection: '2026-01-01T00:00:00Z' });
      const state = getState(tmpDir);
      assert.equal(state.cycle, 5);
      assert.equal(state.lastReflection, '2026-01-01T00:00:00Z');
      assert.ok(state.updatedAt);
    });

    it('incrementCycle increments correctly', () => {
      updateState(tmpDir, { cycle: 3 });
      const newCycle = incrementCycle(tmpDir);
      assert.equal(newCycle, 4);
    });

    it('preserves existing fields on update', () => {
      updateState(tmpDir, { cycle: 1, lastReflection: 'A' });
      updateState(tmpDir, { cycle: 2 });
      const state = getState(tmpDir);
      assert.equal(state.cycle, 2);
      assert.equal(state.lastReflection, 'A');
    });
  });

  describe('getGepaConfig', () => {
    it('returns defaults when no config', () => {
      const config = getGepaConfig(tmpDir);
      assert.equal(config.enabled, false);
      assert.equal(config.quarantineCycles, 20);
    });

    it('merges with existing config', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.claude-memory', 'config.json'),
        JSON.stringify({ gepa: { enabled: true, quarantineCycles: 10 } })
      );
      const config = getGepaConfig(tmpDir);
      assert.equal(config.enabled, true);
      assert.equal(config.quarantineCycles, 10);
    });
  });

  describe('isEnabled', () => {
    it('returns false by default', () => {
      assert.equal(isEnabled(tmpDir), false);
    });

    it('returns true when enabled', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.claude-memory', 'config.json'),
        JSON.stringify({ gepa: { enabled: true } })
      );
      assert.equal(isEnabled(tmpDir), true);
    });
  });

  describe('setEnabled', () => {
    it('enables GEPA and creates workspace', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.claude-memory', 'config.json'),
        JSON.stringify({ version: 1 })
      );
      setEnabled(tmpDir, true);

      const config = JSON.parse(fs.readFileSync(
        path.join(tmpDir, '.claude-memory', 'config.json'), 'utf-8'
      ));
      assert.equal(config.gepa.enabled, true);

      // Workspace dirs should be created
      assert.ok(fs.existsSync(path.join(tmpDir, '.claude-memory', 'gepa')));
      assert.ok(fs.existsSync(path.join(tmpDir, '.claude-memory', 'gepa', 'constant')));
      assert.ok(fs.existsSync(path.join(tmpDir, '.claude-memory', 'gepa', 'traces')));
      assert.ok(fs.existsSync(path.join(tmpDir, '.claude-memory', 'gepa', 'archive')));
    });

    it('disables GEPA', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.claude-memory', 'config.json'),
        JSON.stringify({ gepa: { enabled: true } })
      );
      setEnabled(tmpDir, false);

      const config = JSON.parse(fs.readFileSync(
        path.join(tmpDir, '.claude-memory', 'config.json'), 'utf-8'
      ));
      assert.equal(config.gepa.enabled, false);
    });

    it('preserves existing config fields', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.claude-memory', 'config.json'),
        JSON.stringify({ version: 1, maxSizeMB: 20 })
      );
      setEnabled(tmpDir, true);

      const config = JSON.parse(fs.readFileSync(
        path.join(tmpDir, '.claude-memory', 'config.json'), 'utf-8'
      ));
      assert.equal(config.version, 1);
      assert.equal(config.maxSizeMB, 20);
      assert.equal(config.gepa.enabled, true);
    });
  });

  describe('getGepaDir', () => {
    it('returns correct path', () => {
      const dir = getGepaDir(tmpDir);
      assert.ok(dir.endsWith(path.join('.claude-memory', 'gepa')));
    });
  });

  describe('GEPA_SCHEMA_VERSION', () => {
    it('is version 2', () => {
      assert.equal(GEPA_SCHEMA_VERSION, 2);
    });
  });
});
