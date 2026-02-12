#!/usr/bin/env node
/**
 * Tests for hooks-template (nested format) and path-resolver (used by setup command).
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

/** Helper: count total individual hooks across all events */
function countHooks(hooksConfig) {
  let count = 0;
  for (const groups of Object.values(hooksConfig)) {
    for (const group of groups) {
      count += (group.hooks || []).length;
    }
  }
  return count;
}

/** Helper: collect all command strings from nested format */
function allCommands(hooksConfig) {
  const cmds = [];
  for (const groups of Object.values(hooksConfig)) {
    for (const group of groups) {
      for (const h of (group.hooks || [])) {
        cmds.push(h.command);
      }
    }
  }
  return cmds;
}

describe('hooks-template', () => {
  const hooksDir = '/home/user/.claude/hooks';

  describe('generateHooks', () => {
    it('generates all required event types', () => {
      const hooks = generateHooks(hooksDir);
      assert.ok(hooks.PreToolUse, 'Missing PreToolUse');
      assert.ok(hooks.PostToolUse, 'Missing PostToolUse');
      assert.ok(hooks.UserPromptSubmit, 'Missing UserPromptSubmit');
      assert.ok(hooks.SessionStart, 'Missing SessionStart');
      assert.ok(hooks.Stop, 'Missing Stop');
      assert.ok(hooks.Notification, 'Missing Notification');
    });

    it('generates correct number of matcher groups', () => {
      const hooks = generateHooks(hooksDir);
      assert.equal(hooks.PreToolUse.length, 3);   // Edit, Bash, Task groups
      assert.equal(hooks.PostToolUse.length, 3);   // Edit, Bash, Task groups
      assert.equal(hooks.SessionStart.length, 1);  // Single group
      assert.equal(hooks.Stop.length, 1);          // Single group
      assert.equal(hooks.Notification.length, 1);  // Single group
    });

    it('uses nested format with type: command and continueOnError', () => {
      const hooks = generateHooks(hooksDir);
      for (const groups of Object.values(hooks)) {
        for (const group of groups) {
          assert.ok(group.hooks, 'Group should have hooks array');
          assert.ok(Array.isArray(group.hooks), 'hooks should be array');
          for (const h of group.hooks) {
            assert.equal(h.type, 'command', 'Hook should have type: command');
            assert.equal(h.continueOnError, true, 'Hook should have continueOnError: true');
            assert.ok(h.timeout > 0, 'Hook should have timeout');
          }
        }
      }
    });

    it('uses correct matchers for PreToolUse', () => {
      const hooks = generateHooks(hooksDir);
      const matchers = hooks.PreToolUse.map(g => g.matcher);
      assert.ok(matchers.includes('^(Write|Edit|MultiEdit)$'));
      assert.ok(matchers.includes('^Bash$'));
      assert.ok(matchers.includes('^Task$'));
    });

    it('includes all required scripts', () => {
      const hooks = generateHooks(hooksDir);
      const cmds = allCommands(hooks).join(' ');
      assert.ok(cmds.includes('memory-bridge.cjs'), 'Should include memory-bridge hooks');
      assert.ok(cmds.includes('hook-runner.cjs'), 'Should include hook-runner hooks');
      assert.ok(cmds.includes('inherit-params.cjs'), 'Should include inherit-params');
    });

    it('includes 2>/dev/null || true in all commands', () => {
      const hooks = generateHooks(hooksDir);
      for (const cmd of allCommands(hooks)) {
        assert.ok(cmd.includes('2>/dev/null || true'), `Command should have error suppression: ${cmd}`);
      }
    });

    it('includes env variable placeholders', () => {
      const hooks = generateHooks(hooksDir);
      const cmds = allCommands(hooks).join(' ');
      assert.ok(cmds.includes('$TOOL_INPUT_file_path'), 'Should reference $TOOL_INPUT_file_path');
      assert.ok(cmds.includes('$TOOL_INPUT_command'), 'Should reference $TOOL_INPUT_command');
      assert.ok(cmds.includes('$TOOL_INPUT_prompt'), 'Should reference $TOOL_INPUT_prompt');
      assert.ok(cmds.includes('$SESSION_ID'), 'Should reference $SESSION_ID');
      assert.ok(cmds.includes('$PROMPT'), 'Should reference $PROMPT');
    });

    it('sets reasonable timeouts', () => {
      const hooks = generateHooks(hooksDir);
      for (const h of allCommands(hooks)) {
        // Already checked in nested format test
      }
      for (const groups of Object.values(hooks)) {
        for (const group of groups) {
          for (const h of (group.hooks || [])) {
            assert.ok(h.timeout >= 2000 && h.timeout <= 10000, `Timeout should be 2-10s: ${h.timeout}`);
          }
        }
      }
    });
  });

  describe('generateMinimalHooks', () => {
    it('generates fewer hooks than full', () => {
      const minimal = generateMinimalHooks(hooksDir);
      const full = generateHooks(hooksDir);
      assert.ok(countHooks(minimal) < countHooks(full));
    });

    it('does not include memory-bridge', () => {
      const minimal = generateMinimalHooks(hooksDir);
      const cmds = allCommands(minimal).join(' ');
      assert.ok(!cmds.includes('memory-bridge.cjs'));
    });

    it('uses nested format', () => {
      const minimal = generateMinimalHooks(hooksDir);
      for (const groups of Object.values(minimal)) {
        for (const group of groups) {
          assert.ok(group.hooks, 'Group should have hooks array');
          for (const h of group.hooks) {
            assert.equal(h.type, 'command');
            assert.equal(h.continueOnError, true);
          }
        }
      }
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
