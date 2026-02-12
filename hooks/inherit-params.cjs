#!/usr/bin/env node
/**
 * Cross-platform parameter inheritance for Claude Code sub-agents.
 * Outputs inherited params to stdout — Claude Code reads this via hook.
 */
'use strict';

const params = `=== INHERITED GLOBAL PARAMETERS (AUTO-INJECTED) ===

RULES FOR THIS AGENT:
1. Hooks: node hooks/hook-runner.cjs (portable, zero deps, NEVER npx for hooks)
2. Anti-Drift: topology=hierarchical, max-agents=8, strategy=specialized, consensus=raft
3. NEVER save files to root folder. Use /src, /tests, /docs, /config, /scripts
4. ALL operations must be concurrent/parallel in a single message
5. Check memory BEFORE starting: mcp__claude-flow__memory_search({ query: "[task]", namespace: "patterns" })
6. Store results AFTER completing: mcp__claude-flow__memory_store({ key: "[key]", value: "[result]", namespace: "patterns" })
7. VERIFICATION REQUIRED: PLAN -> IMPLEMENT -> VERIFY -> DONE. Never skip verify.
8. Model routing: simple=haiku, moderate=sonnet, complex=opus
9. Report results back clearly with evidence.

CORE MCP TOOLS (USE INSTEAD OF RAW BASH):
- mcp__github__* (replaces gh CLI) -> ToolSearch("+github <action>")
- mcp__filesystem__* (raw file ops) -> ToolSearch("+filesystem <action>")
- mcp__claude-flow__* (coordination, memory, agents) -> ToolSearch("+claude-flow <action>")
- mcp__context7__* (docs lookup) -> ToolSearch("+context7 <action>")
- mcp__sequential-thinking__* (reasoning) -> ToolSearch("+sequential-thinking")
ALWAYS call ToolSearch to load MCP tool BEFORE using it.

MEMORY SYSTEM (claude-code-memory):
- Memory dir: .claude-memory/ (separate git repo, isolated from main project)
- 4 layers: planning-with-files + MCP bridge + auto-memory + GraphMemory SQLite
- Bridge: node hooks/memory-bridge.cjs (syncs between all 4 layers)
- Encryption: AES-256-GCM via CLAUDE_MEMORY_KEY env var (optional)

=== END INHERITED PARAMETERS ===
`;

process.stdout.write(params);
