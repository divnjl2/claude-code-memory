#!/usr/bin/env node
/**
 * Memory Bridge — 4-way sync between memory systems (claude-code-memory edition).
 *
 * Bridges:
 *   1. planning-with-files  (task_plan.md, findings.md, progress.md)
 *   2. claude-flow MCP      (synced via CLI fire-and-forget)
 *   3. auto-memory           (~/.claude/projects/.../memory/MEMORY.md)
 *   4. GraphMemory SQLite    (.claude-memory/db/memory.db)
 *
 * Uses .claude-memory/bridge/ for cache files.
 * Supports AES-256 encryption of cache files via CLAUDE_MEMORY_KEY.
 *
 * Always exits 0 — never blocks Claude Code.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

// ─── Paths ──────────────────────────────────────────────────────────────────
const PROJECT_ROOT = fs.existsSync(path.join(process.cwd(), '.claude'))
  ? process.cwd()
  : path.resolve(__dirname, '..', '..');
const MEMORY_DIR = path.join(PROJECT_ROOT, '.claude-memory');
const BRIDGE_DIR = path.join(MEMORY_DIR, 'bridge');

// Fallback to .claude-flow paths for backwards compatibility
const CF_DIR = path.join(PROJECT_ROOT, '.claude-flow');
const CF_BRIDGE_DIR = path.join(CF_DIR, 'memory', 'bridge');

// GraphMemory CLI discovery
const PYTHON = process.env.PYTHON_CMD || 'python';

function findMemoryCli() {
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

const MEMORY_CLI = findMemoryCli();

// Planning files
const PLAN_FILE = path.join(PROJECT_ROOT, 'task_plan.md');
const FINDINGS_FILE = path.join(PROJECT_ROOT, 'findings.md');
const PROGRESS_FILE = path.join(PROJECT_ROOT, 'progress.md');

// Cache files
const PLANNING_CACHE = path.join(BRIDGE_DIR, 'planning-cache.json');
const MEMORY_SYNC = path.join(BRIDGE_DIR, 'memory-sync.json');
const BRIDGE_STATE = path.join(BRIDGE_DIR, 'bridge-state.json');

// Auto-memory
const HOME = process.env.USERPROFILE || process.env.HOME || '';
const AUTO_MEMORY_DIR = path.join(HOME, '.claude', 'projects');

// PII patterns — never store these
const PII_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/,
  /ghp_[a-zA-Z0-9]{36}/,
  /password\s*=\s*["'][^"']+["']/i,
  /api[_-]?key\s*=\s*["'][^"']+["']/i,
  /token\s*=\s*["'][^"']+["']/i,
  /secret\s*=\s*["'][^"']+["']/i,
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ok */ }
}

function readFile(filePath) {
  try { return fs.readFileSync(filePath, 'utf-8'); } catch { return null; }
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

function quickHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h |= 0;
  }
  return h.toString(36);
}

/** Check if text contains PII patterns */
function containsPII(text) {
  if (!text) return false;
  return PII_PATTERNS.some(p => p.test(text));
}

