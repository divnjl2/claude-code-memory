#!/usr/bin/env node
/**
 * Claude Code Memory — Portable Hook Runner
 * Zero-dependency CJS dispatcher for all Claude Code hooks.
 *
 * Adapted from claude-flow hook-runner for claude-code-memory package.
 * Uses .claude-memory/ paths instead of .claude-flow/ and .clod/.
 *
 * Always exits 0 — never blocks Claude Code.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// ─── Paths ──────────────────────────────────────────────────────────────────
const PROJECT_ROOT = fs.existsSync(path.join(process.cwd(), '.claude'))
  ? process.cwd()
  : path.resolve(__dirname, '..', '..');
const MEMORY_DIR = path.join(PROJECT_ROOT, '.claude-memory');
const CF_DIR = path.join(PROJECT_ROOT, '.claude-flow');
const METRICS_DIR = path.join(MEMORY_DIR, 'metrics');
const SWARM_DIR = path.join(CF_DIR, 'swarm');
const EDIT_LOG = path.join(MEMORY_DIR, 'edit-history.log');

// ─── Helpers ────────────────────────────────────────────────────────────────

function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ok */ }
}

function readJSON(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { return null; }
}

function writeJSON(filePath, data) {
  try {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch { /* ok */ }
}

function appendLog(filePath, line) {
  try {
    ensureDir(path.dirname(filePath));
    fs.appendFileSync(filePath, line + '\n');
  } catch { /* ok */ }
}

function now() { return new Date().toISOString(); }

function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) { flags[key] = next; i++; }
      else { flags[key] = 'true'; }
    }
  }
  return flags;
}

function incrementMetric(file, key, amount = 1) {
  const data = readJSON(file) || {};
  data[key] = (data[key] || 0) + amount;
  data.lastUpdated = now();
  writeJSON(file, data);
}

function updateSwarmActivity(patch) {
  const file = path.join(METRICS_DIR, 'swarm-activity.json');
  const data = readJSON(file) || { swarm: {}, lastUpdated: now() };
  Object.assign(data.swarm, patch);
  data.lastUpdated = now();
  writeJSON(file, data);
}

// Security-sensitive path patterns
const SENSITIVE_PATTERNS = [
  /secret/i, /credential/i, /password/i, /\.env$/i,
  /private.?key/i, /auth.*config/i, /token/i,
  /\.pem$/, /\.p12$/, /\.pfx$/, /\.key$/,
];

// Dangerous command patterns
const DANGEROUS_COMMANDS = [
  /rm\s+-rf\s+[\/\\]/, /sudo\s/, /chmod\s+777/,
  /DROP\s+TABLE/i, /DELETE\s+FROM/i, /TRUNCATE/i,
  /format\s+[a-z]:/i, /del\s+\/[sS]/i,
  /--force\s+push/, /push\s+--force/,
  /reset\s+--hard/, /checkout\s+\./,
  /git\s+clean\s+-fd/,
];

// Route patterns for task classification
const ROUTE_PATTERNS = [
  { pattern: /secur|CVE|vulnerab|auth.*bypass|injection/i, agent: 'security-architect' },
  { pattern: /memory|AgentDB|HNSW|vector|embed/i, agent: 'memory-specialist' },
  { pattern: /perf|optim|benchmark|latency|throughput/i, agent: 'performance-engineer' },
  { pattern: /test|TDD|spec|coverage|assert/i, agent: 'test-architect' },
  { pattern: /refactor|clean|debt|deprecat/i, agent: 'code-reviewer' },
  { pattern: /deploy|CI|CD|pipeline|release/i, agent: 'cicd-engineer' },
  { pattern: /doc|README|comment|JSDoc/i, agent: 'api-docs' },
  { pattern: /architect|design|DDD|domain|boundary/i, agent: 'system-architect' },
  { pattern: /debug|fix|bug|error|crash|exception/i, agent: 'researcher' },
  { pattern: /UI|frontend|component|CSS|style/i, agent: 'frontend-dev' },
  { pattern: /API|endpoint|REST|GraphQL|route/i, agent: 'backend-dev' },
  { pattern: /database|schema|migration|SQL|query/i, agent: 'backend-dev' },
];

