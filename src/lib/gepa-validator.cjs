#!/usr/bin/env node
/**
 * gepa-validator.cjs — GEPA Hook Validator.
 *
 * Provides:
 *   - Deduplication (content hash check before store)
 *   - Conflict detection (contradicting entries in same layer)
 *   - Importance scoring (normalized 0-1 based on type + context)
 *   - Rate limiting per hook type (prevents runaway writes)
 *
 * All operations use SQLite via Python subprocess.
 * Zero dependencies — Node.js built-ins only.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { getMemoryDbPath, getMemoryDir } = require('./path-resolver.cjs');
const { detectPython } = require('./python-detector.cjs');
const { getGepaConfig } = require('./gepa-core.cjs');

// ─── Deduplication ───────────────────────────────────────────────────────────

/**
 * Check if content already exists in the database (exact or similar match).
 * Uses normalized content comparison via SQLite.
 *
 * @param {string} projectRoot
 * @param {string} content - Content to check
 * @param {string} [layer] - Optional layer filter
 * @returns {{ isDuplicate: boolean, existingId?: string, similarity?: number }}
 */
function checkDuplicate(projectRoot, content, layer) {
  const dbPath = getMemoryDbPath(projectRoot);
  if (!fs.existsSync(dbPath)) return { isDuplicate: false };

  const python = detectPython();
  if (!python.available) return { isDuplicate: false };

  // Normalize content for comparison: lowercase, trim, collapse whitespace
  const normalized = content.toLowerCase().trim().replace(/\s+/g, ' ');

  const script = `
import sqlite3, json
db_path = ${JSON.stringify(dbPath.replace(/\\/g, '/'))}
normalized = ${JSON.stringify(normalized)}
layer_filter = ${JSON.stringify(layer || '')}

conn = sqlite3.connect(db_path)

# Check if memory_layer column exists
cols = {row[1] for row in conn.execute("PRAGMA table_info(nodes)").fetchall()}
has_layer = 'memory_layer' in cols

# Check exact match (normalized)
sql = "SELECT id, content FROM nodes WHERE LOWER(TRIM(content)) = ?"
params = [normalized]
if has_layer and layer_filter:
    sql += " AND memory_layer = ?"
    params.append(layer_filter)
sql += " LIMIT 1"

row = conn.execute(sql, params).fetchone()
if row:
    conn.close()
    print(json.dumps({"isDuplicate": True, "existingId": row[0], "similarity": 1.0}))
else:
    # Check substring overlap (>80% of words match)
    words = set(normalized.split())
    if len(words) >= 3:
        # Check entries that share at least half the words
        sample_word = sorted(words, key=len, reverse=True)[0]
        sql2 = "SELECT id, content FROM nodes WHERE LOWER(content) LIKE ? LIMIT 20"
        params2 = [f"%{sample_word}%"]
        candidates = conn.execute(sql2, params2).fetchall()
        best_sim = 0.0
        best_id = None
        for cid, ccontent in candidates:
            cwords = set(ccontent.lower().split())
            if not cwords:
                continue
            overlap = len(words & cwords) / max(len(words), len(cwords))
            if overlap > best_sim:
                best_sim = overlap
                best_id = cid
        if best_sim >= 0.8:
            conn.close()
            print(json.dumps({"isDuplicate": True, "existingId": best_id, "similarity": round(best_sim, 2)}))
        else:
            conn.close()
            print(json.dumps({"isDuplicate": False}))
    else:
        conn.close()
        print(json.dumps({"isDuplicate": False}))
`;

  try {
    const result = execFileSync(python.command, ['-c', script], {
      encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return JSON.parse(result);
  } catch {
    return { isDuplicate: false };
  }
}

// ─── Conflict Detection ─────────────────────────────────────────────────────

/**
 * Check if content conflicts with existing entries (contradicting patterns).
 * Looks for entries with negation keywords that overlap significantly.
 *
 * @param {string} projectRoot
 * @param {string} content
 * @param {string} layer
 * @returns {{ hasConflict: boolean, conflictingIds?: string[], reason?: string }}
 */
function checkConflict(projectRoot, content, layer) {
  const dbPath = getMemoryDbPath(projectRoot);
  if (!fs.existsSync(dbPath)) return { hasConflict: false };

  const python = detectPython();
  if (!python.available) return { hasConflict: false };

  const script = `
import sqlite3, json
db_path = ${JSON.stringify(dbPath.replace(/\\/g, '/'))}
content = ${JSON.stringify(content)}
layer = ${JSON.stringify(layer || 'mutating')}

conn = sqlite3.connect(db_path)

# Check if memory_layer column exists
cols = {row[1] for row in conn.execute("PRAGMA table_info(nodes)").fetchall()}
has_layer = 'memory_layer' in cols

# Extract keywords from content
words = set(content.lower().split())
# Negation markers
negations = {"not", "never", "don't", "dont", "avoid", "anti", "bad", "wrong", "deprecated"}
has_negation = bool(words & negations)

# Get content words without negations for matching
content_words = words - negations
if len(content_words) < 2:
    conn.close()
    print(json.dumps({"hasConflict": False}))
else:
    # Search for entries that share keywords but have opposite sentiment
    sample_words = sorted(content_words, key=len, reverse=True)[:3]
    conditions = " OR ".join(["LOWER(content) LIKE ?" for _ in sample_words])
    params = [f"%{w}%" for w in sample_words]

    sql = f"SELECT id, content FROM nodes WHERE ({conditions})"
    if has_layer:
        sql += " AND memory_layer = ?"
        params.append(layer)
    sql += " LIMIT 30"

    conflicts = []
    for row_id, row_content in conn.execute(sql, params).fetchall():
        row_words = set(row_content.lower().split())
        row_has_negation = bool(row_words & negations)
        # Conflict: one has negation, the other doesn't, but they share >50% keywords
        row_content_words = row_words - negations
        if not row_content_words:
            continue
        overlap = len(content_words & row_content_words) / max(len(content_words), len(row_content_words))
        if overlap >= 0.5 and has_negation != row_has_negation:
            conflicts.append(row_id)

    conn.close()
    if conflicts:
        print(json.dumps({"hasConflict": True, "conflictingIds": conflicts[:5], "reason": "negation_mismatch"}))
    else:
        print(json.dumps({"hasConflict": False}))
`;

  try {
    const result = execFileSync(python.command, ['-c', script], {
      encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return JSON.parse(result);
  } catch {
    return { hasConflict: false };
  }
}

// ─── Importance Scoring ─────────────────────────────────────────────────────

/**
 * Base importance scores by node type.
 */
const BASE_IMPORTANCE = {
  pattern: 0.8,
  decision: 0.7,
  error: 0.7,
  task: 0.5,
  fact: 0.5,
  file: 0.4,
};

/**
 * Calculate importance score for a piece of content.
 * Uses type-based base score + content analysis heuristics.
 *
 * @param {string} content
 * @param {string} nodeType
 * @param {object} [context] - Additional context
 * @param {boolean} [context.isUserExplicit] - User explicitly asked to store
 * @param {number} [context.mentionCount] - How many times this topic was mentioned
 * @returns {number} Importance score 0-1
 */
function calculateImportance(content, nodeType, context = {}) {
  let score = BASE_IMPORTANCE[nodeType] || 0.5;

  // Boost for user-explicit stores
  if (context.isUserExplicit) score = Math.min(score + 0.15, 1.0);

  // Boost for content with specific indicators
  const lower = content.toLowerCase();
  if (lower.includes('always') || lower.includes('never') || lower.includes('critical')) {
    score = Math.min(score + 0.1, 1.0);
  }
  if (lower.includes('bug') || lower.includes('fix') || lower.includes('workaround')) {
    score = Math.min(score + 0.05, 1.0);
  }

  // Penalty for very short content
  if (content.length < 20) score = Math.max(score - 0.1, 0.1);

  // Boost for mention frequency
  if (context.mentionCount && context.mentionCount > 3) {
    score = Math.min(score + 0.1, 1.0);
  }

  return Math.round(score * 100) / 100;
}

// ─── Rate Limiting ──────────────────────────────────────────────────────────

/**
 * Check if a hook type is rate-limited.
 * Uses a simple JSON file for tracking (no SQLite needed for this).
 *
 * @param {string} projectRoot
 * @param {string} hookType - Hook type (user, promotion, verifier, calibration)
 * @returns {{ allowed: boolean, remaining: number, resetAt?: string }}
 */
function checkRateLimit(projectRoot, hookType) {
  const gepaConfig = getGepaConfig(projectRoot);
  const limits = gepaConfig.rateLimits || {};
  const limit = limits[hookType];

  if (!limit) return { allowed: true, remaining: Infinity };

  const rateLimitFile = path.join(getMemoryDir(projectRoot), 'gepa', 'rate-limits.json');
  let data = {};
  try { data = JSON.parse(fs.readFileSync(rateLimitFile, 'utf-8')); } catch { /* ok */ }

  const entry = data[hookType] || { count: 0, windowStart: new Date().toISOString() };
  const now = new Date();
  const windowStart = new Date(entry.windowStart);

  // Calculate window duration
  let windowMs;
  switch (limit.window) {
    case 'day': windowMs = 24 * 60 * 60 * 1000; break;
    case 'hour': windowMs = 60 * 60 * 1000; break;
    case 'cycle': windowMs = 0; break; // Reset per cycle
    case '10cycles': windowMs = 0; break; // Handled separately
    default: windowMs = 24 * 60 * 60 * 1000;
  }

  // Check if window has expired (for time-based windows)
  if (windowMs > 0 && (now - windowStart) >= windowMs) {
    entry.count = 0;
    entry.windowStart = now.toISOString();
  }

  const remaining = Math.max(0, limit.max - entry.count);
  const allowed = entry.count < limit.max;

  return {
    allowed,
    remaining,
    resetAt: windowMs > 0 ? new Date(windowStart.getTime() + windowMs).toISOString() : undefined,
  };
}

/**
 * Consume a rate limit token.
 * @param {string} projectRoot
 * @param {string} hookType
 * @returns {boolean} Whether the operation was allowed
 */
function consumeRateLimit(projectRoot, hookType) {
  const check = checkRateLimit(projectRoot, hookType);
  if (!check.allowed) return false;

  const rateLimitFile = path.join(getMemoryDir(projectRoot), 'gepa', 'rate-limits.json');
  let data = {};
  try { data = JSON.parse(fs.readFileSync(rateLimitFile, 'utf-8')); } catch { /* ok */ }

  if (!data[hookType]) {
    data[hookType] = { count: 0, windowStart: new Date().toISOString() };
  }
  data[hookType].count++;
  data[hookType].lastUsed = new Date().toISOString();

  const dir = path.dirname(rateLimitFile);
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ok */ }
  fs.writeFileSync(rateLimitFile, JSON.stringify(data, null, 2));

  return true;
}

/**
 * Reset rate limits for a specific hook type or all types.
 * Called at cycle boundaries.
 *
 * @param {string} projectRoot
 * @param {string} [hookType] - Specific type to reset, or null for all cycle-based
 */
function resetRateLimits(projectRoot, hookType) {
  const rateLimitFile = path.join(getMemoryDir(projectRoot), 'gepa', 'rate-limits.json');
  let data = {};
  try { data = JSON.parse(fs.readFileSync(rateLimitFile, 'utf-8')); } catch { /* ok */ }

  const gepaConfig = getGepaConfig(projectRoot);
  const limits = gepaConfig.rateLimits || {};

  if (hookType) {
    if (data[hookType]) {
      data[hookType].count = 0;
      data[hookType].windowStart = new Date().toISOString();
    }
  } else {
    // Reset all cycle-based limits
    for (const [type, limit] of Object.entries(limits)) {
      if (limit.window === 'cycle' && data[type]) {
        data[type].count = 0;
        data[type].windowStart = new Date().toISOString();
      }
    }
  }

  const dir = path.dirname(rateLimitFile);
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ok */ }
  fs.writeFileSync(rateLimitFile, JSON.stringify(data, null, 2));
}

// ─── Validate Store Operation ────────────────────────────────────────────────

/**
 * Full validation pipeline for a GEPA store operation.
 * Runs dedup, conflict, importance, and rate limit checks.
 *
 * @param {string} projectRoot
 * @param {string} content
 * @param {string} nodeType
 * @param {string} layer
 * @param {string} hookType
 * @param {object} [context]
 * @returns {{ allowed: boolean, importance: number, layer: string, reason?: string, warnings?: string[] }}
 */
function validateStore(projectRoot, content, nodeType, layer, hookType, context = {}) {
  const warnings = [];

  // Rate limit check
  const rateCheck = checkRateLimit(projectRoot, hookType || 'user');
  if (!rateCheck.allowed) {
    return {
      allowed: false,
      importance: 0,
      layer,
      reason: `Rate limit exceeded for ${hookType} (remaining: ${rateCheck.remaining})`,
    };
  }

  // Calculate importance
  const importance = calculateImportance(content, nodeType, context);

  // Dedup check
  const dupCheck = checkDuplicate(projectRoot, content, layer);
  if (dupCheck.isDuplicate) {
    return {
      allowed: false,
      importance,
      layer,
      reason: `Duplicate content (existing: ${dupCheck.existingId}, similarity: ${dupCheck.similarity})`,
    };
  }

  // Conflict check (only for constant layer)
  if (layer === 'constant') {
    const conflictCheck = checkConflict(projectRoot, content, layer);
    if (conflictCheck.hasConflict) {
      warnings.push(`Potential conflict with: ${conflictCheck.conflictingIds.join(', ')}`);
    }
  }

  return {
    allowed: true,
    importance,
    layer,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

module.exports = {
  checkDuplicate,
  checkConflict,
  calculateImportance,
  BASE_IMPORTANCE,
  checkRateLimit,
  consumeRateLimit,
  resetRateLimits,
  validateStore,
};
