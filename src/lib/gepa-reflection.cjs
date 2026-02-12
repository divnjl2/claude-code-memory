#!/usr/bin/env node
/**
 * gepa-reflection.cjs — GEPA Reflection Engine.
 *
 * 5 checks (all via SQLite, no LLM):
 *   1. Alignment — keyword overlap between mutating and constant anti-patterns
 *   2. Drift — distribution comparison of node_type between layers
 *   3. Promotion candidates — fitness>=0.8, generation>=5, no quarantine
 *   4. Quarantine resolution — fitness still >=0.8 after quarantine → promote
 *   5. Diversity quota — COUNT(DISTINCT node_type) in mutating >= K
 *
 * Zero dependencies — Node.js built-ins + Python for SQLite.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { getMemoryDbPath, getMemoryDir } = require('./path-resolver.cjs');
const { detectPython } = require('./python-detector.cjs');
const { getGepaConfig, getState, updateState, incrementCycle, logEvent, getGepaDir } = require('./gepa-core.cjs');

// ─── Full Reflection ─────────────────────────────────────────────────────────

/**
 * Run all 5 reflection checks and return a comprehensive report.
 *
 * @param {string} projectRoot
 * @returns {{ success: boolean, cycle: number, checks: object, actions: object[], error?: string }}
 */
