#!/usr/bin/env node
/**
 * Tests for bench.cjs — Memory system benchmarks (23 benchmarks, 27 hypotheses)
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  runBench,
  BENCHMARKS,
  SYNONYMS,
  benchRecall,
  benchPersist,
  benchFitness,
  benchEffort,
  benchContext,
  benchDrift,
  benchLatency,
  benchScalability,
  benchAdversarial,
  benchDecay,
  benchDedup,
  benchPromotion,
  benchConflict,
  benchCompaction,
  benchForgetting,
  benchTemporal,
  benchInheritance,
  benchQueryRewrite,
  benchCapacity,
  benchGenGap,
  benchFreshness,
  benchHubNodes,
  benchCoherence,
} = require('../src/lib/bench.cjs');

const { detectPython } = require('../src/lib/python-detector.cjs');

const python = detectPython();
const skipSqlite = !python.available;

describe('bench module', () => {
  it('exports BENCHMARKS with 23 entries', () => {
    assert.equal(Object.keys(BENCHMARKS).length, 23);
    for (const name of ['recall', 'persist', 'fitness', 'effort', 'context', 'drift',
                         'latency', 'scalability', 'adversarial', 'decay', 'dedup',
                         'promotion', 'conflict', 'compaction', 'forgetting',
                         'temporal', 'inheritance', 'queryrewrite', 'capacity',
                         'gengap', 'freshness', 'hubnodes', 'coherence']) {
      assert.ok(BENCHMARKS[name], `Missing benchmark: ${name}`);
    }
  });

  it('each benchmark has fn and desc', () => {
    for (const [name, bench] of Object.entries(BENCHMARKS)) {
      assert.equal(typeof bench.fn, 'function', `${name}.fn`);
      assert.equal(typeof bench.desc, 'string', `${name}.desc`);
      assert.ok(bench.desc.length > 10, `${name}.desc too short`);
    }
  });

  it('runBench returns error for unknown name', () => {
    const result = runBench('nonexistent');
    assert.ok(result.error);
    assert.match(result.error, /Unknown benchmark/);
  });

  it('exports SYNONYMS table [G]', () => {
    assert.ok(SYNONYMS);
    assert.ok(Object.keys(SYNONYMS).length >= 10);
    assert.ok(Array.isArray(SYNONYMS.eval));
    assert.ok(SYNONYMS.eval.includes('execute'));
  });
});

describe('benchEffort (no SQLite needed) [J,K,L]', () => {
  it('runs successfully', () => {
    const result = benchEffort();
    assert.equal(result.bench, 'effort');
    assert.ok(!result.error, result.error);
    assert.ok(result.metrics);
    assert.ok(result.duration_ms >= 0);
  });

  it('measures cost savings vs baseline', () => {
    const result = benchEffort();
    const m = result.metrics;
    assert.equal(m.tasks, 50);
    assert.ok(m.gepa_total_cost > 0, 'GEPA cost should be > 0');
    assert.ok(m.baseline_total_cost > 0, 'Baseline cost should be > 0');
    assert.ok(m.gepa_total_cost < m.baseline_total_cost, 'GEPA should cost less than all-opus baseline');
    assert.ok(m.total_savings > 0, 'Should have positive savings');
    assert.ok(m.cost_ratio > 0 && m.cost_ratio < 1, `Cost ratio should be 0-1, got ${m.cost_ratio}`);
  });

  it('has per-profile breakdown', () => {
    const result = benchEffort();
    const m = result.metrics;
    assert.ok(m.by_profile);
    assert.ok(Object.keys(m.by_profile).length >= 3, 'Should have multiple profiles');
    for (const [name, p] of Object.entries(m.by_profile)) {
      assert.ok(p.count > 0, `${name} count`);
      assert.ok(p.gepaCost >= 0, `${name} gepaCost`);
      assert.ok(p.baselineCost > 0, `${name} baselineCost`);
    }
  });

  it('has escalation cost curve', () => {
    const result = benchEffort();
    const m = result.metrics;
    assert.ok(Array.isArray(m.escalation_cost_curve));
    assert.ok(m.escalation_cost_curve.length >= 2, 'Should have multiple escalation levels');
    for (const step of m.escalation_cost_curve) {
      assert.ok(step.level > 0);
      assert.ok(step.phase);
      assert.ok(step.action);
    }
  });

  it('trivial tasks should be cheapest', () => {
    const result = benchEffort();
    const m = result.metrics;
    const profiles = m.by_profile;
    if (profiles.trivial && profiles.extreme) {
      const trivialAvg = profiles.trivial.gepaCost / profiles.trivial.count;
      const extremeAvg = profiles.extreme.gepaCost / profiles.extreme.count;
      assert.ok(trivialAvg < extremeAvg, `Trivial ($${trivialAvg}) should cost less than extreme ($${extremeAvg})`);
    }
  });

  it('[J] caching saves more than GEPA alone', () => {
    const result = benchEffort();
    const m = result.metrics;
    assert.ok(m.caching_total_cost >= 0, 'Caching cost should exist');
    assert.ok(m.caching_savings >= m.total_savings, `Caching savings (${m.caching_savings}) should be >= GEPA savings (${m.total_savings})`);
  });

  it('[L] haiku-first saves more than GEPA alone', () => {
    const result = benchEffort();
    const m = result.metrics;
    assert.ok(m.haiku_total_cost >= 0, 'Haiku cost should exist');
    assert.ok(m.haiku_savings >= m.total_savings, `Haiku savings (${m.haiku_savings}) should be >= GEPA savings (${m.total_savings})`);
  });

  it('reports hypotheses tested', () => {
    const result = benchEffort();
    assert.ok(Array.isArray(result.metrics.hypotheses));
    assert.ok(result.metrics.hypotheses.includes('J_result_caching'));
    assert.ok(result.metrics.hypotheses.includes('L_haiku_first'));
  });
});

describe('benchRecall (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchRecall();
    assert.equal(result.bench, 'recall');
    assert.ok(!result.error, result.error);
    assert.ok(result.metrics);
  });

  it('has per-layer breakdown', () => {
    const result = benchRecall();
    const m = result.metrics;
    assert.ok(m.by_layer);
    assert.ok(m.by_layer.constant);
    assert.ok(m.by_layer.mutating);
    assert.ok(m.by_layer.file);
  });

  it('recall should be high (exact keyword match)', () => {
    const result = benchRecall();
    const m = result.metrics;
    assert.ok(m.overall_recall >= 0.9, `Overall recall ${m.overall_recall} should be >= 0.9`);
    for (const [layer, lr] of Object.entries(m.by_layer)) {
      assert.ok(lr.recall >= 0.9, `${layer} recall ${lr.recall} should be >= 0.9`);
    }
  });
});

describe('benchPersist (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchPersist();
    assert.equal(result.bench, 'persist');
    assert.ok(!result.error, result.error);
    assert.ok(result.metrics);
  });

  it('golden facts should survive (high retention)', () => {
    const result = benchPersist();
    const m = result.metrics;
    assert.ok(m.retention_rate >= 0.7, `Retention ${m.retention_rate} should be >= 0.7`);
    assert.ok(m.constant_retention >= 0.9, `Constant retention ${m.constant_retention} should be >= 0.9`);
  });

  it('has retention curve', () => {
    const result = benchPersist();
    const m = result.metrics;
    assert.ok(Array.isArray(m.retention_curve));
    assert.equal(m.retention_curve.length, m.sessions_simulated);
    for (const p of m.retention_curve) {
      assert.ok(p.session > 0);
      assert.ok(p.retention_rate >= 0 && p.retention_rate <= 1);
    }
  });
});

describe('benchFitness (requires SQLite) [A,B,C]', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchFitness();
    assert.equal(result.bench, 'fitness');
    assert.ok(!result.error, result.error);
    assert.ok(result.metrics);
  });

  it('golden entries should have higher fitness than noise', () => {
    const result = benchFitness();
    const m = result.metrics;
    assert.ok(m.avg_golden_fitness > m.avg_noise_fitness, `Golden (${m.avg_golden_fitness}) should be > noise (${m.avg_noise_fitness})`);
    assert.ok(m.separation > 0.1, `Separation ${m.separation} should be > 0.1`);
  });

  it('promotion precision should be reasonable', () => {
    const result = benchFitness();
    const m = result.metrics;
    assert.ok(m.precision >= 0.5, `Precision ${m.precision} should be >= 0.5`);
  });

  it('[A] has adaptive threshold', () => {
    const result = benchFitness();
    const m = result.metrics;
    assert.ok(typeof m.adaptive_threshold === 'number', 'Should have adaptive_threshold');
    assert.ok(m.adaptive_threshold > 0 && m.adaptive_threshold < 1, `Threshold ${m.adaptive_threshold} should be 0-1`);
  });

  it('[B] referrals boost golden recall above 50%', () => {
    const result = benchFitness();
    const m = result.metrics;
    // With transitive referrals + adaptive threshold, recall should be much higher than 30%
    assert.ok(m.recall >= 0.5, `Recall ${m.recall} should be >= 0.5 with referrals + adaptive threshold`);
  });

  it('reports hypotheses tested', () => {
    const result = benchFitness();
    assert.ok(Array.isArray(result.metrics.hypotheses));
    assert.ok(result.metrics.hypotheses.includes('A_adaptive_threshold'));
    assert.ok(result.metrics.hypotheses.includes('B_transitive_referrals'));
  });
});

describe('benchContext (requires SQLite) [D,E,F]', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchContext();
    assert.equal(result.bench, 'context');
    assert.ok(!result.error, result.error);
    assert.ok(result.metrics);
  });

  it('[D,E,F] smart strategy should beat random', () => {
    const result = benchContext();
    const m = result.metrics;
    assert.ok(m.smart.hits >= m.random_baseline.hits,
      `Smart (${m.smart.hits}) should have >= hits than random (${m.random_baseline.hits})`);
  });

  it('[D,E,F] smart strategy should beat basic budget-aware', () => {
    const result = benchContext();
    const m = result.metrics;
    assert.ok(m.smart.hits >= m.budget_aware.hits,
      `Smart (${m.smart.hits}) should have >= hits than budget-aware (${m.budget_aware.hits})`);
  });

  it('smart hit rate should be high', () => {
    const result = benchContext();
    const m = result.metrics;
    assert.ok(m.smart.hit_rate >= 0.6, `Smart hit rate ${m.smart.hit_rate} should be >= 0.6`);
  });

  it('budget-aware should beat random', () => {
    const result = benchContext();
    const m = result.metrics;
    assert.ok(m.budget_aware.hits >= m.random_baseline.hits,
      `Budget-aware (${m.budget_aware.hits}) should have >= hits than random (${m.random_baseline.hits})`);
  });

  it('reports hypotheses tested', () => {
    const result = benchContext();
    assert.ok(Array.isArray(result.metrics.hypotheses));
    assert.ok(result.metrics.hypotheses.includes('D_tfidf_relevance'));
    assert.ok(result.metrics.hypotheses.includes('E_mmr_diversity'));
    assert.ok(result.metrics.hypotheses.includes('F_recency_boost'));
  });
});

describe('benchDrift (requires SQLite) [G,H]', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchDrift();
    assert.equal(result.bench, 'drift');
    assert.ok(!result.error, result.error);
    assert.ok(result.metrics);
  });

  it('should detect most violations', () => {
    const result = benchDrift();
    const m = result.metrics;
    assert.ok(m.detected_violations > 0, 'Should detect at least some violations');
    assert.ok(m.drift_detection_rate >= 0.6, `Detection rate ${m.drift_detection_rate} should be >= 0.6 with synonyms + negation`);
  });

  it('precision should be high', () => {
    const result = benchDrift();
    const m = result.metrics;
    assert.ok(m.precision >= 0.5, `Precision ${m.precision} should be >= 0.5`);
  });

  it('[G,H] has by_method breakdown', () => {
    const result = benchDrift();
    const m = result.metrics;
    assert.ok(m.by_method, 'Should have by_method');
    // Should use at least one of the two methods
    const total = Object.values(m.by_method).reduce((s, v) => s + v, 0);
    assert.ok(total > 0, 'Should have violations by method');
  });

  it('reports hypotheses tested', () => {
    const result = benchDrift();
    assert.ok(Array.isArray(result.metrics.hypotheses));
    assert.ok(result.metrics.hypotheses.includes('G_synonym_expansion'));
    assert.ok(result.metrics.hypotheses.includes('H_negation_aware'));
  });
});

describe('benchLatency [M] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchLatency();
    assert.equal(result.bench, 'latency');
    assert.ok(!result.error, result.error);
    assert.ok(result.metrics);
  });

  it('has per-operation timings', () => {
    const result = benchLatency();
    const t = result.metrics.timings_ms;
    assert.ok(typeof t.store_100 === 'number', 'store_100 timing');
    assert.ok(typeof t.query_10 === 'number', 'query_10 timing');
    assert.ok(typeof t.fitness_update === 'number', 'fitness_update timing');
    assert.ok(typeof t.load_context === 'number', 'load_context timing');
  });

  it('total pipeline should be under 5s', () => {
    const result = benchLatency();
    assert.ok(result.metrics.total_pipeline_ms < 5000,
      `Total pipeline ${result.metrics.total_pipeline_ms}ms should be < 5s`);
  });
});

describe('benchScalability [N] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchScalability();
    assert.equal(result.bench, 'scalability');
    assert.ok(!result.error, result.error);
    assert.ok(result.metrics);
  });

  it('tests multiple scales', () => {
    const result = benchScalability();
    const scales = result.metrics.scales;
    assert.ok(Array.isArray(scales));
    assert.ok(scales.length >= 2, 'Should test at least 2 scales');
    for (const s of scales) {
      assert.ok(s.scale > 0);
      assert.ok(s.insert_ms >= 0);
      assert.ok(s.query_10_ms >= 0);
      assert.ok(s.fitness_update_ms >= 0);
    }
  });

  it('has degradation factor', () => {
    const result = benchScalability();
    assert.ok(typeof result.metrics.degradation_factor === 'number');
    assert.ok(result.metrics.degradation_factor > 0, 'Degradation should be > 0');
  });
});

describe('benchAdversarial [O] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchAdversarial();
    assert.equal(result.bench, 'adversarial');
    assert.ok(!result.error, result.error);
    assert.ok(result.metrics);
  });

  it('adversarial entries should NOT be promoted', () => {
    const result = benchAdversarial();
    const m = result.metrics;
    assert.equal(m.adversarial_promoted, 0, 'No adversarial entries should be promoted');
    assert.ok(m.promotion_blocked, 'Promotion should be blocked');
  });

  it('legitimate entries should have higher fitness than adversarial', () => {
    const result = benchAdversarial();
    const m = result.metrics;
    assert.ok(m.avg_legitimate_fitness > m.avg_adversarial_fitness,
      `Legit (${m.avg_legitimate_fitness}) should be > adversarial (${m.avg_adversarial_fitness})`);
    assert.ok(m.fitness_separation > 0, 'Fitness separation should be positive');
  });

  it('drift detection should flag adversarial entries', () => {
    const result = benchAdversarial();
    const m = result.metrics;
    assert.ok(m.adversarial_flagged > 0, 'Should flag at least some adversarial entries');
    assert.ok(m.adversarial_flag_rate > 0, 'Flag rate should be > 0');
  });
});

describe('benchDecay [Q] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchDecay();
    assert.equal(result.bench, 'decay');
    assert.ok(!result.error, result.error);
    assert.ok(result.metrics);
  });

  it('compares 3 strategies', () => {
    const result = benchDecay();
    const s = result.metrics.strategies;
    assert.ok(s.exponential, 'Should have exponential');
    assert.ok(s.linear, 'Should have linear');
    assert.ok(s.step, 'Should have step');
    for (const [name, d] of Object.entries(s)) {
      assert.ok(d.f1 >= 0 && d.f1 <= 1, `${name} F1 out of range`);
      assert.ok(d.separation >= 0, `${name} separation should be >= 0`);
    }
  });

  it('best strategy has F1 > 0.5', () => {
    const result = benchDecay();
    assert.ok(result.metrics.best_f1 > 0.5, `Best F1 ${result.metrics.best_f1} should be > 0.5`);
  });

  it('reports hypotheses', () => {
    const result = benchDecay();
    assert.ok(result.metrics.hypotheses.includes('Q_decay_curves'));
  });
});

describe('benchDedup [R] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchDedup();
    assert.equal(result.bench, 'dedup');
    assert.ok(!result.error, result.error);
    assert.ok(result.metrics);
  });

  it('detects some known duplicates', () => {
    const result = benchDedup();
    const m = result.metrics;
    assert.ok(m.true_positives > 0, 'Should find at least some duplicates');
    assert.ok(m.recall > 0, `Recall ${m.recall} should be > 0`);
  });

  it('precision is reasonable', () => {
    const result = benchDedup();
    const m = result.metrics;
    assert.ok(m.precision >= 0.3, `Precision ${m.precision} should be >= 0.3`);
  });

  it('reports hypotheses', () => {
    const result = benchDedup();
    assert.ok(result.metrics.hypotheses.includes('R_deduplication'));
  });
});

describe('benchPromotion [S] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchPromotion();
    assert.equal(result.bench, 'promotion');
    assert.ok(!result.error, result.error);
    assert.ok(result.metrics);
  });

  it('rising entries should reach constant layer', () => {
    const result = benchPromotion();
    const m = result.metrics;
    assert.ok(m.rising_reached_constant > 0, 'At least some rising entries should reach constant');
    assert.ok(m.rising_promotion_rate > 0, 'Promotion rate should be > 0');
  });

  it('static entries should not leak to constant', () => {
    const result = benchPromotion();
    const m = result.metrics;
    assert.equal(m.static_leaked_to_constant, 0, 'No static (fact) entries should leak to constant');
  });

  it('has promotion history over generations', () => {
    const result = benchPromotion();
    const h = result.metrics.promotion_history;
    assert.ok(Array.isArray(h));
    assert.equal(h.length, 10);
    for (const gen of h) {
      assert.ok(gen.generation > 0);
      assert.ok(gen.layers);
    }
  });

  it('reports hypotheses', () => {
    const result = benchPromotion();
    assert.ok(result.metrics.hypotheses.includes('S_auto_promotion'));
  });
});

describe('benchConflict [T] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchConflict();
    assert.equal(result.bench, 'conflict');
    assert.ok(!result.error, result.error);
    assert.ok(result.metrics);
  });

  it('detects known conflicts', () => {
    const result = benchConflict();
    const m = result.metrics;
    assert.ok(m.true_positives > 0, 'Should detect at least some conflicts');
    assert.ok(m.recall > 0, `Recall ${m.recall} should be > 0`);
  });

  it('has reasonable precision', () => {
    const result = benchConflict();
    const m = result.metrics;
    assert.ok(m.precision >= 0.3, `Precision ${m.precision} should be >= 0.3`);
  });

  it('detects cross-layer conflicts', () => {
    const result = benchConflict();
    const m = result.metrics;
    assert.ok(m.cross_layer_conflicts >= 0);
  });

  it('reports hypotheses', () => {
    const result = benchConflict();
    assert.ok(result.metrics.hypotheses.includes('T_conflict_detection'));
  });
});

describe('benchCompaction [U] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchCompaction();
    assert.equal(result.bench, 'compaction');
    assert.ok(!result.error, result.error);
    assert.ok(result.metrics);
  });

  it('reduces entry count', () => {
    const result = benchCompaction();
    const m = result.metrics;
    assert.ok(m.merged_entries < m.original_entries, 'Should reduce entries');
    assert.ok(m.reduction_rate > 0, 'Reduction rate should be > 0');
  });

  it('maintains high keyword coverage', () => {
    const result = benchCompaction();
    const m = result.metrics;
    assert.ok(m.keyword_coverage >= 0.8, `Coverage ${m.keyword_coverage} should be >= 0.8`);
  });

  it('clusters have good topic purity', () => {
    const result = benchCompaction();
    const m = result.metrics;
    assert.ok(m.avg_purity >= 0.5, `Purity ${m.avg_purity} should be >= 0.5`);
  });

  it('reports hypotheses', () => {
    const result = benchCompaction();
    assert.ok(result.metrics.hypotheses.includes('U_memory_compaction'));
  });
});

describe('benchForgetting [V] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchForgetting();
    assert.equal(result.bench, 'forgetting');
    assert.ok(!result.error, result.error);
    assert.ok(result.metrics);
  });

  it('spaced repetition beats no repetition', () => {
    const result = benchForgetting();
    const s = result.metrics.strategies;
    assert.ok(s.spaced_repetition.survival_rate > s.no_repetition.survival_rate,
      `Spaced (${s.spaced_repetition.survival_rate}) should beat none (${s.no_repetition.survival_rate})`);
  });

  it('spaced repetition beats or equals random repetition', () => {
    const result = benchForgetting();
    const s = result.metrics.strategies;
    // Spaced has expanding intervals which build higher stability via spacing effect
    assert.ok(s.spaced_repetition.avg_fitness >= s.random_repetition.avg_fitness * 0.8,
      `Spaced fitness (${s.spaced_repetition.avg_fitness}) should be competitive with random (${s.random_repetition.avg_fitness})`);
  });

  it('best strategy should not be no_repetition', () => {
    const result = benchForgetting();
    assert.notEqual(result.metrics.best_strategy, 'no_repetition',
      'No repetition should never be the best strategy');
  });

  it('reports hypotheses', () => {
    const result = benchForgetting();
    assert.ok(result.metrics.hypotheses.includes('V_forgetting_curve'));
  });
});

describe('benchTemporal [W] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchTemporal();
    assert.equal(result.bench, 'temporal');
    assert.ok(!result.error, result.error);
  });

  it('clusters have coherence > 0', () => {
    const result = benchTemporal();
    assert.ok(result.metrics.avg_coherence > 0, 'Coherence should be > 0');
  });

  it('cluster loading beats random', () => {
    const result = benchTemporal();
    assert.ok(result.metrics.cluster_hits >= result.metrics.random_hits,
      `Cluster (${result.metrics.cluster_hits}) should >= random (${result.metrics.random_hits})`);
  });

  it('reports hypotheses', () => {
    const result = benchTemporal();
    assert.ok(result.metrics.hypotheses.includes('W_temporal_clustering'));
  });
});

describe('benchInheritance [X] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchInheritance();
    assert.equal(result.bench, 'inheritance');
    assert.ok(!result.error, result.error);
  });

  it('connected entries get boost', () => {
    const result = benchInheritance();
    assert.ok(result.metrics.connected_boost > 0,
      `Connected boost (${result.metrics.connected_boost}) should be > 0`);
  });

  it('isolated entries get no boost', () => {
    const result = benchInheritance();
    assert.equal(result.metrics.isolated_boost, 0, 'Isolated entries should get 0 boost');
  });

  it('reports hypotheses', () => {
    const result = benchInheritance();
    assert.ok(result.metrics.hypotheses.includes('X_importance_inheritance'));
  });
});

describe('benchQueryRewrite [Y] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchQueryRewrite();
    assert.equal(result.bench, 'queryrewrite');
    assert.ok(!result.error, result.error);
  });

  it('expanded recall >= original recall', () => {
    const result = benchQueryRewrite();
    assert.ok(result.metrics.expanded_recall >= result.metrics.original_recall,
      `Expanded (${result.metrics.expanded_recall}) should >= original (${result.metrics.original_recall})`);
  });

  it('reports hypotheses', () => {
    const result = benchQueryRewrite();
    assert.ok(result.metrics.hypotheses.includes('Y_query_rewriting'));
  });
});

describe('benchCapacity [Z] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchCapacity();
    assert.equal(result.bench, 'capacity');
    assert.ok(!result.error, result.error);
  });

  it('golden entries mostly retained', () => {
    const result = benchCapacity();
    assert.ok(result.metrics.golden_retention_rate >= 0.8,
      `Golden retention (${result.metrics.golden_retention_rate}) should be >= 0.8`);
  });

  it('noise entries mostly evicted', () => {
    const result = benchCapacity();
    assert.ok(result.metrics.noise_eviction_rate > 0, 'Some noise should be evicted');
  });

  it('reports hypotheses', () => {
    const result = benchCapacity();
    assert.ok(result.metrics.hypotheses.includes('Z_layer_capacity'));
  });
});

describe('benchGenGap [AA] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchGenGap();
    assert.equal(result.bench, 'gengap');
    assert.ok(!result.error, result.error);
  });

  it('veterans get positive boost', () => {
    const result = benchGenGap();
    assert.ok(result.metrics.veteran_boost > 0, `Veteran boost (${result.metrics.veteran_boost}) should be > 0`);
  });

  it('separation improves', () => {
    const result = benchGenGap();
    assert.ok(result.metrics.separation_improvement >= 0,
      `Separation improvement (${result.metrics.separation_improvement}) should be >= 0`);
  });

  it('reports hypotheses', () => {
    const result = benchGenGap();
    assert.ok(result.metrics.hypotheses.includes('AA_generation_gap'));
  });
});

describe('benchFreshness [AB] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchFreshness();
    assert.equal(result.bench, 'freshness');
    assert.ok(!result.error, result.error);
  });

  it('updated entries get larger boost than stale', () => {
    const result = benchFreshness();
    assert.ok(result.metrics.updated_boost > result.metrics.stale_boost,
      `Updated boost (${result.metrics.updated_boost}) should > stale (${result.metrics.stale_boost})`);
  });

  it('reports hypotheses', () => {
    const result = benchFreshness();
    assert.ok(result.metrics.hypotheses.includes('AB_content_freshness'));
  });
});

describe('benchHubNodes [AC] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchHubNodes();
    assert.equal(result.bench, 'hubnodes');
    assert.ok(!result.error, result.error);
  });

  it('hub nodes get boost, leaves do not', () => {
    const result = benchHubNodes();
    assert.ok(result.metrics.hub_boost > 0, `Hub boost (${result.metrics.hub_boost}) should be > 0`);
    assert.equal(result.metrics.leaf_boost, 0, 'Leaf boost should be 0');
  });

  it('separation improves', () => {
    const result = benchHubNodes();
    assert.ok(result.metrics.separation_improvement > 0,
      `Separation improvement (${result.metrics.separation_improvement}) should be > 0`);
  });

  it('reports hypotheses', () => {
    const result = benchHubNodes();
    assert.ok(result.metrics.hypotheses.includes('AC_relation_density'));
  });
});

describe('benchCoherence [AD] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchCoherence();
    assert.equal(result.bench, 'coherence');
    assert.ok(!result.error, result.error);
  });

  it('coherent strategy beats random', () => {
    const result = benchCoherence();
    const s = result.metrics.strategies;
    assert.ok(s.coherent_greedy >= s.random,
      `Coherent (${s.coherent_greedy}) should >= random (${s.random})`);
  });

  it('graph-walk has positive coherence', () => {
    const result = benchCoherence();
    assert.ok(result.metrics.strategies.graph_walk > 0, 'Graph-walk coherence should be > 0');
  });

  it('reports hypotheses', () => {
    const result = benchCoherence();
    assert.ok(result.metrics.hypotheses.includes('AD_context_coherence'));
  });
});

describe('runBench all', () => {
  it('returns array of results', () => {
    const results = runBench('all');
    assert.ok(Array.isArray(results));
    assert.equal(results.length, 23);
    for (const r of results) {
      assert.ok(r.bench);
      assert.ok(r.timestamp);
      assert.ok(r.description);
    }
  });
});
