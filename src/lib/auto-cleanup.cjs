#!/usr/bin/env node
/**
 * auto-cleanup.cjs — Importance scoring + TTL cleanup for memory DB.
 *
 * Manages memory size by removing low-importance and old entries.
 * Runs automatically at session-end when DB > 80% of maxSizeMB.
 *
 * Zero dependencies (uses sqlite3 via Python CLI or direct file size checks).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { getMemoryDir, getMemoryDbPath } = require('./path-resolver.cjs');
const { getConfig, getMemorySize } = require('./memory-repo.cjs');
const { detectPython } = require('./python-detector.cjs');

/**
 * Check if cleanup is needed (DB > threshold % of maxSizeMB).
 * @param {string} projectRoot
 * @returns {{ needed: boolean, currentMB: number, maxMB: number, pct: number }}
 */
function shouldCleanup(projectRoot) {
  const config = getConfig(projectRoot);
  const currentBytes = getMemorySize(projectRoot);
  const currentMB = currentBytes / (1024 * 1024);
  const maxMB = config.maxSizeMB || 10;
  const threshold = config.autoCleanupThreshold || 0.8;
  const pct = currentMB / maxMB;

  return {
    needed: pct >= threshold,
    currentMB: Math.round(currentMB * 100) / 100,
    maxMB,
    pct: Math.round(pct * 100),
  };
}

/**
 * Run cleanup on the memory database.
 *
 * Strategy:
 *   1. Delete entries with importance < minImportance AND age > ttlDays
 *   2. If still over limit, delete by ascending importance until under limit
 *   3. VACUUM the database
 *
 * @param {string} projectRoot
 * @param {object} [options]
 * @param {boolean} [options.dryRun] - Only show what would be deleted
 * @param {boolean} [options.force] - Skip threshold check
 * @returns {{ deleted: number, vacuumed: boolean, beforeMB: number, afterMB: number, entries: object[] }}
 */
function cleanup(projectRoot, options = {}) {
  const config = getConfig(projectRoot);
  const dbPath = getMemoryDbPath(projectRoot);

  if (!fs.existsSync(dbPath)) {
    return { deleted: 0, vacuumed: false, beforeMB: 0, afterMB: 0, entries: [] };
  }

  const beforeBytes = getMemorySize(projectRoot);
  const beforeMB = Math.round(beforeBytes / (1024 * 1024) * 100) / 100;

  // Use Python for SQLite operations
  const python = detectPython();
  if (!python.available) {
    return { deleted: 0, vacuumed: false, beforeMB, afterMB: beforeMB, entries: [], error: 'Python not available' };
  }

  const ttlDays = config.ttlDays || 30;
  const minImportance = config.minImportance || 0.3;
  const maxSizeMB = config.maxSizeMB || 10;

  // Build Python cleanup script
  const cleanupScript = `
import sqlite3
import json
import sys
from datetime import datetime, timedelta

db_path = ${JSON.stringify(dbPath.replace(/\\/g, '/'))}
dry_run = ${options.dryRun ? 'True' : 'False'}
ttl_days = ${ttlDays}
min_importance = ${minImportance}
max_size_mb = ${maxSizeMB}

conn = sqlite3.connect(db_path)
deleted = []

# Phase 1: Delete low-importance + old entries
cutoff = (datetime.now() - timedelta(days=ttl_days)).isoformat()
cursor = conn.execute(
    "SELECT id, node_type, content, importance, created_at FROM nodes "
    "WHERE importance < ? AND created_at < ? ORDER BY importance ASC",
    (min_importance, cutoff)
)
phase1 = cursor.fetchall()

for row in phase1:
    deleted.append({"id": row[0], "type": row[1], "content": row[2][:100], "importance": row[3], "reason": "low-importance+old"})

if not dry_run and phase1:
    conn.execute(
        "DELETE FROM nodes WHERE importance < ? AND created_at < ?",
        (min_importance, cutoff)
    )
    # Also delete orphaned relations
    conn.execute(
        "DELETE FROM relations WHERE source_id NOT IN (SELECT id FROM nodes) "
        "OR target_id NOT IN (SELECT id FROM nodes)"
    )
    conn.commit()

# Phase 2: If still over limit, delete by ascending importance
if not dry_run:
    import os
    db_size_mb = os.path.getsize(db_path) / (1024 * 1024)
    if db_size_mb > max_size_mb:
        cursor = conn.execute(
            "SELECT id, node_type, content, importance FROM nodes "
            "ORDER BY importance ASC, access_count ASC LIMIT 100"
        )
        for row in cursor.fetchall():
            if os.path.getsize(db_path) / (1024 * 1024) <= max_size_mb * 0.7:
                break
            deleted.append({"id": row[0], "type": row[1], "content": row[2][:100], "importance": row[3], "reason": "over-limit"})
            conn.execute("DELETE FROM nodes WHERE id = ?", (row[0],))
        conn.execute(
            "DELETE FROM relations WHERE source_id NOT IN (SELECT id FROM nodes) "
            "OR target_id NOT IN (SELECT id FROM nodes)"
        )
        conn.commit()

# Phase 3: VACUUM
vacuumed = False
if not dry_run and deleted:
    conn.execute("VACUUM")
    vacuumed = True

conn.close()
print(json.dumps({"deleted": len(deleted), "vacuumed": vacuumed, "entries": deleted}))
`;

  try {
    const result = execFileSync(python.command, ['-c', cleanupScript], {
      encoding: 'utf-8',
      timeout: 30000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();

    const parsed = JSON.parse(result);
    const afterBytes = getMemorySize(projectRoot);
    const afterMB = Math.round(afterBytes / (1024 * 1024) * 100) / 100;

    return {
      deleted: parsed.deleted,
      vacuumed: parsed.vacuumed,
      beforeMB,
      afterMB,
      entries: parsed.entries,
    };
  } catch (err) {
    return {
      deleted: 0,
      vacuumed: false,
      beforeMB,
      afterMB: beforeMB,
      entries: [],
      error: err.message,
    };
  }
}

module.exports = { shouldCleanup, cleanup };