// ─── Graceful CLI delegation (fire-and-forget) ─────────────────────────────

function tryClaudeFlowCLI(hookName, args) {
  const candidates = [
    path.join(PROJECT_ROOT, 'node_modules', '.bin', 'claude-flow'),
    path.join(PROJECT_ROOT, 'node_modules', '@claude-flow', 'cli', 'bin', 'cli.js'),
    process.env.CLAUDE_FLOW_V3_CLI_PATH,
  ].filter(Boolean);

  let cliPath = null;
  for (const candidate of candidates) {
    try { if (fs.existsSync(candidate)) { cliPath = candidate; break; } } catch { /* skip */ }
  }

  if (!cliPath) {
    try {
      const cmd = process.platform === 'win32' ? 'where' : 'which';
      const { execSync } = require('child_process');
      const result = execSync(`${cmd} claude-flow 2>${process.platform === 'win32' ? 'nul' : '/dev/null'}`, {
        encoding: 'utf-8', timeout: 2000
      }).trim().split('\n')[0];
      if (result && fs.existsSync(result)) cliPath = result;
    } catch { /* not found */ }
  }

  if (!cliPath) return;

  try {
    const child = spawn(process.execPath, [cliPath, 'hooks', hookName, ...args], {
      stdio: 'ignore', detached: true, timeout: 3000, cwd: PROJECT_ROOT,
    });
    child.unref();
  } catch { /* ignore */ }
}

// ─── Memory CLI discovery ──────────────────────────────────────────────────

