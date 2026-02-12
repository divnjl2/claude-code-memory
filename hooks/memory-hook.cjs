#!/usr/bin/env node
/**
 * Memory Hook — Zero-dep Node.js hook for Claude Code integration.
 * Wraps memory-cli.py for Claude Code PreToolUse/PostToolUse hooks.
 *
 * Adapted for claude-code-memory: discovers memory-cli.py in
 * .claude-memory/ or hooks/ directory.
 */

'use strict';

const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// ── Config ───────────────────────────────────────────────────────────────────

const PROJECT_DIR = process.env.CLOD_PROJECT_DIR || process.cwd();
const PYTHON = process.env.PYTHON_CMD || 'python';

// Discover memory-cli.py
function findMemoryCli() {
  const candidates = [
    path.join(PROJECT_DIR, '.claude-memory', 'memory-cli.py'),
    path.join(__dirname, 'memory-cli.py'),
    path.join(PROJECT_DIR, 'scripts', 'hooks', 'memory-cli.py'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

const MEMORY_CLI = findMemoryCli();

// ── Helpers ──────────────────────────────────────────────────────────────────

function runPython(args, stdin) {
  if (!MEMORY_CLI) {
    process.stderr.write('[memory-hook] memory-cli.py not found\n');
    return '';
  }
  try {
    const opts = {
      cwd: PROJECT_DIR,
      encoding: 'utf-8',
      timeout: 10000,
      stdio: stdin ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
    };
    if (stdin) opts.input = stdin;
    const result = execFileSync(PYTHON, [MEMORY_CLI, ...args], opts);
    return result.trim();
  } catch (err) {
    if (err.stderr) process.stderr.write(`[memory-hook] ${err.stderr}\n`);
    return '';
  }
}

function extractDescription(stdinData) {
  if (!stdinData) return '';
  try {
    const data = JSON.parse(stdinData);
    return data.prompt || data.description || '';
  } catch {
    return stdinData.substring(0, 200);
  }
}

// ── Commands ─────────────────────────────────────────────────────────────────

function cmdPreTask(args) {
  let description = '';
  const descIdx = args.indexOf('--description');
  if (descIdx !== -1 && args[descIdx + 1]) description = args[descIdx + 1];

  if (!description) {
    try {
      const stdinBuf = fs.readFileSync(0, 'utf-8');
      description = extractDescription(stdinBuf);
    } catch { /* no stdin */ }
  }

  if (!description || description.length < 5) return;

  const output = runPython(['pre-task', '--description', description]);
  if (output) process.stdout.write(output + '\n');
}

function cmdPostTask(args) {
  let taskOutput = '';
  try { taskOutput = fs.readFileSync(0, 'utf-8'); } catch { /* no stdin */ }

  if (taskOutput && taskOutput.length > 20) {
    const output = runPython(['post-task'], taskOutput);
    if (output) process.stderr.write(`[memory-hook] ${output}\n`);
  }
}

function cmdContext(args) {
  const query = args[0] || '';
  if (!query) { process.stderr.write('[memory-hook] Usage: memory-hook.cjs context "query"\n'); process.exit(1); }
  const limitIdx = args.indexOf('--limit');
  const limitArgs = limitIdx !== -1 ? ['--limit', args[limitIdx + 1]] : [];
  const output = runPython(['context', query, ...limitArgs]);
  if (output) process.stdout.write(output + '\n');
}

function cmdStore(args) {
  if (args.length < 2) { process.stderr.write('[memory-hook] Usage: memory-hook.cjs store <key> <value>\n'); process.exit(1); }
  const output = runPython(['store', ...args]);
  if (output) process.stdout.write(output + '\n');
}

function cmdSearch(args) {
  const query = args[0] || '';
  if (!query) { process.stderr.write('[memory-hook] Usage: memory-hook.cjs search "query"\n'); process.exit(1); }
  const limitIdx = args.indexOf('--limit');
  const limitArgs = limitIdx !== -1 ? ['--limit', args[limitIdx + 1]] : [];
  const output = runPython(['search', query, ...limitArgs]);
  if (output) process.stdout.write(output + '\n');
}

function cmdStats() {
  const output = runPython(['stats']);
  if (output) process.stdout.write(output + '\n');
}

function cmdSessionEnd(args) {
  const jsonIdx = args.indexOf('--json');
  const jsonArgs = jsonIdx !== -1 ? ['--json', args[jsonIdx + 1]] : [];
  const output = runPython(['session-end', ...jsonArgs]);
  if (output) process.stdout.write(output + '\n');
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const rest = args.slice(1);

  const commands = {
    'pre-task': cmdPreTask,
    'post-task': cmdPostTask,
    'context': cmdContext,
    'store': cmdStore,
    'search': cmdSearch,
    'stats': cmdStats,
    'session-end': cmdSessionEnd,
  };

  const handler = commands[command];
  if (handler) {
    handler(rest);
  } else {
    process.stderr.write('[memory-hook] Commands: pre-task, post-task, context, store, search, stats, session-end\n');
    process.exit(1);
  }
}

main();
