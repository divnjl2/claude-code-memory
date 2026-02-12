#!/usr/bin/env node
/**
 * gepa-fitness.cjs — GEPA Fitness Engine.
 *
 * Provides:
 *   - Fitness calculation (pure SQL, no ML)
 *   - Pareto selection for cleanup
 *   - Importance decay over time
 *
 * Fitness formula:
 *   fitness = 0.3 * normalized_access_count
 *           + 0.3 * importance
 *           + 0.2 * age_factor
 *           + 0.2 * referral_factor
 *
 * Where:
 *   - normalized_access_count = access_count / max(access_count) in layer
 *   - age_factor = 1.0 - (days_since_access / max_age_days), clamped to [0, 1]
 *   - referral_factor = min(1.0, inbound_relations / 5)
 *
 * Zero dependencies — Node.js built-ins + Python for SQLite.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { getMemoryDbPath } = require('./path-resolver.cjs');
const { detectPython } = require('./python-detector.cjs');

// ─── Fitness Calculation ─────────────────────────────────────────────────────

/**
 * Update fitness scores for all nodes in the database.
 * Uses a single SQL bulk operation for efficiency.
 *
 * @param {string} projectRoot
 * @param {object} [options]
 * @param {string} [options.layer] - Only update specific layer
 * @param {number} [options.maxAgeDays] - Max age for decay (default: 90)
 * @returns {{ updated: number, stats: object } | { error: string }}
 */
