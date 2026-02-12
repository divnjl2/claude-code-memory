#!/usr/bin/env node
/**
 * gepa.cjs — CLI for GEPA v2.1 Memory Paradigm.
 *
 * Usage:
 *   npx claude-code-memory gepa enable       Enable GEPA
 *   npx claude-code-memory gepa disable      Disable GEPA
 *   npx claude-code-memory gepa status       Show GEPA status
 *   npx claude-code-memory gepa reflect      Run reflection engine
 *   npx claude-code-memory gepa promote <id> Promote node to constant
 *   npx claude-code-memory gepa deprecate <id> Soft-delete a node
 *   npx claude-code-memory gepa archive      Run Pareto cleanup + archive
 *   npx claude-code-memory gepa resurrect <id> Restore deprecated node
 *   npx claude-code-memory gepa export       Export constant snapshot
 *   npx claude-code-memory gepa import <path> Import constant snapshot
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { isEnabled, setEnabled, getPopulation, getState, getGepaConfig, migrateSchema } = require('../lib/gepa-core.cjs');
const { reflect, promote, deprecate, resurrect } = require('../lib/gepa-reflection.cjs');
const { updateFitness } = require('../lib/gepa-fitness.cjs');
const { gepaCleanup } = require('../lib/auto-cleanup.cjs');
const { exportConstant, importConstant, workspaceStatus } = require('../lib/gepa-workspace.cjs');
const { assessAndPropagateDown, handleFailure, midExecutionTune, getEffortReport, resetEffort, getNodeStates, COMPLEXITY_PROFILES, MAX_COST_PER_TASK } = require('../lib/gepa-effort.cjs');

function gepa(flags) {
  const projectRoot = process.cwd();
  const subcommand = flags._sub || '';

  switch (subcommand) {
    case 'enable': return cmdEnable(projectRoot);
    case 'disable': return cmdDisable(projectRoot);
    case 'status': return cmdStatus(projectRoot, flags);
    case 'reflect': return cmdReflect(projectRoot, flags);
    case 'promote': return cmdPromote(projectRoot, flags);
    case 'deprecate': return cmdDeprecate(projectRoot, flags);
    case 'archive': return cmdArchive(projectRoot, flags);
    case 'resurrect': return cmdResurrect(projectRoot, flags);
    case 'export': return cmdExport(projectRoot);
    case 'import': return cmdImport(projectRoot, flags);
    case 'effort': return cmdEffort(projectRoot, flags);
    default:
      console.log(`
GEPA v2.1 — Guided Evolutionary Paradigm for Agents

Usage:
  npx claude-code-memory gepa <command> [options]

Commands:
  enable        Enable GEPA (runs schema migration)
  disable       Disable GEPA (data preserved)
  status        Show GEPA status and layer counts
  reflect       Run reflection engine (5 checks)
  promote <id>  Promote a node to constant layer
  deprecate <id> Soft-delete a node
  archive       Run Pareto cleanup + archive low-fitness entries
  resurrect <id> Restore a deprecated node
  export        Export constant layer snapshot
  import <path> Import constant layer from snapshot file
  effort        Effort controller: status, assess, report, reset
`);
  }
}

function cmdEnable(projectRoot) {
  console.log('GEPA: Enabling...\n');

  setEnabled(projectRoot, true);
  const migration = migrateSchema(projectRoot);

  if (migration.success) {
    console.log(`  Schema: migrated (v${migration.version})`);
    if (migration.migrations.length > 0) {
      console.log(`  Changes: ${migration.migrations.join(', ')}`);
    }
  } else {
    console.log(`  Schema: ${migration.error || 'skipped'}`);
  }

  console.log('  Config: gepa.enabled = true');
  console.log('\nGEPA enabled! Run `npx claude-code-memory gepa status` to check.');
}

function cmdDisable(projectRoot) {
  setEnabled(projectRoot, false);
  console.log('GEPA disabled. Data is preserved, just not active.');
  console.log('Re-enable anytime with `npx claude-code-memory gepa enable`.');
}

function cmdStatus(projectRoot, flags) {
  const enabled = isEnabled(projectRoot);
  const state = getState(projectRoot);
  const population = getPopulation(projectRoot);
  const config = getGepaConfig(projectRoot);
  const workspace = workspaceStatus(projectRoot);

  if (flags.json) {
    console.log(JSON.stringify({ enabled, state, population, config, workspace }, null, 2));
    return;
  }

  console.log('GEPA v2.1 Status\n');
  console.log(`  Enabled: ${enabled ? 'YES' : 'NO'}`);
  console.log(`  Cycle: ${state.cycle}`);
  console.log(`  Last reflection: ${state.lastReflection || 'never'}`);

  if (population) {
    console.log(`\n  Layers:`);
    console.log(`    Constant: ${population.constant} nodes`);
    console.log(`    Mutating: ${population.mutating} nodes`);
    console.log(`    File:     ${population.file} nodes`);
    console.log(`    Total:    ${population.total} nodes`);
    if (!population.migrated) {
      console.log('    (GEPA columns not yet migrated — run `gepa enable`)');
    }
  }

  console.log(`\n  Budget:`);
  const bud = config.contextBudget;
  console.log(`    Constant: ${bud.constant} chars`);
  console.log(`    Mutating: ${bud.mutating} chars`);
  console.log(`    File:     ${bud.file} chars`);
  console.log(`    Total:    ${bud.total} chars`);

  console.log(`\n  Workspace:`);
  if (workspace.exists) {
    console.log(`    State: ${workspace.hasState ? 'OK' : 'MISSING'}`);
    console.log(`    Constant snapshots: ${workspace.constantSnapshots}`);
    console.log(`    Session traces: ${workspace.traces}`);
    console.log(`    Archives: ${workspace.archives}`);
  } else {
    console.log('    Not initialized');
  }

  console.log('');
}

function cmdReflect(projectRoot, flags) {
  if (!isEnabled(projectRoot)) {
    console.log('GEPA is not enabled. Run `npx claude-code-memory gepa enable` first.');
    return;
  }

  console.log('Running GEPA reflection...\n');

  // Update fitness first
  const fitness = updateFitness(projectRoot);
  if (fitness.updated > 0) {
    console.log(`  Fitness updated: ${fitness.updated} nodes (avg=${fitness.stats.avg}, min=${fitness.stats.min}, max=${fitness.stats.max})`);
  }

  // Run reflection
  const result = reflect(projectRoot);

  if (!result.success) {
    console.log(`  Error: ${result.error}`);
    return;
  }

  console.log(`  Cycle: ${result.cycle}`);

  // Print check results
  for (const [name, check] of Object.entries(result.checks)) {
    const icon = check.status === 'ok' ? '+' : check.status === 'action' ? '!' : '~';
    console.log(`  [${icon}] ${name}: ${check.status}`);

    if (name === 'alignment' && check.violations?.length > 0) {
      for (const v of check.violations.slice(0, 3)) {
        console.log(`      Violation: mutating=${v.mutating_id} ↔ constant=${v.constant_id} (overlap=${v.overlap})`);
      }
    }
    if (name === 'promotion' && check.candidates?.length > 0) {
      for (const c of check.candidates) {
        console.log(`      Candidate: ${c.id} (fitness=${c.fitness}, gen=${c.generation}) → quarantine`);
      }
    }
    if (name === 'quarantine' && check.resolved?.length > 0) {
      for (const r of check.resolved) {
        console.log(`      Promoted: ${r.id} (fitness=${r.fitness}) → constant`);
      }
    }
    if (name === 'diversity') {
      console.log(`      Types: ${check.distinct_types}/${check.quota}`);
    }
  }

  if (result.actions.length > 0) {
    console.log(`\n  Actions taken: ${result.actions.length}`);
  }

  const pop = result.population;
  if (pop) {
    console.log(`\n  Population: constant=${pop.constant} mutating=${pop.mutating} file=${pop.file} total=${pop.total}`);
  }
}

function cmdPromote(projectRoot, flags) {
  const nodeId = flags._arg;
  if (!nodeId) {
    console.log('Usage: npx claude-code-memory gepa promote <node-id>');
    return;
  }

  const result = promote(projectRoot, nodeId);
  if (result.success) {
    console.log(`Promoted ${nodeId}: ${result.from} → ${result.to}`);
  } else {
    console.log(`Error: ${result.error}`);
  }
}

function cmdDeprecate(projectRoot, flags) {
  const nodeId = flags._arg;
  if (!nodeId) {
    console.log('Usage: npx claude-code-memory gepa deprecate <node-id>');
    return;
  }

  const result = deprecate(projectRoot, nodeId);
  if (result.success) {
    console.log(`Deprecated ${nodeId} (layer: ${result.layer})`);
  } else {
    console.log(`Error: ${result.error}`);
  }
}

function cmdArchive(projectRoot, flags) {
  if (!isEnabled(projectRoot)) {
    console.log('GEPA is not enabled.');
    return;
  }

  const dryRun = flags['dry-run'] || false;
  const count = parseInt(flags.count) || 20;

  console.log(`Archiving ${dryRun ? '(dry run) ' : ''}up to ${count} low-fitness entries...\n`);

  const result = gepaCleanup(projectRoot, { dryRun, count });

  if (result.error) {
    console.log(`Error: ${result.error}`);
    return;
  }

  console.log(`  Archived: ${result.archived} entries`);
  if (result.preserved) console.log(`  Preserved for diversity: ${result.preserved}`);
  if (result.archivePath) console.log(`  Archive file: ${result.archivePath}`);
}

function cmdResurrect(projectRoot, flags) {
  const nodeId = flags._arg;
  if (!nodeId) {
    console.log('Usage: npx claude-code-memory gepa resurrect <node-id>');
    return;
  }

  const result = resurrect(projectRoot, nodeId);
  if (result.success) {
    console.log(`Resurrected ${nodeId}`);
  } else {
    console.log(`Error: ${result.error}`);
  }
}

function cmdExport(projectRoot) {
  if (!isEnabled(projectRoot)) {
    console.log('GEPA is not enabled.');
    return;
  }

  const result = exportConstant(projectRoot);
  if (result.error) {
    console.log(`Error: ${result.error}`);
    return;
  }

  console.log(`Exported ${result.count} constant entries`);
  console.log(`Snapshot: ${result.path}`);
}

function cmdImport(projectRoot, flags) {
  const snapshotPath = flags._arg;
  if (!snapshotPath) {
    console.log('Usage: npx claude-code-memory gepa import <path-to-snapshot.json>');
    return;
  }

  const result = importConstant(projectRoot, snapshotPath);
  if (result.error) {
    console.log(`Error: ${result.error}`);
    return;
  }

  console.log(`Imported ${result.imported} entries into constant layer`);
}

function cmdEffort(projectRoot, flags) {
  const action = flags._arg || 'status';

  switch (action) {
    case 'status': {
      const states = getNodeStates(projectRoot);
      if (!states) {
        console.log('Effort Controller: no active task.\n  Run assessment first or start a new task.');
        return;
      }
      console.log('Effort Controller — Current Node States\n');
      for (const [name, state] of Object.entries(states)) {
        const level = name.split('_')[0];
        console.log(`  ${name} (${level})`);
        console.log(`    effort=${state.reasoning_effort} temp=${state.temperature} model=${state.model_tier}`);
        console.log(`    variants=${state.n_variants} mutations=${state.max_mutation_cycles} retries=${state.max_retries} budget=${state.token_budget}`);
      }
      console.log('');
      break;
    }

    case 'assess': {
      const score = parseFloat(flags.score || flags.complexity || '0.5');
      const taskId = flags['task-id'] || undefined;
      console.log(`Assessing complexity: ${score}\n`);
      const result = assessAndPropagateDown(projectRoot, score, { taskId });
      console.log(`  Profile: ${result.profile} (score=${result.complexityScore})`);
      console.log(`  Nodes configured: ${Object.keys(result.nodeStates).length}`);
      for (const [name, state] of Object.entries(result.nodeStates)) {
        console.log(`    ${name}: effort=${state.reasoning_effort} model=${state.model_tier}`);
      }
      console.log('');
      break;
    }

    case 'report': {
      const report = getEffortReport(projectRoot);
      if (flags.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }
      console.log('Effort Report\n');
      console.log(`  Task: ${report.taskId || 'none'}`);
      console.log(`  Complexity: ${report.complexityScore ?? 'not assessed'}`);
      console.log(`  Escalations: ${report.totalEscalations}`);
      console.log(`  Failures: ${report.totalFailures}`);
      console.log(`  Effort changes: ${report.effortChanges}`);
      console.log(`  Cost estimate: $${report.costEstimate} (max $${report.maxCost})`);
      if (report.failureTraces.length > 0) {
        console.log('\n  Failure traces:');
        for (const t of report.failureTraces) {
          console.log(`    [${t.timestamp}] ${t.node}: ${t.reason}`);
        }
      }
      if (Object.keys(report.finalStates).length > 0) {
        console.log('\n  Final states:');
        for (const [name, s] of Object.entries(report.finalStates)) {
          console.log(`    ${name}: effort=${s.effort} model=${s.model}`);
        }
      }
      console.log('');
      break;
    }

    case 'reset': {
      resetEffort(projectRoot);
      console.log('Effort Controller state cleared.');
      break;
    }

    default:
      console.log(`
Effort Controller — GEPA v2.1

Usage:
  npx claude-code-memory gepa effort status           Show current node states
  npx claude-code-memory gepa effort assess --score X  Assess complexity (0-1)
  npx claude-code-memory gepa effort report            Full effort report
  npx claude-code-memory gepa effort reset             Clear effort state
`);
  }
}

module.exports = gepa;