function findMemoryCli() {
  // Try .claude-memory path first, then fallback to scripts/hooks/
  const candidates = [
    path.join(MEMORY_DIR, 'memory-cli.py'),
    path.join(__dirname, 'memory-cli.py'),
    path.join(PROJECT_ROOT, 'scripts', 'hooks', 'memory-cli.py'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

// ─── Hook Handlers ──────────────────────────────────────────────────────────

const handlers = {

  'pre-edit'(flags) {
    const filePath = flags.file || process.env.TOOL_INPUT_file_path || '';
    if (!filePath) return;

    const isSensitive = SENSITIVE_PATTERNS.some(p => p.test(filePath));
    if (isSensitive) {
      process.stdout.write('[Guidance] Security-sensitive file: ' + path.basename(filePath) + '\n');
    }

    incrementMetric(path.join(METRICS_DIR, 'hooks.json'), 'preEdit');
    tryClaudeFlowCLI('pre-edit', ['--file', filePath, '--intelligence', 'true']);
  },

  'post-edit'(flags) {
    const filePath = flags.file || process.env.TOOL_INPUT_file_path || '';
    const success = flags.success || process.env.TOOL_SUCCESS || 'true';

    if (filePath) {
      appendLog(EDIT_LOG, `${now()} edit ${success === 'true' ? 'OK' : 'FAIL'} ${filePath}`);
    }

    incrementMetric(path.join(METRICS_DIR, 'hooks.json'), 'postEdit');

    const cliArgs = ['--file', filePath, '--success', success];
    if (flags['train-patterns'] || flags['train-neural']) {
      cliArgs.push('--train-patterns', 'true');
    }
    tryClaudeFlowCLI('post-edit', cliArgs);
  },

  'post-edit-fail'(flags) {
    const filePath = flags.file || process.env.TOOL_INPUT_file_path || '';
    if (filePath) appendLog(EDIT_LOG, `${now()} edit FAIL ${filePath}`);
    incrementMetric(path.join(METRICS_DIR, 'hooks.json'), 'postEditFail');
    tryClaudeFlowCLI('post-edit', ['--file', filePath, '--success', 'false', '--learn-from-failure', 'true']);
  },

  'pre-command'(flags) {
    const command = flags.command || process.env.TOOL_INPUT_command || '';
    if (!command) return;

    const isDangerous = DANGEROUS_COMMANDS.some(p => p.test(command));
    if (isDangerous) {
      process.stdout.write('[Guidance] High-risk command detected\n');
    }

    incrementMetric(path.join(METRICS_DIR, 'hooks.json'), 'preCommand');
    tryClaudeFlowCLI('pre-command', ['--command', command]);
  },

  'post-command'(flags) {
    const command = flags.command || process.env.TOOL_INPUT_command || '';
    const success = flags.success || process.env.TOOL_SUCCESS || 'true';
    const exitCode = flags['exit-code'] || process.env.TOOL_EXIT_CODE || '0';

    incrementMetric(path.join(METRICS_DIR, 'hooks.json'), 'postCommand');

    const metricsFile = path.join(METRICS_DIR, 'commands.json');
    const data = readJSON(metricsFile) || { commands: [], total: 0 };
    data.commands = (data.commands || []).slice(-99);
    data.commands.push({
      command: (command || '').slice(0, 200),
      success: success === 'true',
      exitCode: parseInt(exitCode) || 0,
      timestamp: now(),
    });
    data.total = (data.total || 0) + 1;
    writeJSON(metricsFile, data);

    tryClaudeFlowCLI('post-command', ['--command', command, '--exit-code', exitCode, '--success', success]);
  },

  'post-command-fail'(flags) {
    const command = flags.command || process.env.TOOL_INPUT_command || '';
    incrementMetric(path.join(METRICS_DIR, 'hooks.json'), 'postCommandFail');
    tryClaudeFlowCLI('post-command', ['--command', command, '--exit-code', '1', '--success', 'false']);
  },

  'pre-task'(flags) {
    const description = flags.description || process.env.TOOL_INPUT_prompt || '';

    incrementMetric(path.join(METRICS_DIR, 'hooks.json'), 'preTask');

    // Inject GraphMemory context if available
    if (description) {
      const memoryCli = findMemoryCli();
      if (memoryCli) {
        try {
          const { execFileSync } = require('child_process');
          const python = process.env.PYTHON_CMD || 'python';
          const memCtx = execFileSync(python, [memoryCli, 'pre-task', '--description', description], {
            cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 2000, stdio: ['ignore', 'pipe', 'pipe'],
          }).trim();
          if (memCtx) process.stdout.write(memCtx + '\n');
        } catch { /* GraphMemory unavailable */ }
      }
    }

    // Check for pending handoffs
    const handoffsDir = path.join(SWARM_DIR, 'handoffs');
    let pendingHandoffs = 0;
    try {
      if (fs.existsSync(handoffsDir)) {
        const files = fs.readdirSync(handoffsDir).filter(f => f.endsWith('.json'));
        for (const file of files) {
          const data = readJSON(path.join(handoffsDir, file));
          if (data && data.status === 'pending') pendingHandoffs++;
        }
      }
    } catch { /* ok */ }

    if (pendingHandoffs > 0) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          additionalContext: `Swarm: ${pendingHandoffs} pending handoffs`
        }
      }) + '\n');
    }

    tryClaudeFlowCLI('pre-task', ['--description', description]);
  },

  'post-task'(flags) {
    const description = flags.description || process.env.TOOL_INPUT_prompt || '';
    const success = flags.success || process.env.TOOL_SUCCESS || 'true';
    const taskId = flags['task-id'] || process.env.TOOL_RESULT_agent_id || `task-${Date.now()}`;

    incrementMetric(path.join(METRICS_DIR, 'hooks.json'), 'postTask');
    updateSwarmActivity({
      last_task: description.slice(0, 100),
      last_task_success: success === 'true',
      last_task_time: now(),
    });

    // Store task result in GraphMemory
    if (description && description.length > 10) {
      const memoryCli = findMemoryCli();
      if (memoryCli) {
        try {
          const { execFileSync } = require('child_process');
          const python = process.env.PYTHON_CMD || 'python';
          const content = `Task ${success === 'true' ? 'OK' : 'FAIL'}: ${description.slice(0, 300)}`;
          const nodeType = success === 'true' ? 'task' : 'error';
          const importance = success === 'true' ? '0.6' : '0.7';
          execFileSync(python, [
            memoryCli, 'store', taskId, content,
            '--type', nodeType, '--importance', importance, '--fast',
          ], { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 2000, stdio: 'ignore' });
        } catch { /* continue without */ }
      }
    }

    const cliArgs = ['--task-id', taskId, '--description', description, '--success', success];
    if (flags['train-patterns']) cliArgs.push('--train-patterns', 'true');
    tryClaudeFlowCLI('post-task', cliArgs);
  },

  'post-task-fail'(flags) {
    const description = flags.description || process.env.TOOL_INPUT_prompt || '';
    const taskId = flags['task-id'] || `task-${Date.now()}`;
    incrementMetric(path.join(METRICS_DIR, 'hooks.json'), 'postTaskFail');
    tryClaudeFlowCLI('post-task', ['--task-id', taskId, '--description', description, '--success', 'false']);
  },

  'pre-search'(flags) {
    incrementMetric(path.join(METRICS_DIR, 'hooks.json'), 'preSearch');
  },

  'post-search'(flags) {
    incrementMetric(path.join(METRICS_DIR, 'hooks.json'), 'postSearch');
  },

  'mcp-pre'(flags) {
    incrementMetric(path.join(METRICS_DIR, 'hooks.json'), 'mcpPre');
  },

  'mcp-post'(flags) {
    incrementMetric(path.join(METRICS_DIR, 'hooks.json'), 'mcpPost');
  },

  'route'(flags) {
    const task = flags.task || process.env.PROMPT || process.env.USER_PROMPT || '';
    if (!task) return;

    incrementMetric(path.join(METRICS_DIR, 'hooks.json'), 'route');

    for (const { pattern, agent } of ROUTE_PATTERNS) {
      if (pattern.test(task)) {
        process.stdout.write(`[Route] ${agent}\n`);
        break;
      }
    }

    tryClaudeFlowCLI('route', ['--task', task, '--intelligence', 'true']);
  },

  'session-start'(flags) {
    const sessionId = flags['session-id'] || process.env.SESSION_ID || `session-${Date.now()}`;

    ensureDir(METRICS_DIR);
    ensureDir(SWARM_DIR);
    ensureDir(path.join(SWARM_DIR, 'messages'));
    ensureDir(path.join(SWARM_DIR, 'patterns'));
    ensureDir(path.join(SWARM_DIR, 'handoffs'));
    ensureDir(path.join(MEMORY_DIR, 'history'));

    // Auto-pull from remote at session start (get latest memory from other machines)
    try {
      const { execFileSync } = require('child_process');
      const gitDir = path.join(MEMORY_DIR, '.git');
      if (fs.existsSync(gitDir)) {
        const configPath = path.join(MEMORY_DIR, 'config.json');
        const config = readJSON(configPath) || {};
        if (config.autoPush) {
          const remotes = execFileSync('git', ['remote'], {
            cwd: MEMORY_DIR, encoding: 'utf-8', timeout: 5000, stdio: 'pipe',
          }).trim();
          if (remotes.includes('origin')) {
            execFileSync('git', ['pull', '--rebase', '--autostash', 'origin', 'main'], {
              cwd: MEMORY_DIR, encoding: 'utf-8', timeout: 15000, stdio: 'pipe',
            });
          }
        }
      }
    } catch { /* offline or no remote — continue with local memory */ }

    writeJSON(path.join(MEMORY_DIR, 'session.json'), {
      sessionId,
      startTime: now(),
      lastActivity: now(),
      operationsCount: 0,
    });

    incrementMetric(path.join(METRICS_DIR, 'hooks.json'), 'sessionStart');

    // Append to session history
    appendLog(path.join(MEMORY_DIR, 'history', 'sessions.jsonl'),
      JSON.stringify({ sessionId, startTime: now(), event: 'start' }));

    process.stdout.write([
      '## Session Initialized (claude-code-memory)',
      '',
      '**Memory layers**: planning-with-files + MCP bridge + auto-memory + GraphMemory',
      '**Patterns**: TDD, event sourcing, bounded contexts',
      '',
    ].join('\n'));

    tryClaudeFlowCLI('session-start', ['--session-id', sessionId]);
  },

  'session-end'(flags) {
    const sessionFile = path.join(MEMORY_DIR, 'session.json');
    const session = readJSON(sessionFile) || {};
    session.endTime = now();
    session.lastActivity = now();
    writeJSON(sessionFile, session);

    incrementMetric(path.join(METRICS_DIR, 'hooks.json'), 'sessionEnd');

    // Append to session history
    appendLog(path.join(MEMORY_DIR, 'history', 'sessions.jsonl'),
      JSON.stringify({ sessionId: session.sessionId, endTime: now(), event: 'end' }));

    // Auto-commit + auto-push memory repo if git is available
    try {
      const { execFileSync } = require('child_process');
      const gitDir = path.join(MEMORY_DIR, '.git');
      if (fs.existsSync(gitDir)) {
        // Read config for autoPush
        const configPath = path.join(MEMORY_DIR, 'config.json');
        const config = readJSON(configPath) || {};

        const status = execFileSync('git', ['status', '--porcelain'], {
          cwd: MEMORY_DIR, encoding: 'utf-8', timeout: 5000, stdio: 'pipe',
        }).trim();
        if (status) {
          execFileSync('git', ['add', '-A'], {
            cwd: MEMORY_DIR, encoding: 'utf-8', timeout: 5000, stdio: 'pipe',
          });
          execFileSync('git', ['commit', '-m', `Session ${session.sessionId || 'unknown'} - auto`], {
            cwd: MEMORY_DIR, encoding: 'utf-8', timeout: 5000, stdio: 'pipe',
          });
        }

        // Auto-push if enabled and remote exists
        if (config.autoPush) {
          try {
            const remotes = execFileSync('git', ['remote'], {
              cwd: MEMORY_DIR, encoding: 'utf-8', timeout: 5000, stdio: 'pipe',
            }).trim();
            if (remotes.includes('origin')) {
              // Pull first (rebase to avoid merge commits)
              try {
                execFileSync('git', ['pull', '--rebase', '--autostash', 'origin', 'main'], {
                  cwd: MEMORY_DIR, encoding: 'utf-8', timeout: 15000, stdio: 'pipe',
                });
              } catch { /* no remote branch yet or offline — ok */ }

              // Push (fire-and-forget via spawn for speed)
              const child = spawn('git', ['push', '-u', 'origin', 'main'], {
                cwd: MEMORY_DIR, stdio: 'ignore', detached: true, timeout: 15000,
              });
              child.unref();
            }
          } catch { /* no remote configured — skip */ }
        }
      }
    } catch { /* git not available or no changes */ }

    tryClaudeFlowCLI('session-end', ['--persist-memory', 'true']);
  },

  'session-restore'(flags) {
    const sessionId = flags['session-id'] || '';
    incrementMetric(path.join(METRICS_DIR, 'hooks.json'), 'sessionRestore');
    tryClaudeFlowCLI('session-restore', ['--session-id', sessionId]);
  },

  'notify'(flags) {
    incrementMetric(path.join(METRICS_DIR, 'hooks.json'), 'notify');
  },

  'teammate-idle'(flags) {
    incrementMetric(path.join(METRICS_DIR, 'hooks.json'), 'teammateIdle');
    tryClaudeFlowCLI('teammate-idle', ['--auto-assign', 'true']);
  },

  'task-completed'(flags) {
    const taskId = flags['task-id'] || process.env.TASK_ID || '';
    incrementMetric(path.join(METRICS_DIR, 'hooks.json'), 'taskCompleted');
    tryClaudeFlowCLI('task-completed', ['--task-id', taskId, '--train-patterns', 'true']);
  },

  'statusline'(flags) {
    const hookMetrics = readJSON(path.join(METRICS_DIR, 'hooks.json')) || {};
    const session = readJSON(path.join(MEMORY_DIR, 'session.json')) || {};

    const hooksTotal = Object.values(hookMetrics).reduce((sum, v) => typeof v === 'number' ? sum + v : sum, 0);

    let duration = '';
    if (session.startTime) {
      const mins = Math.floor((Date.now() - new Date(session.startTime).getTime()) / 60000);
      duration = mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h${mins % 60}m`;
    }

    const parts = ['MEM'];
    if (duration) parts.push(duration);
    parts.push(`hooks:${hooksTotal}`);

    process.stdout.write(parts.join(' | ') + '\n');
  },

  'route-task'(flags) { handlers.route(flags); },

  'inherit-params'(flags) {
    incrementMetric(path.join(METRICS_DIR, 'hooks.json'), 'inheritParams');

    const claudeMdPath = path.join(PROJECT_ROOT, 'CLAUDE.md');
    let paramsBlock = '';
    try {
      const content = fs.readFileSync(claudeMdPath, 'utf-8');
      const startMarker = '[INHERITED GLOBAL PARAMS]';
      const endMarker = '[END INHERITED PARAMS]';
      const startIdx = content.indexOf(startMarker);
      const endIdx = content.indexOf(endMarker);
      if (startIdx !== -1 && endIdx !== -1) {
        paramsBlock = content.slice(startIdx, endIdx + endMarker.length);
      }
    } catch { /* CLAUDE.md not found */ }

    if (!paramsBlock) {
      paramsBlock = [
        '[INHERITED GLOBAL PARAMS]',
        '- Hooks: node hooks/hook-runner.cjs <command>',
        '- File rules: NEVER save to root. Use /src, /tests, /docs, /config, /scripts',
        '- Concurrency: ALL operations parallel in single message',
        '- Verification: PLAN -> IMPLEMENT -> VERIFY -> DONE',
        '[END INHERITED PARAMS]',
      ].join('\n');
    }

    process.stdout.write(paramsBlock + '\n');
  },

  'memory-init'(flags) {
    incrementMetric(path.join(METRICS_DIR, 'hooks.json'), 'memoryInit');
    ensureDir(MEMORY_DIR);
    ensureDir(METRICS_DIR);
    ensureDir(SWARM_DIR);
    ensureDir(path.join(MEMORY_DIR, 'db'));
    ensureDir(path.join(MEMORY_DIR, 'bridge'));
    ensureDir(path.join(MEMORY_DIR, 'history'));

    const hooksFile = path.join(METRICS_DIR, 'hooks.json');
    if (!readJSON(hooksFile)) writeJSON(hooksFile, { initialized: now() });

    process.stdout.write('[memory-init] Directories and metrics initialized\n');
    tryClaudeFlowCLI('memory', ['init', '--force']);
  },

  'bootstrap'(flags) {
    incrementMetric(path.join(METRICS_DIR, 'hooks.json'), 'bootstrap');
    handlers['memory-init'](flags);
    handlers['session-start'](flags);
    process.stdout.write('[bootstrap] Project bootstrapped\n');
  },

  'metrics'(flags) {
    const hookMetrics = readJSON(path.join(METRICS_DIR, 'hooks.json')) || {};
    if (flags.json || flags.output) {
      const jsonStr = JSON.stringify(hookMetrics, null, 2);
      if (flags.output) writeJSON(flags.output, hookMetrics);
      else process.stdout.write(jsonStr + '\n');
    } else {
      process.stdout.write(JSON.stringify(hookMetrics) + '\n');
    }
  },
};

// ─── Main ───────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';
  const flags = parseFlags(args.slice(1));

  if (command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write([
      'Claude Code Memory — Portable Hook Runner',
      '',
      'Usage: node hooks/hook-runner.cjs <command> [--flag value ...]',
      '',
      'Commands: pre-edit, post-edit, pre-command, post-command,',
      '  pre-task, post-task, route, session-start, session-end,',
      '  statusline, metrics, inherit-params, memory-init, bootstrap',
      '',
    ].join('\n'));
    return;
  }

  const handler = handlers[command];
  if (handler) handler(flags);
}

try { main(); } catch (err) {
  try {
    appendLog(path.join(MEMORY_DIR, 'hook-errors.log'), `${now()} [${process.argv[2]}] ${err.message}`);
  } catch { /* last resort */ }
}

process.exit(0);
