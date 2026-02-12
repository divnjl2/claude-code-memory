#!/usr/bin/env node
/**
 * Tests for settings-merger.cjs
 * Validates: signature extraction, nested format merge, idempotency, non-destructive behavior
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

  it('extracts from command with 2>/dev/null suffix', () => {
    const sig = extractSignature('node "C:/hooks/hook-runner.cjs" pre-edit --file "$TOOL_INPUT_file_path" 2>/dev/null || true');
    assert.equal(sig, 'hook-runner.cjs::pre-edit');
  });

  it('extracts from bash command', () => {
    const sig = extractSignature('bash "C:/scripts/check-complete.sh" 2>/dev/null || true');
    assert.equal(sig, 'check-complete.sh::run');
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

describe('mergeHookArray (nested format)', () => {
  it('adds new hook groups to empty array', () => {
    const newGroups = [
      {
        matcher: '^(Write|Edit)$',
        hooks: [
          { type: 'command', command: 'node "hooks/hook-runner.cjs" pre-edit 2>/dev/null || true', timeout: 3000, continueOnError: true },
        ],
      },
    ];
    const result = mergeHookArray([], newGroups);
    assert.equal(result.length, 1);
    assert.equal(result[0].hooks.length, 1);
    assert.equal(result[0].matcher, '^(Write|Edit)$');
  });

  it('updates existing hooks within matched group by signature', () => {
    const existing = [
      {
        matcher: '^(Write|Edit)$',
        hooks: [
          { type: 'command', command: 'node "hooks/hook-runner.cjs" pre-edit 2>/dev/null || true', timeout: 1000, continueOnError: true },
        ],
      },
    ];
    const newGroups = [
      {
        matcher: '^(Write|Edit)$',
        hooks: [
          { type: 'command', command: 'node "hooks/hook-runner.cjs" pre-edit 2>/dev/null || true', timeout: 5000, continueOnError: true },
        ],
      },
    ];
    const result = mergeHookArray(existing, newGroups);
    assert.equal(result.length, 1);
    assert.equal(result[0].hooks.length, 1);
    assert.equal(result[0].hooks[0].timeout, 5000);
  });

  it('adds new hooks to existing group without removing foreign hooks', () => {
    const existing = [
      {
        matcher: '^(Write|Edit)$',
        hooks: [
          { type: 'command', command: 'node "foreign.cjs" lint 2>/dev/null || true', timeout: 2000, continueOnError: true },
        ],
      },
    ];
    const newGroups = [
      {
        matcher: '^(Write|Edit)$',
        hooks: [
          { type: 'command', command: 'node "hooks/hook-runner.cjs" pre-edit 2>/dev/null || true', timeout: 3000, continueOnError: true },
        ],
      },
    ];
    const result = mergeHookArray(existing, newGroups);
    assert.equal(result.length, 1);
    assert.equal(result[0].hooks.length, 2);
    assert.ok(result[0].hooks[0].command.includes('foreign.cjs'));
    assert.ok(result[0].hooks[1].command.includes('hook-runner.cjs'));
  });

  it('adds new matcher group alongside existing ones', () => {
    const existing = [
      {
        matcher: '^(Write|Edit)$',
        hooks: [
          { type: 'command', command: 'node "hooks/hook-runner.cjs" pre-edit 2>/dev/null || true', timeout: 3000, continueOnError: true },
        ],
      },
    ];
    const newGroups = [
      {
        matcher: '^Bash$',
        hooks: [
          { type: 'command', command: 'node "hooks/hook-runner.cjs" pre-command 2>/dev/null || true', timeout: 3000, continueOnError: true },
        ],
      },
    ];
    const result = mergeHookArray(existing, newGroups);
    assert.equal(result.length, 2);
    assert.equal(result[0].matcher, '^(Write|Edit)$');
    assert.equal(result[1].matcher, '^Bash$');
  });

  it('merges non-matcher groups (SessionStart/Stop)', () => {
    const existing = [
      {
        hooks: [
          { type: 'command', command: 'node "hooks/hook-runner.cjs" session-start 2>/dev/null || true', timeout: 5000, continueOnError: true },
        ],
      },
    ];
    const newGroups = [
      {
        hooks: [
          { type: 'command', command: 'node "hooks/hook-runner.cjs" session-start 2>/dev/null || true', timeout: 8000, continueOnError: true },
          { type: 'command', command: 'node "hooks/memory-bridge.cjs" load-context 2>/dev/null || true', timeout: 3000, continueOnError: true },
        ],
      },
    ];
    const result = mergeHookArray(existing, newGroups);
    assert.equal(result.length, 1);
    assert.equal(result[0].hooks.length, 2);
    assert.equal(result[0].hooks[0].timeout, 8000); // updated
  });

  it('is idempotent', () => {
    const groups = [
      {
        matcher: '^Bash$',
        hooks: [
          { type: 'command', command: 'node "hooks/hook-runner.cjs" pre-command 2>/dev/null || true', timeout: 3000, continueOnError: true },
        ],
      },
    ];
    const result1 = mergeHookArray([], groups);
    const result2 = mergeHookArray(result1, groups);
    assert.equal(result2.length, 1);
    assert.equal(result2[0].hooks.length, 1);
    assert.deepEqual(result1, result2);
  });

  it('handles null/undefined existing', () => {
    const groups = [{
      hooks: [{ type: 'command', command: 'node "hooks/hook-runner.cjs" session-start 2>/dev/null || true', timeout: 3000, continueOnError: true }],
    }];
    assert.equal(mergeHookArray(null, groups).length, 1);
    assert.equal(mergeHookArray(undefined, groups).length, 1);
  });
});

describe('mergeSettings', () => {
  it('creates hooks section if missing', () => {
    const result = mergeSettings({}, {
      PreToolUse: [{
        matcher: '^(Write|Edit)$',
        hooks: [{ type: 'command', command: 'node "hooks/hook-runner.cjs" pre-edit 2>/dev/null || true', timeout: 3000, continueOnError: true }],
      }],
    });
    assert.ok(result.hooks);
    assert.ok(result.hooks.PreToolUse);
    assert.equal(result.hooks.PreToolUse.length, 1);
    assert.equal(result.hooks.PreToolUse[0].hooks.length, 1);
  });

  it('preserves existing non-hook settings', () => {
    const existing = { theme: 'dark', model: 'opus', hooks: {} };
    const result = mergeSettings(existing, {
      SessionStart: [{
        hooks: [{ type: 'command', command: 'node "hooks/hook-runner.cjs" session-start 2>/dev/null || true', timeout: 5000, continueOnError: true }],
      }],
    });
    assert.equal(result.theme, 'dark');
    assert.equal(result.model, 'opus');
  });

  it('does not mutate input', () => {
    const existing = { hooks: { PreToolUse: [] } };
    const copy = JSON.parse(JSON.stringify(existing));
    mergeSettings(existing, {
      PreToolUse: [{
        matcher: '^Bash$',
        hooks: [{ type: 'command', command: 'node "hooks/hook-runner.cjs" pre-command 2>/dev/null || true', timeout: 3000, continueOnError: true }],
      }],
    });
    assert.deepEqual(existing, copy);
  });
});

describe('mergeIntoFile', () => {
  it('creates settings file if missing', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-test-'));
    const settingsPath = path.join(tmpDir, 'settings.json');

    const result = mergeIntoFile(settingsPath, {
      SessionStart: [{
        hooks: [{ type: 'command', command: 'node "hooks/hook-runner.cjs" session-start 2>/dev/null || true', timeout: 5000, continueOnError: true }],
      }],
    });

    assert.ok(result.success);
    assert.equal(result.added, 1);
    assert.ok(fs.existsSync(settingsPath));

    const content = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    assert.equal(content.hooks.SessionStart.length, 1);
    assert.equal(content.hooks.SessionStart[0].hooks.length, 1);

    fs.rmSync(tmpDir, { recursive: true });
  });

  it('merges into existing settings without losing foreign hooks', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-test-'));
    const settingsPath = path.join(tmpDir, 'settings.json');

    // Write existing settings with real nested format and a foreign hook
    fs.writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [
              { type: 'command', command: 'bash "scripts/check-complete.sh" 2>/dev/null || true', timeout: 3000, continueOnError: true },
            ],
          },
        ],
      },
      permissions: { allow: ['Read(*)'] },
    }));

    mergeIntoFile(settingsPath, {
      Stop: [{
        hooks: [
          { type: 'command', command: 'node "hooks/memory-bridge.cjs" persist 2>/dev/null || true', timeout: 5000, continueOnError: true },
          { type: 'command', command: 'node "hooks/hook-runner.cjs" session-end 2>/dev/null || true', timeout: 3000, continueOnError: true },
        ],
      }],
    });

    const content = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    // Should have 1 group (merged) with 3 hooks: foreign + 2 ours
    assert.equal(content.hooks.Stop.length, 1);
    assert.equal(content.hooks.Stop[0].hooks.length, 3);
    // Permissions preserved
    assert.deepEqual(content.permissions.allow, ['Read(*)']);

    fs.rmSync(tmpDir, { recursive: true });
  });
});

describe('removeOurHooks (nested format)', () => {
  it('removes only our hooks from nested groups', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-test-'));
    const settingsPath = path.join(tmpDir, 'settings.json');

    fs.writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            matcher: '^(Write|Edit|MultiEdit)$',
            hooks: [
              { type: 'command', command: 'node "hooks/hook-runner.cjs" pre-edit 2>/dev/null || true', timeout: 3000, continueOnError: true },
              { type: 'command', command: 'node "hooks/memory-bridge.cjs" on-pre-edit 2>/dev/null || true', timeout: 2000, continueOnError: true },
            ],
          },
          {
            matcher: '^Bash$',
            hooks: [
              { type: 'command', command: 'node "hooks/hook-runner.cjs" pre-command 2>/dev/null || true', timeout: 3000, continueOnError: true },
            ],
          },
        ],
        Stop: [
          {
            hooks: [
              { type: 'command', command: 'node "hooks/hook-runner.cjs" session-end 2>/dev/null || true', timeout: 3000, continueOnError: true },
              { type: 'command', command: 'bash "scripts/check-complete.sh" 2>/dev/null || true', timeout: 3000, continueOnError: true },
            ],
          },
        ],
      },
    }));

    const result = removeOurHooks(settingsPath);
    assert.equal(result.removed, 4); // pre-edit, on-pre-edit, pre-command, session-end

    const content = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    // PreToolUse: Edit group empty (removed), Bash group empty (removed) → no PreToolUse
    assert.ok(!content.hooks.PreToolUse);
    // Stop: only foreign hook remains
    assert.equal(content.hooks.Stop.length, 1);
    assert.equal(content.hooks.Stop[0].hooks.length, 1);
    assert.ok(content.hooks.Stop[0].hooks[0].command.includes('check-complete.sh'));

    fs.rmSync(tmpDir, { recursive: true });
  });

  it('preserves entire groups with only foreign hooks', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-test-'));
    const settingsPath = path.join(tmpDir, 'settings.json');

    fs.writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        Notification: [
          {
            hooks: [
              { type: 'command', command: 'node "my-notifier.cjs" send 2>/dev/null || true', timeout: 2000, continueOnError: true },
            ],
          },
        ],
      },
    }));

    const result = removeOurHooks(settingsPath);
    assert.equal(result.removed, 0);

    const content = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    assert.equal(content.hooks.Notification.length, 1);

    fs.rmSync(tmpDir, { recursive: true });
  });
});
