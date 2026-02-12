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
- GEPA v2.1: 3-layer paradigm (Constant + Mutating + File) with fitness-based promotion
  - Constant = proven patterns (protected), Mutating = evolving knowledge, File = workspace
  - Reflection engine: alignment checks, drift detection, promotion via quarantine
  - Effort Controller: dynamic reasoning_effort/temperature/model_tier per node (L1/L2/L3)
    - Top-Down: complexity score → effort propagation to all nodes
    - Bottom-Up: failure escalation (4 levels: L3 retry → L2 re-mutate → L1 re-plan → circuit break)
    - Mid-Execution signals: struggling, confident, novel_territory, pattern_match
    - Cost guardrails: $5/task max, auto circuit-break on budget exceed
  - Enable: npx claude-code-memory gepa enable

=== END INHERITED PARAMETERS ===
`;

process.stdout.write(params);
