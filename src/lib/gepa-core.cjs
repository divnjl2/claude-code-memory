#!/usr/bin/env node
/**
 * gepa-core.cjs — GEPA v2.1 Memory Paradigm core library.
 *
 * Provides:
 *   - Constants for GEPA 3-layer memory model (Constant, Mutating, File)
 *   - SQLite schema migration (backwards-compatible ALTER TABLE)
 *   - state.json CRUD for cycle tracking
 *   - Helper functions for layer classification
 *
 * Zero dependencies — Node.js built-ins + Python for SQLite.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { getMemoryDir, getMemoryDbPath } = require('./path-resolver.cjs');
const { detectPython } = require('./python-detector.cjs');

// ─── Constants ───────────────────────────────────────────────────────────────

/** GEPA memory layers */
const LAYERS = {
  CONSTANT: 'constant',
  MUTATING: 'mutating',
  FILE: 'file',
};

/** Default GEPA configuration (merged into config.json when enabled) */
const DEFAULT_GEPA_CONFIG = {
  enabled: false,
  quarantineCycles: 20,
  minFitnessForPromotion: 0.8,
  diversityQuota: 3,
  rateLimits: {
    user: { max: 5, window: 'day' },
    promotion: { max: 2, window: 'cycle' },
    verifier: { max: 1, window: '10cycles' },
    calibration: { max: 1, window: 'cycle' },
  },
  contextBudget: {
    constant: 4000,
    mutating: 3000,
    file: 2000,
    total: 10000,
  },
};

/** Node types that auto-classify as constant (when importance >= 0.8) */
const CONSTANT_NODE_TYPES = ['pattern', 'decision'];

/** Node types that auto-classify as file layer */
const FILE_NODE_TYPES = ['file'];

/** Schema version for GEPA migration */
const GEPA_SCHEMA_VERSION = 2;

// ─── Migration SQL ───────────────────────────────────────────────────────────

/**
 * Python script for backwards-compatible schema migration.
 * Uses ALTER TABLE ADD COLUMN — safe on existing data.
 */
function getMigrationScript(dbPath) {
  return `
import sqlite3
import json
import sys

db_path = ${JSON.stringify(dbPath.replace(/\\/g, '/'))}
conn = sqlite3.connect(db_path)

# Check existing columns
cursor = conn.execute("PRAGMA table_info(nodes)")
existing_cols = {row[1] for row in cursor.fetchall()}

migrations = []

# GEPA columns on nodes table
gepa_columns = [
    ("memory_layer", "TEXT DEFAULT 'mutating'"),
    ("version", "INTEGER DEFAULT 1"),
    ("deprecated_at", "TEXT"),
    ("fitness", "REAL DEFAULT 0.5"),
    ("generation", "INTEGER DEFAULT 0"),
    ("promoted_from", "TEXT"),
    ("quarantine_until", "TEXT"),
]

for col_name, col_def in gepa_columns:
    if col_name not in existing_cols:
        conn.execute(f"ALTER TABLE nodes ADD COLUMN {col_name} {col_def}")
        migrations.append(f"added nodes.{col_name}")

# GEPA events table
conn.execute("""
    CREATE TABLE IF NOT EXISTS gepa_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT,
        event_type TEXT,
        source_id TEXT,
        target_id TEXT,
        hook_type TEXT,
        details TEXT DEFAULT '{}',
        created_at TEXT
    )
""")

# Check if gepa_events existed
# (we always run CREATE IF NOT EXISTS, but track if new)
events_existed = conn.execute(
    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='gepa_events'"
).fetchone()[0]
if events_existed:
    migrations.append("gepa_events table ensured")
else:
    migrations.append("created gepa_events table")

# GEPA rate limits table
conn.execute("""
    CREATE TABLE IF NOT EXISTS gepa_rate_limits (
        hook_type TEXT PRIMARY KEY,
        count INTEGER DEFAULT 0,
        window_start TEXT,
        max_per_window INTEGER,
        window_type TEXT
    )
""")
migrations.append("gepa_rate_limits table ensured")

# Index on memory_layer
conn.execute("CREATE INDEX IF NOT EXISTS idx_nodes_memory_layer ON nodes(memory_layer)")
conn.execute("CREATE INDEX IF NOT EXISTS idx_nodes_fitness ON nodes(fitness)")
conn.execute("CREATE INDEX IF NOT EXISTS idx_nodes_generation ON nodes(generation)")
conn.execute("CREATE INDEX IF NOT EXISTS idx_gepa_events_type ON gepa_events(event_type)")

# Auto-classify existing nodes
if "memory_layer" in [m.split(".")[-1] for m in migrations if "nodes." in m]:
    # Classify pattern/decision with importance >= 0.8 as constant
    conn.execute("""
        UPDATE nodes SET memory_layer = 'constant'
        WHERE node_type IN ('pattern', 'decision') AND importance >= 0.8
        AND memory_layer = 'mutating'
    """)
    constant_count = conn.execute(
        "SELECT changes()"
    ).fetchone()[0]

    # Classify file nodes as file layer
    conn.execute("""
        UPDATE nodes SET memory_layer = 'file'
        WHERE node_type = 'file' AND memory_layer = 'mutating'
    """)
    file_count = conn.execute(
        "SELECT changes()"
    ).fetchone()[0]

    migrations.append(f"classified {constant_count} constant, {file_count} file nodes")

conn.commit()
conn.close()
print(json.dumps({"success": True, "migrations": migrations, "version": ${GEPA_SCHEMA_VERSION}}))
`;
}

