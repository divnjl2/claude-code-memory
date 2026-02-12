# claude-code-memory

4-layer persistent memory system for [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

Cross-session context, encrypted storage, auto-cleanup. Zero runtime dependencies.

## Quick Start

```bash
# Install hooks globally
npx claude-code-memory

# Initialize memory in your project
cd your-project
npx claude-code-memory init

# Check status
npx claude-code-memory status
```

## 4-Layer Architecture

```
Layer 1: planning-with-files     (task_plan.md, findings.md, progress.md)
         Manus-style file planning — attention manipulation via markdown

Layer 2: claude-flow MCP bridge  (JSON cache + HNSW semantic search)
         Bidirectional sync between planning files and MCP memory

Layer 3: auto-memory             (MEMORY.md — cross-session knowledge)
         Persistent knowledge base updated via pending queue

Layer 4: GraphMemory SQLite      (.claude-memory/db/memory.db)
         Per-project deep knowledge: patterns, decisions, errors
         Fast SQLite queries (<50ms) for hook integration
```

## How It Works

1. **SessionStart** — `memory-bridge.cjs load-context` merges all 4 layers into Claude's context
2. **PreToolUse** — Injects relevant memories before each tool call
3. **PostToolUse** — Syncs changes to cache, trains patterns
4. **Stop** — `memory-bridge.cjs persist` saves to all 4 destinations + auto-commits git

## Commands

| Command | Description |
|---------|-------------|
| `npx claude-code-memory` | Install hooks globally (default = setup) |
| `npx claude-code-memory init` | Initialize memory in current project |
| `npx claude-code-memory status` | Health check of all 4 layers |
| `npx claude-code-memory cleanup` | Manual cleanup by importance/age |
| `npx claude-code-memory backup` | Encrypted export of all memory |
| `npx claude-code-memory uninstall` | Clean removal by manifest |

### Setup Options

```bash
npx claude-code-memory setup --dry-run      # Preview changes
npx claude-code-memory setup --force        # Overwrite existing hooks
npx claude-code-memory setup --global-only  # Skip memory-bridge hooks
```

### Init Options

```bash
npx claude-code-memory init --with-planning  # Scaffold task_plan.md etc.
npx claude-code-memory init --encrypt        # Enable AES-256 encryption
npx claude-code-memory init --remote <url>   # Set up private git remote
```

## Memory Storage

Memory is stored in `.claude-memory/` — a separate git repo, isolated from your main project:

```
.claude-memory/
├── .git/                    # Own git history (private)
├── db/
│   └── memory.db            # SQLite (encrypted if CLAUDE_MEMORY_KEY set)
├── bridge/
│   ├── planning-cache.json  # Planning state cache
│   ├── memory-sync.json     # Sync manifest
│   └── bridge-state.json    # Bridge health
├── history/
│   └── sessions.jsonl       # Session log (append-only)
├── metrics/
│   └── hooks.json           # Hook execution counts
└── config.json              # Settings (limits, TTL, encryption)
```

`.claude-memory/` is automatically added to your project's `.gitignore`.

## Security

### Encryption (AES-256-GCM)

Set the `CLAUDE_MEMORY_KEY` environment variable to enable encryption:

```bash
export CLAUDE_MEMORY_KEY="your-secret-key"
npx claude-code-memory init --encrypt
```

What gets encrypted:
- `memory.db` (SQLite database)
- Bridge cache JSON files

What stays plaintext (needed by Claude):
- `task_plan.md`, `findings.md`, `progress.md`
- `MEMORY.md`

### PII Protection

The memory bridge automatically redacts patterns matching:
- API keys (`sk-*`, `ghp_*`)
- Passwords (`password=`)
- Tokens (`api_key=`, `secret=`)

### Auto-Cleanup

Configured via `.claude-memory/config.json`:

```json
{
  "maxSizeMB": 10,
  "ttlDays": 30,
  "minImportance": 0.3,
  "autoCleanupThreshold": 0.8
}
```

Cleanup runs automatically at session-end when DB exceeds 80% of limit.
Manual: `npx claude-code-memory cleanup --dry-run`

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CLAUDE_MEMORY_KEY` | AES-256 encryption key | (none — plaintext) |
| `PYTHON_CMD` | Python binary for Layer 4 | `python` |

### Requirements

- **Node.js 18+** (required)
- **Python 3.8+** (optional — for Layer 4 GraphMemory)
- **Git** (optional — for memory versioning)

Layers 1-3 work without Python or Git.

## Hook Files

| File | Lines | Purpose |
|------|-------|---------|
| `hook-runner.cjs` | ~450 | Main dispatcher — security checks, routing, metrics |
| `memory-bridge.cjs` | ~400 | 4-way sync between all memory layers |
| `memory-hook.cjs` | ~120 | Node.js wrapper for memory-cli.py |
| `memory-cli.py` | ~280 | Python SQLite CLI (fast mode <50ms) |
| `inherit-params.cjs` | ~40 | Parameter inheritance for sub-agents |

All hooks are zero-dependency and exit 0 — they never block Claude Code.

## Development

```bash
git clone https://github.com/divnjl2/claude-code-memory
cd claude-code-memory
node --test tests/
```

## License

MIT
