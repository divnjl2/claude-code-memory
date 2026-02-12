#!/usr/bin/env node
/**
 * bench.cjs — CLI for claude-code-memory benchmarks.
 *
 * Usage:
 *   npx claude-code-memory bench recall     # Memory recall accuracy
 *   npx claude-code-memory bench persist    # Cross-session persistence
 *   npx claude-code-memory bench fitness    # GEPA fitness pipeline
 *   npx claude-code-memory bench effort     # Cost/quality tradeoff
 *   npx claude-code-memory bench context    # Context utilization
 *   npx claude-code-memory bench drift      # Drift detection
 *   npx claude-code-memory bench all        # All + summary
 */

'use strict';

const { runBench, BENCHMARKS } = require('../lib/bench.cjs');

function bench(flags) {
  const sub = flags._sub || '';
  const json = flags.json || false;

  if (!sub || sub === 'help') {
    console.log(`
claude-code-memory bench — Memory system benchmarks

Usage:
  npx claude-code-memory bench <name> [--json]

Benchmarks:
${Object.entries(BENCHMARKS).map(([k, v]) => `  ${k.padEnd(10)} ${v.desc}`).join('\n')}
  all        Run all benchmarks

Options:
  --json     Output raw JSON (for CI/automation)

Inspired by: LongMemEval, MemoryBench, RouteLLM, Evo-Memory
`);
    return;
  }

  const validNames = [...Object.keys(BENCHMARKS), 'all'];
  if (!validNames.includes(sub)) {
    console.error(`Unknown benchmark: ${sub}`);
    console.error(`Available: ${validNames.join(', ')}`);
    process.exit(1);
  }

  console.log(`Running benchmark: ${sub}...\n`);
  const result = runBench(sub);

  if (json) {
    console.log(JSON.stringify(sub === 'all' ? result : result, null, 2));
    return;
  }

  // Human-readable output
  if (sub === 'all') {
    printAllResults(result);
  } else {
    printResult(result);
  }
}

