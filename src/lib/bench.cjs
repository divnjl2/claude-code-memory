#!/usr/bin/env node
/**
 * bench.cjs — Benchmark suite for claude-code-memory + GEPA.
 *
 * 6 benchmarks measuring memory system effectiveness:
 *   1. recall    — Memory recall accuracy (by layer)
 *   2. persist   — Cross-session persistence (retention over cycles)
 *   3. fitness   — GEPA fitness & promotion pipeline
 *   4. effort    — Effort controller cost/quality tradeoff
 *   5. context   — Context window utilization (budget-aware load)
 *   6. drift     — Drift detection (alignment violations)
 *
 * Each benchmark uses a temp directory, runs scenarios, returns JSON metrics.
 * No external dependencies, no LLM calls. Python required for SQLite benchmarks.
 *
 * Inspired by: LongMemEval, MemoryBench, RouteLLM/RouterBench, Evo-Memory
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const { detectPython } = require('./python-detector.cjs');
const { getMemoryDir, getMemoryDbPath, getGepaDir: getGepaDirFromPath } = require('./path-resolver.cjs');

// Re-use GEPA modules
const {
  assessAndPropagateDown, handleFailure, midExecutionTune,
  estimateCost, getEffortReport, resetEffort, getNodeStates,
  COMPLEXITY_PROFILES, MAX_COST_PER_TASK, effectiveEffort,
  classifyComplexity,
} = require('./gepa-effort.cjs');

const {
  getGepaDir, getState, updateState, logEvent,
  DEFAULT_GEPA_CONFIG, migrateSchema, setEnabled,
  getGepaConfig,
} = require('./gepa-core.cjs');

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `ccm-bench-${prefix}-`));
}

function cleanTmpDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ }
}

function initMemoryDir(projectRoot) {
  const memDir = path.join(projectRoot, '.claude-memory');
  const gepaDir = path.join(memDir, 'gepa');
  fs.mkdirSync(gepaDir, { recursive: true });
  // Write minimal config
  fs.writeFileSync(path.join(memDir, 'config.json'), JSON.stringify({
    ...DEFAULT_GEPA_CONFIG,
    enabled: true,
  }, null, 2));
  // Write state
  fs.writeFileSync(path.join(gepaDir, 'state.json'), JSON.stringify({
    cycle: 0,
    lastReflection: null,
    population: { constant: 0, mutating: 0, file: 0, total: 0 },
  }, null, 2));
  return memDir;
}

function initDb(projectRoot) {
  const python = detectPython();
  if (!python.available) return null;

  const dbPath = path.join(projectRoot, '.claude-memory', 'memory.db');
  const script = `
import sqlite3, json

db = sqlite3.connect(${JSON.stringify(dbPath.replace(/\\/g, '/'))})
db.executescript("""
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  content TEXT,
  node_type TEXT DEFAULT 'fact',
  importance REAL DEFAULT 0.5,
  access_count INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT,
  memory_layer TEXT DEFAULT 'mutating',
  version INTEGER DEFAULT 1,
  deprecated_at TEXT,
  fitness REAL DEFAULT 0.5,
  generation INTEGER DEFAULT 0,
  promoted_from TEXT,
  quarantine_until TEXT
);
CREATE TABLE IF NOT EXISTS relations (
  source_id TEXT, target_id TEXT, relation_type TEXT,
  PRIMARY KEY (source_id, target_id, relation_type)
);
CREATE TABLE IF NOT EXISTS gepa_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT, event_type TEXT, source_id TEXT, target_id TEXT,
  hook_type TEXT, details TEXT DEFAULT '{}', created_at TEXT
);
""")
db.close()
print("OK")
`;
  try {
    execFileSync(python.command, ['-c', script], {
      encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'],
    });
    return dbPath;
  } catch { return null; }
}

function insertNodes(dbPath, nodes) {
  const python = detectPython();
  if (!python.available) return 0;

  // Write nodes to temp file to avoid Windows command-line length limits
  const tmpFile = path.join(os.tmpdir(), `ccm-nodes-${Date.now()}.json`);
  fs.writeFileSync(tmpFile, JSON.stringify(nodes));

  const script = `
import sqlite3, json
from datetime import datetime

db = sqlite3.connect(${JSON.stringify(dbPath.replace(/\\/g, '/'))})
with open(${JSON.stringify(tmpFile.replace(/\\/g, '/'))}, 'r') as f:
    nodes = json.load(f)
now = datetime.utcnow().isoformat()
count = 0
for n in nodes:
    db.execute(
        "INSERT OR REPLACE INTO nodes (id, content, node_type, importance, access_count, created_at, updated_at, memory_layer, fitness, generation) VALUES (?,?,?,?,?,?,?,?,?,?)",
        (n['id'], n['content'], n.get('node_type','fact'), n.get('importance',0.5), n.get('access_count',1), now, now, n.get('memory_layer','mutating'), n.get('fitness',0.5), n.get('generation',0))
    )
    count += 1
db.commit()
db.close()
print(count)
`;
  try {
    const out = execFileSync(python.command, ['-c', script], {
      encoding: 'utf-8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return parseInt(out, 10) || 0;
  } catch { return 0; } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ok */ }
  }
}

