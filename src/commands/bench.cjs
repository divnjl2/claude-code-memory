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

    case 'slidingwin':
      console.log(`  Window size: ${m.window_size}`);
      console.log(`  All-time separation: ${m.alltime_separation}, Window separation: ${m.window_separation}`);
      console.log(`  Improvement: +${m.improvement}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'momentum':
      console.log(`  Rising base avg: ${m.rising_base_avg}, Momentum avg: ${m.rising_momentum_avg}`);
      console.log(`  Base separation: ${m.base_separation}, Momentum separation: ${m.momentum_separation}`);
      console.log(`  Momentum bonus: +${m.momentum_bonus}, Improvement: +${m.improvement}`);
      console.log(`  Rising with momentum: ${m.rising_with_momentum}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'peercomp':
      console.log(`  Entries: ${m.total_entries}, Types: ${m.types}`);
      console.log(`  Absolute separation: ${m.absolute_separation}, Peer separation: ${m.peer_separation}`);
      console.log(`  Improvement: +${m.improvement}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'accessentropy':
      console.log(`  Regular entropy avg: ${m.regular_entropy_avg}, Bursty: ${m.bursty_entropy_avg}`);
      console.log(`  Entropy separation: ${m.entropy_separation}, Base separation: ${m.base_separation}`);
      console.log(`  Improvement: +${m.improvement}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'writeamp':
      console.log(`  Individual: ${m.individual_writes} writes in ${m.individual_ms}ms`);
      console.log(`  Batch: ${m.batch_writes} writes in ${m.batch_ms}ms`);
      console.log(`  Reduction factor: ${m.reduction_factor}x`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'layermigcost':
      console.log(`  Eager: ${m.eager_promotions} promotions in ${m.eager_ms}ms`);
      console.log(`  Threshold: ${m.threshold_promotions} promotions in ${m.threshold_ms}ms`);
      console.log(`  Unnecessary migrations: ${m.unnecessary_migrations}`);
      console.log(`  Cost ratio: ${m.cost_ratio}x, Threshold cheaper: ${m.threshold_is_cheaper}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'ctxsaturation':
      console.log(`  Budgets tested: ${m.budgets_tested}`);
      console.log(`  Optimal fill: ${m.optimal_fill_pct}%`);
      console.log(`  First marginal gain: ${m.first_marginal_gain}, Last: ${m.last_marginal_gain}`);
      console.log(`  Diminishing confirmed: ${m.diminishing_confirmed}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'latencydist':
      console.log(`  P50: ${m.p50_ms}ms, P95: ${m.p95_ms}ms, P99: ${m.p99_ms}ms`);
      console.log(`  Mean: ${m.mean_ms}ms, Std: ${m.std_ms}ms`);
      console.log(`  P99/P50 ratio: ${m.p99_to_p50_ratio}x (target <5x)`);
      console.log(`  P99 under 5x P50: ${m.p99_under_5x_p50}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    // Round 9: BS-BZ
    case 'surprise':
      console.log(`  Memorability ratio: ${m.memorability_ratio}x, Surprise boost: ${m.surprise_boost}`);
      console.log(`  Surprise avg: ${m.avg_surprise_score}, Normal avg: ${m.avg_normal_score}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'usagedecay':
      console.log(`  Half-life: ${m.halflife_days} days`);
      console.log(`  Active avg: ${m.active_avg_fitness}, Inactive avg: ${m.inactive_avg_fitness}`);
      console.log(`  Separation: ${m.separation}, Decay effective: ${m.decay_effective}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'transitivity':
      console.log(`  Direct reach: ${m.direct_reach}, Transitive reach: ${m.transitive_reach}`);
      console.log(`  Amplification: ${m.transitivity_amplification}x, Max depth: ${m.max_depth}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'compressratio':
      console.log(`  Original: ${m.original_count} entries (${m.original_bytes}B) → Compressed: ${m.compressed_count} (${m.compressed_bytes}B)`);
      console.log(`  Compression ratio: ${m.compression_ratio}, Space saved: ${m.space_saved_pct}%`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'queryspec':
      console.log(`  Queries tested: ${m.queries_tested}, Avg specificity: ${m.avg_specificity}`);
      console.log(`  Specific precision: ${m.specific_precision}, Broad precision: ${m.broad_precision}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'temploc':
      console.log(`  Recent: ${m.recent_entries}, Old: ${m.old_entries}`);
      console.log(`  Locality score: ${m.locality_score}, Temporal advantage: ${m.temporal_advantage}x`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'importcalib':
      console.log(`  High: ${m.avg_high_score}, Med: ${m.avg_med_score}, Low: ${m.avg_low_score}`);
      console.log(`  Monotonic: ${m.monotonic}, Separation: ${m.separation}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'graphdiam':
      console.log(`  Diameter: ${m.diameter}, Radius: ${m.radius}`);
      console.log(`  Avg eccentricity: ${m.avg_eccentricity}, Nodes: ${m.nodes}, Edges: ${m.edges}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    // Round 10: CA-CH
    case 'forgetthresh':
      console.log(`  Thresholds tested: ${m.thresholds_tested}, Best: ${m.best_threshold}`);
      console.log(`  Forgotten: ${m.best_forgotten}, Retained: ${m.best_retained}, Separation: ${m.separation}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'batchopt':
      console.log(`  Batch sizes tested: ${m.batch_sizes_tested}, Best: ${m.best_batch_size}`);
      console.log(`  Best per-entry: ${m.best_per_entry_ms}ms, Speedup vs single: ${m.speedup_vs_single}x`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'importdist':
      console.log(`  Count: ${m.count}, Mean: ${m.mean}, Std: ${m.std}, Median: ${m.median}`);
      console.log(`  Skewness: ${m.skewness}, Gini: ${m.gini}`);
      console.log(`  Low: ${m.low_count}, Mid: ${m.mid_count}, High: ${m.high_count}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'reltypeweight':
      console.log(`  Relation types: ${m.relation_types}, Weighting effect: ${m.weighting_effect}`);
      console.log(`  Weighted reach: ${m.total_weighted_reach}, Unweighted: ${m.total_unweighted_reach}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'warmup':
      console.log(`  Cold avg: ${m.cold_avg_ms}ms, Warm avg: ${m.warm_avg_ms}ms`);
      console.log(`  Speedup: ${m.speedup}x, Warmup effective: ${m.warmup_effective}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'staleref':
      console.log(`  Total relations: ${m.total_relations}, Valid: ${m.valid_relations}, Stale: ${m.stale_relations}`);
      console.log(`  Stale ratio: ${m.stale_ratio}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'ctxoverlap':
      console.log(`  Selected: ${m.selected}, Avg pairwise overlap: ${m.avg_pairwise_overlap}`);
      console.log(`  Redundancy: ${m.redundancy}, Info density: ${m.info_density}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'fitnessplateau':
      console.log(`  Plateaued: ${m.plateaued_count}, Rising: ${m.rising_count}`);
      console.log(`  Plateau fitness: ${m.avg_plateau_fitness}, Rising fitness: ${m.avg_rising_fitness}`);
      console.log(`  Separation: ${m.separation}, Plateau detected: ${m.plateau_detected}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    // Round 11: CI-CP
    case 'concurrent':
      console.log(`  Readers: ${m.readers}, Writers: ${m.writers}`);
      console.log(`  Read ops: ${m.read_ops} (avg ${m.avg_read_ms}ms), Write ops: ${m.write_ops} (avg ${m.avg_write_ms}ms)`);
      console.log(`  Errors: ${m.errors}, Concurrent safe: ${m.concurrent_safe}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'recovery':
      console.log(`  Before: ${m.before_count}, After: ${m.after_count}`);
      console.log(`  Recovery: ${m.recovery_ms}ms, Integrity: ${m.integrity}`);
      console.log(`  Data preserved: ${m.data_preserved}, Recovery successful: ${m.recovery_successful}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'indexeff':
      console.log(`  Without index: ${m.no_index_avg_ms}ms, With index: ${m.with_index_avg_ms}ms`);
      console.log(`  Speedup: ${m.speedup}x, Index effective: ${m.index_effective}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'vacuum':
      console.log(`  Pre-vacuum: ${m.pre_vacuum_bytes}B, Post: ${m.post_vacuum_bytes}B`);
      console.log(`  Space reduction: ${m.space_reduction_pct}%, Vacuum: ${m.vacuum_ms}ms`);
      console.log(`  Query before: ${m.pre_query_ms}ms, After: ${m.post_query_ms}ms`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'schemaevol':
      console.log(`  Before: ${m.before_count}, After: ${m.after_count}`);
      console.log(`  Data preserved: ${m.data_preserved}, Backward compatible: ${m.backward_compatible}`);
      console.log(`  Migration1: ${m.migration1_ms}ms, Migration2: ${m.migration2_ms}ms`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'queryplan':
      console.log(`  Queries analyzed: ${m.queries_analyzed}`);
      console.log(`  Using index: ${m.using_index}, Full scans: ${m.full_scans}`);
      console.log(`  Optimization ratio: ${m.optimization_ratio}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'memfootprint':
      console.log(`  Growth rate: ${m.growth_rate}, Sub-linear: ${m.sub_linear}`);
      console.log(`  Smallest: ${m.smallest_per_entry}B/entry, Largest: ${m.largest_per_entry}B/entry`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'checkpoint':
      console.log(`  Frequencies tested: ${m.frequencies_tested}`);
      console.log(`  Best frequency: ${m.best_frequency} (${m.best_time_ms}ms)`);
      console.log(`  Worst frequency: ${m.worst_frequency} (${m.worst_time_ms}ms)`);
      console.log(`  Speedup: ${m.speedup}x`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'semantic-drift':
      console.log(`  Generations: ${m.generations}, Total entries: ${m.total_entries}`);
      console.log(`  High drift avg fitness: ${m.high_drift_avg_fitness}, Low drift avg fitness: ${m.low_drift_avg_fitness}`);
      console.log(`  Drift-fitness correlation: ${m.drift_fitness_correlation}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'mem-pressure':
      console.log(`  Total entries: ${m.total_entries}, Fitness wins: ${m.fitness_wins}/${m.total_tests}`);
      console.log(`  Avg quality ratio: ${m.avg_quality_ratio}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'rel-symmetry':
      console.log(`  Symmetric co-retrieval: ${m.symmetric_co_retrieval}, Asymmetric: ${m.asymmetric_co_retrieval}`);
      console.log(`  Improvement: ${m.improvement_pct}%, Exceeds 20%: ${m.exceeds_20pct}`);
      console.log(`  Bidirectional: ${m.bidirectional_relations}/${m.total_relations}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'node-centrality':
      console.log(`  High centrality: ${m.high_centrality_count}, Low: ${m.low_centrality_count}`);
      console.log(`  High cent avg importance: ${m.high_cent_avg_importance}, Low: ${m.low_cent_avg_importance}`);
      console.log(`  Nodes: ${m.total_nodes}, Edges: ${m.total_edges}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'incr-learning':
      console.log(`  Related overlap: ${m.related_overlap}, Unrelated: ${m.unrelated_overlap}`);
      console.log(`  Stabilization ratio: ${m.stabilization_ratio}, Exceeds 2x: ${m.ratio_exceeds_2x}`);
      console.log(`  Total entries: ${m.total_entries}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'partition-eff':
      console.log(`  Partitioned: ${m.partitioned_time_ms}ms, Flat: ${m.flat_time_ms}ms`);
      console.log(`  Speedup: ${m.speedup_pct}%, Exceeds 30%: ${m.exceeds_30pct}`);
      console.log(`  Total entries: ${m.total_entries}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'confidence':
      console.log(`  Conf weighted precision: ${m.conf_weighted_precision}, Unweighted: ${m.unweighted_precision}`);
      console.log(`  Improvement: ${m.precision_improvement}%, Exceeds 15%: ${m.exceeds_15pct}`);
      console.log(`  Total entries: ${m.total_entries}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'recency-grad':
      console.log(`  Sharp preserved useful: ${m.sharp_preserved_useful}, Sigmoid: ${m.sigmoid_preserved_useful}`);
      console.log(`  Sigmoid better: ${m.sigmoid_better}, Overlap top50: ${m.overlap_top50}`);
      console.log(`  Total entries: ${m.total_entries}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'graph-density':
      console.log(`  Optimal density: ${m.optimal_density_min}-${m.optimal_density_max}`);
      console.log(`  Avg coverage in 2-4: ${m.avg_coverage_in_2_4}%, Outside: ${m.avg_coverage_outside_2_4}%`);
      console.log(`  Density 2-4 is best: ${m.density_2_4_is_best}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'temporal-batch':
      console.log(`  Intra-session coherence: ${m.avg_intra_session}, Cross-session: ${m.avg_cross_session}`);
      console.log(`  Coherence ratio: ${m.coherence_ratio}, Exceeds 3x: ${m.ratio_exceeds_3x}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'fitness-inherit':
      console.log(`  Captured at 2-hop: ${m.pct_captured_at_2hop}%, At 3-hop: ${m.pct_captured_at_3hop}%`);
      console.log(`  2-hop captures 90%: ${m.two_hop_captures_90pct}, Depth: ${m.depth}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'memory-replay':
      console.log(`  Avg replayed fitness: ${m.avg_replayed_fitness}, Unreplayed: ${m.avg_unreplayed_fitness}`);
      console.log(`  Fitness ratio: ${m.fitness_ratio}, Replayed 50% higher: ${m.replayed_50pct_higher}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'content-novelty':
      console.log(`  Novel avg fitness: ${m.avg_novel_fitness}, Redundant: ${m.avg_redundant_fitness}`);
      console.log(`  Retention ratio: ${m.retention_ratio}, Novel 2x retention: ${m.novel_2x_retention}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'query-routing':
      console.log(`  Avg direct hits: ${m.avg_direct_hits}, Routed: ${m.avg_routed_hits}`);
      console.log(`  Search reduction: ${m.search_space_reduction_pct}%, Exceeds 40%: ${m.reduction_exceeds_40pct}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'dep-resilience':
      console.log(`  Linear survival: ${m.linear_survival_rate}%, Redundant: ${m.redundant_survival_rate}%`);
      console.log(`  Redundant better: ${m.redundant_better}, Chain length: ${m.chain_length}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'consol-waves':
      console.log(`  Original: ${m.original_count}, Consolidated: ${m.consolidated_count}`);
      console.log(`  Reduction: ${m.reduction_pct}%, Recall: ${m.recall_pct}%`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'readwrite-ratio':
      console.log(`  Best ratio: ${m.best_ratio}, Best ops/sec: ${m.best_ops_sec}`);
      console.log(`  Ratios tested: ${(m.ratios || []).length}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'semantic-neighbor':
      console.log(`  High quality: ${m.high_quality_count}, Low quality: ${m.low_quality_count}`);
      console.log(`  HQ avg fitness: ${m.hq_avg_fitness}, LQ avg fitness: ${m.lq_avg_fitness}`);
      console.log(`  Precision lift: ${m.precision_lift_pct}%, Exceeds 25%: ${m.lift_exceeds_25pct}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'gc-efficiency':
      console.log(`  Total before: ${m.total_before}, Deprecated: ${m.deprecated_count}`);
      console.log(`  Eager: ${m.eager_time_ms}ms, Lazy: ${m.lazy_time_ms}ms`);
      console.log(`  Speedup: ${m.speedup_factor}x, Lazy 3x faster: ${m.lazy_3x_faster}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'ctx-packing':
      console.log(`  Window size: ${m.window_size}, Total entries: ${m.total_entries}`);
      console.log(`  Greedy vs optimal: ${m.greedy_vs_optimal_pct}%`);
      console.log(`  Greedy exceeds 90%: ${m.greedy_exceeds_90pct}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'versioning-cost':
      console.log(`  Updates performed: ${m.updates_performed}, Version records: ${m.version_records}`);
      console.log(`  Version time: ${m.version_time_ms}ms, Storage overhead: ${m.storage_overhead_pct}%`);
      console.log(`  Overhead under 10%: ${m.overhead_under_10pct}, Rollback capable: ${m.rollback_capable}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'rel-pruning':
      console.log(`  Prune: ${m.prune_count} (${m.prune_pct}%)`);
      console.log(`  Best strategy: ${m.best_strategy}, Weight is best: ${m.weight_is_best}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'query-fusion':
      console.log(`  Queries: ${m.query_count}, Individual IDs: ${m.individual_count}, Fused: ${m.fused_count}`);
      console.log(`  Time reduction: ${m.time_reduction_pct}%, Recall: ${m.recall_fused_pct}%`);
      console.log(`  Fusion saves 50%: ${m.fusion_saves_50pct}, Recall loss <5%: ${m.recall_loss_under_5pct}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'snapshot-diff':
      console.log(`  Total entries: ${m.total_entries}, Changed: ${m.changed_entries}, New: ${m.new_entries}`);
      console.log(`  Storage reduction: ${m.storage_reduction_pct}%, Diff speedup: ${m.diff_speedup}x`);
      console.log(`  Reduction exceeds 70%: ${m.reduction_exceeds_70pct}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'adaptive-batch':
      console.log(`  Fixed small batches: ${m.fixed_small_batches} (${m.fixed_small_ms}ms)`);
      console.log(`  Adaptive batches: ${m.adaptive_batches} (${m.adaptive_ms}ms)`);
      console.log(`  Savings vs small: ${m.savings_vs_small_pct}%, Better than 40%: ${m.adaptive_better_than_40pct}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'cross-session':
      console.log(`  Single session: ${m.single_session_count} (avg fitness: ${m.avg_single_fitness})`);
      console.log(`  Multi session: ${m.multi_session_count} (avg fitness: ${m.avg_multi_fitness})`);
      console.log(`  Multi/single ratio: ${m.multi_to_single_ratio}, 3x higher: ${m.multi_3x_higher}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'index-select':
      console.log(`  Best strategy: ${m.best_strategy}, Best time: ${m.best_time_ms}ms`);
      console.log(`  Composite is optimal: ${m.composite_is_optimal}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'topic-cluster':
      console.log(`  Total entries: ${m.total_entries}, Clusters: ${m.num_clusters}`);
      console.log(`  Avg topic coherence: ${m.avg_topic_coherence}, Random: ${m.avg_random_coherence}`);
      console.log(`  Improvement: ${m.coherence_improvement_pct}%, Above 30%: ${m.improvement_above_30pct}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'fitness-norm':
      console.log(`  Sizes tested: ${(m.sizes_tested || []).length}`);
      console.log(`  Raw CV: ${m.stability_raw_cv}, Z-score CV: ${m.stability_zscore_cv}, MinMax CV: ${m.stability_minmax_cv}`);
      console.log(`  Best method: ${m.best_method}, Z-score most stable: ${m.zscore_is_most_stable}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'rel-decay':
      console.log(`  Total relations: ${m.total_relations}, Sample nodes: ${m.sample_nodes}`);
      console.log(`  Avg raw relevance: ${m.avg_raw_relevance}, Decayed: ${m.avg_decayed_relevance}`);
      console.log(`  Old reduced: ${m.old_relations_reduced}/${m.old_relations_total}`);
      console.log(`  Decay improves relevance: ${m.decay_improves_relevance}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'promo-velocity':
      console.log(`  Current promoted: ${m.current_promoted_count}, Proposed: ${m.proposed_promoted_count}`);
      console.log(`  Fast in current: ${m.fast_in_current}, Fast in proposed: ${m.fast_in_proposed}`);
      console.log(`  Proposed captures fast better: ${m.proposed_captures_fast_better}`);
      if (m.hypotheses) console.log(`  Hypotheses: ${m.hypotheses.join(', ')}`);
      break;

    case 'query-cache':
      console.log(`  Total queries: ${m.total_queries}`);
      console.log(`  No cache: ${m.no_cache_ms}ms, Full cache: ${m.full_cache_ms}ms`);
      console.log(`  Hit rate: ${m.full_cache_hit_rate_pct}%, Reduction: ${m.full_cache_reduction_pct}%`);
      console.log(`  Caching reduces 60%: ${m.caching_reduces_60pct}`);
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
      case 'slidingwin': console.log(`  [+] slidingwin: window sep ${m.window_separation}, alltime ${m.alltime_separation}, improvement +${m.improvement}`); break;
      case 'momentum': console.log(`  [+] momentum: base sep ${m.base_separation}, momentum sep ${m.momentum_separation}, +${m.improvement}`); break;
      case 'peercomp': console.log(`  [+] peercomp: absolute ${m.absolute_separation}, peer ${m.peer_separation}, +${m.improvement}`); break;
      case 'accessentropy': console.log(`  [+] accessentropy: entropy sep ${m.entropy_separation}, base ${m.base_separation}, +${m.improvement}`); break;
      case 'writeamp': console.log(`  [+] writeamp: batch ${m.batch_ms}ms vs individual ${m.individual_ms}ms (${m.reduction_factor}x)`); break;
      case 'layermigcost': console.log(`  [+] layermigcost: threshold ${m.threshold_promotions} vs eager ${m.eager_promotions}, cost ${m.cost_ratio}x`); break;
      case 'ctxsaturation': console.log(`  [+] ctxsaturation: optimal fill ${m.optimal_fill_pct}%, diminishing=${m.diminishing_confirmed}`); break;
      case 'latencydist': console.log(`  [+] latencydist: P50=${m.p50_ms}ms P95=${m.p95_ms}ms P99=${m.p99_ms}ms ratio=${m.p99_to_p50_ratio}x`); break;
      case 'surprise': console.log(`  [+] surprise: memorability=${m.memorability_ratio}x, boost=${m.surprise_boost}`); break;
      case 'usagedecay': console.log(`  [+] usagedecay: halflife=${m.halflife_days}d, separation=${m.separation}`); break;
      case 'transitivity': console.log(`  [+] transitivity: reach=${m.transitive_reach}, amplification=${m.transitivity_amplification}x`); break;
      case 'compressratio': console.log(`  [+] compressratio: ratio=${m.compression_ratio}, saved=${m.space_saved_pct}%`); break;
      case 'queryspec': console.log(`  [+] queryspec: specific_prec=${m.specific_precision}, broad_prec=${m.broad_precision}`); break;
      case 'temploc': console.log(`  [+] temploc: locality=${m.locality_score}, advantage=${m.temporal_advantage}x`); break;
      case 'importcalib': console.log(`  [+] importcalib: monotonic=${m.monotonic}, separation=${m.separation}`); break;
      case 'graphdiam': console.log(`  [+] graphdiam: diameter=${m.diameter}, radius=${m.radius}, density=${m.density}`); break;
      case 'forgetthresh': console.log(`  [+] forgetthresh: best=${m.best_threshold}, separation=${m.separation}`); break;
      case 'batchopt': console.log(`  [+] batchopt: best_size=${m.best_batch_size}, speedup=${m.speedup_vs_single}x`); break;
      case 'importdist': console.log(`  [+] importdist: mean=${m.mean}, gini=${m.gini}, skewness=${m.skewness}`); break;
      case 'reltypeweight': console.log(`  [+] reltypeweight: effect=${m.weighting_effect}, types=${m.relation_types}`); break;
      case 'warmup': console.log(`  [+] warmup: cold=${m.cold_avg_ms}ms, warm=${m.warm_avg_ms}ms, speedup=${m.speedup}x`); break;
      case 'staleref': console.log(`  [+] staleref: stale=${m.stale_relations}/${m.total_relations}, ratio=${m.stale_ratio}`); break;
      case 'ctxoverlap': console.log(`  [+] ctxoverlap: redundancy=${m.redundancy}, info_density=${m.info_density}`); break;
      case 'fitnessplateau': console.log(`  [+] fitnessplateau: plateaued=${m.plateaued_count}, rising=${m.rising_count}, sep=${m.separation}`); break;
      case 'concurrent': console.log(`  [+] concurrent: reads=${m.read_ops}, writes=${m.write_ops}, errors=${m.errors}, safe=${m.concurrent_safe}`); break;
      case 'recovery': console.log(`  [+] recovery: preserved=${m.data_preserved}, integrity=${m.integrity}, ms=${m.recovery_ms}`); break;
      case 'indexeff': console.log(`  [+] indexeff: speedup=${m.speedup}x, effective=${m.index_effective}`); break;
      case 'vacuum': console.log(`  [+] vacuum: reduction=${m.space_reduction_pct}%, vacuum_ms=${m.vacuum_ms}`); break;
      case 'schemaevol': console.log(`  [+] schemaevol: preserved=${m.data_preserved}, compatible=${m.backward_compatible}`); break;
      case 'queryplan': console.log(`  [+] queryplan: indexed=${m.using_index}/${m.queries_analyzed}, ratio=${m.optimization_ratio}`); break;
      case 'memfootprint': console.log(`  [+] memfootprint: growth=${m.growth_rate}, sub_linear=${m.sub_linear}`); break;
      case 'checkpoint': console.log(`  [+] checkpoint: best_freq=${m.best_frequency}, speedup=${m.speedup}x`); break;
      case 'semantic-drift': console.log(`  [+] semantic-drift: corr=${m.drift_fitness_correlation}, high=${m.high_drift_avg_fitness}, low=${m.low_drift_avg_fitness}`); break;
      case 'mem-pressure': console.log(`  [+] mem-pressure: wins=${m.fitness_wins}/${m.total_tests}, quality=${m.avg_quality_ratio}`); break;
      case 'rel-symmetry': console.log(`  [+] rel-symmetry: sym=${m.symmetric_co_retrieval}, asym=${m.asymmetric_co_retrieval}, impr=${m.improvement_pct}%`); break;
      case 'node-centrality': console.log(`  [+] node-centrality: high_imp=${m.high_cent_avg_importance}, low_imp=${m.low_cent_avg_importance}, nodes=${m.total_nodes}`); break;
      case 'incr-learning': console.log(`  [+] incr-learning: related=${m.related_overlap}, unrelated=${m.unrelated_overlap}, ratio=${m.stabilization_ratio}`); break;
      case 'partition-eff': console.log(`  [+] partition-eff: speedup=${m.speedup_pct}%, partitioned=${m.partitioned_time_ms}ms`); break;
      case 'confidence': console.log(`  [+] confidence: weighted=${m.conf_weighted_precision}, unweighted=${m.unweighted_precision}, impr=${m.precision_improvement}%`); break;
      case 'recency-grad': console.log(`  [+] recency-grad: sharp=${m.sharp_preserved_useful}, sigmoid=${m.sigmoid_preserved_useful}, sigmoid_better=${m.sigmoid_better}`); break;
      case 'graph-density': console.log(`  [+] graph-density: coverage_in_2_4=${m.avg_coverage_in_2_4}%, optimal=${m.density_2_4_is_best}`); break;
      case 'temporal-batch': console.log(`  [+] temporal-batch: intra=${m.avg_intra_session}, cross=${m.avg_cross_session}, ratio=${m.coherence_ratio}`); break;
      case 'fitness-inherit': console.log(`  [+] fitness-inherit: 2hop=${m.pct_captured_at_2hop}%, 3hop=${m.pct_captured_at_3hop}%, captures_90=${m.two_hop_captures_90pct}`); break;
      case 'memory-replay': console.log(`  [+] memory-replay: replayed=${m.avg_replayed_fitness}, unreplayed=${m.avg_unreplayed_fitness}, ratio=${m.fitness_ratio}`); break;
      case 'content-novelty': console.log(`  [+] content-novelty: novel=${m.avg_novel_fitness}, redundant=${m.avg_redundant_fitness}, retention=${m.retention_ratio}`); break;
      case 'query-routing': console.log(`  [+] query-routing: direct=${m.avg_direct_hits}, routed=${m.avg_routed_hits}, reduction=${m.search_space_reduction_pct}%`); break;
      case 'dep-resilience': console.log(`  [+] dep-resilience: linear=${m.linear_survival_rate}%, redundant=${m.redundant_survival_rate}%, better=${m.redundant_better}`); break;
      case 'consol-waves': console.log(`  [+] consol-waves: original=${m.original_count}, consolidated=${m.consolidated_count}, reduction=${m.reduction_pct}%`); break;
      case 'readwrite-ratio': console.log(`  [+] readwrite-ratio: best=${m.best_ratio}, ops_sec=${m.best_ops_sec}`); break;
      case 'semantic-neighbor': console.log(`  [+] semantic-neighbor: high=${m.high_quality_count}, low=${m.low_quality_count}, lift=${m.precision_lift_pct}%`); break;
      case 'gc-efficiency': console.log(`  [+] gc-efficiency: before=${m.total_before}, deprecated=${m.deprecated_count}, speedup=${m.speedup_factor}x`); break;
      case 'ctx-packing': console.log(`  [+] ctx-packing: greedy_vs_optimal=${m.greedy_vs_optimal_pct}%, exceeds_90=${m.greedy_exceeds_90pct}`); break;
      case 'versioning-cost': console.log(`  [+] versioning-cost: updates=${m.updates_performed}, overhead=${m.storage_overhead_pct}%, under_10=${m.overhead_under_10pct}`); break;
      case 'rel-pruning': console.log(`  [+] rel-pruning: pruned=${m.prune_count} (${m.prune_pct}%), best=${m.best_strategy}`); break;
      case 'query-fusion': console.log(`  [+] query-fusion: individual=${m.individual_count}, fused=${m.fused_count}, time_reduction=${m.time_reduction_pct}%`); break;
      case 'snapshot-diff': console.log(`  [+] snapshot-diff: reduction=${m.storage_reduction_pct}%, speedup=${m.diff_speedup}x`); break;
      case 'adaptive-batch': console.log(`  [+] adaptive-batch: fixed=${m.fixed_small_ms}ms, adaptive=${m.adaptive_ms}ms, savings=${m.savings_vs_small_pct}%`); break;
      case 'cross-session': console.log(`  [+] cross-session: single=${m.avg_single_fitness}, multi=${m.avg_multi_fitness}, ratio=${m.multi_to_single_ratio}`); break;
      case 'index-select': console.log(`  [+] index-select: best=${m.best_strategy}, time=${m.best_time_ms}ms, composite_optimal=${m.composite_is_optimal}`); break;
      case 'topic-cluster': console.log(`  [+] topic-cluster: coherence=${m.avg_topic_coherence}, random=${m.avg_random_coherence}, impr=${m.coherence_improvement_pct}%`); break;
      case 'fitness-norm': console.log(`  [+] fitness-norm: best=${m.best_method}, raw_cv=${m.stability_raw_cv}, zscore_cv=${m.stability_zscore_cv}`); break;
      case 'rel-decay': console.log(`  [+] rel-decay: raw=${m.avg_raw_relevance}, decayed=${m.avg_decayed_relevance}, improves=${m.decay_improves_relevance}`); break;
      case 'promo-velocity': console.log(`  [+] promo-velocity: current=${m.current_promoted_count}, proposed=${m.proposed_promoted_count}, better=${m.proposed_captures_fast_better}`); break;
      case 'query-cache': console.log(`  [+] query-cache: no_cache=${m.no_cache_ms}ms, cached=${m.full_cache_ms}ms, hit_rate=${m.full_cache_hit_rate_pct}%`); break;
    }
  }
  console.log('');
}

function pct(n) {
  return `${Math.round(n * 100)}%`;
}

module.exports = bench;