function printResult(r) {
  if (r.error) {
    console.log(`  ERROR: ${r.error}`);
    return;
  }

  console.log(`Benchmark: ${r.bench}`);
  console.log(`  ${r.description}`);
  console.log(`  Duration: ${r.duration_ms}ms\n`);

  const m = r.metrics;

  switch (r.bench) {
    case 'recall':
      console.log(`  Overall recall: ${pct(m.overall_recall)}  MRR: ${m.overall_mrr}`);
      for (const [layer, lr] of Object.entries(m.by_layer)) {
        console.log(`    ${layer.padEnd(10)} recall=${pct(lr.recall)}  mrr=${lr.mrr}  (${lr.found}/${lr.total})`);
      }
      break;

    case 'persist':
      console.log(`  Golden retained: ${m.golden_retained}/${m.golden_total} (${pct(m.retention_rate)})`);
      console.log(`  Constant retention: ${pct(m.constant_retention)}`);
      console.log(`  Mutating retention: ${pct(m.mutating_retention)}`);
      console.log(`  Sessions simulated: ${m.sessions_simulated}`);
      console.log(`  Retention curve:`);
      for (const p of m.retention_curve) {
        const bar = '#'.repeat(Math.round(p.retention_rate * 20));
        console.log(`    S${String(p.session).padStart(2)}: ${bar.padEnd(20)} ${pct(p.retention_rate)} (${p.golden_retained}/${p.golden_total})`);
      }
      break;

    case 'fitness':
      console.log(`  Promotion candidates: ${m.promotion_candidates} (of ${m.total_entries})`);
      console.log(`  Precision: ${pct(m.precision)}  Recall: ${pct(m.recall)}  F1: ${pct(m.f1)}`);
      console.log(`  TP=${m.true_positives} FP=${m.false_positives} FN=${m.false_negatives}`);
      console.log(`  Avg fitness: golden=${m.avg_golden_fitness} noise=${m.avg_noise_fitness} separation=${m.separation}`);
      break;

    case 'effort':
      console.log(`  Tasks: ${m.tasks}`);
      console.log(`  GEPA total cost: $${m.gepa_total_cost}`);
      console.log(`  Baseline (all opus/0.95): $${m.baseline_total_cost}`);
      console.log(`  Cost ratio: ${m.cost_ratio} (savings: ${pct(m.total_savings)})`);
      console.log(`  By profile:`);
      for (const [p, d] of Object.entries(m.by_profile)) {
        console.log(`    ${p.padEnd(10)} n=${d.count} gepa=$${d.gepaCost} baseline=$${d.baselineCost} savings=${pct(d.savings)}`);
      }
      console.log(`  Escalation cost curve:`);
      for (const e of m.escalation_cost_curve) {
        console.log(`    Level ${e.level}: ${e.phase.padEnd(14)} $${e.cost} [${e.action}]`);
      }
      break;

    case 'context':
      console.log(`  Entries: ${m.total_entries}, Needed: ${m.needed_facts}, Budget: ${m.budget_chars} chars`);
      console.log(`  Budget-aware: ${m.budget_aware.hits}/${m.needed_facts} hits (${pct(m.budget_aware.hit_rate)}) — ${m.budget_aware.selected} items, ${m.budget_aware.chars_used} chars`);
      console.log(`  Random:       ${m.random_baseline.hits}/${m.needed_facts} hits (${pct(m.random_baseline.hit_rate)}) — ${m.random_baseline.selected} items, ${m.random_baseline.chars_used} chars`);
      console.log(`  Advantage: ${m.budget_aware_advantage}x over random`);
      break;

    case 'drift':
      console.log(`  Constant patterns: ${m.constant_patterns}, Mutating: ${m.mutating_entries}`);
      console.log(`  Actual violations: ${m.actual_violations}`);
      console.log(`  Detected: ${m.detected_violations} (detection rate: ${pct(m.drift_detection_rate)})`);
      console.log(`  Precision: ${pct(m.precision)}  F1: ${pct(m.f1)}`);
      console.log(`  TP=${m.true_positives} FP=${m.false_positives} FN=${m.false_negatives}`);
      if (m.violation_details && m.violation_details.length > 0) {
        console.log(`  Top violations:`);
        for (const v of m.violation_details.slice(0, 3)) {
          console.log(`    ${v.constant} <-> ${v.mutating} (score=${v.score}, overlap=${v.overlap.join(',')})`);
        }
      }
      break;
  }

  console.log('');
}

function printAllResults(results) {
  console.log('claude-code-memory benchmark suite\n');
  console.log('='.repeat(60));

  for (const r of results) {
    console.log('');
    printResult(r);
    console.log('-'.repeat(60));
  }

  // Summary
  console.log('\nSummary:');
  const passed = results.filter(r => !r.error).length;
  const failed = results.filter(r => r.error).length;
  console.log(`  Benchmarks: ${passed} passed, ${failed} failed, ${results.length} total`);
  console.log(`  Total duration: ${results.reduce((s, r) => s + (r.duration_ms || 0), 0)}ms`);

  // Key metrics
  for (const r of results) {
    if (r.error) {
      console.log(`  [x] ${r.bench}: ${r.error}`);
      continue;
    }
    const m = r.metrics;
    switch (r.bench) {
      case 'recall': console.log(`  [+] recall: ${pct(m.overall_recall)} overall`); break;
      case 'persist': console.log(`  [+] persist: ${pct(m.retention_rate)} retention after ${m.sessions_simulated} sessions`); break;
      case 'fitness': console.log(`  [+] fitness: F1=${pct(m.f1)} (precision=${pct(m.precision)} recall=${pct(m.recall)})`); break;
      case 'effort': console.log(`  [+] effort: ${pct(m.total_savings)} savings ($${m.gepa_total_cost} vs $${m.baseline_total_cost})`); break;
      case 'context': console.log(`  [+] context: ${m.budget_aware_advantage}x advantage over random`); break;
      case 'drift': console.log(`  [+] drift: ${pct(m.drift_detection_rate)} detection rate (F1=${pct(m.f1)})`); break;
    }
  }
  console.log('');
}

function pct(n) {
  return `${Math.round(n * 100)}%`;
}

module.exports = bench;