// ─── Migration ───────────────────────────────────────────────────────────────

/**
 * Run GEPA schema migration on the SQLite database.
 *
 * @param {string} projectRoot - Project root directory
 * @returns {{ success: boolean, migrations: string[], version: number, error?: string }}
 */
function migrateSchema(projectRoot) {
  const dbPath = getMemoryDbPath(projectRoot);

  if (!fs.existsSync(dbPath)) {
    return { success: false, migrations: [], version: 0, error: 'Database not found' };
  }

  const python = detectPython();
  if (!python.available || !python.hasMinVersion) {
    return { success: false, migrations: [], version: 0, error: 'Python 3.8+ required' };
  }

  try {
    const script = getMigrationScript(dbPath);
    const result = execFileSync(python.command, ['-c', script], {
      encoding: 'utf-8',
      timeout: 15000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();

    return JSON.parse(result);
  } catch (err) {
    return { success: false, migrations: [], version: 0, error: err.message };
  }
}

// ─── State Management ────────────────────────────────────────────────────────

/**
 * Get the GEPA state file path.
 * @param {string} projectRoot
 * @returns {string}
 */
function getGepaDir(projectRoot) {
  return path.join(getMemoryDir(projectRoot), 'gepa');
}

/**
 * Get GEPA state (cycle number, last reflection, population stats).
 * @param {string} projectRoot
 * @returns {object}
 */
function getState(projectRoot) {
  const stateFile = path.join(getGepaDir(projectRoot), 'state.json');
  const defaults = {
    cycle: 0,
    lastReflection: null,
    lastPromotion: null,
    population: { constant: 0, mutating: 0, file: 0 },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  try {
    const data = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    return { ...defaults, ...data };
  } catch {
    return defaults;
  }
}

/**
 * Update GEPA state.
 * @param {string} projectRoot
 * @param {object} patch - Fields to update
 * @returns {object} Updated state
 */
function updateState(projectRoot, patch) {
  const gepaDir = getGepaDir(projectRoot);
  try { fs.mkdirSync(gepaDir, { recursive: true }); } catch { /* ok */ }

  const state = getState(projectRoot);
  Object.assign(state, patch, { updatedAt: new Date().toISOString() });

  const stateFile = path.join(gepaDir, 'state.json');
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  return state;
}

/**
 * Increment the GEPA cycle counter.
 * @param {string} projectRoot
 * @returns {number} New cycle number
 */
function incrementCycle(projectRoot) {
  const state = getState(projectRoot);
  const newState = updateState(projectRoot, { cycle: state.cycle + 1 });
  return newState.cycle;
}

// ─── Layer Classification ────────────────────────────────────────────────────

/**
 * Determine the GEPA layer for a node based on its type and importance.
 * @param {string} nodeType - Node type (pattern, decision, fact, error, task, file)
 * @param {number} importance - Importance score (0-1)
 * @returns {string} GEPA layer name
 */
function classifyLayer(nodeType, importance) {
  if (FILE_NODE_TYPES.includes(nodeType)) return LAYERS.FILE;
  if (CONSTANT_NODE_TYPES.includes(nodeType) && importance >= 0.8) return LAYERS.CONSTANT;
  return LAYERS.MUTATING;
}

// ─── Population Stats ────────────────────────────────────────────────────────

/**
 * Get layer population counts from SQLite.
 * @param {string} projectRoot
 * @returns {{ constant: number, mutating: number, file: number, total: number } | null}
 */
function getPopulation(projectRoot) {
  const dbPath = getMemoryDbPath(projectRoot);
  if (!fs.existsSync(dbPath)) return null;

  const python = detectPython();
  if (!python.available) return null;

  const script = `
import sqlite3, json
db_path = ${JSON.stringify(dbPath.replace(/\\/g, '/'))}
conn = sqlite3.connect(db_path)

# Check if memory_layer column exists
cols = {row[1] for row in conn.execute("PRAGMA table_info(nodes)").fetchall()}
if 'memory_layer' not in cols:
    total = conn.execute("SELECT COUNT(*) FROM nodes").fetchone()[0]
    conn.close()
    print(json.dumps({"constant": 0, "mutating": total, "file": 0, "total": total, "migrated": False}))
else:
    counts = {}
    for row in conn.execute("SELECT memory_layer, COUNT(*) FROM nodes GROUP BY memory_layer").fetchall():
        counts[row[0]] = row[1]
    total = sum(counts.values())
    conn.close()
    print(json.dumps({
        "constant": counts.get("constant", 0),
        "mutating": counts.get("mutating", 0),
        "file": counts.get("file", 0),
        "total": total,
        "migrated": True
    }))
`;

  try {
    const result = execFileSync(python.command, ['-c', script], {
      encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return JSON.parse(result);
  } catch {
    return null;
  }
}

// ─── GEPA Config ─────────────────────────────────────────────────────────────

/**
 * Get GEPA config from project config.json.
 * @param {string} projectRoot
 * @returns {object}
 */
function getGepaConfig(projectRoot) {
  const configPath = path.join(getMemoryDir(projectRoot), 'config.json');
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return { ...DEFAULT_GEPA_CONFIG, ...(config.gepa || {}) };
  } catch {
    return { ...DEFAULT_GEPA_CONFIG };
  }
}

/**
 * Check if GEPA is enabled for a project.
 * @param {string} projectRoot
 * @returns {boolean}
 */
function isEnabled(projectRoot) {
  return getGepaConfig(projectRoot).enabled === true;
}

/**
 * Enable or disable GEPA for a project.
 * @param {string} projectRoot
 * @param {boolean} enabled
 * @returns {object} Updated config
 */
function setEnabled(projectRoot, enabled) {
  const configPath = path.join(getMemoryDir(projectRoot), 'config.json');
  let config = {};
  try { config = JSON.parse(fs.readFileSync(configPath, 'utf-8')); } catch { /* ok */ }

  if (!config.gepa) config.gepa = { ...DEFAULT_GEPA_CONFIG };
  config.gepa.enabled = enabled;

  try { fs.mkdirSync(path.dirname(configPath), { recursive: true }); } catch { /* ok */ }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  // If enabling, run migration + create workspace
  if (enabled) {
    const gepaDir = getGepaDir(projectRoot);
    try { fs.mkdirSync(gepaDir, { recursive: true }); } catch { /* ok */ }
    try { fs.mkdirSync(path.join(gepaDir, 'constant'), { recursive: true }); } catch { /* ok */ }
    try { fs.mkdirSync(path.join(gepaDir, 'traces'), { recursive: true }); } catch { /* ok */ }
    try { fs.mkdirSync(path.join(gepaDir, 'archive'), { recursive: true }); } catch { /* ok */ }

    const stateFile = path.join(gepaDir, 'state.json');
    if (!fs.existsSync(stateFile)) {
      updateState(projectRoot, { cycle: 0 });
    }

    migrateSchema(projectRoot);
  }

  return config;
}

// ─── Event Logging ───────────────────────────────────────────────────────────

/**
 * Log a GEPA event to the database.
 * @param {string} projectRoot
 * @param {object} event - { eventType, sourceId, targetId, hookType, details }
 * @returns {boolean}
 */
function logEvent(projectRoot, event) {
  const dbPath = getMemoryDbPath(projectRoot);
  if (!fs.existsSync(dbPath)) return false;

  const python = detectPython();
  if (!python.available) return false;

  const script = `
import sqlite3, json
db_path = ${JSON.stringify(dbPath.replace(/\\/g, '/'))}
conn = sqlite3.connect(db_path)

# Ensure table exists
conn.execute("""
    CREATE TABLE IF NOT EXISTS gepa_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT, event_type TEXT, source_id TEXT, target_id TEXT,
        hook_type TEXT, details TEXT DEFAULT '{}', created_at TEXT
    )
""")

from datetime import datetime
conn.execute(
    "INSERT INTO gepa_events (agent_id, event_type, source_id, target_id, hook_type, details, created_at) "
    "VALUES (?, ?, ?, ?, ?, ?, ?)",
    (
        "claude-code",
        ${JSON.stringify(event.eventType || '')},
        ${JSON.stringify(event.sourceId || '')},
        ${JSON.stringify(event.targetId || '')},
        ${JSON.stringify(event.hookType || '')},
        ${JSON.stringify(JSON.stringify(event.details || {}))},
        datetime.now().isoformat()
    )
)
conn.commit()
conn.close()
print(json.dumps({"success": True}))
`;

  try {
    execFileSync(python.command, ['-c', script], {
      encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  LAYERS,
  DEFAULT_GEPA_CONFIG,
  CONSTANT_NODE_TYPES,
  FILE_NODE_TYPES,
  GEPA_SCHEMA_VERSION,
  migrateSchema,
  getGepaDir,
  getState,
  updateState,
  incrementCycle,
  classifyLayer,
  getPopulation,
  getGepaConfig,
  isEnabled,
  setEnabled,
  logEvent,
};
