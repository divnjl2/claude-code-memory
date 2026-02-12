#!/usr/bin/env node
/**
 * gepa-workspace.cjs — GEPA workspace directory management.
 *
 * Manages:
 *   .claude-memory/gepa/
 *   ├── state.json           # Cycle number, last reflection, population stats
 *   ├── rate-limits.json     # Rate limit tracking
 *   ├── constant/v{N}.json   # Exported constant memory snapshots
 *   ├── traces/session-{ID}.json  # Episodic traces (summarized)
 *   └── archive/gen-{N}.json      # Archived mutating entries (resurrection)
 *
 * Zero dependencies.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { getMemoryDbPath } = require('./path-resolver.cjs');
const { getGepaDir, getState } = require('./gepa-core.cjs');
const { detectPython } = require('./python-detector.cjs');

/**
 * Ensure workspace directories exist.
 * @param {string} projectRoot
 */
function ensureWorkspace(projectRoot) {
  const gepaDir = getGepaDir(projectRoot);
  const dirs = [
    gepaDir,
    path.join(gepaDir, 'constant'),
    path.join(gepaDir, 'traces'),
    path.join(gepaDir, 'archive'),
  ];
  for (const dir of dirs) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ok */ }
  }
}

/**
 * Export current constant layer to a snapshot file.
 * @param {string} projectRoot
 * @returns {{ path: string, count: number } | { error: string }}
 */
function exportConstant(projectRoot) {
  const dbPath = getMemoryDbPath(projectRoot);
  if (!fs.existsSync(dbPath)) return { error: 'Database not found' };

  const python = detectPython();
  if (!python.available) return { error: 'Python not available' };

  const state = getState(projectRoot);
  const gepaDir = getGepaDir(projectRoot);
  ensureWorkspace(projectRoot);

  const script = `
import sqlite3, json
db_path = ${JSON.stringify(dbPath.replace(/\\/g, '/'))}
conn = sqlite3.connect(db_path)

cols = {row[1] for row in conn.execute("PRAGMA table_info(nodes)").fetchall()}
if 'memory_layer' not in cols:
    conn.close()
    print(json.dumps({"error": "GEPA not migrated"}))
    exit()

rows = conn.execute(
    "SELECT id, node_type, content, importance, fitness, generation, created_at "
    "FROM nodes WHERE memory_layer = 'constant' AND deprecated_at IS NULL "
    "ORDER BY importance DESC"
).fetchall()
conn.close()

entries = []
for r in rows:
    entries.append({
        "id": r[0], "type": r[1], "content": r[2], "importance": r[3],
        "fitness": r[4], "generation": r[5], "created_at": r[6],
    })
print(json.dumps({"entries": entries, "count": len(entries)}))
`;

  try {
    const result = execFileSync(python.command, ['-c', script], {
      encoding: 'utf-8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    const parsed = JSON.parse(result);
    if (parsed.error) return parsed;

    const snapshotPath = path.join(gepaDir, 'constant', `v${state.cycle}.json`);
    fs.writeFileSync(snapshotPath, JSON.stringify({
      exportedAt: new Date().toISOString(),
      cycle: state.cycle,
      entries: parsed.entries,
    }, null, 2));

    return { path: snapshotPath, count: parsed.count };
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Import constant entries from a snapshot file.
 * @param {string} projectRoot
 * @param {string} snapshotPath
 * @returns {{ imported: number } | { error: string }}
 */
function importConstant(projectRoot, snapshotPath) {
  if (!fs.existsSync(snapshotPath)) return { error: 'Snapshot file not found' };

  const dbPath = getMemoryDbPath(projectRoot);
  if (!fs.existsSync(dbPath)) return { error: 'Database not found' };

  const python = detectPython();
  if (!python.available) return { error: 'Python not available' };

  let snapshot;
  try {
    snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
  } catch {
    return { error: 'Invalid snapshot file' };
  }

  if (!snapshot.entries || !Array.isArray(snapshot.entries)) {
    return { error: 'No entries in snapshot' };
  }

  const script = `
import sqlite3, json
from datetime import datetime
from uuid import uuid4

db_path = ${JSON.stringify(dbPath.replace(/\\/g, '/'))}
entries = ${JSON.stringify(snapshot.entries)}

conn = sqlite3.connect(db_path)
imported = 0
now = datetime.now().isoformat()

for e in entries:
    # Check if already exists
    existing = conn.execute("SELECT id FROM nodes WHERE id = ?", (e["id"],)).fetchone()
    if existing:
        continue
    conn.execute(
        "INSERT INTO nodes (id, agent_id, node_type, content, importance, "
        "created_at, accessed_at, access_count, memory_layer, fitness, generation) "
        "VALUES (?, 'claude-code', ?, ?, ?, ?, ?, 0, 'constant', ?, ?)",
        (e["id"], e.get("type", "pattern"), e["content"], e.get("importance", 0.8),
         e.get("created_at", now), now, e.get("fitness", 0.8), e.get("generation", 0))
    )
    imported += 1

conn.commit()
conn.close()
print(json.dumps({"imported": imported}))
`;

  try {
    const result = execFileSync(python.command, ['-c', script], {
      encoding: 'utf-8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return JSON.parse(result);
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Save a session trace to the traces directory.
 * @param {string} projectRoot
 * @param {string} sessionId
 * @param {object} trace - Trace data
 */
function saveTrace(projectRoot, sessionId, trace) {
  ensureWorkspace(projectRoot);
  const tracePath = path.join(getGepaDir(projectRoot), 'traces', `session-${sessionId}.json`);
  fs.writeFileSync(tracePath, JSON.stringify({
    sessionId,
    savedAt: new Date().toISOString(),
    ...trace,
  }, null, 2));
  return tracePath;
}

/**
 * List workspace contents summary.
 * @param {string} projectRoot
 * @returns {object}
 */
function workspaceStatus(projectRoot) {
  const gepaDir = getGepaDir(projectRoot);
  const exists = fs.existsSync(gepaDir);

  if (!exists) return { exists: false };

  const countFiles = (dir) => {
    try { return fs.readdirSync(dir).filter(f => f.endsWith('.json')).length; } catch { return 0; }
  };

  return {
    exists: true,
    hasState: fs.existsSync(path.join(gepaDir, 'state.json')),
    constantSnapshots: countFiles(path.join(gepaDir, 'constant')),
    traces: countFiles(path.join(gepaDir, 'traces')),
    archives: countFiles(path.join(gepaDir, 'archive')),
  };
}

module.exports = {
  ensureWorkspace,
  exportConstant,
  importConstant,
  saveTrace,
  workspaceStatus,
};