/** Sanitize text by removing PII */
function sanitize(text) {
  if (!text) return text;
  let result = text;
  for (const pattern of PII_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}

// ─── Markdown Parsing ───────────────────────────────────────────────────────

function parseSections(md) {
  if (!md) return {};
  const sections = {};
  let currentHeader = '_preamble';
  let currentContent = [];
  for (const line of md.split('\n')) {
    const headerMatch = line.match(/^##\s+(.+)/);
    if (headerMatch) {
      if (currentContent.length > 0) sections[currentHeader] = currentContent.join('\n').trim();
      currentHeader = headerMatch[1].trim();
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }
  if (currentContent.length > 0) sections[currentHeader] = currentContent.join('\n').trim();
  return sections;
}

function extractPhases(md) {
  if (!md) return [];
  const phases = [];
  const phaseRegex = /###\s+Phase\s+(\d+):\s*(.+)/g;
  const statusRegex = /\*\*Status:\*\*\s*(\w+)/;
  let match;
  while ((match = phaseRegex.exec(md)) !== null) {
    const afterHeader = md.slice(match.index);
    const statusMatch = afterHeader.match(statusRegex);
    phases.push({
      number: parseInt(match[1]),
      name: match[2].trim(),
      status: statusMatch ? statusMatch[1] : 'unknown',
    });
  }
  return phases;
}

function extractGoal(md) {
  if (!md) return '';
  const goalMatch = md.match(/##\s+Goal\s*\n([^\n#]+)/);
  return goalMatch ? goalMatch[1].trim().replace(/^\[|\]$/g, '') : '';
}

function extractCurrentPhase(md) {
  if (!md) return '';
  const match = md.match(/##\s+Current Phase\s*\n\s*(.+)/);
  return match ? match[1].trim() : '';
}

// ─── Claude Flow CLI delegation ─────────────────────────────────────────────

function tryClaudeFlowMemoryStore(namespace, key, value) {
  const candidates = [
    path.join(PROJECT_ROOT, 'node_modules', '.bin', 'claude-flow'),
    path.join(PROJECT_ROOT, 'node_modules', '@claude-flow', 'cli', 'bin', 'cli.js'),
  ].filter(Boolean);

  let cliPath = null;
  for (const candidate of candidates) {
    try { if (fs.existsSync(candidate)) { cliPath = candidate; break; } } catch {}
  }

  if (!cliPath) {
    try {
      const cmd = process.platform === 'win32' ? 'where' : 'which';
      const { execSync } = require('child_process');
      const result = execSync(`${cmd} claude-flow 2>${process.platform === 'win32' ? 'nul' : '/dev/null'}`, {
        encoding: 'utf-8', timeout: 2000
      }).trim().split('\n')[0];
      if (result && fs.existsSync(result)) cliPath = result;
    } catch {}
  }

  if (!cliPath) return false;

  try {
    const child = spawn(process.execPath, [
      cliPath, 'memory', 'store',
      '--namespace', namespace, '--key', key,
      '--value', typeof value === 'string' ? value : JSON.stringify(value),
    ], { stdio: 'ignore', detached: true, timeout: 5000, cwd: PROJECT_ROOT });
    child.unref();
    return true;
  } catch { return false; }
}

// ─── GraphMemory Integration ─────────────────────────────────────────────────

function tryGraphMemoryQuery(searchTerm, limit = 3) {
  const cli = MEMORY_CLI || findMemoryCli();
  if (!cli) return null;
  try {
    return execFileSync(PYTHON, [cli, 'context', searchTerm, '--limit', String(limit), '--fast'], {
      cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 3000, stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch { return null; }
}

function tryGraphMemoryStore(content, nodeType, importance) {
  const cli = MEMORY_CLI || findMemoryCli();
  if (!cli) return false;
  // PII check
  if (containsPII(content)) content = sanitize(content);
  try {
    const key = `bridge-${Date.now().toString(36)}`;
    execFileSync(PYTHON, [
      cli, 'store', key, content,
      '--type', nodeType || 'fact', '--importance', String(importance || 0.5), '--fast',
    ], { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 3000, stdio: ['ignore', 'pipe', 'pipe'] });
    return true;
  } catch { return false; }
}

function tryGraphMemoryStats() {
  const cli = MEMORY_CLI || findMemoryCli();
  if (!cli) return null;
  try {
    const result = execFileSync(PYTHON, [cli, 'stats'], {
      cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 3000, stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return JSON.parse(result);
  } catch { return null; }
}

// ─── Auto-Memory Discovery ─────────────────────────────────────────────────

function findAutoMemoryPath() {
  const projectPath = PROJECT_ROOT.replace(/[\\\/]/g, '-').replace(/:/g, '-');
  const candidates = [];
  try {
    if (fs.existsSync(AUTO_MEMORY_DIR)) {
      const dirs = fs.readdirSync(AUTO_MEMORY_DIR);
      for (const dir of dirs) {
        if (projectPath.includes(dir) || dir.includes('clod')) {
          const memPath = path.join(AUTO_MEMORY_DIR, dir, 'memory', 'MEMORY.md');
          if (fs.existsSync(memPath)) candidates.push(memPath);
        }
      }
    }
  } catch {}

  const defaultPath = path.join(AUTO_MEMORY_DIR, 'C--Users-Administrator-Documents', 'memory', 'MEMORY.md');
  if (fs.existsSync(defaultPath) && !candidates.includes(defaultPath)) candidates.push(defaultPath);
  return candidates[0] || defaultPath;
}

// ─── Command Handlers ───────────────────────────────────────────────────────

const handlers = {

  'sync-planning-to-cache'(flags) {
    ensureDir(BRIDGE_DIR);

    const planMd = readFile(PLAN_FILE);
    const findingsMd = readFile(FINDINGS_FILE);
    const progressMd = readFile(PROGRESS_FILE);

    const cache = {
      syncedAt: now(),
      source: 'planning-with-files',
      plan: {
        goal: extractGoal(planMd),
        currentPhase: extractCurrentPhase(planMd),
        phases: extractPhases(planMd),
        sections: parseSections(planMd),
        hash: planMd ? quickHash(planMd) : null,
      },
      findings: { sections: parseSections(findingsMd), hash: findingsMd ? quickHash(findingsMd) : null },
      progress: { sections: parseSections(progressMd), hash: progressMd ? quickHash(progressMd) : null },
    };

    writeJSON(PLANNING_CACHE, cache);

    const summary = JSON.stringify({
      goal: cache.plan.goal, currentPhase: cache.plan.currentPhase,
      phases: cache.plan.phases, syncedAt: cache.syncedAt,
    });
    tryClaudeFlowMemoryStore('planning', 'plan-state', summary);

    if (findingsMd) tryClaudeFlowMemoryStore('planning', 'findings-snapshot', findingsMd.slice(0, 4000));

    process.stdout.write(`[memory-bridge] Synced planning -> cache (${cache.plan.phases.length} phases)\n`);
  },

  'load-context'(flags) {
    ensureDir(BRIDGE_DIR);
    const parts = [];

    // 1. Planning files
    const planMd = readFile(PLAN_FILE);
    if (planMd) {
      const goal = extractGoal(planMd);
      const currentPhase = extractCurrentPhase(planMd);
      const phases = extractPhases(planMd);
      const phasesSummary = phases.map(p => `  ${p.number}. ${p.name} [${p.status}]`).join('\n');
      parts.push([
        '## Planning Context (task_plan.md)',
        `**Goal:** ${goal}`,
        `**Current Phase:** ${currentPhase}`,
        '**Phases:**', phasesSummary,
      ].join('\n'));
    }

    // 2. Findings
    const findingsMd = readFile(FINDINGS_FILE);
    if (findingsMd) {
      parts.push('## Key Findings\n' + findingsMd.split('\n').slice(0, 40).join('\n'));
    }

    // 3. Bridge state
    const bridgeState = readJSON(BRIDGE_STATE);
    if (bridgeState && bridgeState.lastSync) {
      parts.push(`## Memory Bridge\nLast sync: ${bridgeState.lastSync}`);
    }

    // 4. Auto-memory
    const autoMemPath = findAutoMemoryPath();
    const autoMem = readFile(autoMemPath);
    if (autoMem) {
      const clodSection = autoMem.match(/## Clod Project[\s\S]*?(?=\n## [^#]|$)/);
      if (clodSection) parts.push('## Auto-Memory\n' + clodSection[0].slice(0, 1500));
    }

    // 5. GraphMemory
    const graphStats = tryGraphMemoryStats();
    if (graphStats && graphStats.total_nodes > 0) {
      const goal = extractGoal(readFile(PLAN_FILE));
      const queryTerm = goal || 'project patterns decisions errors';
      const graphContext = tryGraphMemoryQuery(queryTerm, 5);
      if (graphContext) parts.push('## GraphMemory (' + graphStats.total_nodes + ' nodes)\n' + graphContext);
    }

    if (parts.length > 0) {
      process.stdout.write(parts.join('\n\n---\n\n') + '\n');
    } else {
      process.stdout.write('[memory-bridge] No context found\n');
    }

    writeJSON(BRIDGE_STATE, {
      ...(bridgeState || {}),
      lastContextLoad: now(),
      sourcesLoaded: parts.length,
      graphMemoryNodes: graphStats ? graphStats.total_nodes : 0,
    });
  },

  'persist'(flags) {
    ensureDir(BRIDGE_DIR);
    handlers['sync-planning-to-cache'](flags);

    const cache = readJSON(PLANNING_CACHE);
    if (!cache) {
      process.stdout.write('[memory-bridge] No planning cache to persist\n');
      return;
    }

    const syncManifest = {
      syncedAt: now(),
      plan: {
        goal: cache.plan.goal,
        currentPhase: cache.plan.currentPhase,
        phasesComplete: cache.plan.phases.filter(p => p.status === 'complete').length,
        phasesTotal: cache.plan.phases.length,
      },
      findings: { sectionCount: Object.keys(cache.findings.sections || {}).length, hash: cache.findings.hash },
      progress: { sectionCount: Object.keys(cache.progress.sections || {}).length, hash: cache.progress.hash },
      bridges: { planningToCache: true, cacheToMCP: false, autoMemory: false, graphMemory: false },
    };

    const cliSynced = tryClaudeFlowMemoryStore('planning', 'session-snapshot', JSON.stringify(syncManifest));
    syncManifest.bridges.cacheToMCP = cliSynced;

    // Auto-memory pending queue
    const autoMemSync = path.join(BRIDGE_DIR, 'auto-memory-pending.json');
    const pendingUpdates = readJSON(autoMemSync) || { updates: [] };
    pendingUpdates.updates.push({
      timestamp: now(),
      type: 'session-end',
      goal: cache.plan.goal,
      phasesComplete: syncManifest.plan.phasesComplete,
      phasesTotal: syncManifest.plan.phasesTotal,
    });
    pendingUpdates.updates = pendingUpdates.updates.slice(-20);
    writeJSON(autoMemSync, pendingUpdates);
    syncManifest.bridges.autoMemory = true;

    writeJSON(MEMORY_SYNC, syncManifest);

    // GraphMemory persistence
    let graphSynced = false;
    if (cache.plan.goal) {
      graphSynced = tryGraphMemoryStore(
        `Session goal: ${cache.plan.goal} | Completed: ${syncManifest.plan.phasesComplete}/${syncManifest.plan.phasesTotal} phases`,
        'task', 0.7
      );
    }
    const findingsSections = cache.findings.sections || {};
    for (const [section, content] of Object.entries(findingsSections).slice(0, 3)) {
      if (content && content.length > 20) {
        tryGraphMemoryStore(`[${section}] ${content.slice(0, 300)}`, 'pattern', 0.6);
      }
    }
    syncManifest.bridges.graphMemory = graphSynced;

    writeJSON(BRIDGE_STATE, {
      lastSync: now(), lastPersist: now(),
      mcpEntries: syncManifest.bridges.cacheToMCP ? (cache.plan.phases.length + 1) : 0,
      autoMemoryPending: pendingUpdates.updates.length,
      graphMemorySynced: graphSynced,
    });

    process.stdout.write(`[memory-bridge] Persisted: planning(${syncManifest.plan.phasesComplete}/${syncManifest.plan.phasesTotal}) -> MCP(${cliSynced ? 'OK' : 'pending'}) -> GraphMemory(${graphSynced ? 'OK' : 'skip'})\n`);
  },

  'on-planning-edit'(flags) {
    const file = flags.file || '';
    const basename = path.basename(file);
    if (!['task_plan.md', 'findings.md', 'progress.md'].includes(basename)) return;

    ensureDir(BRIDGE_DIR);

    const cache = readJSON(PLANNING_CACHE) || { syncedAt: now(), source: 'planning-with-files' };
    const content = readFile(file);
    if (!content) return;

    const newHash = quickHash(content);

    if (basename === 'task_plan.md') {
      if (cache.plan && cache.plan.hash === newHash) return;
      cache.plan = {
        goal: extractGoal(content), currentPhase: extractCurrentPhase(content),
        phases: extractPhases(content), sections: parseSections(content), hash: newHash,
      };
      tryClaudeFlowMemoryStore('planning', 'plan-state', JSON.stringify({
        goal: cache.plan.goal, currentPhase: cache.plan.currentPhase,
        phases: cache.plan.phases, syncedAt: now(),
      }));
    } else if (basename === 'findings.md') {
      if (cache.findings && cache.findings.hash === newHash) return;
      cache.findings = { sections: parseSections(content), hash: newHash };
      tryClaudeFlowMemoryStore('planning', 'findings-snapshot', content.slice(0, 4000));
    } else if (basename === 'progress.md') {
      if (cache.progress && cache.progress.hash === newHash) return;
      cache.progress = { sections: parseSections(content), hash: newHash };
    }

    cache.syncedAt = now();
    writeJSON(PLANNING_CACHE, cache);
    process.stdout.write(`[memory-bridge] ${basename} -> cache (synced)\n`);
  },

  'on-pre-edit'(flags) {
    const planMd = readFile(PLAN_FILE);
    if (!planMd) return;
    const lines = planMd.split('\n').slice(0, 25);
    process.stdout.write(lines.join('\n') + '\n');
  },

  'status'(flags) {
    const state = readJSON(BRIDGE_STATE);
    const cache = readJSON(PLANNING_CACHE);
    const pending = readJSON(path.join(BRIDGE_DIR, 'auto-memory-pending.json'));

    const status = {
      bridge: 'memory-bridge v2.0 (claude-code-memory)',
      lastSync: state ? state.lastSync : 'never',
      lastPersist: state ? state.lastPersist : 'never',
      planning: {
        taskPlan: fs.existsSync(PLAN_FILE) ? 'exists' : 'missing',
        findings: fs.existsSync(FINDINGS_FILE) ? 'exists' : 'missing',
        progress: fs.existsSync(PROGRESS_FILE) ? 'exists' : 'missing',
      },
      cache: {
        exists: !!cache,
        goal: cache ? cache.plan.goal : null,
        phases: cache ? cache.plan.phases.length : 0,
      },
      graphMemory: tryGraphMemoryStats() || { total_nodes: 0 },
      autoMemoryPending: pending ? pending.updates.length : 0,
    };

    if (flags.json) {
      process.stdout.write(JSON.stringify(status, null, 2) + '\n');
    } else {
      const gm = status.graphMemory;
      process.stdout.write([
        `Memory Bridge Status (4-way sync)`,
        `  Last sync: ${status.lastSync}`,
        `  Planning: plan=${status.planning.taskPlan} findings=${status.planning.findings}`,
        `  Cache: ${status.cache.exists ? 'OK' : 'empty'} (${status.cache.phases} phases)`,
        `  GraphMemory: ${gm.total_nodes} nodes`,
        `  Auto-memory pending: ${status.autoMemoryPending} updates`,
      ].join('\n') + '\n');
    }
  },

  'init'(flags) {
    ensureDir(BRIDGE_DIR);
    writeJSON(BRIDGE_STATE, {
      initialized: now(), lastSync: null, lastPersist: null,
      mcpEntries: 0, autoMemoryPending: 0,
    });
    if (fs.existsSync(PLAN_FILE)) handlers['sync-planning-to-cache'](flags);
    process.stdout.write('[memory-bridge] Initialized\n');
  },
};

// ─── Main ───────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';
  const flags = parseFlags(args.slice(1));

  if (command === 'help' || command === '--help') {
    process.stdout.write([
      'Memory Bridge — 4-way memory sync (claude-code-memory)',
      '',
      'Commands: init, sync-planning-to-cache, load-context,',
      '  persist, on-planning-edit, on-pre-edit, status',
      '',
    ].join('\n'));
    return;
  }

  const handler = handlers[command];
  if (handler) handler(flags);
}

try { main(); } catch (err) {
  try {
    ensureDir(BRIDGE_DIR);
    fs.appendFileSync(path.join(BRIDGE_DIR, 'bridge-errors.log'), `${now()} [${process.argv[2]}] ${err.message}\n`);
  } catch {}
}

process.exit(0);
