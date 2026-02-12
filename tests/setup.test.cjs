#!/usr/bin/env node
/**
 * Tests for hooks-template and path-resolver (used by setup command).
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { generateHooks, generateMinimalHooks } = require('../src/lib/hooks-template.cjs');
const {
  getGlobalHooksDir,
  getGlobalSettingsPath,
  getMemoryDir,
  getMemoryDbPath,
  getBridgeDir,
  resolveHookCommand,
  forwardSlash,
} = require('../src/lib/path-resolver.cjs');

describe('hooks-template', () => {
  const hooksDir = '/home/user/.claude/hooks';

  describe('generateHooks', () => {
    it('generates all required event types', () => {
      const hooks = generateHooks(hooksDir);
      assert.ok(hooks.PreToolUse, 'Missing PreToolUse');
      assert.ok(hooks.PostToolUse, 'Missing PostToolUse');
      assert.ok(hooks.SessionStart, 'Missing SessionStart');
      assert.ok(hooks.Stop, 'Missing Stop');
      assert.ok(hooks.Notification, 'Missing Notification');
    });

    it('generates correct number of hooks per event', () => {
      const hooks = generateHooks(hooksDir);
      assert.equal(hooks.PreToolUse.length, 4);  // edit, edit, bash, task
      assert.equal(hooks.PostToolUse.length, 4);
      assert.equal(hooks.SessionStart.length, 2);
      assert.equal(hooks.Stop.length, 2);
    });

    it('uses correct script paths', () => {
      const hooks = generateHooks(hooksDir);
      for (const arr of Object.values(hooks)) {
        for (const hook of arr) {
          assert.ok(hook.command.startsWith('node '), `Hook command should start with "node": ${hook.command}`);
          assert.ok(hook.command.includes(hooksDir.replace(/\\/g, '/')), `Hook should reference hooksDir: ${hook.command}`);
        }
      }
    });

    it('includes memory-bridge hooks', () => {
      const hooks = generateHooks(hooksDir);
      const allCommands = Object.values(hooks).flat().map(h => h.command).join(' ');
      assert.ok(allCommands.includes('memory-bridge.cjs'), 'Should include memory-bridge hooks');
      assert.ok(allCommands.includes('hook-runner.cjs'), 'Should include hook-runner hooks');
    });

    it('sets timeouts', () => {
      const hooks = generateHooks(hooksDir);
      for (const arr of Object.values(hooks)) {
        for (const hook of arr) {
          assert.ok(hook.timeout > 0, `Hook should have timeout: ${hook.command}`);
          assert.ok(hook.timeout <= 10000, `Timeout should be reasonable: ${hook.timeout}`);
        }
      }
    });
  });

  describe('generateMinimalHooks', () => {
    it('generates fewer hooks than full', () => {
      const minimal = generateMinimalHooks(hooksDir);
      const full = generateHooks(hooksDir);

      const minCount = Object.values(minimal).reduce((s, a) => s + a.length, 0);
      const fullCount = Object.values(full).reduce((s, a) => s + a.length, 0);
      assert.ok(minCount < fullCount);
    });

    it('does not include memory-bridge', () => {
      const minimal = generateMinimalHooks(hooksDir);
      const allCommands = Object.values(minimal).flat().map(h => h.command).join(' ');
      assert.ok(!allCommands.includes('memory-bridge.cjs'));
    });
  });
});

describe('path-resolver', () => {
  describe('getGlobalHooksDir', () => {
    it('returns path ending with .claude/hooks', () => {
      const dir = getGlobalHooksDir();
      assert.ok(dir.endsWith(path.join('.claude', 'hooks')));
    });
  });

  describe('getGlobalSettingsPath', () => {
    it('returns path ending with settings.json', () => {
      const p = getGlobalSettingsPath();
      assert.ok(p.endsWith('settings.json'));
    });
  });

  describe('getMemoryDir', () => {
    it('returns .claude-memory under project root', () => {
      const dir = getMemoryDir('/project');
      assert.ok(dir.includes('.claude-memory'));
    });
  });

  describe('getMemoryDbPath', () => {
    it('returns path to memory.db', () => {
      const p = getMemoryDbPath('/project');
      assert.ok(p.endsWith('memory.db'));
      assert.ok(p.includes('.claude-memory'));
    });
  });

  describe('resolveHookCommand', () => {
    it('builds correct command string', () => {
      const cmd = resolveHookCommand('/hooks', 'hook-runner.cjs', 'pre-edit', ['--file', 'test.js']);
      assert.ok(cmd.includes('node'));
      assert.ok(cmd.includes('hook-runner.cjs'));
      assert.ok(cmd.includes('pre-edit'));
      assert.ok(cmd.includes('--file'));
    });

    it('uses forward slashes', () => {
      const cmd = resolveHookCommand('C:\\Users\\Admin\\.claude\\hooks', 'script.cjs', 'cmd');
      assert.ok(!cmd.includes('\\'), `Should use forward slashes: ${cmd}`);
    });
  });

  describe('forwardSlash', () => {
    it('converts backslashes', () => {
      assert.equal(forwardSlash('C:\\Users\\Admin'), 'C:/Users/Admin');
    });

    it('preserves forward slashes', () => {
      assert.equal(forwardSlash('/home/user'), '/home/user');
    });
  });
});
