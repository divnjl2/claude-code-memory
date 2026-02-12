#!/usr/bin/env node
/**
 * uninstall.cjs — Clean removal of hooks and files by manifest.
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
const { readManifest, removeOurHooks } = require('../lib/settings-merger.cjs');

function uninstall(flags) {
  const dryRun = flags['dry-run'] || false;
  const keepMemory = flags['keep-memory'] || false;

  console.log('claude-code-memory: Uninstalling...\n');

  const manifestPath = getManifestPath();
  const manifest = readManifest(manifestPath);

  if (!manifest) {
    console.log('No installation manifest found.');
    console.log('Attempting to remove hooks from settings anyway...');
  }

  // Step 1: Remove hooks from settings.json
  console.log('1. Removing hooks from settings.json...');
  const settingsPath = getGlobalSettingsPath();

  if (fs.existsSync(settingsPath)) {
    if (dryRun) {
      console.log('   WOULD remove our hooks from settings');
    } else {
      const result = removeOurHooks(settingsPath);
      console.log(`   Removed ${result.removed} hooks`);
    }
  } else {
    console.log('   Settings file not found (nothing to do)');
  }

  // Step 2: Remove hook files
  console.log('\n2. Removing hook files...');
  const hooksDir = getGlobalHooksDir();
  const hookFiles = [
    'hook-runner.cjs',
    'memory-bridge.cjs',
    'memory-hook.cjs',
    'memory-cli.py',
    'inherit-params.cjs',
    'inherit-params.ps1',
  ];

  let removedFiles = 0;
  for (const file of hookFiles) {
    const filePath = path.join(hooksDir, file);
    if (fs.existsSync(filePath)) {
      if (dryRun) {
        console.log(`   WOULD remove ${file}`);
      } else {
        fs.unlinkSync(filePath);
        console.log(`   REMOVED ${file}`);
      }
      removedFiles++;
    }
  }

  if (removedFiles === 0) {
    console.log('   No hook files found');
  }

  // Step 3: Remove project memory (optional)
  if (!keepMemory) {
    const projectRoot = process.cwd();
    const memoryDir = path.join(projectRoot, '.claude-memory');
    if (fs.existsSync(memoryDir)) {
      console.log('\n3. Removing .claude-memory/...');
      if (dryRun) {
        console.log('   WOULD remove .claude-memory/');
      } else {
        fs.rmSync(memoryDir, { recursive: true, force: true });
        console.log('   REMOVED');
      }
    }
  } else {
    console.log('\n3. Keeping .claude-memory/ (--keep-memory)');
  }

  // Step 4: Remove manifest
  console.log('\n4. Removing manifest...');
  if (fs.existsSync(manifestPath)) {
    if (dryRun) {
      console.log('   WOULD remove manifest');
    } else {
      fs.unlinkSync(manifestPath);
      console.log('   REMOVED');
    }
  } else {
    console.log('   Not found');
  }

  console.log('\n' + '='.repeat(50));
  console.log('Uninstall complete.');
  if (dryRun) {
    console.log('\n(DRY RUN — no changes were made)');
  }
  console.log('');
}

module.exports = uninstall;
