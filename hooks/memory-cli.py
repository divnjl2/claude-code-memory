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

    args = parser.parse_args()

    if args.command in FAST_COMMANDS:
        args.fast = True

    handlers = {
        "context": cmd_context, "store": cmd_store, "search": cmd_search,
        "stats": cmd_stats, "session-end": cmd_session_end,
        "pre-task": cmd_pre_task, "post-task": cmd_post_task,
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
