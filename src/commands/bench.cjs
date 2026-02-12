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

    case 'crosslayer':
      console.log(`  Linked: ${m.linked_entries}, Isolated: ${m.isolated_entries}`);
      console.log(`  Linked boost: +${m.linked_boost}, Isolated boost: +${m.isolated_boost}`);
      console.log(`  Separation: standard=${m.separation_standard} → crosslayer=${m.separation_crosslayer} (+${m.separation_improvement})`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'coaccess':
      console.log(`  Sessions: ${m.sessions_simulated}, Unique pairs: ${m.unique_co_pairs}`);
      console.log(`  Co-access hits: ${m.coaccess_hits} (${pct(m.coaccess_hit_rate)})`);
      console.log(`  Random hits: ${m.random_hits} (${pct(m.random_hit_rate)})`);
      console.log(`  Advantage: ${m.coaccess_advantage}x over random`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'kwdensity':
      console.log(`  Rare: ${m.rare_entries}, Common: ${m.common_entries}`);
      console.log(`  Rare boost: +${m.rare_boost}, Common boost: +${m.common_boost}`);
      console.log(`  Separation: standard=${m.separation_standard} → IDF=${m.separation_idf} (+${m.separation_improvement})`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'batchinc':
      console.log(`  Operations: ${m.operations}, Entries: ${m.total_entries}`);
      console.log(`  Avg drift: ${m.avg_drift}, Max drift: ${m.max_drift}`);
      console.log(`  Zero-drift entries: ${m.zero_drift_pct}%`);
      console.log(`  Top-10 overlap: ${m.top10_overlap}/10 (${pct(m.top10_agreement)})`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'coldstart':
      console.log(`  Capacity: ${m.capacity}, Grace period: ${m.grace_period_cycles} cycles`);
      console.log(`  No grace: new survival=${pct(m.no_grace_new_survival)}, patterns lost=${m.no_grace_patterns_lost}`);
      console.log(`  With grace: new survival=${pct(m.grace_new_survival)}, patterns lost=${m.grace_patterns_lost}`);
      console.log(`  Survival improvement: +${pct(m.survival_improvement)}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'fragmentation':
      console.log(`  Nodes: ${m.total_nodes}, Edges: ${m.total_edges}`);
      console.log(`  Components: ${m.num_components}, Largest: ${m.largest_component}`);
      console.log(`  Isolated nodes: ${m.isolated_nodes}`);
      console.log(`  Fragmentation: ${m.fragmentation_score} → ${m.post_defrag_fragmentation} (-${m.fragmentation_reduction})`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'cascade':
      console.log(`  Hub deprecated: ${m.hub_deprecated}, Cascade penalty: ${m.cascade_penalty}`);
      console.log(`  Affected dependents: ${m.affected_dependents}`);
      console.log(`  Dependent fitness loss: -${m.dependent_fitness_loss}`);
      console.log(`  Unaffected change: ${m.unaffected_change}, Independent change: ${m.independent_change}`);
      console.log(`  Targeted precision: ${pct(m.targeted_precision)}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'recrel':
      console.log(`  Recent: ${m.recent_nodes}, Old: ${m.old_nodes}`);
      console.log(`  Separation: uniform=${m.separation_uniform} → recency=${m.separation_recency} (+${m.separation_improvement})`);
      console.log(`  Recent boost: +${m.recent_boost}, Old penalty: ${m.old_penalty}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'entropy':
      console.log(`  Info: ${m.info_entries}, Generic: ${m.generic_entries}`);
      console.log(`  Info boost: +${m.info_boost}, Generic penalty: ${m.generic_penalty}`);
      console.log(`  Separation: standard=${m.separation_standard} → entropy=${m.separation_entropy} (+${m.separation_improvement})`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'velocity':
      console.log(`  Hot: ${m.hot_entries}, Cold: ${m.cold_entries}`);
      console.log(`  Hot boost: +${m.hot_boost}, Cold boost: +${m.cold_boost}`);
      console.log(`  Separation: standard=${m.separation_standard} → velocity=${m.separation_velocity} (+${m.separation_improvement})`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'semcluster':
      console.log(`  Entries: ${m.total_entries}, Budget: ${m.budget}`);
      console.log(`  Random: ${m.random_coherence}, Cluster: ${m.cluster_coherence}, Query: ${m.query_coherence}`);
      console.log(`  Cluster vs random: ${m.cluster_vs_random}x`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'walmode':
      console.log(`  Writes: ${m.writes}, Reads: ${m.reads}`);
      console.log(`  Default: write=${m.default_write_ms}ms read=${m.default_read_ms}ms`);
      console.log(`  WAL:     write=${m.wal_write_ms}ms read=${m.wal_read_ms}ms`);
      console.log(`  Speedup: write=${m.write_speedup}x read=${m.read_speedup}x`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'multihop':
      console.log(`  Entries: ${m.total_entries}, Relevant: ${m.relevant_entries}`);
      console.log(`  1-hop: ${m.hop1_found} found (recall=${pct(m.hop1_recall)})`);
      console.log(`  2-hop: ${m.hop2_found} found (recall=${pct(m.hop2_recall)})`);
      console.log(`  3-hop: ${m.hop3_found} found (recall=${pct(m.hop3_recall)})`);
      console.log(`  2-hop improvement: ${m.hop2_improvement}x`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'migration':
      console.log(`  Naive promotions: ${m.naive_promotions}, Cost-aware: ${m.cost_aware_promotions}`);
      console.log(`  Marginal blocked: ${m.marginal_blocked}`);
      console.log(`  Selectivity improvement: ${pct(m.selectivity_improvement)}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'attention':
      console.log(`  Used boost: +${m.used_boost}, Ignored penalty: ${m.ignored_penalty}`);
      console.log(`  Separation: standard=${m.separation_standard} → attention=${m.separation_attention} (+${m.separation_improvement})`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'contentlen':
      console.log(`  Short: ${m.short_entries}, Optimal: ${m.optimal_entries}, Long: ${m.long_entries}`);
      console.log(`  Short penalty: ${m.short_penalty}, Optimal boost: +${m.optimal_boost}, Long penalty: ${m.long_penalty}`);
      console.log(`  Optimal vs short improvement: +${m.optimal_vs_short_improvement}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'typefitness':
      console.log(`  Pattern avg: ${m.pattern_avg}, Decision avg: ${m.decision_avg}, Fact avg: ${m.fact_avg}`);
      console.log(`  Separation: +${m.separation_improvement}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'diminishing':
      console.log(`  Budgets tested: ${m.budgets_tested}`);
      console.log(`  First marginal gain: ${m.first_marginal_gain}, Last: ${m.last_marginal_gain}`);
      console.log(`  Diminishing confirmed: ${m.diminishing_confirmed}, Optimal budget: ${m.optimal_budget}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'contradict':
      console.log(`  Best strategy: ${m.best_strategy}, Best accuracy: ${m.best_accuracy}`);
      console.log(`  Conflicts tested: ${m.conflicts_tested}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'prefetch':
      console.log(`  Markov accuracy: ${pct(m.markov_accuracy)}, Random accuracy: ${pct(m.random_accuracy)}`);
      console.log(`  Prefetch advantage: ${m.prefetch_advantage}x`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'budget':
      console.log(`  Best strategy: ${m.best_strategy}, Best fitness: ${m.best_fitness}`);
      console.log(`  Total entries: ${m.total_entries}, Budget: ${m.total_budget}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'staleness':
      console.log(`  Fresh avg: ${m.fresh_avg}, Stale avg: ${m.stale_avg}`);
      console.log(`  Stale penalty: ${m.stale_penalty}, Separation: +${m.separation_improvement}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'consolidation':
      console.log(`  Before: ${m.before_count}, After: ${m.after_count}`);
      console.log(`  Groups: ${m.groups_found}, Merged: ${m.entries_merged}, Compression: ${pct(m.compression_rate)}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'feedback':
      console.log(`  Used boost: +${m.used_boost}, Ignored penalty: ${m.ignored_penalty}`);
      console.log(`  Separation: +${m.separation_improvement}, Recall lift: ${m.recall_lift}x`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'temporal_validity':
      console.log(`  Valid now: ${m.valid_now}, Expired: ${m.expired}, Future: ${m.future}`);
      console.log(`  Precision: ${pct(m.precision)}, Recall: ${pct(m.recall)}, F1: ${pct(m.f1)}`);
      console.log(`  Noise reduction: ${pct(m.noise_reduction)}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'hybrid':
      console.log(`  Keyword recall@10: ${pct(m.keyword_recall_at_10)}, Semantic: ${pct(m.semantic_recall_at_10)}, RRF: ${pct(m.rrf_recall_at_10)}`);
      console.log(`  MRR — Keyword: ${m.keyword_mrr}, Semantic: ${m.semantic_mrr}, RRF: ${m.rrf_mrr}`);
      console.log(`  Best method: ${m.best_method}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'autoreflect':
      console.log(`  Fixed: ${m.fixed_reflections} reflections (score=${m.fixed_score})`);
      console.log(`  Threshold: ${m.threshold_reflections} reflections (score=${m.threshold_score})`);
      console.log(`  Adaptive: ${m.adaptive_reflections} reflections (score=${m.adaptive_score})`);
      console.log(`  Best: ${m.best_strategy}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'recencybias':
      console.log(`  Uniform recent: ${m.uniform_recent_count}, Biased: ${m.biased_recent_count}, Floored: ${m.floored_recent_count}`);
      console.log(`  Bias advantage: +${m.bias_advantage}, Best: ${m.best_strategy}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'priorityevict':
      console.log(`  FIFO golden: ${m.fifo_golden_retained}, Random: ${m.random_golden_retained}`);
      console.log(`  Priority: ${m.priority_golden_retained}, Fitness-only: ${m.fitness_golden_retained}`);
      console.log(`  Priority vs FIFO: +${m.priority_vs_fifo}, Best: ${m.best_strategy}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'ctxdiversity':
      console.log(`  Dup info density: ${m.dup_info_density}, Diverse: ${m.div_info_density}`);
      console.log(`  Diversity advantage: +${m.diversity_advantage}`);
      console.log(`  Greedy unique words: ${m.greedy_unique_words}, MMR: ${m.mmr_unique_words}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'agedist':
      console.log(`  Balanced health: ${m.balanced_health}, Skewed old: ${m.skewed_old_health}, Skewed new: ${m.skewed_new_health}`);
      console.log(`  Health spread: ${m.health_spread}, Best: ${m.best_scenario}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'reldensity':
      console.log(`  Hub relations: ${m.avg_hub_relations}, Leaf: ${m.avg_leaf_relations}`);
      console.log(`  Standard sep: ${m.standard_separation}, Density sep: ${m.density_separation}`);
      console.log(`  Improvement: +${m.separation_improvement}`);
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
      case 'crosslayer': console.log(`  [+] crosslayer: linked +${m.linked_boost}, separation +${m.separation_improvement}`); break;
      case 'coaccess': console.log(`  [+] coaccess: ${m.coaccess_advantage}x advantage over random`); break;
      case 'kwdensity': console.log(`  [+] kwdensity: rare +${m.rare_boost}, separation +${m.separation_improvement}`); break;
      case 'batchinc': console.log(`  [+] batchinc: top10 overlap=${m.top10_overlap}/10, avg drift=${m.avg_drift}`); break;
      case 'coldstart': console.log(`  [+] coldstart: survival +${pct(m.survival_improvement)} with grace period`); break;
      case 'fragmentation': console.log(`  [+] fragmentation: score=${m.fragmentation_score}→${m.post_defrag_fragmentation}`); break;
      case 'cascade': console.log(`  [+] cascade: dep loss=-${m.dependent_fitness_loss}, precision=${pct(m.targeted_precision)}`); break;
      case 'recrel': console.log(`  [+] recrel: separation +${m.separation_improvement} with recency weighting`); break;
      case 'entropy': console.log(`  [+] entropy: info +${m.info_boost}, generic ${m.generic_penalty}, separation +${m.separation_improvement}`); break;
      case 'velocity': console.log(`  [+] velocity: hot +${m.hot_boost}, separation +${m.separation_improvement}`); break;
      case 'semcluster': console.log(`  [+] semcluster: cluster ${m.cluster_vs_random}x vs random`); break;
      case 'walmode': console.log(`  [+] walmode: write ${m.write_speedup}x, read ${m.read_speedup}x`); break;
      case 'multihop': console.log(`  [+] multihop: 1-hop ${pct(m.hop1_recall)} → 2-hop ${pct(m.hop2_recall)} (${m.hop2_improvement}x)`); break;
      case 'migration': console.log(`  [+] migration: ${m.marginal_blocked} blocked, selectivity +${pct(m.selectivity_improvement)}`); break;
      case 'attention': console.log(`  [+] attention: used +${m.used_boost}, ignored ${m.ignored_penalty}, separation +${m.separation_improvement}`); break;
      case 'contentlen': console.log(`  [+] contentlen: optimal +${m.optimal_boost}, short ${m.short_penalty}, long ${m.long_penalty}`); break;
      case 'typefitness': console.log(`  [+] typefitness: pattern=${m.pattern_avg}, decision=${m.decision_avg}, sep +${m.separation_improvement}`); break;
      case 'diminishing': console.log(`  [+] diminishing: confirmed=${m.diminishing_confirmed}, ${m.budgets_tested} budgets`); break;
      case 'contradict': console.log(`  [+] contradict: best=${m.best_strategy} (${pct(m.best_accuracy)})`); break;
      case 'prefetch': console.log(`  [+] prefetch: markov=${pct(m.markov_accuracy)} vs random=${pct(m.random_accuracy)} (${m.prefetch_advantage}x)`); break;
      case 'budget': console.log(`  [+] budget: best=${m.best_strategy} (fitness=${m.best_fitness})`); break;
      case 'staleness': console.log(`  [+] staleness: fresh=${m.fresh_avg}, stale=${m.stale_avg}, penalty=${m.stale_penalty}`); break;
      case 'consolidation': console.log(`  [+] consolidation: ${m.before_count}→${m.after_count} (${pct(m.compression_rate)} compression)`); break;
      case 'feedback': console.log(`  [+] feedback: used +${m.used_boost}, ignored ${m.ignored_penalty}, sep +${m.separation_improvement}`); break;
      case 'temporal_validity': console.log(`  [+] temporal_validity: precision=${pct(m.precision)}, recall=${pct(m.recall)}, noise_reduction=${pct(m.noise_reduction)}`); break;
      case 'hybrid': console.log(`  [+] hybrid: RRF recall=${pct(m.rrf_recall_at_10)}, MRR=${m.rrf_mrr}, best=${m.best_method}`); break;
      case 'autoreflect': console.log(`  [+] autoreflect: best=${m.best_strategy} (${m.adaptive_score}), vs fixed +${m.adaptive_vs_fixed}`); break;
      case 'recencybias': console.log(`  [+] recencybias: biased=${m.biased_recent_count}, advantage=+${m.bias_advantage}`); break;
      case 'priorityevict': console.log(`  [+] priorityevict: priority=${m.priority_golden_retained}/10 golden, vs fifo +${m.priority_vs_fifo}`); break;
      case 'ctxdiversity': console.log(`  [+] ctxdiversity: diverse=${m.div_info_density}, dup=${m.dup_info_density}, MMR +${m.mmr_vs_greedy} words`); break;
      case 'agedist': console.log(`  [+] agedist: balanced=${m.balanced_health}, spread=${m.health_spread}`); break;
      case 'reldensity': console.log(`  [+] reldensity: density sep +${m.separation_improvement}, hub access +${m.hub_access_advantage}`); break;
    }
  }
  console.log('');
}

function pct(n) {
  return `${Math.round(n * 100)}%`;
}

module.exports = bench;
