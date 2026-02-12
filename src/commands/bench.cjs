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
 *   npx claude-code-memory bench latency    # Operation latency
 *   npx claude-code-memory bench scalability # Scale testing (100/1K/10K)
 *   npx claude-code-memory bench adversarial # Adversarial resilience
 *   npx claude-code-memory bench decay      # Decay function comparison
 *   npx claude-code-memory bench dedup      # Near-duplicate detection
 *   npx claude-code-memory bench promotion  # Auto-promotion pipeline
 *   npx claude-code-memory bench conflict   # Contradiction detection
 *   npx claude-code-memory bench compaction # Memory compaction
 *   npx claude-code-memory bench forgetting # Forgetting curve
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

    case 'latency':
      console.log(`  Operations tested: ${Object.keys(m.operations).length}`);
      for (const [op, ms] of Object.entries(m.operations)) {
        const bar = '#'.repeat(Math.min(Math.round(ms / 5), 40));
        console.log(`    ${op.padEnd(22)} ${String(ms).padStart(6)}ms ${bar}`);
      }
      console.log(`  Total: ${m.total_ms}ms`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'scalability':
      console.log(`  Scales tested: ${m.scales.map(s => s.scale).join(', ')}`);
      for (const s of m.scales) {
        console.log(`    ${String(s.scale).padStart(6)} entries: insert=${s.insert_ms}ms query=${s.query_ms}ms fitness=${s.fitness_ms}ms`);
      }
      console.log(`  Degradation factor: ${m.degradation_factor} (1.0=linear, >1=superlinear)`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'adversarial':
      console.log(`  Adversarial entries: ${m.adversarial_count}, Legitimate: ${m.legitimate_count}`);
      console.log(`  Safety constants: ${m.safety_constants}`);
      console.log(`  Adversarial promotion blocked: ${m.adversarial_promotion_blocked ? 'YES' : 'NO'}`);
      console.log(`  Adversarial flagged by drift: ${m.adversarial_flagged ? 'YES' : 'NO'}`);
      console.log(`  Avg fitness — legit: ${m.avg_legit_fitness}, adversarial: ${m.avg_adversarial_fitness}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'decay':
      console.log(`  Best strategy: ${m.best_strategy} (F1=${pct(m.best_f1)})`);
      for (const [s, d] of Object.entries(m.strategies)) {
        console.log(`    ${s.padEnd(14)} separation=${d.separation} precision=${pct(d.precision)} recall=${pct(d.recall)} F1=${pct(d.f1)}`);
      }
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'dedup':
      console.log(`  Entries: ${m.total_entries}, Known duplicates: ${m.known_duplicates}`);
      console.log(`  Detected pairs: ${m.detected_pairs} (TP=${m.true_positives} FP=${m.false_positives})`);
      console.log(`  Precision: ${pct(m.precision)}  Recall: ${pct(m.recall)}  F1: ${pct(m.f1)}`);
      console.log(`  Jaccard threshold: ${m.jaccard_threshold}`);
      if (m.top_matches && m.top_matches.length > 0) {
        console.log(`  Top matches:`);
        for (const t of m.top_matches.slice(0, 3)) {
          console.log(`    ${t.id1} <-> ${t.id2} (similarity=${t.similarity})`);
        }
      }
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'promotion':
      console.log(`  Entries: ${m.total_entries} (${m.rising_entries} rising, ${m.static_entries} static)`);
      console.log(`  Generations: ${m.generations_simulated}`);
      console.log(`  Rising reached constant: ${m.rising_reached_constant}/${m.rising_entries} (${pct(m.rising_promotion_rate)})`);
      console.log(`  Static leaked to constant: ${m.static_leaked_to_constant}`);
      console.log(`  Avg rising fitness: ${m.avg_rising_fitness}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'conflict':
      console.log(`  Entries: ${m.total_entries}, Known conflicts: ${m.known_conflicts}`);
      console.log(`  Detected: ${m.detected_conflicts} (TP=${m.true_positives} FP=${m.false_positives} FN=${m.false_negatives})`);
      console.log(`  Precision: ${pct(m.precision)}  Recall: ${pct(m.recall)}  F1: ${pct(m.f1)}`);
      console.log(`  Cross-layer conflicts: ${m.cross_layer_conflicts}`);
      if (m.top_conflicts && m.top_conflicts.length > 0) {
        console.log(`  Top conflicts:`);
        for (const c of m.top_conflicts.slice(0, 3)) {
          console.log(`    ${c.id1} <-> ${c.id2} (overlap=${c.overlap_ratio}, words=${c.overlap.join(',')})`);
        }
      }
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'compaction':
      console.log(`  Original: ${m.original_entries} → Merged: ${m.merged_entries} (${pct(m.reduction_rate)} reduction)`);
      console.log(`  Avg cluster size: ${m.avg_cluster_size}`);
      console.log(`  Topic purity: ${pct(m.avg_purity)}`);
      console.log(`  Keyword coverage: ${pct(m.keyword_coverage)}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'forgetting':
      console.log(`  Best strategy: ${m.best_strategy} (survival=${pct(m.best_survival_rate)})`);
      for (const [s, d] of Object.entries(m.strategies)) {
        console.log(`    ${s.padEnd(20)} survival=${pct(d.survival_rate)} avg_fitness=${d.avg_fitness}`);
      }
      console.log(`  Spaced vs none: +${pct(m.spaced_vs_none)}`);
      console.log(`  Spaced vs random: +${pct(m.spaced_vs_random)}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'temporal':
      console.log(`  Entries: ${m.total_entries}, Clusters: ${m.clusters_found}`);
      console.log(`  Avg cluster size: ${m.avg_cluster_size}`);
      console.log(`  Avg coherence: ${m.avg_coherence}`);
      console.log(`  Cluster hits: ${m.cluster_hits} vs Random: ${m.random_hits} (${m.cluster_advantage}x)`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'inheritance':
      console.log(`  Hub: ${m.hub_entries}, Connected: ${m.connected_entries}, Isolated: ${m.isolated_entries}`);
      console.log(`  Connected boost: +${m.connected_boost} fitness`);
      console.log(`  Isolated boost: +${m.isolated_boost} fitness`);
      console.log(`  Entries with inheritance: ${m.entries_with_inheritance}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'queryrewrite':
      console.log(`  Original recall: ${pct(m.original_recall)}  Expanded: ${pct(m.expanded_recall)}`);
      console.log(`  Improvement: +${pct(m.recall_improvement)}`);
      if (m.per_query) {
        for (const q of m.per_query) {
          console.log(`    "${q.query}": ${q.original_hits}→${q.expanded_hits}/${q.expected} (${pct(q.original_recall)}→${pct(q.expanded_recall)})`);
        }
      }
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'capacity':
      console.log(`  Before: ${m.before_count} → After: ${m.after_count} (cap=${m.capacity_limit})`);
      console.log(`  Golden retained: ${m.golden_retained} (${pct(m.golden_retention_rate)})`);
      console.log(`  Noise evicted: ${m.noise_evicted} (${pct(m.noise_eviction_rate)})`);
      console.log(`  Golden lost: ${m.golden_lost}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'gengap':
      console.log(`  Avg generation: ${m.avg_generation}`);
      console.log(`  Veteran boost: +${m.veteran_boost}`);
      console.log(`  Newcomer boost: +${m.newcomer_boost}`);
      console.log(`  Separation: standard=${m.separation_standard} → gengap=${m.separation_gengap} (+${m.separation_improvement})`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'freshness':
      console.log(`  Updated: ${m.updated_entries}, Stale: ${m.stale_entries}`);
      console.log(`  Updated boost: +${m.updated_boost}`);
      console.log(`  Separation: standard=${m.separation_standard} → fresh=${m.separation_fresh} (+${m.separation_improvement})`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'hubnodes':
      console.log(`  Hubs: ${m.hub_count} (threshold=${m.hub_threshold} relations), Leaves: ${m.leaf_count}`);
      console.log(`  Hub avg density: ${m.hub_avg_density} relations`);
      console.log(`  Hub boost: +${m.hub_boost}, Leaf boost: +${m.leaf_boost}`);
      console.log(`  Separation: standard=${m.separation_standard} → density=${m.separation_density} (+${m.separation_improvement})`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'coherence':
      console.log(`  Best strategy: ${m.best_strategy} (coherence=${m.best_coherence})`);
      for (const [s, c] of Object.entries(m.strategies)) {
        console.log(`    ${s.padEnd(18)} coherence=${c}`);
      }
      console.log(`  Coherent vs fitness-only: +${m.coherent_vs_fitness}`);
      console.log(`  Graph-walk vs fitness-only: +${m.graph_vs_fitness}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
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
      case 'latency': console.log(`  [+] latency: ${m.total_ms}ms total (${Object.keys(m.operations).length} ops)`); break;
      case 'scalability': console.log(`  [+] scalability: degradation=${m.degradation_factor} across ${m.scales.length} scales`); break;
      case 'adversarial': console.log(`  [+] adversarial: blocked=${m.adversarial_promotion_blocked} flagged=${m.adversarial_flagged}`); break;
      case 'decay': console.log(`  [+] decay: best=${m.best_strategy} F1=${pct(m.best_f1)}`); break;
      case 'dedup': console.log(`  [+] dedup: F1=${pct(m.f1)} (${m.true_positives}/${m.known_duplicates} found)`); break;
      case 'promotion': console.log(`  [+] promotion: ${m.rising_reached_constant}/${m.rising_entries} reached constant, ${m.static_leaked_to_constant} leaked`); break;
      case 'conflict': console.log(`  [+] conflict: F1=${pct(m.f1)} (${m.true_positives}/${m.known_conflicts} detected)`); break;
      case 'compaction': console.log(`  [+] compaction: ${pct(m.reduction_rate)} reduction, ${pct(m.avg_purity)} purity`); break;
      case 'forgetting': console.log(`  [+] forgetting: best=${m.best_strategy} survival=${pct(m.best_survival_rate)}`); break;
      case 'temporal': console.log(`  [+] temporal: ${m.cluster_advantage}x cluster advantage, coherence=${m.avg_coherence}`); break;
      case 'inheritance': console.log(`  [+] inheritance: connected +${m.connected_boost}, isolated +${m.isolated_boost}`); break;
      case 'queryrewrite': console.log(`  [+] queryrewrite: recall ${pct(m.original_recall)}→${pct(m.expanded_recall)} (+${pct(m.recall_improvement)})`); break;
      case 'capacity': console.log(`  [+] capacity: ${pct(m.golden_retention_rate)} golden retained, ${pct(m.noise_eviction_rate)} noise evicted`); break;
      case 'gengap': console.log(`  [+] gengap: veteran +${m.veteran_boost}, separation +${m.separation_improvement}`); break;
      case 'freshness': console.log(`  [+] freshness: updated +${m.updated_boost}, separation +${m.separation_improvement}`); break;
      case 'hubnodes': console.log(`  [+] hubnodes: hub +${m.hub_boost}, separation +${m.separation_improvement}`); break;
      case 'coherence': console.log(`  [+] coherence: best=${m.best_strategy} (${m.best_coherence})`); break;
    }
  }
  console.log('');
}

function pct(n) {
  return `${Math.round(n * 100)}%`;
}

module.exports = bench;
