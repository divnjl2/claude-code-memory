#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const dir = path.join(process.env.USERPROFILE || '/c/Users/Administrator', 'Desktop', 'claude-code-memory-2026-02-12');
const results = JSON.parse(fs.readFileSync(path.join(dir, 'bench-results.json'), 'utf8'));

const passed = results.filter(r => !r.error).length;
const failed = results.filter(r => r.error).length;
const total_ms = results.reduce((s, r) => s + (r.duration_ms || 0), 0);

// Extract per-bench summary
const lines = results.map(r => {
  if (r.error) return `| ${r.bench} | ERROR | ${r.error} |`;
  const m = r.metrics;
  const hyp = (m.hypotheses || []).join(', ');
  let key = '';
  if (m.overall_recall != null) key = `recall=${m.overall_recall}, MRR=${m.overall_mrr}`;
  else if (m.retention_rate != null) key = `retention=${m.retention_rate}`;
  else if (m.f1 != null) key = `F1=${m.f1}`;
  else if (m.total_savings != null) key = `savings=${m.total_savings}`;
  else if (m.budget_aware_advantage != null) key = `${m.budget_aware_advantage}x advantage`;
  else if (m.drift_detection_rate != null) key = `detection=${m.drift_detection_rate}`;
  else if (m.total_ms != null) key = `${m.total_ms}ms total`;
  else if (m.degradation_factor != null) key = `degradation=${m.degradation_factor}`;
  else if (m.adversarial_promotion_blocked != null) key = `blocked=${m.adversarial_promotion_blocked}`;
  else if (m.separation_improvement != null) key = `sep_improvement=+${m.separation_improvement}`;
  else if (m.survival_improvement != null) key = `survival_improvement=+${m.survival_improvement}`;
  else if (m.cluster_vs_random != null) key = `cluster_vs_random=${m.cluster_vs_random}x`;
  else if (m.hop2_improvement != null) key = `hop2=${m.hop2_improvement}x`;
  else if (m.write_speedup != null) key = `write=${m.write_speedup}x, read=${m.read_speedup}x`;
  else if (m.selectivity_improvement != null) key = `selectivity=+${m.selectivity_improvement}`;
  else if (m.coaccess_advantage != null) key = `advantage=${m.coaccess_advantage}x`;
  else if (m.optimal_vs_short_improvement != null) key = `opt_vs_short=+${m.optimal_vs_short_improvement}`;
  else if (m.top10_overlap != null) key = `top10_overlap=${m.top10_overlap}/10`;
  else if (m.fragmentation_reduction != null) key = `frag_reduction=${m.fragmentation_reduction}`;
  else if (m.dependent_fitness_loss != null) key = `dep_loss=-${m.dependent_fitness_loss}`;
  else key = `${r.duration_ms}ms`;

  return `| ${r.bench} | ${hyp || '-'} | ${key} | ${r.duration_ms}ms |`;
});

console.log(`Benchmarks: ${passed} passed, ${failed} failed`);
console.log(`Total duration: ${total_ms}ms`);
console.log('');
console.log('| Bench | Hypotheses | Key Metric | Duration |');
console.log('|-------|-----------|------------|----------|');
lines.forEach(l => console.log(l));
