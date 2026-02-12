#!/usr/bin/env node
/**
 * status.cjs — Show health of all 4 memory layers.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const {
  getGlobalHooksDir,
  getGlobalSettingsPath,
  getMemoryDir,
  getMemoryDbPath,
  getBridgeDir,
  getManifestPath,
  forwardSlash,
} = require('../lib/path-resolver.cjs');
const { readManifest } = require('../lib/settings-merger.cjs');
const { detectPython } = require('../lib/python-detector.cjs');
const { isEncryptionEnabled } = require('../lib/crypto.cjs');
const { getConfig, getMemorySize } = require('../lib/memory-repo.cjs');
const { shouldCleanup } = require('../lib/auto-cleanup.cjs');

function readJSON(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { return null; }
}

function fileExists(p) {
  return fs.existsSync(p);
}

function status(flags) {
  const projectRoot = process.cwd();
  const json = flags.json || false;

  const result = {
    global: {},
    project: {},
    layers: {},
    encryption: {},
    cleanup: {},
  };

  // ── Global status ──
  const hooksDir = getGlobalHooksDir();
  const settingsPath = getGlobalSettingsPath();
  const manifest = readManifest(getManifestPath());

  const hookFiles = ['hook-runner.cjs', 'memory-bridge.cjs', 'memory-hook.cjs', 'memory-cli.py', 'inherit-params.cjs'];
  const installedHooks = hookFiles.filter(f => fileExists(path.join(hooksDir, f)));

  result.global = {
    hooksDir: forwardSlash(hooksDir),
    hooksInstalled: `${installedHooks.length}/${hookFiles.length}`,
    settingsExists: fileExists(settingsPath),
    manifest: manifest ? `v${manifest.version} (${manifest.installedAt})` : 'NOT FOUND',
  };

  // ── Project status ──
  const memoryDir = getMemoryDir(projectRoot);
  const dbPath = getMemoryDbPath(projectRoot);
  const bridgeDir = getBridgeDir(projectRoot);
  const config = getConfig(projectRoot);

  result.project = {
    root: forwardSlash(projectRoot),
    memoryDir: fileExists(memoryDir) ? 'EXISTS' : 'NOT INITIALIZED',
    gitRepo: fileExists(path.join(memoryDir, '.git')) ? 'YES' : 'NO',
    config: fileExists(path.join(memoryDir, 'config.json')) ? config : null,
  };

  // ── Layer 1: planning-with-files ──
  const planFile = path.join(projectRoot, 'task_plan.md');
  const findingsFile = path.join(projectRoot, 'findings.md');
  const progressFile = path.join(projectRoot, 'progress.md');

  result.layers['1_planning'] = {
    name: 'planning-with-files',
    status: fileExists(planFile) ? 'ACTIVE' : 'INACTIVE',
    files: {
      task_plan: fileExists(planFile) ? 'EXISTS' : 'MISSING',
      findings: fileExists(findingsFile) ? 'EXISTS' : 'MISSING',
      progress: fileExists(progressFile) ? 'EXISTS' : 'MISSING',
    },
  };

  // ── Layer 2: claude-flow MCP (bridge cache) ──
  const bridgeState = readJSON(path.join(bridgeDir, 'bridge-state.json'));
  const planningCache = readJSON(path.join(bridgeDir, 'planning-cache.json'));

  result.layers['2_mcp_bridge'] = {
    name: 'claude-flow MCP bridge',
    status: bridgeState ? 'ACTIVE' : 'INACTIVE',
    lastSync: bridgeState ? bridgeState.lastSync : null,
    lastPersist: bridgeState ? bridgeState.lastPersist : null,
    cachedGoal: planningCache ? planningCache.plan?.goal : null,
    cachedPhases: planningCache ? planningCache.plan?.phases?.length : 0,
  };

  // ── Layer 3: auto-memory ──
  const autoMemoryPending = readJSON(path.join(bridgeDir, 'auto-memory-pending.json'));

  result.layers['3_auto_memory'] = {
    name: 'auto-memory (MEMORY.md)',
    status: 'ACTIVE', // Always available
    pendingUpdates: autoMemoryPending ? autoMemoryPending.updates?.length : 0,
  };

  // ── Layer 4: GraphMemory SQLite ──
  const python = detectPython();
  let dbStats = null;

  if (python.available && fileExists(dbPath)) {
    try {
      const { execFileSync } = require('child_process');
      const statsScript = `
import sqlite3, json
conn = sqlite3.connect(${JSON.stringify(dbPath.replace(/\\/g, '/'))})
total = conn.execute("SELECT COUNT(*) FROM nodes").fetchone()[0]
types = {}
for r in conn.execute("SELECT node_type, COUNT(*) FROM nodes GROUP BY node_type").fetchall():
    types[r[0]] = r[1]
rels = conn.execute("SELECT COUNT(*) FROM relations").fetchone()[0]
conn.close()
print(json.dumps({"total_nodes": total, "total_relations": rels, "by_type": types}))
`;
      const out = execFileSync(python.command, ['-c', statsScript], {
        encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
      dbStats = JSON.parse(out);
    } catch { /* ok */ }
  }

  result.layers['4_graphmemory'] = {
    name: 'GraphMemory SQLite',
    status: dbStats ? 'ACTIVE' : (python.available ? 'EMPTY' : 'DISABLED'),
    python: python.available ? `${python.version} (${python.command})` : 'NOT FOUND',
    dbPath: fileExists(dbPath) ? forwardSlash(dbPath) : 'NOT CREATED',
    nodes: dbStats ? dbStats.total_nodes : 0,
    relations: dbStats ? dbStats.total_relations : 0,
    byType: dbStats ? dbStats.by_type : {},
  };

  // ── Encryption ──
  result.encryption = {
    enabled: isEncryptionEnabled(),
    keySet: !!process.env.CLAUDE_MEMORY_KEY,
  };

  // ── Cleanup status ──
  const cleanupStatus = shouldCleanup(projectRoot);
  result.cleanup = cleanupStatus;

  // ── Output ──
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Human-readable output
  console.log('claude-code-memory status\n');

  console.log('Global:');
  console.log(`  Hooks: ${result.global.hooksInstalled} files in ${result.global.hooksDir}`);
  console.log(`  Settings: ${result.global.settingsExists ? 'OK' : 'MISSING'}`);
  console.log(`  Manifest: ${result.global.manifest}`);

  console.log('\nProject:');
  console.log(`  Root: ${result.project.root}`);
  console.log(`  Memory dir: ${result.project.memoryDir}`);
  console.log(`  Git repo: ${result.project.gitRepo}`);

  console.log('\nLayers:');
  for (const [key, layer] of Object.entries(result.layers)) {
    const num = key.split('_')[0];
    const icon = layer.status === 'ACTIVE' ? '+' : layer.status === 'DISABLED' ? 'x' : '-';
    console.log(`  [${icon}] Layer ${num}: ${layer.name} — ${layer.status}`);

    if (key === '1_planning') {
      console.log(`      Files: plan=${layer.files.task_plan} findings=${layer.files.findings} progress=${layer.files.progress}`);
    } else if (key === '2_mcp_bridge') {
      if (layer.lastSync) console.log(`      Last sync: ${layer.lastSync}`);
      if (layer.cachedGoal) console.log(`      Goal: ${layer.cachedGoal}`);
    } else if (key === '3_auto_memory') {
      console.log(`      Pending updates: ${layer.pendingUpdates}`);
    } else if (key === '4_graphmemory') {
      console.log(`      Python: ${layer.python}`);
      if (layer.nodes > 0) {
        console.log(`      Nodes: ${layer.nodes}, Relations: ${layer.relations}`);
        const types = Object.entries(layer.byType).map(([k, v]) => `${k}:${v}`).join(', ');
        if (types) console.log(`      Types: ${types}`);
      }
    }
  }

  console.log('\nEncryption:');
  console.log(`  Status: ${result.encryption.enabled ? 'ENABLED' : 'disabled'}`);
  console.log(`  CLAUDE_MEMORY_KEY: ${result.encryption.keySet ? 'SET' : 'not set'}`);

  console.log('\nStorage:');
  console.log(`  Size: ${result.cleanup.currentMB} MB / ${result.cleanup.maxMB} MB (${result.cleanup.pct}%)`);
  console.log(`  Cleanup needed: ${result.cleanup.needed ? 'YES' : 'NO'}`);
  console.log('');
}

module.exports = status;
