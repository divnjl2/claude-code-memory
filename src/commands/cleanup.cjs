#!/usr/bin/env node
/**
 * cleanup.cjs — Manual cleanup by importance/age.
 */

'use strict';

const { shouldCleanup, cleanup } = require('../lib/auto-cleanup.cjs');
const { getConfig } = require('../lib/memory-repo.cjs');

function cleanupCommand(flags) {
  const projectRoot = process.cwd();
  const dryRun = flags['dry-run'] || false;
  const force = flags.force || false;

  console.log('claude-code-memory: Memory cleanup\n');

  // Check if cleanup is needed
  const check = shouldCleanup(projectRoot);
  const config = getConfig(projectRoot);

  console.log(`Current size: ${check.currentMB} MB / ${check.maxMB} MB (${check.pct}%)`);
  console.log(`Config: TTL=${config.ttlDays}d, minImportance=${config.minImportance}\n`);

  if (!check.needed && !force) {
    console.log('No cleanup needed (under threshold).');
    console.log('Use --force to clean up anyway.');
    return;
  }

  console.log(dryRun ? 'DRY RUN — showing what would be deleted:\n' : 'Running cleanup...\n');

  const result = cleanup(projectRoot, { dryRun, force });

  if (result.error) {
    console.error(`Error: ${result.error}`);
    return;
  }

  if (result.deleted === 0) {
    console.log('Nothing to clean up.');
    return;
  }

  // Show entries
  const byReason = {};
  for (const entry of result.entries) {
    if (!byReason[entry.reason]) byReason[entry.reason] = [];
    byReason[entry.reason].push(entry);
  }

  for (const [reason, entries] of Object.entries(byReason)) {
    console.log(`${reason} (${entries.length} entries):`);
    for (const e of entries.slice(0, 10)) {
      console.log(`  [${e.type}] imp=${e.importance} ${e.content}`);
    }
    if (entries.length > 10) {
      console.log(`  ... and ${entries.length - 10} more`);
    }
    console.log('');
  }

  console.log('Summary:');
  console.log(`  Deleted: ${result.deleted} entries`);
  console.log(`  Vacuumed: ${result.vacuumed ? 'YES' : 'NO'}`);
  console.log(`  Before: ${result.beforeMB} MB`);
  console.log(`  After: ${result.afterMB} MB`);
  console.log(`  Saved: ${Math.round((result.beforeMB - result.afterMB) * 100) / 100} MB`);

  if (dryRun) {
    console.log('\n(DRY RUN — no changes were made)');
  }
}

module.exports = cleanupCommand;