function reflect(projectRoot) {
  const dbPath = getMemoryDbPath(projectRoot);
  if (!fs.existsSync(dbPath)) {
    return { success: false, cycle: 0, checks: {}, actions: [], error: 'Database not found' };
  }

  const python = detectPython();
  if (!python.available) {
    return { success: false, cycle: 0, checks: {}, actions: [], error: 'Python not available' };
  }

  const config = getGepaConfig(projectRoot);
  const state = getState(projectRoot);
  const cycle = incrementCycle(projectRoot);

  const script = buildReflectionScript(dbPath, config, cycle);

  try {
    const result = execFileSync(python.command, ['-c', script], {
      encoding: 'utf-8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();

    const report = JSON.parse(result);

    // Update state with reflection results
    updateState(projectRoot, {
      lastReflection: new Date().toISOString(),
      population: report.population || state.population,
    });

    // Log reflection event
    logEvent(projectRoot, {
      eventType: 'reflection',
      details: {
        cycle,
        promotionCandidates: report.checks.promotion?.candidates?.length || 0,
        quarantineResolved: report.checks.quarantine?.resolved?.length || 0,
        alignmentViolations: report.checks.alignment?.violations?.length || 0,
      },
    });

    return {
      success: true,
      cycle,
      checks: report.checks,
      actions: report.actions || [],
      population: report.population,
    };
  } catch (err) {
    return { success: false, cycle, checks: {}, actions: [], error: err.message };
  }
}

/**
 * Build the Python reflection script.
 */
function buildReflectionScript(dbPath, config, cycle) {
  const quarantineCycles = config.quarantineCycles || 20;
  const minFitness = config.minFitnessForPromotion || 0.8;
  const diversityQuota = config.diversityQuota || 3;

  return `
import sqlite3, json
from datetime import datetime

db_path = ${JSON.stringify(dbPath.replace(/\\/g, '/'))}
quarantine_cycles = ${quarantineCycles}
min_fitness = ${minFitness}
diversity_quota = ${diversityQuota}
current_cycle = ${cycle}

conn = sqlite3.connect(db_path)

# Verify GEPA columns exist
cols = {row[1] for row in conn.execute("PRAGMA table_info(nodes)").fetchall()}
if 'memory_layer' not in cols:
    conn.close()
    print(json.dumps({"checks": {}, "actions": [], "population": {}, "error": "GEPA not migrated"}))
    exit()

checks = {}
actions = []

# ── Check 1: Alignment ──────────────────────────────────────────────────────
# Keyword overlap between mutating entries and constant anti-patterns
constant_nodes = conn.execute(
    "SELECT id, content FROM nodes WHERE memory_layer = 'constant' AND deprecated_at IS NULL"
).fetchall()
mutating_nodes = conn.execute(
    "SELECT id, content FROM nodes WHERE memory_layer = 'mutating' AND deprecated_at IS NULL"
).fetchall()

# Extract anti-pattern keywords from constant layer
negation_words = {"not", "never", "don't", "dont", "avoid", "anti", "bad", "wrong", "deprecated"}
anti_patterns = {}
for cid, ccontent in constant_nodes:
    words = set(ccontent.lower().split())
    if words & negation_words:
        content_words = words - negation_words
        if len(content_words) >= 2:
            anti_patterns[cid] = content_words

# Check mutating entries against anti-patterns
violations = []
for mid, mcontent in mutating_nodes:
    mwords = set(mcontent.lower().split())
    mwords_clean = mwords - negation_words
    has_negation = bool(mwords & negation_words)

    for cid, cwords in anti_patterns.items():
        if not cwords:
            continue
        overlap = len(mwords_clean & cwords) / max(len(mwords_clean), len(cwords), 1)
        # Violation: mutating entry positively matches constant anti-pattern
        if overlap > 0.4 and not has_negation:
            violations.append({"mutating_id": mid, "constant_id": cid, "overlap": round(overlap, 2)})

checks["alignment"] = {
    "status": "warning" if violations else "ok",
    "violations": violations[:10],
    "constant_anti_patterns": len(anti_patterns),
}

# ── Check 2: Drift ──────────────────────────────────────────────────────────
# Compare node_type distribution between layers
layer_dist = {}
for layer in ["constant", "mutating", "file"]:
    types = {}
    for row in conn.execute(
        "SELECT node_type, COUNT(*) FROM nodes WHERE memory_layer = ? AND deprecated_at IS NULL GROUP BY node_type",
        (layer,)
    ).fetchall():
        types[row[0]] = row[1]
    layer_dist[layer] = types

# Detect drift: mutating should have diverse types
mutating_types = set(layer_dist.get("mutating", {}).keys())
constant_types = set(layer_dist.get("constant", {}).keys())

drift_issues = []
if len(mutating_types) < 2 and sum(layer_dist.get("mutating", {}).values()) > 10:
    drift_issues.append("mutating layer has low type diversity")
if constant_types and not (constant_types & {"pattern", "decision"}):
    drift_issues.append("constant layer missing pattern/decision types")

checks["drift"] = {
    "status": "warning" if drift_issues else "ok",
    "issues": drift_issues,
    "distribution": layer_dist,
}

# ── Check 3: Promotion Candidates ───────────────────────────────────────────
# fitness >= threshold, generation >= 5, no quarantine, not deprecated
candidates = conn.execute(
    "SELECT id, content, fitness, generation, node_type FROM nodes "
    "WHERE memory_layer = 'mutating' AND fitness >= ? AND generation >= 5 "
    "AND (quarantine_until IS NULL OR quarantine_until = '') "
    "AND deprecated_at IS NULL "
    "ORDER BY fitness DESC LIMIT 10",
    (min_fitness,)
).fetchall()

promotion_candidates = []
for row in candidates:
    promotion_candidates.append({
        "id": row[0], "content": row[1][:100], "fitness": row[2],
        "generation": row[3], "type": row[4],
    })
    # Set quarantine
    quarantine_until = current_cycle + quarantine_cycles
    conn.execute(
        "UPDATE nodes SET quarantine_until = ? WHERE id = ?",
        (str(quarantine_until), row[0])
    )
    actions.append({"action": "quarantine", "id": row[0], "until_cycle": quarantine_until})

checks["promotion"] = {
    "status": "action" if promotion_candidates else "ok",
    "candidates": promotion_candidates,
}

# ── Check 4: Quarantine Resolution ──────────────────────────────────────────
# Entries whose quarantine has expired and fitness is still high enough
quarantined = conn.execute(
    "SELECT id, content, fitness, quarantine_until, node_type FROM nodes "
    "WHERE memory_layer = 'mutating' AND quarantine_until IS NOT NULL "
    "AND quarantine_until != '' AND deprecated_at IS NULL"
).fetchall()

resolved = []
for row in quarantined:
    try:
        q_until = int(row[3])
    except (ValueError, TypeError):
        continue

    if current_cycle >= q_until and row[2] >= min_fitness:
        # Promote to constant
        conn.execute(
            "UPDATE nodes SET memory_layer = 'constant', promoted_from = 'mutating', "
            "quarantine_until = NULL, version = version + 1 WHERE id = ?",
            (row[0],)
        )
        resolved.append({
            "id": row[0], "content": row[1][:100], "fitness": row[2],
            "type": row[4], "quarantine_expired": q_until,
        })
        actions.append({"action": "promote", "id": row[0], "from": "mutating", "to": "constant"})
    elif current_cycle >= q_until and row[2] < min_fitness:
        # Failed quarantine — clear quarantine, stay in mutating
        conn.execute("UPDATE nodes SET quarantine_until = NULL WHERE id = ?", (row[0],))
        actions.append({"action": "quarantine_failed", "id": row[0], "fitness": row[2]})

checks["quarantine"] = {
    "status": "action" if resolved else "ok",
    "resolved": resolved,
    "pending": len([r for r in quarantined if int(r[3] or 0) > current_cycle]),
}

# ── Check 5: Diversity Quota ────────────────────────────────────────────────
distinct_types = conn.execute(
    "SELECT COUNT(DISTINCT node_type) FROM nodes "
    "WHERE memory_layer = 'mutating' AND deprecated_at IS NULL"
).fetchone()[0]

checks["diversity"] = {
    "status": "warning" if distinct_types < diversity_quota else "ok",
    "distinct_types": distinct_types,
    "quota": diversity_quota,
}
if distinct_types < diversity_quota:
    actions.append({"action": "diversity_warning", "current": distinct_types, "required": diversity_quota})

# Increment generation for all non-deprecated mutating nodes
conn.execute(
    "UPDATE nodes SET generation = generation + 1 WHERE memory_layer = 'mutating' AND deprecated_at IS NULL"
)

# Population counts
population = {}
for row in conn.execute(
    "SELECT memory_layer, COUNT(*) FROM nodes WHERE deprecated_at IS NULL GROUP BY memory_layer"
).fetchall():
    population[row[0]] = row[1]

conn.commit()
conn.close()

print(json.dumps({
    "checks": checks,
    "actions": actions,
    "population": {
        "constant": population.get("constant", 0),
        "mutating": population.get("mutating", 0),
        "file": population.get("file", 0),
        "total": sum(population.values()),
    },
}))
`;
}

// ─── Individual Operations ───────────────────────────────────────────────────

/**
 * Manually promote a node from mutating to constant.
 * @param {string} projectRoot
 * @param {string} nodeId
 * @returns {{ success: boolean, error?: string }}
 */
function promote(projectRoot, nodeId) {
  const dbPath = getMemoryDbPath(projectRoot);
  if (!fs.existsSync(dbPath)) return { success: false, error: 'Database not found' };

  const python = detectPython();
  if (!python.available) return { success: false, error: 'Python not available' };

  const script = `
import sqlite3, json
db_path = ${JSON.stringify(dbPath.replace(/\\/g, '/'))}
node_id = ${JSON.stringify(nodeId)}

conn = sqlite3.connect(db_path)
row = conn.execute("SELECT memory_layer FROM nodes WHERE id = ?", (node_id,)).fetchone()
if not row:
    conn.close()
    print(json.dumps({"success": False, "error": "Node not found"}))
elif row[0] == "constant":
    conn.close()
    print(json.dumps({"success": False, "error": "Already in constant layer"}))
else:
    conn.execute(
        "UPDATE nodes SET memory_layer = 'constant', promoted_from = ?, "
        "quarantine_until = NULL, version = version + 1 WHERE id = ?",
        (row[0], node_id)
    )
    conn.commit()
    conn.close()
    print(json.dumps({"success": True, "from": row[0], "to": "constant"}))
`;

  try {
    const result = execFileSync(python.command, ['-c', script], {
      encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    const parsed = JSON.parse(result);
    if (parsed.success) {
      logEvent(projectRoot, { eventType: 'manual_promote', sourceId: nodeId });
    }
    return parsed;
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Deprecate a node (soft-delete).
 * @param {string} projectRoot
 * @param {string} nodeId
 * @returns {{ success: boolean, error?: string }}
 */
function deprecate(projectRoot, nodeId) {
  const dbPath = getMemoryDbPath(projectRoot);
  if (!fs.existsSync(dbPath)) return { success: false, error: 'Database not found' };

  const python = detectPython();
  if (!python.available) return { success: false, error: 'Python not available' };

  const script = `
import sqlite3, json
from datetime import datetime

db_path = ${JSON.stringify(dbPath.replace(/\\/g, '/'))}
node_id = ${JSON.stringify(nodeId)}

conn = sqlite3.connect(db_path)
row = conn.execute("SELECT id, memory_layer FROM nodes WHERE id = ?", (node_id,)).fetchone()
if not row:
    conn.close()
    print(json.dumps({"success": False, "error": "Node not found"}))
else:
    conn.execute(
        "UPDATE nodes SET deprecated_at = ? WHERE id = ?",
        (datetime.now().isoformat(), node_id)
    )
    conn.commit()
    conn.close()
    print(json.dumps({"success": True, "layer": row[1]}))
`;

  try {
    const result = execFileSync(python.command, ['-c', script], {
      encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    const parsed = JSON.parse(result);
    if (parsed.success) {
      logEvent(projectRoot, { eventType: 'deprecate', sourceId: nodeId });
    }
    return parsed;
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Resurrect a deprecated node.
 * @param {string} projectRoot
 * @param {string} nodeId
 * @returns {{ success: boolean, error?: string }}
 */
function resurrect(projectRoot, nodeId) {
  const dbPath = getMemoryDbPath(projectRoot);
  if (!fs.existsSync(dbPath)) return { success: false, error: 'Database not found' };

  const python = detectPython();
  if (!python.available) return { success: false, error: 'Python not available' };

  const script = `
import sqlite3, json
db_path = ${JSON.stringify(dbPath.replace(/\\/g, '/'))}
node_id = ${JSON.stringify(nodeId)}

conn = sqlite3.connect(db_path)
row = conn.execute("SELECT id, deprecated_at FROM nodes WHERE id = ?", (node_id,)).fetchone()
if not row:
    conn.close()
    print(json.dumps({"success": False, "error": "Node not found"}))
elif not row[1]:
    conn.close()
    print(json.dumps({"success": False, "error": "Node is not deprecated"}))
else:
    conn.execute("UPDATE nodes SET deprecated_at = NULL WHERE id = ?", (node_id,))
    conn.commit()
    conn.close()
    print(json.dumps({"success": True}))
`;

  try {
    const result = execFileSync(python.command, ['-c', script], {
      encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return JSON.parse(result);
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = {
  reflect,
  promote,
  deprecate,
  resurrect,
};
