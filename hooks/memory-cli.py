#!/usr/bin/env python3
"""
Memory CLI — hook-friendly wrapper for GraphMemory.

Two modes:
  FAST (hooks):  Direct SQLite — no torch/sentence-transformers, <100ms
  FULL (manual): Full GraphMemory with HNSW semantic search (if available)

Adapted for claude-code-memory: uses .claude-memory/db/memory.db path.

Usage:
    python memory-cli.py context "task description"
    python memory-cli.py store <key> <value> [--type pattern]
    python memory-cli.py search "query" [--limit N]
    python memory-cli.py stats
    python memory-cli.py session-end [--json '{"what_worked":[...]}']
    python memory-cli.py pre-task [--description "..."]
    python memory-cli.py post-task
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import os
from datetime import datetime
from pathlib import Path
from uuid import uuid4

# ── Paths ─────────────────────────────────────────────────────────────────────

# Use CWD as project root (hooks run with CWD = project dir)
_cwd = Path.cwd()
if (_cwd / ".claude").exists():
    PROJECT_DIR = _cwd
elif (_cwd / ".claude-memory").exists():
    PROJECT_DIR = _cwd
else:
    PROJECT_DIR = Path(__file__).resolve().parent.parent

# Memory dir: prefer .claude-memory, fallback to .clod
MEMORY_DIR = PROJECT_DIR / ".claude-memory" / "db"
if not MEMORY_DIR.exists():
    _legacy = PROJECT_DIR / ".clod"
    if _legacy.exists():
        MEMORY_DIR = _legacy

DB_PATH = MEMORY_DIR / "memory.db"
AGENT_ID = "claude-code"

FAST_COMMANDS = {"pre-task", "post-task", "session-end"}

# PII patterns — never store these
PII_PATTERNS = [
    r"sk-[a-zA-Z0-9]{20,}",
    r"ghp_[a-zA-Z0-9]{36}",
    r"password\s*=\s*[\"'][^\"']+[\"']",
    r"api[_\-]?key\s*=\s*[\"'][^\"']+[\"']",
]


def contains_pii(text: str) -> bool:
    import re
    return any(re.search(p, text, re.IGNORECASE) for p in PII_PATTERNS)


def sanitize(text: str) -> str:
    import re
    for p in PII_PATTERNS:
        text = re.sub(p, "[REDACTED]", text, flags=re.IGNORECASE)
    return text


# ── Fast SQLite Layer ────────────────────────────────────────────────────────

def _ensure_db():
    """Ensure database exists with correct schema."""
    MEMORY_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute("""
        CREATE TABLE IF NOT EXISTS nodes (
            id TEXT PRIMARY KEY,
            agent_id TEXT NOT NULL,
            node_type TEXT NOT NULL,
            content TEXT NOT NULL,
            metadata TEXT DEFAULT '{}',
            importance REAL DEFAULT 0.5,
            created_at TEXT NOT NULL,
            accessed_at TEXT NOT NULL,
            access_count INTEGER DEFAULT 0
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS relations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agent_id TEXT NOT NULL,
            source_id TEXT NOT NULL,
            target_id TEXT NOT NULL,
            relation_type TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_nodes_agent ON nodes(agent_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(node_type)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_nodes_importance ON nodes(importance)")
    conn.commit()
    return conn


def fast_query(search_term: str, limit: int = 5, node_type: str = None):
    conn = _ensure_db()
    sql = "SELECT id, node_type, content, importance, access_count FROM nodes WHERE agent_id = ?"
    params = [AGENT_ID]

    if search_term:
        words = search_term.lower().split()[:5]
        word_clauses = []
        for w in words:
            word_clauses.append("LOWER(content) LIKE ?")
            params.append(f"%{w}%")
        if word_clauses:
            sql += " AND (" + " OR ".join(word_clauses) + ")"

    if node_type:
        sql += " AND node_type = ?"
        params.append(node_type)

    sql += " ORDER BY importance DESC, access_count DESC LIMIT ?"
    params.append(limit)

    rows = conn.execute(sql, params).fetchall()
    conn.close()
    return [
        {"id": r[0], "type": r[1], "content": r[2], "importance": r[3], "access_count": r[4]}
        for r in rows
    ]


def fast_store(content: str, node_type: str = "fact", importance: float = 0.5,
               metadata: dict = None):
    # PII check
    if contains_pii(content):
        content = sanitize(content)

    conn = _ensure_db()
    node_id = str(uuid4())[:12]
    now = datetime.now().isoformat()
    meta_json = json.dumps(metadata or {})

    conn.execute(
        "INSERT INTO nodes (id, agent_id, node_type, content, metadata, importance, created_at, accessed_at, access_count) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)",
        (node_id, AGENT_ID, node_type, content, meta_json, importance, now, now),
    )
    conn.commit()
    conn.close()
    return node_id


def fast_stats():
    conn = _ensure_db()
    total = conn.execute("SELECT COUNT(*) FROM nodes WHERE agent_id = ?", (AGENT_ID,)).fetchone()[0]
    total_rel = conn.execute("SELECT COUNT(*) FROM relations WHERE agent_id = ?", (AGENT_ID,)).fetchone()[0]

    types = {}
    for row in conn.execute(
        "SELECT node_type, COUNT(*) FROM nodes WHERE agent_id = ? GROUP BY node_type", (AGENT_ID,)
    ).fetchall():
        types[row[0]] = row[1]

    # DB file size
    db_size = 0
    if DB_PATH.exists():
        db_size = DB_PATH.stat().st_size

    conn.close()
    return {
        "agent_id": AGENT_ID,
        "total_nodes": total,
        "total_relations": total_rel,
        "nodes_by_type": types,
        "db_path": str(DB_PATH),
        "db_size_kb": round(db_size / 1024, 1),
    }


# ── Command Handlers ──────────────────────────────────────────────────────────

def cmd_context(args):
    if args.fast:
        results = fast_query(args.query, limit=args.limit or 5)
    else:
        try:
            from memory.graph_memory import GraphMemory
            mem = GraphMemory(agent_id=AGENT_ID)
            nodes = mem.query(search_term=args.query, limit=args.limit or 5)
            results = [
                {"type": n.node_type.value, "content": n.content[:200], "importance": n.importance}
                for n in nodes
            ]
        except ImportError:
            results = fast_query(args.query, limit=args.limit or 5)

    if not results:
        print(f"[memory] No relevant context found for: {args.query}")
        return

    print(f"[MEMORY CONTEXT] {len(results)} relevant memories for: {args.query}")
    print("---")
    for r in results:
        t = r["type"].upper()
        imp = f"imp={r['importance']:.1f}" if r.get("importance") else ""
        print(f"[{t}] {imp} {r['content'][:200]}")
    print("---")


def cmd_store(args):
    importance = args.importance or 0.5
    meta = {"key": args.key, "source": "cli"}
    node_id = fast_store(args.value, node_type=args.type, importance=importance, metadata=meta)
    print(json.dumps({"success": True, "node_id": node_id, "type": args.type, "key": args.key}))


def cmd_search(args):
    results = fast_query(args.query, limit=args.limit or 10)
    print(json.dumps({"count": len(results), "results": results}, indent=2))


def cmd_stats(args):
    stats = fast_stats()
    print(json.dumps(stats, indent=2))


def cmd_session_end(args):
    insights = {}
    if args.json:
        try:
            insights = json.loads(args.json)
        except json.JSONDecodeError:
            print("[memory] Error: invalid JSON for --json", file=sys.stderr)
            return

    stored = 0
    for key, items in insights.items():
        if isinstance(items, list):
            for item in items:
                type_map = {
                    "what_worked": "pattern", "what_failed": "error",
                    "patterns_found": "pattern", "gotchas": "error",
                    "recommendations": "decision", "subtasks_completed": "task",
                }
                importance_map = {
                    "what_worked": 0.8, "what_failed": 0.7,
                    "patterns_found": 0.9, "gotchas": 0.8,
                    "recommendations": 0.7, "subtasks_completed": 0.5,
                }
                fast_store(
                    content=str(item),
                    node_type=type_map.get(key, "fact"),
                    importance=importance_map.get(key, 0.5),
                    metadata={"source": "session-end", "insight_type": key},
                )
                stored += 1

    print(json.dumps({"success": True, "stored": stored}))


def cmd_pre_task(args):
    description = args.description or ""
    if not description:
        try:
            if not sys.stdin.isatty():
                data = sys.stdin.read(2000)
                try:
                    tool_input = json.loads(data)
                    description = tool_input.get("prompt", tool_input.get("description", ""))
                except json.JSONDecodeError:
                    description = data[:200]
        except (OSError, ValueError):
            pass

    if not description or len(description) < 5:
        return

    results = fast_query(description, limit=3)
    if not results:
        return

    print(f"\n[MEMORY CONTEXT -- {len(results)} relevant memories]")
    for r in results:
        t = r["type"].upper()
        print(f"  [{t}] {r['content'][:150]}")
    print("[END MEMORY CONTEXT]\n")


def cmd_post_task(args):
    output_text = ""
    try:
        if not sys.stdin.isatty():
            output_text = sys.stdin.read(2000)
    except (OSError, ValueError):
        pass

    if not output_text or len(output_text) < 20:
        return

    summary = output_text[:500].strip()
    if summary:
        node_id = fast_store(
            content=summary, node_type="task", importance=0.6,
            metadata={"source": "post-task-hook", "auto": True},
        )
        print(json.dumps({"stored": True, "node_id": node_id, "length": len(summary)}))


# ── GEPA Commands ────────────────────────────────────────────────────────────

def _has_gepa_columns() -> bool:
    """Check if GEPA migration has been applied."""
    conn = _ensure_db()
    cols = {row[1] for row in conn.execute("PRAGMA table_info(nodes)").fetchall()}
    conn.close()
    return "memory_layer" in cols


def cmd_migrate(args):
    """Run GEPA schema migration."""
    conn = _ensure_db()
    cols = {row[1] for row in conn.execute("PRAGMA table_info(nodes)").fetchall()}

    migrations = []
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
        if col_name not in cols:
            conn.execute(f"ALTER TABLE nodes ADD COLUMN {col_name} {col_def}")
            migrations.append(f"added nodes.{col_name}")

    conn.execute("""
        CREATE TABLE IF NOT EXISTS gepa_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agent_id TEXT, event_type TEXT, source_id TEXT, target_id TEXT,
            hook_type TEXT, details TEXT DEFAULT '{}', created_at TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS gepa_rate_limits (
            hook_type TEXT PRIMARY KEY,
            count INTEGER DEFAULT 0, window_start TEXT,
            max_per_window INTEGER, window_type TEXT
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_nodes_memory_layer ON nodes(memory_layer)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_nodes_fitness ON nodes(fitness)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_nodes_generation ON nodes(generation)")

    # Auto-classify existing nodes
    if "memory_layer" not in cols:
        conn.execute("""
            UPDATE nodes SET memory_layer = 'constant'
            WHERE node_type IN ('pattern', 'decision') AND importance >= 0.8
        """)
        constant_count = conn.execute("SELECT changes()").fetchone()[0]
        conn.execute("""
            UPDATE nodes SET memory_layer = 'file'
            WHERE node_type = 'file' AND memory_layer = 'mutating'
        """)
        file_count = conn.execute("SELECT changes()").fetchone()[0]
        migrations.append(f"classified {constant_count} constant, {file_count} file")

    conn.commit()
    conn.close()
    print(json.dumps({"success": True, "migrations": migrations}))


def cmd_gepa_store(args):
    """Store a node with GEPA layer classification."""
    if not _has_gepa_columns():
        # Fallback to regular store
        fast_store(args.value, node_type=args.type, importance=args.importance or 0.5)
        print(json.dumps({"success": True, "gepa": False}))
        return

    importance = args.importance or 0.5
    layer = args.layer or "mutating"

    # Auto-classify if layer not specified
    if not args.layer:
        if args.type == "file":
            layer = "file"
        elif args.type in ("pattern", "decision") and importance >= 0.8:
            layer = "constant"

    content = args.value
    if contains_pii(content):
        content = sanitize(content)

    conn = _ensure_db()
    node_id = str(uuid4())[:12]
    now = datetime.now().isoformat()
    meta = json.dumps({"key": args.key, "source": "gepa-cli", "layer": layer})

    conn.execute(
        "INSERT INTO nodes (id, agent_id, node_type, content, metadata, importance, "
        "created_at, accessed_at, access_count, memory_layer, fitness, generation) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0)",
        (node_id, AGENT_ID, args.type, content, meta, importance, now, now, layer, importance),
    )
    conn.commit()
    conn.close()
    print(json.dumps({"success": True, "node_id": node_id, "layer": layer, "gepa": True}))


def cmd_fitness_update(args):
    """Bulk update fitness scores for all nodes."""
    if not _has_gepa_columns():
        print(json.dumps({"updated": 0, "error": "GEPA not migrated"}))
        return

    conn = _ensure_db()
    max_age_days = getattr(args, 'max_age_days', 90) or 90
    layer_filter = getattr(args, 'layer', None)

    # Get max access count for normalization
    sql_max = "SELECT COALESCE(MAX(access_count), 1) FROM nodes"
    params_max = []
    if layer_filter:
        sql_max += " WHERE memory_layer = ?"
        params_max = [layer_filter]
    max_access = conn.execute(sql_max, params_max).fetchone()[0] or 1

    now = datetime.now()

    sql = "SELECT id, importance, access_count, accessed_at FROM nodes"
    params = []
    if layer_filter:
        sql += " WHERE memory_layer = ?"
        params = [layer_filter]

    rows = conn.execute(sql, params).fetchall()
    updates = []

    for node_id, importance, access_count, accessed_at in rows:
        norm_access = access_count / max_access

        try:
            last_access = datetime.fromisoformat(accessed_at.replace('Z', '').split('+')[0])
            days_since = (now - last_access).days
        except (ValueError, TypeError):
            days_since = 0

        age_factor = max(0.0, 1.0 - (days_since / max_age_days))

        inbound = conn.execute(
            "SELECT COUNT(*) FROM relations WHERE target_id = ?", (node_id,)
        ).fetchone()[0]
        referral_factor = min(1.0, inbound / 5.0)

        fitness = (0.3 * norm_access) + (0.3 * importance) + (0.2 * age_factor) + (0.2 * referral_factor)
        fitness = round(fitness, 4)
        updates.append((fitness, node_id))

    conn.executemany("UPDATE nodes SET fitness = ? WHERE id = ?", updates)
    conn.commit()
    conn.close()
    print(json.dumps({"updated": len(updates)}))


def cmd_reflect(args):
    """Run GEPA reflection checks."""
    if not _has_gepa_columns():
        print(json.dumps({"success": False, "error": "GEPA not migrated"}))
        return

    conn = _ensure_db()
    checks = {}

    # Check 1: Diversity quota
    distinct_types = conn.execute(
        "SELECT COUNT(DISTINCT node_type) FROM nodes "
        "WHERE memory_layer = 'mutating' AND deprecated_at IS NULL"
    ).fetchone()[0]
    checks["diversity"] = {"distinct_types": distinct_types, "quota": 3}

    # Check 2: Population
    population = {}
    for row in conn.execute(
        "SELECT memory_layer, COUNT(*) FROM nodes WHERE deprecated_at IS NULL GROUP BY memory_layer"
    ).fetchall():
        population[row[0]] = row[1]

    # Check 3: Quarantine count
    quarantine_count = conn.execute(
        "SELECT COUNT(*) FROM nodes WHERE quarantine_until IS NOT NULL AND quarantine_until != '' "
        "AND deprecated_at IS NULL"
    ).fetchone()[0]

    conn.close()
    print(json.dumps({
        "success": True,
        "checks": checks,
        "population": population,
        "quarantine_pending": quarantine_count,
    }, indent=2))


def cmd_promote(args):
    """Promote a node to constant layer."""
    if not _has_gepa_columns():
        print(json.dumps({"success": False, "error": "GEPA not migrated"}))
        return

    conn = _ensure_db()
    node_id = args.node_id
    row = conn.execute("SELECT memory_layer FROM nodes WHERE id = ?", (node_id,)).fetchone()
    if not row:
        conn.close()
        print(json.dumps({"success": False, "error": "Node not found"}))
        return
    if row[0] == "constant":
        conn.close()
        print(json.dumps({"success": False, "error": "Already constant"}))
        return

    conn.execute(
        "UPDATE nodes SET memory_layer = 'constant', promoted_from = ?, "
        "quarantine_until = NULL, version = version + 1 WHERE id = ?",
        (row[0], node_id)
    )
    conn.commit()
    conn.close()
    print(json.dumps({"success": True, "from": row[0], "to": "constant"}))


def cmd_deprecate(args):
    """Soft-delete a node by setting deprecated_at."""
    if not _has_gepa_columns():
        print(json.dumps({"success": False, "error": "GEPA not migrated"}))
        return

    conn = _ensure_db()
    node_id = args.node_id
    row = conn.execute("SELECT id FROM nodes WHERE id = ?", (node_id,)).fetchone()
    if not row:
        conn.close()
        print(json.dumps({"success": False, "error": "Node not found"}))
        return

    conn.execute(
        "UPDATE nodes SET deprecated_at = ? WHERE id = ?",
        (datetime.now().isoformat(), node_id)
    )
    conn.commit()
    conn.close()
    print(json.dumps({"success": True}))


def cmd_quarantine_check(args):
    """Check and resolve quarantined nodes."""
    if not _has_gepa_columns():
        print(json.dumps({"success": False, "error": "GEPA not migrated"}))
        return

    conn = _ensure_db()
    current_cycle = args.cycle or 0
    min_fitness = 0.8

    quarantined = conn.execute(
        "SELECT id, content, fitness, quarantine_until FROM nodes "
        "WHERE quarantine_until IS NOT NULL AND quarantine_until != '' "
        "AND deprecated_at IS NULL AND memory_layer = 'mutating'"
    ).fetchall()

    promoted = []
    failed = []
    for node_id, content, fitness, q_until in quarantined:
        try:
            q_cycle = int(q_until)
        except (ValueError, TypeError):
            continue
        if current_cycle >= q_cycle:
            if fitness >= min_fitness:
                conn.execute(
                    "UPDATE nodes SET memory_layer = 'constant', promoted_from = 'mutating', "
                    "quarantine_until = NULL, version = version + 1 WHERE id = ?",
                    (node_id,)
                )
                promoted.append({"id": node_id, "fitness": fitness})
            else:
                conn.execute("UPDATE nodes SET quarantine_until = NULL WHERE id = ?", (node_id,))
                failed.append({"id": node_id, "fitness": fitness})

    conn.commit()
    conn.close()
    print(json.dumps({"promoted": promoted, "failed": failed, "pending": len(quarantined) - len(promoted) - len(failed)}))


def cmd_gepa_query(args):
    """Query nodes filtered by GEPA layer."""
    if not _has_gepa_columns():
        results = fast_query(args.query, limit=args.limit or 5)
        print(json.dumps({"results": results, "gepa": False}))
        return

    conn = _ensure_db()
    sql = "SELECT id, node_type, content, importance, memory_layer, fitness FROM nodes WHERE agent_id = ?"
    params = [AGENT_ID]

    if args.layer:
        sql += " AND memory_layer = ?"
        params.append(args.layer)

    if args.query:
        words = args.query.lower().split()[:5]
        word_clauses = ["LOWER(content) LIKE ?" for w in words]
        params.extend(f"%{w}%" for w in words)
        if word_clauses:
            sql += " AND (" + " OR ".join(word_clauses) + ")"

    sql += " ORDER BY fitness DESC, importance DESC LIMIT ?"
    params.append(args.limit or 10)

    rows = conn.execute(sql, params).fetchall()
    conn.close()

    results = [
        {"id": r[0], "type": r[1], "content": r[2], "importance": r[3], "layer": r[4], "fitness": r[5]}
        for r in rows
    ]
    print(json.dumps({"results": results, "count": len(results), "gepa": True}, indent=2))


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Memory CLI for hook integration")
    parser.add_argument("--fast", action="store_true", help="Fast SQLite-only mode")
    sub = parser.add_subparsers(dest="command")

    p_ctx = sub.add_parser("context")
    p_ctx.add_argument("query")
    p_ctx.add_argument("--limit", type=int, default=5)
    p_ctx.add_argument("--fast", action="store_true")

    p_store = sub.add_parser("store")
    p_store.add_argument("key")
    p_store.add_argument("value")
    p_store.add_argument("--type", default="fact", choices=["fact", "decision", "pattern", "error", "task", "file"])
    p_store.add_argument("--importance", type=float, default=0.5)
    p_store.add_argument("--fast", action="store_true")

    p_search = sub.add_parser("search")
    p_search.add_argument("query")
    p_search.add_argument("--limit", type=int, default=10)
    p_search.add_argument("--fast", action="store_true")

    p_stats = sub.add_parser("stats")
    p_stats.add_argument("--fast", action="store_true")

    p_end = sub.add_parser("session-end")
    p_end.add_argument("--json", default=None)
    p_end.add_argument("--fast", action="store_true")

    p_pre = sub.add_parser("pre-task")
    p_pre.add_argument("--description", default="")
    p_pre.add_argument("--fast", action="store_true", default=True)

    p_post = sub.add_parser("post-task")
    p_post.add_argument("--fast", action="store_true", default=True)

    # GEPA subcommands
    p_fitness = sub.add_parser("fitness-update")
    p_fitness.add_argument("--layer", default=None, choices=["constant", "mutating", "file"])
    p_fitness.add_argument("--max-age-days", type=int, default=90)
    p_fitness.add_argument("--fast", action="store_true")

    p_migrate = sub.add_parser("migrate")
    p_migrate.add_argument("--fast", action="store_true")

    p_gstore = sub.add_parser("gepa-store")
    p_gstore.add_argument("key")
    p_gstore.add_argument("value")
    p_gstore.add_argument("--type", default="fact",
                          choices=["fact", "decision", "pattern", "error", "task", "file"])
    p_gstore.add_argument("--importance", type=float, default=0.5)
    p_gstore.add_argument("--layer", default=None, choices=["constant", "mutating", "file"])
    p_gstore.add_argument("--fast", action="store_true")

    p_gquery = sub.add_parser("gepa-query")
    p_gquery.add_argument("query", nargs="?", default="")
    p_gquery.add_argument("--layer", default=None, choices=["constant", "mutating", "file"])
    p_gquery.add_argument("--limit", type=int, default=10)
    p_gquery.add_argument("--fast", action="store_true")

    p_reflect = sub.add_parser("reflect")
    p_reflect.add_argument("--fast", action="store_true")

    p_promote = sub.add_parser("promote")
    p_promote.add_argument("node_id")
    p_promote.add_argument("--fast", action="store_true")

    p_deprecate = sub.add_parser("deprecate")
    p_deprecate.add_argument("node_id")
    p_deprecate.add_argument("--fast", action="store_true")

    p_qcheck = sub.add_parser("quarantine-check")
    p_qcheck.add_argument("--cycle", type=int, default=0)
    p_qcheck.add_argument("--fast", action="store_true")

    args = parser.parse_args()

    if args.command in FAST_COMMANDS:
        args.fast = True

    handlers = {
        "context": cmd_context, "store": cmd_store, "search": cmd_search,
        "stats": cmd_stats, "session-end": cmd_session_end,
        "pre-task": cmd_pre_task, "post-task": cmd_post_task,
        "migrate": cmd_migrate, "gepa-store": cmd_gepa_store,
        "gepa-query": cmd_gepa_query, "fitness-update": cmd_fitness_update,
        "reflect": cmd_reflect, "promote": cmd_promote,
        "deprecate": cmd_deprecate, "quarantine-check": cmd_quarantine_check,
    }

    handler = handlers.get(args.command)
    if handler:
        try:
            handler(args)
        except Exception as e:
            print(f"[memory-cli] Error: {e}", file=sys.stderr)
            sys.exit(1)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