function updateFitness(projectRoot, options = {}) {
  const dbPath = getMemoryDbPath(projectRoot);
  if (!fs.existsSync(dbPath)) return { updated: 0, stats: {}, error: 'Database not found' };

  const python = detectPython();
  if (!python.available) return { updated: 0, stats: {}, error: 'Python not available' };

  const maxAgeDays = options.maxAgeDays || 90;
  const layerFilter = options.layer || '';

  const script = `
import sqlite3, json
from datetime import datetime, timedelta

db_path = ${JSON.stringify(dbPath.replace(/\\/g, '/'))}
max_age_days = ${maxAgeDays}
layer_filter = ${JSON.stringify(layerFilter)}

conn = sqlite3.connect(db_path)

# Check GEPA columns exist
cols = {row[1] for row in conn.execute("PRAGMA table_info(nodes)").fetchall()}
if 'fitness' not in cols or 'memory_layer' not in cols:
    conn.close()
    print(json.dumps({"updated": 0, "stats": {}, "error": "GEPA migration not applied"}))
    exit()

# Get max access count per layer for normalization
layer_clause = ""
params = []
if layer_filter:
    layer_clause = "WHERE memory_layer = ?"
    params = [layer_filter]

max_access = conn.execute(
    f"SELECT COALESCE(MAX(access_count), 1) FROM nodes {layer_clause}", params
).fetchone()[0]
if max_access == 0:
    max_access = 1

now = datetime.now()
max_age = timedelta(days=max_age_days)

# Fetch all nodes for fitness calculation
sql = "SELECT id, importance, access_count, accessed_at, memory_layer FROM nodes"
if layer_filter:
    sql += " WHERE memory_layer = ?"
    params_fetch = [layer_filter]
else:
    params_fetch = []

rows = conn.execute(sql, params_fetch).fetchall()

updates = []
stats = {"min": 1.0, "max": 0.0, "avg": 0.0, "count": 0}
total_fitness = 0.0

for node_id, importance, access_count, accessed_at, layer in rows:
    # Normalized access count
    norm_access = access_count / max_access

    # Age factor
    try:
        last_access = datetime.fromisoformat(accessed_at.replace('Z', '+00:00').replace('+00:00', ''))
    except:
        last_access = now
    days_since = (now - last_access).days
    age_factor = max(0.0, 1.0 - (days_since / max_age_days))

    # Referral factor (inbound relations)
    inbound = conn.execute(
        "SELECT COUNT(*) FROM relations WHERE target_id = ?", (node_id,)
    ).fetchone()[0]
    referral_factor = min(1.0, inbound / 5.0)

    # Fitness formula
    fitness = (0.3 * norm_access) + (0.3 * importance) + (0.2 * age_factor) + (0.2 * referral_factor)
    fitness = round(fitness, 4)

    updates.append((fitness, node_id))
    total_fitness += fitness
    stats["min"] = min(stats["min"], fitness)
    stats["max"] = max(stats["max"], fitness)
    stats["count"] += 1

# Bulk update
conn.executemany("UPDATE nodes SET fitness = ? WHERE id = ?", updates)
conn.commit()

if stats["count"] > 0:
    stats["avg"] = round(total_fitness / stats["count"], 4)
    stats["min"] = round(stats["min"], 4)
    stats["max"] = round(stats["max"], 4)
else:
    stats["min"] = 0.0

conn.close()
print(json.dumps({"updated": len(updates), "stats": stats}))
`;

  try {
    const result = execFileSync(python.command, ['-c', script], {
      encoding: 'utf-8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return JSON.parse(result);
  } catch (err) {
    return { updated: 0, stats: {}, error: err.message };
  }
}

// ─── Pareto Selection ────────────────────────────────────────────────────────

/**
 * Select entries for cleanup using Pareto-aware logic.
 * Preserves diversity across node types while selecting lowest fitness.
 *
 * @param {string} projectRoot
 * @param {number} count - Number of entries to select for removal
 * @param {object} [options]
 * @param {number} [options.diversityQuota] - Min types to preserve (default: 3)
 * @returns {{ candidates: object[], preserved: number }}
 */
function paretoSelect(projectRoot, count, options = {}) {
  const dbPath = getMemoryDbPath(projectRoot);
  if (!fs.existsSync(dbPath)) return { candidates: [], preserved: 0 };

  const python = detectPython();
  if (!python.available) return { candidates: [], preserved: 0 };

  const diversityQuota = options.diversityQuota || 3;

  const script = `
import sqlite3, json

db_path = ${JSON.stringify(dbPath.replace(/\\/g, '/'))}
count = ${count}
diversity_quota = ${diversityQuota}

conn = sqlite3.connect(db_path)

# Check GEPA columns
cols = {row[1] for row in conn.execute("PRAGMA table_info(nodes)").fetchall()}
if 'fitness' not in cols or 'memory_layer' not in cols:
    conn.close()
    print(json.dumps({"candidates": [], "preserved": 0}))
    exit()

# Only select from mutating layer (never touch constant)
# Order by fitness ASC (lowest fitness = most expendable)
candidates_raw = conn.execute(
    "SELECT id, node_type, content, fitness, importance, memory_layer "
    "FROM nodes WHERE memory_layer = 'mutating' AND deprecated_at IS NULL "
    "ORDER BY fitness ASC LIMIT ?",
    (count * 2,)  # Fetch extra for diversity check
).fetchall()

# Ensure diversity: keep at least one of each type that exists
type_counts = {}
for _, ntype, _, _, _, _ in candidates_raw:
    type_counts[ntype] = type_counts.get(ntype, 0) + 1

# Types we must preserve (have only 1 representative)
must_preserve_ids = set()
if len(type_counts) >= diversity_quota:
    for ntype in type_counts:
        # Find the highest-fitness node of this type in mutating
        best = conn.execute(
            "SELECT id FROM nodes WHERE memory_layer = 'mutating' AND node_type = ? "
            "AND deprecated_at IS NULL ORDER BY fitness DESC LIMIT 1",
            (ntype,)
        ).fetchone()
        if best:
            must_preserve_ids.add(best[0])

# Select candidates, excluding preserved ones
candidates = []
for row in candidates_raw:
    if len(candidates) >= count:
        break
    if row[0] not in must_preserve_ids:
        candidates.append({
            "id": row[0], "type": row[1], "content": row[2][:100],
            "fitness": row[3], "importance": row[4], "layer": row[5]
        })

conn.close()
print(json.dumps({"candidates": candidates, "preserved": len(must_preserve_ids)}))
`;

  try {
    const result = execFileSync(python.command, ['-c', script], {
      encoding: 'utf-8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return JSON.parse(result);
  } catch {
    return { candidates: [], preserved: 0 };
  }
}

// ─── Importance Decay ────────────────────────────────────────────────────────

/**
 * Apply importance decay to entries that haven't been accessed recently.
 * Decay rate: 0.01 per day of inactivity beyond threshold.
 *
 * @param {string} projectRoot
 * @param {object} [options]
 * @param {number} [options.inactivityThresholdDays] - Days before decay starts (default: 14)
 * @param {number} [options.decayRate] - Decay per day (default: 0.01)
 * @param {number} [options.minImportance] - Floor (default: 0.1)
 * @returns {{ decayed: number }}
 */
function applyDecay(projectRoot, options = {}) {
  const dbPath = getMemoryDbPath(projectRoot);
  if (!fs.existsSync(dbPath)) return { decayed: 0 };

  const python = detectPython();
  if (!python.available) return { decayed: 0 };

  const threshold = options.inactivityThresholdDays || 14;
  const decayRate = options.decayRate || 0.01;
  const minImportance = options.minImportance || 0.1;

  const script = `
import sqlite3, json
from datetime import datetime, timedelta

db_path = ${JSON.stringify(dbPath.replace(/\\/g, '/'))}
threshold_days = ${threshold}
decay_rate = ${decayRate}
min_importance = ${minImportance}

conn = sqlite3.connect(db_path)

# Check GEPA columns
cols = {row[1] for row in conn.execute("PRAGMA table_info(nodes)").fetchall()}
if 'memory_layer' not in cols:
    conn.close()
    print(json.dumps({"decayed": 0}))
    exit()

now = datetime.now()
cutoff = (now - timedelta(days=threshold_days)).isoformat()

# Only decay mutating layer entries (constant is protected)
rows = conn.execute(
    "SELECT id, importance, accessed_at FROM nodes "
    "WHERE memory_layer = 'mutating' AND accessed_at < ? AND importance > ?",
    (cutoff, min_importance)
).fetchall()

decayed = 0
for node_id, importance, accessed_at in rows:
    try:
        last_access = datetime.fromisoformat(accessed_at.replace('Z', ''))
    except:
        continue
    days_inactive = (now - last_access).days - threshold_days
    if days_inactive > 0:
        new_importance = max(min_importance, importance - (decay_rate * days_inactive))
        if new_importance < importance:
            conn.execute("UPDATE nodes SET importance = ? WHERE id = ?", (round(new_importance, 4), node_id))
            decayed += 1

conn.commit()
conn.close()
print(json.dumps({"decayed": decayed}))
`;

  try {
    const result = execFileSync(python.command, ['-c', script], {
      encoding: 'utf-8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return JSON.parse(result);
  } catch {
    return { decayed: 0 };
  }
}

module.exports = {
  updateFitness,
  paretoSelect,
  applyDecay,
};
