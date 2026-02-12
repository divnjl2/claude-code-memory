#!/usr/bin/env node
/**
 * init.cjs — Initialize memory in current project.
 *
 * Steps:
 *   1. Create .claude-memory/ structure + git init
 *   2. If Python available → create memory.db with schema
 *   3. Add .claude-memory to .gitignore
 *   4. Optionally scaffold planning files (--with-planning)
 *   5. Create config.json with defaults
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { getMemoryDir, getMemoryDbPath, getBridgeDir } = require('../lib/path-resolver.cjs');
const { initMemoryRepo, getConfig } = require('../lib/memory-repo.cjs');
const { detectPython } = require('../lib/python-detector.cjs');
const { isEncryptionEnabled } = require('../lib/crypto.cjs');

function init(flags) {
  const projectRoot = process.cwd();
  const withPlanning = flags['with-planning'] || false;
  const remote = flags.remote || null;
  const encrypt = flags.encrypt || isEncryptionEnabled();

  console.log('claude-code-memory: Initializing project memory...\n');

  // Step 1: Create .claude-memory/ structure
  console.log('1. Creating .claude-memory/ structure...');
  const result = initMemoryRepo(projectRoot, { encrypt, remote });
  console.log(`   Directory: ${result.memoryDir}`);
  console.log(`   Git init: ${result.gitInit ? 'YES' : 'SKIPPED (already exists or git unavailable)'}`);

  // Step 2: Initialize SQLite DB if Python available
  console.log('\n2. Initializing memory database...');
  const python = detectPython();
  const dbPath = getMemoryDbPath(projectRoot);

  if (python.available && python.hasMinVersion) {
    if (!fs.existsSync(dbPath)) {
      const { execFileSync } = require('child_process');
      const initScript = `
import sqlite3
import os

db_path = ${JSON.stringify(dbPath.replace(/\\/g, '/'))}
os.makedirs(os.path.dirname(db_path), exist_ok=True)
conn = sqlite3.connect(db_path)
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
conn.execute("CREATE INDEX IF NOT EXISTS idx_relations_source ON relations(source_id)")
conn.execute("CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(target_id)")
conn.commit()
conn.close()
print("OK")
`;
      try {
        execFileSync(python.command, ['-c', initScript], {
          encoding: 'utf-8',
          timeout: 10000,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        console.log(`   Database: ${dbPath}`);
        console.log('   Schema: OK (nodes + relations + indexes)');
      } catch (err) {
        console.log(`   Database: FAILED (${err.message})`);
      }
    } else {
      console.log('   Database: already exists');
    }
  } else {
    console.log('   Database: SKIPPED (Python 3.8+ required)');
    console.log('   Layers 1-3 will still work without SQLite');
  }

  // Step 3: Initialize bridge cache
  console.log('\n3. Initializing bridge cache...');
  const bridgeDir = getBridgeDir(projectRoot);
  try { fs.mkdirSync(bridgeDir, { recursive: true }); } catch { /* ok */ }

  const bridgeState = path.join(bridgeDir, 'bridge-state.json');
  if (!fs.existsSync(bridgeState)) {
    fs.writeFileSync(bridgeState, JSON.stringify({
      initialized: new Date().toISOString(),
      lastSync: null,
      lastPersist: null,
      mcpEntries: 0,
      autoMemoryPending: 0,
    }, null, 2));
  }
  console.log('   Bridge state: OK');

  // Step 4: Scaffold planning files
  if (withPlanning) {
    console.log('\n4. Scaffolding planning files...');
    const planFile = path.join(projectRoot, 'task_plan.md');
    const findingsFile = path.join(projectRoot, 'findings.md');
    const progressFile = path.join(projectRoot, 'progress.md');

    if (!fs.existsSync(planFile)) {
      fs.writeFileSync(planFile, [
        '# Task Plan',
        '',
        '## Goal',
        '[Describe the goal here]',
        '',
        '## Current Phase',
        'Phase 1',
        '',
        '### Phase 1: Research',
        '**Status:** pending',
        '',
        '### Phase 2: Implementation',
        '**Status:** pending',
        '',
        '### Phase 3: Verification',
        '**Status:** pending',
        '',
      ].join('\n'));
      console.log('   task_plan.md: CREATED');
    } else {
      console.log('   task_plan.md: EXISTS');
    }

    if (!fs.existsSync(findingsFile)) {
      fs.writeFileSync(findingsFile, [
        '# Findings',
        '',
        '## Key Discoveries',
        '',
        '## Decisions',
        '',
        '## Errors & Solutions',
        '',
      ].join('\n'));
      console.log('   findings.md: CREATED');
    } else {
      console.log('   findings.md: EXISTS');
    }

    if (!fs.existsSync(progressFile)) {
      fs.writeFileSync(progressFile, [
        '# Progress',
        '',
        '## Completed',
        '',
        '## In Progress',
        '',
        '## Blocked',
        '',
      ].join('\n'));
      console.log('   progress.md: CREATED');
    } else {
      console.log('   progress.md: EXISTS');
    }
  }

  // Step 5: Remote setup
  if (remote) {
    console.log(`\n5. Remote: ${remote}`);
    const { setupRemote } = require('../lib/memory-repo.cjs');
    const ok = setupRemote(projectRoot, remote);
    console.log(`   ${ok ? 'OK' : 'FAILED'}`);
  }

  // Step 6: Config
  const config = getConfig(projectRoot);
  console.log('\nConfiguration:');
  console.log(`  Max size: ${config.maxSizeMB} MB`);
  console.log(`  TTL: ${config.ttlDays} days`);
  console.log(`  Min importance: ${config.minImportance}`);
  console.log(`  Encryption: ${encrypt ? 'ENABLED' : 'disabled'}`);
  console.log(`  Auto-commit: ${config.autoCommit ? 'YES' : 'NO'}`);

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('Project memory initialized!');
  console.log('');
  console.log('Your memory is stored in .claude-memory/ (added to .gitignore)');
  console.log('Run `npx claude-code-memory status` to check health.');
  console.log('');
}

module.exports = init;
