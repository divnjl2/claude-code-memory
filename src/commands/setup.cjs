#!/usr/bin/env node
/**
 * setup.cjs — Default command: install hooks globally.
 *
 * Steps:
 *   1. Create ~/.claude/hooks/ if needed
 *   2. Copy hook files from package hooks/ → ~/.claude/hooks/
 *   3. Generate hooks config via hooks-template
 *   4. Merge into ~/.claude/settings.json
 *   5. Write manifest for uninstall
 *   6. Detect Python → report Layer 4 status
 *   7. Output summary
 */

'use strict';

const fs = require('fs');
const path = require('path');

const {
  getGlobalHooksDir,
  getGlobalSettingsPath,
  getManifestPath,
  forwardSlash,
} = require('../lib/path-resolver.cjs');
const { mergeIntoFile, writeManifest } = require('../lib/settings-merger.cjs');
const { generateHooks } = require('../lib/hooks-template.cjs');
const { detectPython, hasSqlite3 } = require('../lib/python-detector.cjs');

/** Hook files to copy */
const HOOK_FILES = [
  'hook-runner.cjs',
  'memory-bridge.cjs',
  'memory-hook.cjs',
  'memory-cli.py',
  'inherit-params.cjs',
  'inherit-params.ps1',
];

function setup(flags) {
  const dryRun = flags['dry-run'] || false;
  const force = flags.force || false;
  const globalOnly = flags['global-only'] || false;

  console.log('claude-code-memory: Setting up 4-layer memory system...\n');

  const hooksDir = getGlobalHooksDir();
  const settingsPath = getGlobalSettingsPath();
  const manifestPath = getManifestPath();
  const packageHooksDir = path.resolve(__dirname, '..', '..', 'hooks');

  // Step 1: Create hooks dir
  console.log(`1. Hooks directory: ${forwardSlash(hooksDir)}`);
  if (!dryRun) {
    try { fs.mkdirSync(hooksDir, { recursive: true }); } catch { /* ok */ }
  }
  console.log('   OK');

  // Step 2: Copy hook files
  console.log('\n2. Copying hook files:');
  const copiedFiles = [];
  const skippedFiles = [];

  for (const file of HOOK_FILES) {
    const src = path.join(packageHooksDir, file);
    const dst = path.join(hooksDir, file);

    if (!fs.existsSync(src)) {
      console.log(`   SKIP ${file} (not found in package)`);
      skippedFiles.push(file);
      continue;
    }

    // Check if destination exists and is different
    let needsCopy = true;
    if (fs.existsSync(dst) && !force) {
      const srcContent = fs.readFileSync(src, 'utf-8');
      const dstContent = fs.readFileSync(dst, 'utf-8');
      if (srcContent === dstContent) {
        console.log(`   SKIP ${file} (identical)`);
        skippedFiles.push(file);
        needsCopy = false;
      }
    }

    if (needsCopy) {
      if (dryRun) {
        console.log(`   WOULD COPY ${file}`);
      } else {
        fs.copyFileSync(src, dst);
        console.log(`   COPY ${file}`);
      }
      copiedFiles.push(file);
    }
  }

  // Step 3: Generate hooks config
  console.log('\n3. Generating hooks configuration...');
  const hooks = generateHooks(hooksDir);

  // Step 4: Merge into settings.json
  console.log(`\n4. Merging into ${forwardSlash(settingsPath)}`);
  let mergeResult = { added: 0, updated: 0 };
  if (!dryRun) {
    mergeResult = mergeIntoFile(settingsPath, hooks);
    console.log(`   Added: ${mergeResult.added}, Updated: ${mergeResult.updated}`);
  } else {
    // Count what would change (nested format)
    let totalHooks = 0;
    for (const groups of Object.values(hooks)) {
      for (const group of groups) {
        totalHooks += (group.hooks || []).length;
      }
    }
    console.log(`   WOULD merge ${totalHooks} hooks`);
  }

  // Step 5: Write manifest
  console.log('\n5. Writing manifest...');
  const manifest = {
    version: require('../../package.json').version,
    installedAt: new Date().toISOString(),
    hooksDir: forwardSlash(hooksDir),
    settingsPath: forwardSlash(settingsPath),
    copiedFiles: HOOK_FILES.map(f => forwardSlash(path.join(hooksDir, f))),
    hookEvents: Object.keys(hooks),
  };

  if (!dryRun) {
    writeManifest(manifestPath, manifest);
    console.log(`   ${forwardSlash(manifestPath)}`);
  } else {
    console.log('   WOULD write manifest');
  }

  // Step 6: Python detection
  console.log('\n6. Python detection (Layer 4 - GraphMemory):');
  const python = detectPython();
  if (python.available) {
    const sqlite3Ok = hasSqlite3(python.command);
    console.log(`   Python ${python.version} (${python.command})`);
    console.log(`   sqlite3: ${sqlite3Ok ? 'OK' : 'NOT FOUND'}`);
    console.log(`   Layer 4: ${python.hasMinVersion && sqlite3Ok ? 'READY' : 'LIMITED'}`);
  } else {
    console.log('   Python: NOT FOUND');
    console.log('   Layer 4: DISABLED (Layers 1-3 still work)');
  }

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('Setup complete!');
  console.log('');
  console.log('Memory layers:');
  console.log('  1. planning-with-files  (task_plan.md)     OK');
  console.log('  2. claude-flow MCP      (HNSW search)      OK');
  console.log('  3. auto-memory          (MEMORY.md)         OK');
  console.log(`  4. GraphMemory SQLite   (memory.db)         ${python.available ? 'OK' : 'DISABLED'}`);
  console.log('');
  console.log('Next steps:');
  console.log('  cd <your-project>');
  console.log('  npx claude-code-memory init');
  console.log('');

  if (dryRun) {
    console.log('(DRY RUN — no changes were made)');
  }
}

module.exports = setup;
