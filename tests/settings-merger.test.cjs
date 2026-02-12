#!/usr/bin/env node
/**
 * Tests for settings-merger.cjs
 * Validates: signature extraction, merge idempotency, non-destructive behavior
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  extractSignature,
  isOurHook,
  mergeHookArray,
  mergeSettings,
  mergeIntoFile,
  removeOurHooks,
} = require('../src/lib/settings-merger.cjs');

describe('extractSignature', () => {
  it('extracts script + subcommand from node command', () => {
    const sig = extractSignature('node "/home/user/.claude/hooks/hook-runner.cjs" pre-edit --file');
    assert.equal(sig, 'hook-runner.cjs::pre-edit');
  });

  it('extracts from Windows-style path', () => {
    const sig = extractSignature('node "C:/Users/Admin/.claude/hooks/memory-bridge.cjs" load-context');
    assert.equal(sig, 'memory-bridge.cjs::load-context');
  });

  it('extracts from unquoted path', () => {
    const sig = extractSignature('node /usr/local/hooks/hook-runner.cjs session-start');
    assert.equal(sig, 'hook-runner.cjs::session-start');
  });

  it('extracts from python command', () => {
    const sig = extractSignature('python "/path/to/memory-cli.py" stats');
    assert.equal(sig, 'memory-cli.py::stats');
  });

  it('returns null for non-matching commands', () => {
    assert.equal(extractSignature('echo hello'), null);
    assert.equal(extractSignature(''), null);
    assert.equal(extractSignature(null), null);
  });
});

describe('isOurHook', () => {
  it('detects hook-runner.cjs', () => {
    assert.ok(isOurHook('node "/path/hook-runner.cjs" pre-edit'));
  });

  it('detects memory-bridge.cjs', () => {
    assert.ok(isOurHook('node memory-bridge.cjs load-context'));
  });

  it('rejects foreign hooks', () => {
    assert.ok(!isOurHook('node some-other-hook.cjs pre-edit'));
    assert.ok(!isOurHook(''));
  });
});

describe('mergeHookArray', () => {
  it('adds new hooks to empty array', () => {
    const newHooks = [
      { command: 'node "hooks/hook-runner.cjs" pre-edit', timeout: 3000 },
    ];
    const result = mergeHookArray([], newHooks);
    assert.equal(result.length, 1);
    assert.equal(result[0].timeout, 3000);
  });

  it('updates existing hooks by signature', () => {
    const existing = [
      { command: 'node "hooks/hook-runner.cjs" pre-edit', timeout: 1000 },
    ];
    const newHooks = [
      { command: 'node "hooks/hook-runner.cjs" pre-edit', timeout: 5000 },
    ];
    const result = mergeHookArray(existing, newHooks);
    assert.equal(result.length, 1);
    assert.equal(result[0].timeout, 5000);
  });

  it('preserves foreign hooks', () => {
    const existing = [
      { command: 'node "other-tool.cjs" custom-hook', timeout: 2000 },
    ];
    const newHooks = [
      { command: 'node "hooks/hook-runner.cjs" pre-edit', timeout: 3000 },
    ];
    const result = mergeHookArray(existing, newHooks);
    assert.equal(result.length, 2);
    assert.ok(result[0].command.includes('other-tool.cjs'));
    assert.ok(result[1].command.includes('hook-runner.cjs'));
  });

  it('is idempotent', () => {
    const hooks = [
      { command: 'node "hooks/hook-runner.cjs" pre-edit', timeout: 3000 },
    ];
    const result1 = mergeHookArray([], hooks);
    const result2 = mergeHookArray(result1, hooks);
    assert.equal(result2.length, 1);
    assert.deepEqual(result1, result2);
  });

  it('handles null/undefined existing', () => {
    const newHooks = [{ command: 'node "hooks/hook-runner.cjs" pre-edit', timeout: 3000 }];
    assert.equal(mergeHookArray(null, newHooks).length, 1);
    assert.equal(mergeHookArray(undefined, newHooks).length, 1);
  });
});

describe('mergeSettings', () => {
  it('creates hooks section if missing', () => {
    const result = mergeSettings({}, {
      PreToolUse: [{ command: 'node "hooks/hook-runner.cjs" pre-edit', timeout: 3000 }],
    });
    assert.ok(result.hooks);
    assert.ok(result.hooks.PreToolUse);
    assert.equal(result.hooks.PreToolUse.length, 1);
  });

  it('preserves existing non-hook settings', () => {
    const existing = { theme: 'dark', model: 'opus', hooks: {} };
    const result = mergeSettings(existing, {
      PreToolUse: [{ command: 'node "hooks/hook-runner.cjs" pre-edit', timeout: 3000 }],
    });
    assert.equal(result.theme, 'dark');
    assert.equal(result.model, 'opus');
  });

  it('does not mutate input', () => {
    const existing = { hooks: { PreToolUse: [] } };
    const copy = JSON.parse(JSON.stringify(existing));
    mergeSettings(existing, {
      PreToolUse: [{ command: 'node "hooks/hook-runner.cjs" pre-edit', timeout: 3000 }],
    });
    assert.deepEqual(existing, copy);
  });
});

describe('mergeIntoFile', () => {
  it('creates settings file if missing', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-test-'));
    const settingsPath = path.join(tmpDir, 'settings.json');

    const result = mergeIntoFile(settingsPath, {
      PreToolUse: [{ command: 'node "hooks/hook-runner.cjs" pre-edit', timeout: 3000 }],
    });

    assert.ok(result.success);
    assert.equal(result.added, 1);
    assert.ok(fs.existsSync(settingsPath));

    const content = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    assert.equal(content.hooks.PreToolUse.length, 1);

    fs.rmSync(tmpDir, { recursive: true });
  });

  it('merges without losing existing hooks', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-test-'));
    const settingsPath = path.join(tmpDir, 'settings.json');

    // Write existing settings with a foreign hook
    fs.writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        PreToolUse: [
          { command: 'node "foreign-tool.cjs" analyze', timeout: 5000 },
        ],
      },
    }));

    mergeIntoFile(settingsPath, {
      PreToolUse: [{ command: 'node "hooks/hook-runner.cjs" pre-edit', timeout: 3000 }],
    });

    const content = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    assert.equal(content.hooks.PreToolUse.length, 2);

    fs.rmSync(tmpDir, { recursive: true });
  });
});

describe('removeOurHooks', () => {
  it('removes only our hooks', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-test-'));
    const settingsPath = path.join(tmpDir, 'settings.json');

    fs.writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        PreToolUse: [
          { command: 'node "hooks/hook-runner.cjs" pre-edit', timeout: 3000 },
          { command: 'node "foreign-tool.cjs" analyze', timeout: 5000 },
        ],
      },
    }));

    const result = removeOurHooks(settingsPath);
    assert.equal(result.removed, 1);

    const content = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    assert.equal(content.hooks.PreToolUse.length, 1);
    assert.ok(content.hooks.PreToolUse[0].command.includes('foreign-tool.cjs'));

    fs.rmSync(tmpDir, { recursive: true });
  });
});