function queryNodes(dbPath, where = '1=1') {
  const python = detectPython();
  if (!python.available) return [];

  const script = `
import sqlite3, json
db = sqlite3.connect(${JSON.stringify(dbPath.replace(/\\/g, '/'))})
rows = db.execute("SELECT id, content, node_type, importance, memory_layer, fitness, generation, quarantine_until, deprecated_at, access_count FROM nodes WHERE ${where}").fetchall()
db.close()
result = []
for r in rows:
    result.append({"id":r[0],"content":r[1],"node_type":r[2],"importance":r[3],"memory_layer":r[4],"fitness":r[5],"generation":r[6],"quarantine_until":r[7],"deprecated_at":r[8],"access_count":r[9]})
print(json.dumps(result))
`;
  try {
    const out = execFileSync(python.command, ['-c', script], {
      encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return JSON.parse(out);
  } catch { return []; }
}

function updateNodeField(dbPath, nodeId, field, value) {
  const python = detectPython();
  if (!python.available) return false;

  const val = typeof value === 'string' ? `'${value}'` : value;
  const script = `
import sqlite3
db = sqlite3.connect(${JSON.stringify(dbPath.replace(/\\/g, '/'))})
db.execute("UPDATE nodes SET ${field} = ${val} WHERE id = '${nodeId}'")
db.commit()
db.close()
print("OK")
`;
  try {
    execFileSync(python.command, ['-c', script], {
      encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'],
    });
    return true;
  } catch { return false; }
}

function round2(n) { return Math.round(n * 100) / 100; }

// ─── Bench 1: Memory Recall Accuracy ────────────────────────────────────────

/**
 * Tests: can we find stored facts by content search?
 * Creates 50 facts across 3 layers, queries each by keyword.
 * Measures recall@1, recall@5, MRR per layer.
 */
function benchRecall() {
  const tmpDir = makeTmpDir('recall');
  const start = Date.now();

  try {
    initMemoryDir(tmpDir);
    const dbPath = initDb(tmpDir);
    if (!dbPath) return { bench: 'recall', error: 'Python/SQLite not available', duration_ms: Date.now() - start };

    // Generate 50 facts across layers
    const facts = [];
    const layers = ['constant', 'mutating', 'file'];
    const keywords = [];
    for (let i = 0; i < 50; i++) {
      const layer = layers[i % 3];
      const keyword = `bench_fact_${i}_${Math.random().toString(36).slice(2, 8)}`;
      keywords.push({ keyword, layer, id: `fact-${i}` });
      facts.push({
        id: `fact-${i}`,
        content: `The ${keyword} is important for ${layer} operations in the system`,
        node_type: layer === 'constant' ? 'pattern' : 'fact',
        importance: layer === 'constant' ? 0.9 : (layer === 'mutating' ? 0.6 : 0.3),
        memory_layer: layer,
        fitness: layer === 'constant' ? 0.9 : 0.5,
      });
    }

    const inserted = insertNodes(dbPath, facts);
    if (inserted === 0) return { bench: 'recall', error: 'Failed to insert facts', duration_ms: Date.now() - start };

    // Search each fact by keyword
    const results = { constant: { found: 0, total: 0, mrr_sum: 0 }, mutating: { found: 0, total: 0, mrr_sum: 0 }, file: { found: 0, total: 0, mrr_sum: 0 } };

    for (const { keyword, layer, id } of keywords) {
      results[layer].total++;
      const found = queryNodes(dbPath, `content LIKE '%${keyword}%'`);
      if (found.length > 0) {
        results[layer].found++;
        const rank = found.findIndex(f => f.id === id);
        if (rank >= 0) {
          results[layer].mrr_sum += 1 / (rank + 1);
        } else {
          results[layer].mrr_sum += 1; // found but at rank 1
        }
      }
    }

    const metrics = {
      recall_at_1: round2(keywords.filter(k => {
        const found = queryNodes(dbPath, `content LIKE '%${k.keyword}%' AND id = '${k.id}'`);
        return found.length > 0;
      }).length / keywords.length),
      by_layer: {},
    };

    for (const [layer, r] of Object.entries(results)) {
      metrics.by_layer[layer] = {
        recall: r.total > 0 ? round2(r.found / r.total) : 0,
        mrr: r.total > 0 ? round2(r.mrr_sum / r.total) : 0,
        total: r.total,
        found: r.found,
      };
    }

    metrics.overall_recall = round2(Object.values(results).reduce((s, r) => s + r.found, 0) / 50);
    metrics.overall_mrr = round2(Object.values(results).reduce((s, r) => s + r.mrr_sum, 0) / 50);

    return { bench: 'recall', metrics, duration_ms: Date.now() - start };
  } finally {
    cleanTmpDir(tmpDir);
  }
}

// ─── Bench 2: Cross-Session Persistence ─────────────────────────────────────

/**
 * Tests: does knowledge survive across simulated sessions (cleanup cycles)?
 * Stores 20 facts, runs N cleanup/reflection simulations, checks retention.
 */
function benchPersist() {
  const tmpDir = makeTmpDir('persist');
  const start = Date.now();

  try {
    initMemoryDir(tmpDir);
    const dbPath = initDb(tmpDir);
    if (!dbPath) return { bench: 'persist', error: 'Python/SQLite not available', duration_ms: Date.now() - start };

    // Store 20 golden facts (high importance = should survive)
    const goldenFacts = [];
    for (let i = 0; i < 20; i++) {
      goldenFacts.push({
        id: `golden-${i}`,
        content: `Critical pattern: always use approach_${i} for stability`,
        node_type: 'pattern',
        importance: 0.85,
        access_count: 10 + i,
        memory_layer: i < 7 ? 'constant' : 'mutating',
        fitness: 0.8,
        generation: 5,
      });
    }

    // Store 30 noise facts (low importance = may be cleaned)
    const noiseFacts = [];
    for (let i = 0; i < 30; i++) {
      noiseFacts.push({
        id: `noise-${i}`,
        content: `Temporary note: ${Math.random().toString(36).slice(2)}`,
        node_type: 'fact',
        importance: 0.2,
        access_count: 1,
        memory_layer: 'mutating',
        fitness: 0.2,
        generation: 1,
      });
    }

    insertNodes(dbPath, [...goldenFacts, ...noiseFacts]);

    // Simulate 10 "sessions" — each session adds noise and deprecates low-fitness
    const retentionCurve = [];
    const SESSIONS = 10;

    for (let session = 1; session <= SESSIONS; session++) {
      // Add more noise each session
      const sessionNoise = [];
      for (let j = 0; j < 5; j++) {
        sessionNoise.push({
          id: `session-${session}-noise-${j}`,
          content: `Session ${session} temporary: ${Math.random().toString(36).slice(2)}`,
          node_type: 'fact',
          importance: 0.15,
          access_count: 1,
          memory_layer: 'file',
          fitness: 0.1,
          generation: 0,
        });
      }
      insertNodes(dbPath, sessionNoise);

      // Simulate cleanup: deprecate lowest fitness mutating entries
      const python = detectPython();
      if (python.available) {
        const cleanScript = `
import sqlite3
from datetime import datetime
db = sqlite3.connect(${JSON.stringify(dbPath.replace(/\\/g, '/'))})
# Deprecate low-fitness mutating nodes (keep constant protected)
db.execute("UPDATE nodes SET deprecated_at = ? WHERE memory_layer = 'mutating' AND fitness < 0.3 AND deprecated_at IS NULL", (datetime.utcnow().isoformat(),))
# Delete old file layer entries
db.execute("DELETE FROM nodes WHERE memory_layer = 'file' AND fitness < 0.15")
db.commit()
db.close()
print("OK")
`;
        try {
          execFileSync(python.command, ['-c', cleanScript], {
            encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'],
          });
        } catch { /* ok */ }
      }

      // Check golden retention
      const surviving = queryNodes(dbPath, "deprecated_at IS NULL");
      const goldenSurvived = surviving.filter(n => n.id.startsWith('golden-')).length;
      retentionCurve.push({
        session,
        golden_retained: goldenSurvived,
        golden_total: 20,
        retention_rate: round2(goldenSurvived / 20),
        total_active: surviving.length,
      });
    }

    const finalRetention = retentionCurve[retentionCurve.length - 1];
    const metrics = {
      golden_total: 20,
      golden_retained: finalRetention.golden_retained,
      retention_rate: finalRetention.retention_rate,
      constant_retention: round2(queryNodes(dbPath, "memory_layer = 'constant' AND deprecated_at IS NULL").length / 7),
      mutating_retention: round2(queryNodes(dbPath, "id LIKE 'golden-%' AND memory_layer = 'mutating' AND deprecated_at IS NULL").length / 13),
      sessions_simulated: SESSIONS,
      retention_curve: retentionCurve,
    };

    return { bench: 'persist', metrics, duration_ms: Date.now() - start };
  } finally {
    cleanTmpDir(tmpDir);
  }
}

// ─── Bench 3: GEPA Fitness & Promotion Pipeline ────────────────────────────

/**
 * Tests: does fitness scoring correctly identify valuable knowledge?
 * Creates 100 mutating entries, 20 are "golden" (high access + importance).
 * Simulates fitness updates and checks promotion candidates.
 */
function benchFitness() {
  const tmpDir = makeTmpDir('fitness');
  const start = Date.now();

  try {
    initMemoryDir(tmpDir);
    const dbPath = initDb(tmpDir);
    if (!dbPath) return { bench: 'fitness', error: 'Python/SQLite not available', duration_ms: Date.now() - start };

    // Create 100 mutating entries
    const entries = [];
    const goldenIds = new Set();

    for (let i = 0; i < 100; i++) {
      const isGolden = i < 20;
      if (isGolden) goldenIds.add(`entry-${i}`);

      entries.push({
        id: `entry-${i}`,
        content: isGolden
          ? `Proven pattern: use technique_${i} for optimization. Tested multiple times.`
          : `Random observation: noticed ${Math.random().toString(36).slice(2)} in logs`,
        node_type: isGolden ? 'pattern' : 'fact',
        importance: isGolden ? (0.75 + Math.random() * 0.25) : (0.1 + Math.random() * 0.4),
        access_count: isGolden ? (10 + Math.floor(Math.random() * 20)) : (1 + Math.floor(Math.random() * 3)),
        memory_layer: 'mutating',
        fitness: 0.5, // will be recalculated
        generation: isGolden ? (5 + Math.floor(Math.random() * 5)) : Math.floor(Math.random() * 3),
      });
    }

    insertNodes(dbPath, entries);

    // Simulate fitness update (manual SQL since we may not have full gepa-fitness available)
    const python = detectPython();
    const fitnessScript = `
import sqlite3, json
db = sqlite3.connect(${JSON.stringify(dbPath.replace(/\\/g, '/'))})

# Get max access count for normalization
max_ac = db.execute("SELECT MAX(access_count) FROM nodes WHERE memory_layer = 'mutating'").fetchone()[0] or 1

# Update fitness: 0.3*norm_access + 0.3*importance + 0.2*age + 0.2*gen
db.execute("""
UPDATE nodes SET fitness =
  0.3 * (CAST(access_count AS REAL) / ?) +
  0.3 * importance +
  0.2 * 1.0 +
  0.2 * MIN(1.0, CAST(generation AS REAL) / 10.0)
WHERE memory_layer = 'mutating'
""", (max_ac,))
db.commit()

# Get promotion candidates (fitness >= 0.8, generation >= 5)
candidates = db.execute(
  "SELECT id, fitness, generation FROM nodes WHERE memory_layer = 'mutating' AND fitness >= 0.8 AND generation >= 5"
).fetchall()
candidate_ids = [r[0] for r in candidates]

# Get all fitness values
all_nodes = db.execute("SELECT id, fitness FROM nodes WHERE memory_layer = 'mutating'").fetchall()
db.close()

print(json.dumps({
  "candidates": candidate_ids,
  "all_fitness": {r[0]: round(r[1], 3) for r in all_nodes},
}))
`;

    let fitnessResult;
    try {
      const out = execFileSync(python.command, ['-c', fitnessScript], {
        encoding: 'utf-8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
      fitnessResult = JSON.parse(out);
    } catch (e) {
      return { bench: 'fitness', error: `Fitness calculation failed: ${e.message}`, duration_ms: Date.now() - start };
    }

    const candidateIds = new Set(fitnessResult.candidates);
    const truePositives = [...candidateIds].filter(id => goldenIds.has(id)).length;
    const falsePositives = [...candidateIds].filter(id => !goldenIds.has(id)).length;
    const falseNegatives = [...goldenIds].filter(id => !candidateIds.has(id)).length;

    const precision = candidateIds.size > 0 ? round2(truePositives / candidateIds.size) : 0;
    const recall = goldenIds.size > 0 ? round2(truePositives / goldenIds.size) : 0;
    const f1 = precision + recall > 0 ? round2(2 * precision * recall / (precision + recall)) : 0;

    // Fitness distribution
    const fitnesses = Object.values(fitnessResult.all_fitness);
    const goldenFitnesses = [...goldenIds].map(id => fitnessResult.all_fitness[id] || 0);
    const noiseFitnesses = Object.entries(fitnessResult.all_fitness)
      .filter(([id]) => !goldenIds.has(id))
      .map(([, f]) => f);

    const avg = arr => arr.length > 0 ? round2(arr.reduce((s, v) => s + v, 0) / arr.length) : 0;

    const metrics = {
      total_entries: 100,
      golden_count: 20,
      promotion_candidates: candidateIds.size,
      true_positives: truePositives,
      false_positives: falsePositives,
      false_negatives: falseNegatives,
      precision,
      recall,
      f1,
      avg_golden_fitness: avg(goldenFitnesses),
      avg_noise_fitness: avg(noiseFitnesses),
      separation: round2(avg(goldenFitnesses) - avg(noiseFitnesses)),
    };

    return { bench: 'fitness', metrics, duration_ms: Date.now() - start };
  } finally {
    cleanTmpDir(tmpDir);
  }
}

// ─── Bench 4: Effort Controller — Cost/Quality Tradeoff ────────────────────

/**
 * Tests: does dual-axis routing save cost vs always-opus baseline?
 * Runs 50 tasks at different complexity scores.
 * Compares GEPA routing cost vs all-opus-max baseline.
 */
function benchEffort() {
  const tmpDir = makeTmpDir('effort');
  const start = Date.now();

  try {
    initMemoryDir(tmpDir);

    // 50 tasks with varying complexity
    const tasks = [];
    for (let i = 0; i < 50; i++) {
      tasks.push({
        id: `task-${i}`,
        complexity: round2(i / 49), // 0.0 to 1.0 evenly
      });
    }

    let gepaTotalCost = 0;
    let baselineTotalCost = 0;
    const perTask = [];

    for (const task of tasks) {
      resetEffort(tmpDir);

      // GEPA routing
      const result = assessAndPropagateDown(tmpDir, task.complexity, { taskId: task.id });
      const nodeStates = getNodeStates(tmpDir);
      const gepaCost = estimateCost(nodeStates);
      gepaTotalCost += gepaCost;

      // Baseline: all opus, effort 0.95
      const baselineStates = {};
      for (const [name, state] of Object.entries(nodeStates)) {
        baselineStates[name] = { ...state, model_tier: 'opus', reasoning_effort: 0.95 };
      }
      const baselineCost = estimateCost(baselineStates);
      baselineTotalCost += baselineCost;

      perTask.push({
        taskId: task.id,
        complexity: task.complexity,
        profile: result.profile,
        gepaCost: round2(gepaCost),
        baselineCost: round2(baselineCost),
        savings: round2(1 - gepaCost / (baselineCost || 0.01)),
      });
    }

    // Group by profile
    const byProfile = {};
    for (const t of perTask) {
      if (!byProfile[t.profile]) byProfile[t.profile] = { count: 0, gepaCost: 0, baselineCost: 0 };
      byProfile[t.profile].count++;
      byProfile[t.profile].gepaCost += t.gepaCost;
      byProfile[t.profile].baselineCost += t.baselineCost;
    }
    for (const p of Object.values(byProfile)) {
      p.gepaCost = round2(p.gepaCost);
      p.baselineCost = round2(p.baselineCost);
      p.savings = round2(1 - p.gepaCost / (p.baselineCost || 0.01));
    }

    // Escalation test: simulate failures on a medium task
    resetEffort(tmpDir);
    assessAndPropagateDown(tmpDir, 0.5, { taskId: 'escalation-test' });
    const escalationCosts = [];
    for (let fail = 0; fail < 6; fail++) {
      const failResult = handleFailure(tmpDir, 'L3_executor', { reason: `test failure ${fail}` });
      const states = getNodeStates(tmpDir);
      escalationCosts.push({
        level: fail + 1,
        action: failResult.action,
        phase: failResult.phase,
        cost: states ? round2(estimateCost(states)) : 0,
      });
      if (failResult.action === 'circuit_break') break;
    }

    const metrics = {
      tasks: 50,
      gepa_total_cost: round2(gepaTotalCost),
      baseline_total_cost: round2(baselineTotalCost),
      cost_ratio: round2(gepaTotalCost / (baselineTotalCost || 0.01)),
      total_savings: round2(1 - gepaTotalCost / (baselineTotalCost || 0.01)),
      by_profile: byProfile,
      escalation_cost_curve: escalationCosts,
    };

    return { bench: 'effort', metrics, duration_ms: Date.now() - start };
  } finally {
    cleanTmpDir(tmpDir);
  }
}

// ─── Bench 5: Context Window Utilization ────────────────────────────────────

/**
 * Tests: does budget-aware loading prioritize relevant content?
 * Creates 200 entries, 10 are "needed" for a task.
 * Compares: budget-aware selection (constant first, by fitness) vs random.
 */
function benchContext() {
  const tmpDir = makeTmpDir('context');
  const start = Date.now();

  try {
    initMemoryDir(tmpDir);
    const dbPath = initDb(tmpDir);
    if (!dbPath) return { bench: 'context', error: 'Python/SQLite not available', duration_ms: Date.now() - start };

    // Create 200 entries with varied layers and fitness
    const entries = [];
    const neededIds = new Set();
    const BUDGET_CHARS = 10000;

    for (let i = 0; i < 200; i++) {
      const isNeeded = i < 10; // first 10 are "needed" for the task
      if (isNeeded) neededIds.add(`ctx-${i}`);

      const layer = isNeeded
        ? (i < 4 ? 'constant' : (i < 7 ? 'mutating' : 'file'))
        : (['constant', 'mutating', 'file'][i % 3]);

      entries.push({
        id: `ctx-${i}`,
        content: isNeeded
          ? `CRITICAL: task-relevant pattern ${i} needed for correct execution. Keywords: target_fact_${i}`
          : `Background info: general knowledge item ${i} about ${Math.random().toString(36).slice(2, 10)} that may or may not be useful`,
        node_type: isNeeded ? 'pattern' : 'fact',
        importance: isNeeded ? (0.8 + Math.random() * 0.2) : (0.2 + Math.random() * 0.4),
        access_count: isNeeded ? (15 + Math.floor(Math.random() * 10)) : (1 + Math.floor(Math.random() * 5)),
        memory_layer: layer,
        fitness: isNeeded ? (0.8 + Math.random() * 0.2) : (0.1 + Math.random() * 0.5),
      });
    }

    insertNodes(dbPath, entries);

    const python = detectPython();

    // Strategy 1: Budget-aware (constant first by importance DESC, then mutating by fitness DESC, then file)
    const budgetScript = `
import sqlite3, json
db = sqlite3.connect(${JSON.stringify(dbPath.replace(/\\/g, '/'))})
budget = ${BUDGET_CHARS}
selected = []
used = 0

# Phase 1: constant layer (importance DESC)
for row in db.execute("SELECT id, content, importance FROM nodes WHERE memory_layer = 'constant' AND deprecated_at IS NULL ORDER BY importance DESC").fetchall():
    size = len(row[1])
    if used + size <= budget:
        selected.append(row[0])
        used += size

# Phase 2: mutating layer (fitness DESC)
for row in db.execute("SELECT id, content, fitness FROM nodes WHERE memory_layer = 'mutating' AND deprecated_at IS NULL ORDER BY fitness DESC").fetchall():
    size = len(row[1])
    if used + size <= budget:
        selected.append(row[0])
        used += size

# Phase 3: file layer (importance DESC)
for row in db.execute("SELECT id, content, importance FROM nodes WHERE memory_layer = 'file' AND deprecated_at IS NULL ORDER BY importance DESC").fetchall():
    size = len(row[1])
    if used + size <= budget:
        selected.append(row[0])
        used += size

db.close()
print(json.dumps({"selected": selected, "chars_used": used}))
`;

    // Strategy 2: Random selection
    const randomScript = `
import sqlite3, json, random
db = sqlite3.connect(${JSON.stringify(dbPath.replace(/\\/g, '/'))})
budget = ${BUDGET_CHARS}
rows = db.execute("SELECT id, content FROM nodes WHERE deprecated_at IS NULL").fetchall()
random.seed(42)
random.shuffle(rows)
selected = []
used = 0
for row in rows:
    size = len(row[1])
    if used + size <= budget:
        selected.append(row[0])
        used += size
db.close()
print(json.dumps({"selected": selected, "chars_used": used}))
`;

    let budgetResult, randomResult;
    try {
      const budgetOut = execFileSync(python.command, ['-c', budgetScript], {
        encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
      budgetResult = JSON.parse(budgetOut);

      const randomOut = execFileSync(python.command, ['-c', randomScript], {
        encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
      randomResult = JSON.parse(randomOut);
    } catch (e) {
      return { bench: 'context', error: `Context query failed: ${e.message}`, duration_ms: Date.now() - start };
    }

    const budgetHits = budgetResult.selected.filter(id => neededIds.has(id)).length;
    const randomHits = randomResult.selected.filter(id => neededIds.has(id)).length;

    const metrics = {
      total_entries: 200,
      needed_facts: 10,
      budget_chars: BUDGET_CHARS,
      budget_aware: {
        selected: budgetResult.selected.length,
        chars_used: budgetResult.chars_used,
        hits: budgetHits,
        hit_rate: round2(budgetHits / 10),
      },
      random_baseline: {
        selected: randomResult.selected.length,
        chars_used: randomResult.chars_used,
        hits: randomHits,
        hit_rate: round2(randomHits / 10),
      },
      improvement: round2((budgetHits - randomHits) / Math.max(randomHits, 1)),
      budget_aware_advantage: round2(budgetHits / Math.max(randomHits, 1)),
    };

    return { bench: 'context', metrics, duration_ms: Date.now() - start };
  } finally {
    cleanTmpDir(tmpDir);
  }
}

// ─── Bench 6: Drift Detection ───────────────────────────────────────────────

/**
 * Tests: does the system detect when mutating knowledge contradicts constant.
 * Creates 10 constant anti-patterns, then adds mutating entries that contradict them.
 * Measures keyword overlap detection (simulated alignment check).
 */
function benchDrift() {
  const tmpDir = makeTmpDir('drift');
  const start = Date.now();

  try {
    initMemoryDir(tmpDir);
    const dbPath = initDb(tmpDir);
    if (!dbPath) return { bench: 'drift', error: 'Python/SQLite not available', duration_ms: Date.now() - start };

    // Create 10 constant patterns (anti-patterns)
    const constants = [];
    const antiKeywords = [
      'never_use_eval', 'avoid_global_state', 'no_hardcoded_secrets',
      'reject_sql_injection', 'ban_any_type', 'forbid_console_log',
      'prevent_memory_leak', 'block_xss_attack', 'deny_force_push',
      'stop_skip_tests',
    ];

    for (let i = 0; i < 10; i++) {
      constants.push({
        id: `constant-${i}`,
        content: `Anti-pattern: ${antiKeywords[i].replace(/_/g, ' ')}. This should NEVER be done.`,
        node_type: 'pattern',
        importance: 0.95,
        memory_layer: 'constant',
        fitness: 0.95,
        generation: 20,
      });
    }

    // Create 20 mutating entries: 10 violating, 10 safe
    const mutatingEntries = [];
    for (let i = 0; i < 10; i++) {
      // Violating: contains the anti-pattern keyword in a positive context
      mutatingEntries.push({
        id: `violating-${i}`,
        content: `Suggestion: ${antiKeywords[i].replace(/_/g, ' ').replace(/^(never|avoid|no|reject|ban|forbid|prevent|block|deny|stop)\s/, '')} is acceptable in this context`,
        node_type: 'fact',
        importance: 0.5,
        memory_layer: 'mutating',
        fitness: 0.5,
      });
    }
    for (let i = 0; i < 10; i++) {
      // Safe: unrelated content
      mutatingEntries.push({
        id: `safe-${i}`,
        content: `Optimization technique ${i}: use caching for repeated computations`,
        node_type: 'fact',
        importance: 0.5,
        memory_layer: 'mutating',
        fitness: 0.5,
      });
    }

    insertNodes(dbPath, [...constants, ...mutatingEntries]);

    // Run alignment check: keyword overlap between constant anti-patterns and mutating
    const python = detectPython();
    const alignScript = `
import sqlite3, json, re
db = sqlite3.connect(${JSON.stringify(dbPath.replace(/\\/g, '/'))})

# Get constant anti-pattern keywords
constants = db.execute("SELECT id, content FROM nodes WHERE memory_layer = 'constant'").fetchall()
mutating = db.execute("SELECT id, content FROM nodes WHERE memory_layer = 'mutating'").fetchall()

# Extract keywords from each constant (words >= 4 chars)
violations = []
for cid, ccontent in constants:
    c_words = set(w.lower() for w in re.findall(r'\\b\\w{4,}\\b', ccontent))
    for mid, mcontent in mutating:
        m_words = set(w.lower() for w in re.findall(r'\\b\\w{4,}\\b', mcontent))
        overlap = c_words & m_words
        # Exclude common words
        common = {'this', 'should', 'never', 'that', 'with', 'context', 'done', 'acceptable'}
        overlap -= common
        score = len(overlap) / max(len(c_words), 1)
        if score > 0.15:
            violations.append({"constant": cid, "mutating": mid, "overlap": list(overlap)[:5], "score": round(score, 3)})

db.close()
print(json.dumps({"violations": violations, "total_checks": len(constants) * len(mutating)}))
`;

    let alignResult;
    try {
      const out = execFileSync(python.command, ['-c', alignScript], {
        encoding: 'utf-8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
      alignResult = JSON.parse(out);
    } catch (e) {
      return { bench: 'drift', error: `Alignment check failed: ${e.message}`, duration_ms: Date.now() - start };
    }

    const detectedViolatingIds = new Set(alignResult.violations.map(v => v.mutating));
    const actualViolatingIds = new Set(mutatingEntries.slice(0, 10).map(e => e.id));

    const truePositives = [...detectedViolatingIds].filter(id => actualViolatingIds.has(id)).length;
    const falsePositives = [...detectedViolatingIds].filter(id => !actualViolatingIds.has(id)).length;
    const falseNegatives = [...actualViolatingIds].filter(id => !detectedViolatingIds.has(id)).length;

    const precision = detectedViolatingIds.size > 0 ? round2(truePositives / detectedViolatingIds.size) : 0;
    const driftRecall = actualViolatingIds.size > 0 ? round2(truePositives / actualViolatingIds.size) : 0;
    const f1 = precision + driftRecall > 0 ? round2(2 * precision * driftRecall / (precision + driftRecall)) : 0;

    const metrics = {
      constant_patterns: 10,
      mutating_entries: 20,
      actual_violations: 10,
      detected_violations: detectedViolatingIds.size,
      true_positives: truePositives,
      false_positives: falsePositives,
      false_negatives: falseNegatives,
      drift_detection_rate: driftRecall,
      precision,
      f1,
      total_checks: alignResult.total_checks,
      violation_details: alignResult.violations.slice(0, 5), // top 5
    };

    return { bench: 'drift', metrics, duration_ms: Date.now() - start };
  } finally {
    cleanTmpDir(tmpDir);
  }
}

// ─── Runner ─────────────────────────────────────────────────────────────────

const BENCHMARKS = {
  recall: { fn: benchRecall, desc: 'Memory recall accuracy by layer' },
  persist: { fn: benchPersist, desc: 'Cross-session persistence (retention)' },
  fitness: { fn: benchFitness, desc: 'GEPA fitness & promotion pipeline' },
  effort: { fn: benchEffort, desc: 'Effort controller cost/quality tradeoff' },
  context: { fn: benchContext, desc: 'Context window utilization (budget-aware)' },
  drift: { fn: benchDrift, desc: 'Drift detection (alignment violations)' },
};

/**
 * Run one or all benchmarks.
 * @param {string} name - Benchmark name or 'all'
 * @returns {object|object[]}
 */
function runBench(name) {
  if (name === 'all') {
    const results = [];
    for (const [key, { fn, desc }] of Object.entries(BENCHMARKS)) {
      const result = fn();
      result.description = desc;
      result.timestamp = new Date().toISOString();
      results.push(result);
    }
    return results;
  }

  const bench = BENCHMARKS[name];
  if (!bench) {
    return { error: `Unknown benchmark: ${name}. Available: ${Object.keys(BENCHMARKS).join(', ')}, all` };
  }

  const result = bench.fn();
  result.description = bench.desc;
  result.timestamp = new Date().toISOString();
  return result;
}

module.exports = {
  runBench,
  BENCHMARKS,
  // Individual benches (for testing)
  benchRecall,
  benchPersist,
  benchFitness,
  benchEffort,
  benchContext,
  benchDrift,
};
