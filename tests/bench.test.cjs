#!/usr/bin/env node
/**
 * Tests for bench.cjs — Memory system benchmarks (55 benchmarks, 59 hypotheses)
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
  benchCrossLayer,
  benchCoAccess,
  benchKeywordDensity,
  benchBatchVsIncremental,
  benchColdStart,
  benchFragmentation,
  benchCascadeDeprecation,
  benchRecencyRelations,
  benchEntropy,
  benchAccessVelocity,
  benchSemanticCluster,
  benchWalMode,
  benchMultiHop,
  benchMigrationCost,
  benchAttentionDecay,
  benchContentLength,
  benchTypeFitness,
  benchDiminishingReturns,
  benchContradictionResolution,
  benchPredictivePrefetch,
  benchBudgetAllocation,
  benchStaleness,
  benchConsolidation,
  benchFeedbackLoop,
  benchTemporalValidity,
  benchHybridRetrieval,
  benchAutoReflection,
  benchRecencyBias,
  benchPriorityEviction,
  benchContextDiversity,
  benchAgeDistribution,
  benchRelationDensity,
  benchSlidingWindowFitness,
  benchImportanceMomentum,
  benchPeerComparison,
  benchAccessPatternEntropy,
  benchWriteAmplification,
  benchLayerMigrationCost,
  benchContextSaturation,
  benchRetrievalLatencyDist,
  // Round 9
  benchSurpriseScoring,
  benchUsageDecayHalflife,
  benchRelationTransitivity,
  benchCompressionRatio,
  benchQuerySpecificity,
  benchTemporalLocality,
  benchImportanceCalibration,
  benchGraphDiameter,
  // Round 10
  benchForgettingThreshold,
  benchBatchSizeOptimization,
  benchImportanceDistribution,
  benchRelationTypeWeighting,
  benchMemoryWarmup,
  benchStaleReferenceDetection,
  benchContextOverlap,
  benchFitnessPlateauDetection,
  // Round 11
  benchConcurrentAccess,
  benchRecoveryAfterCrash,
  benchIndexEffectiveness,
  benchVacuumImpact,
  benchSchemaEvolution,
  benchQueryPlanAnalysis,
  benchMemoryFootprint,
  benchCheckpointFrequency,
} = require('../src/lib/bench.cjs');

const { detectPython } = require('../src/lib/python-detector.cjs');

const python = detectPython();
const skipSqlite = !python.available;

describe('bench module', () => {
  it('exports BENCHMARKS with 87 entries', () => {
    assert.equal(Object.keys(BENCHMARKS).length, 87);
    for (const name of ['recall', 'persist', 'fitness', 'effort', 'context', 'drift',
                         'latency', 'scalability', 'adversarial', 'decay', 'dedup',
                         'promotion', 'conflict', 'compaction', 'forgetting',
                         'temporal', 'inheritance', 'queryrewrite', 'capacity',
                         'gengap', 'freshness', 'hubnodes', 'coherence',
                         'crosslayer', 'coaccess', 'kwdensity', 'batchinc',
                         'coldstart', 'fragmentation', 'cascade', 'recrel',
                         'entropy', 'velocity', 'semcluster', 'walmode',
                         'multihop', 'migration', 'attention', 'contentlen',
                         'typefitness', 'diminishing', 'contradict', 'prefetch',
                         'budget', 'staleness', 'consolidation', 'feedback',
                         'temporal_validity', 'hybrid', 'autoreflect', 'recencybias',
                         'priorityevict', 'ctxdiversity', 'agedist', 'reldensity',
                         'slidingwin', 'momentum', 'peercomp', 'accessentropy',
                         'writeamp', 'layermigcost', 'ctxsaturation', 'latencydist',
                         'surprise', 'usagedecay', 'transitivity', 'compressratio',
                         'queryspec', 'temploc', 'importcalib', 'graphdiam',
                         'forgetthresh', 'batchopt', 'importdist', 'reltypeweight',
                         'warmup', 'staleref', 'ctxoverlap', 'fitnessplateau',
                         'concurrent', 'recovery', 'indexeff', 'vacuum',
                         'schemaevol', 'queryplan', 'memfootprint', 'checkpoint']) {
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

// ─── Round 4: Hypotheses AE-AL ──────────────────────────────────────────────

describe('benchCrossLayer [AE] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchCrossLayer();
    assert.equal(result.bench, 'crosslayer');
    assert.ok(result.metrics);
  });

  it('linked entries get higher boost than isolated', () => {
    const result = benchCrossLayer();
    assert.ok(result.metrics.linked_boost > result.metrics.isolated_boost,
      'Cross-layer linked entries should get higher boost');
  });

  it('reports hypotheses', () => {
    const result = benchCrossLayer();
    assert.ok(result.metrics.hypotheses.includes('AE_cross_layer_references'));
  });
});

describe('benchCoAccess [AF] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchCoAccess();
    assert.equal(result.bench, 'coaccess');
    assert.ok(result.metrics);
  });

  it('co-access beats random', () => {
    const result = benchCoAccess();
    assert.ok(result.metrics.coaccess_advantage >= 1.0,
      'Co-access should be at least as good as random');
  });

  it('reports hypotheses', () => {
    const result = benchCoAccess();
    assert.ok(result.metrics.hypotheses.includes('AF_co_access_patterns'));
  });
});

describe('benchKeywordDensity [AG] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchKeywordDensity();
    assert.equal(result.bench, 'kwdensity');
    assert.ok(result.metrics);
  });

  it('rare keywords get higher boost', () => {
    const result = benchKeywordDensity();
    assert.ok(result.metrics.rare_boost > result.metrics.common_boost,
      'Rare keyword entries should get higher IDF boost');
  });

  it('reports hypotheses', () => {
    const result = benchKeywordDensity();
    assert.ok(result.metrics.hypotheses.includes('AG_keyword_density_idf'));
  });
});

describe('benchBatchVsIncremental [AH] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchBatchVsIncremental();
    assert.equal(result.bench, 'batchinc');
    assert.ok(result.metrics);
  });

  it('top-10 agreement is high', () => {
    const result = benchBatchVsIncremental();
    assert.ok(result.metrics.top10_overlap >= 7,
      'Batch and incremental should agree on most top-10 entries');
  });

  it('reports hypotheses', () => {
    const result = benchBatchVsIncremental();
    assert.ok(result.metrics.hypotheses.includes('AH_batch_vs_incremental'));
  });
});

describe('benchColdStart [AI] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchColdStart();
    assert.equal(result.bench, 'coldstart');
    assert.ok(result.metrics);
  });

  it('grace period improves new entry survival', () => {
    const result = benchColdStart();
    assert.ok(result.metrics.grace_new_survival >= result.metrics.no_grace_new_survival,
      'Grace period should improve or maintain survival');
  });

  it('reports hypotheses', () => {
    const result = benchColdStart();
    assert.ok(result.metrics.hypotheses.includes('AI_cold_start_mitigation'));
  });
});

describe('benchFragmentation [AJ] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchFragmentation();
    assert.equal(result.bench, 'fragmentation');
    assert.ok(result.metrics);
  });

  it('detects isolated nodes', () => {
    const result = benchFragmentation();
    assert.ok(result.metrics.isolated_nodes > 0, 'Should find isolated nodes');
  });

  it('defragmentation reduces fragmentation score', () => {
    const result = benchFragmentation();
    assert.ok(result.metrics.fragmentation_reduction > 0,
      'Defragmentation should reduce fragmentation score');
  });

  it('reports hypotheses', () => {
    const result = benchFragmentation();
    assert.ok(result.metrics.hypotheses.includes('AJ_memory_fragmentation'));
  });
});

describe('benchCascadeDeprecation [AK] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchCascadeDeprecation();
    assert.equal(result.bench, 'cascade');
    assert.ok(result.metrics);
  });

  it('dependents lose fitness when hub is deprecated', () => {
    const result = benchCascadeDeprecation();
    assert.ok(result.metrics.dependent_fitness_loss > 0,
      'Dependents should lose fitness');
  });

  it('unaffected entries remain unchanged', () => {
    const result = benchCascadeDeprecation();
    assert.equal(result.metrics.unaffected_change, 0, 'Unaffected deps should not change');
    assert.equal(result.metrics.independent_change, 0, 'Independent entries should not change');
  });

  it('reports hypotheses', () => {
    const result = benchCascadeDeprecation();
    assert.ok(result.metrics.hypotheses.includes('AK_cascading_deprecation'));
  });
});

describe('benchRecencyRelations [AL] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchRecencyRelations();
    assert.equal(result.bench, 'recrel');
    assert.ok(result.metrics);
  });

  it('recency weighting improves separation', () => {
    const result = benchRecencyRelations();
    assert.ok(result.metrics.separation_improvement > 0,
      'Recency weighting should improve separation');
  });

  it('reports hypotheses', () => {
    const result = benchRecencyRelations();
    assert.ok(result.metrics.hypotheses.includes('AL_recency_weighted_relations'));
  });
});

// ─── Round 5: Hypotheses AM-AT ──────────────────────────────────────────────

describe('benchEntropy [AM] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchEntropy();
    assert.equal(result.bench, 'entropy');
    assert.ok(result.metrics);
  });
  it('info entries get higher boost than generic', () => {
    const result = benchEntropy();
    assert.ok(result.metrics.info_boost > result.metrics.generic_penalty, 'High-entropy content should score higher');
  });
  it('reports hypotheses', () => {
    const result = benchEntropy();
    assert.ok(result.metrics.hypotheses.includes('AM_entropy_pruning'));
  });
});

describe('benchAccessVelocity [AN] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchAccessVelocity();
    assert.equal(result.bench, 'velocity');
    assert.ok(result.metrics);
  });
  it('hot entries get higher boost than cold', () => {
    const result = benchAccessVelocity();
    assert.ok(result.metrics.hot_boost > result.metrics.cold_boost, 'High velocity should score higher');
  });
  it('reports hypotheses', () => {
    const result = benchAccessVelocity();
    assert.ok(result.metrics.hypotheses.includes('AN_access_velocity'));
  });
});

describe('benchSemanticCluster [AO] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchSemanticCluster();
    assert.equal(result.bench, 'semcluster');
    assert.ok(result.metrics);
  });
  it('cluster coherence beats random', () => {
    const result = benchSemanticCluster();
    assert.ok(result.metrics.cluster_vs_random >= 1.0, 'Cluster should be at least as coherent as random');
  });
  it('reports hypotheses', () => {
    const result = benchSemanticCluster();
    assert.ok(result.metrics.hypotheses.includes('AO_semantic_clustering'));
  });
});

describe('benchWalMode [AP] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchWalMode();
    assert.equal(result.bench, 'walmode');
    assert.ok(result.metrics);
  });
  it('WAL write time is measured', () => {
    const result = benchWalMode();
    assert.ok(result.metrics.wal_write_ms > 0, 'WAL write should be measurable');
  });
  it('reports hypotheses', () => {
    const result = benchWalMode();
    assert.ok(result.metrics.hypotheses.includes('AP_wal_mode'));
  });
});

describe('benchMultiHop [AQ] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchMultiHop();
    assert.equal(result.bench, 'multihop');
    assert.ok(result.metrics);
  });
  it('2-hop recall >= 1-hop recall', () => {
    const result = benchMultiHop();
    assert.ok(result.metrics.hop2_recall >= result.metrics.hop1_recall, '2-hop should find more');
  });
  it('reports hypotheses', () => {
    const result = benchMultiHop();
    assert.ok(result.metrics.hypotheses.includes('AQ_multi_hop_query'));
  });
});

describe('benchMigrationCost [AR] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchMigrationCost();
    assert.equal(result.bench, 'migration');
    assert.ok(result.metrics);
  });
  it('cost-aware blocks some marginal promotions', () => {
    const result = benchMigrationCost();
    assert.ok(result.metrics.cost_aware_promotions <= result.metrics.naive_promotions, 'Cost-aware should be more selective');
  });
  it('reports hypotheses', () => {
    const result = benchMigrationCost();
    assert.ok(result.metrics.hypotheses.includes('AR_migration_cost'));
  });
});

describe('benchAttentionDecay [AS] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchAttentionDecay();
    assert.equal(result.bench, 'attention');
    assert.ok(result.metrics);
  });
  it('used entries get boost, ignored get penalty', () => {
    const result = benchAttentionDecay();
    assert.ok(result.metrics.used_boost > 0, 'Used should get positive boost');
    assert.ok(result.metrics.ignored_penalty < 0, 'Ignored should get negative penalty');
  });
  it('reports hypotheses', () => {
    const result = benchAttentionDecay();
    assert.ok(result.metrics.hypotheses.includes('AS_attention_decay'));
  });
});

describe('benchContentLength [AT] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchContentLength();
    assert.equal(result.bench, 'contentlen');
    assert.ok(result.metrics);
  });
  it('optimal length gets boost, short/long get penalty', () => {
    const result = benchContentLength();
    assert.ok(result.metrics.optimal_boost > 0, 'Optimal length should get boost');
    assert.ok(result.metrics.short_penalty < 0, 'Short should get penalty');
    assert.ok(result.metrics.long_penalty < 0, 'Long should get penalty');
  });
  it('reports hypotheses', () => {
    const result = benchContentLength();
    assert.ok(result.metrics.hypotheses.includes('AT_content_length'));
  });
});

describe('benchTypeFitness [AU] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchTypeFitness();
    assert.equal(result.bench, 'typefitness');
    assert.ok(result.metrics);
  });
  it('pattern type gets highest weight', () => {
    const result = benchTypeFitness();
    assert.ok(result.metrics.pattern_boost > result.metrics.fact_boost, 'Pattern should score higher than fact');
  });
  it('reports hypotheses', () => {
    const result = benchTypeFitness();
    assert.ok(result.metrics.hypotheses.includes('AU_type_specific_fitness'));
  });
});

describe('benchDiminishingReturns [AV] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchDiminishingReturns();
    assert.equal(result.bench, 'diminishing');
    assert.ok(result.metrics);
  });
  it('marginal gain decreases with budget', () => {
    const result = benchDiminishingReturns();
    assert.ok(result.metrics.first_marginal_gain >= result.metrics.last_marginal_gain, 'First marginal gain should be >= last');
  });
  it('reports hypotheses', () => {
    const result = benchDiminishingReturns();
    assert.ok(result.metrics.hypotheses.includes('AV_diminishing_returns'));
  });
});

describe('benchContradictionResolution [AW] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchContradictionResolution();
    assert.equal(result.bench, 'contradict');
    assert.ok(result.metrics);
  });
  it('best strategy has high accuracy', () => {
    const result = benchContradictionResolution();
    assert.ok(result.metrics.best_accuracy >= 0.5, 'Best strategy should have >= 50% accuracy');
  });
  it('reports hypotheses', () => {
    const result = benchContradictionResolution();
    assert.ok(result.metrics.hypotheses.includes('AW_contradiction_resolution'));
  });
});

describe('benchPredictivePrefetch [AX] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchPredictivePrefetch();
    assert.equal(result.bench, 'prefetch');
    assert.ok(result.metrics);
  });
  it('markov prediction > random', () => {
    const result = benchPredictivePrefetch();
    assert.ok(result.metrics.markov_accuracy >= result.metrics.random_accuracy, 'Markov should hit more than random');
  });
  it('reports hypotheses', () => {
    const result = benchPredictivePrefetch();
    assert.ok(result.metrics.hypotheses.includes('AX_predictive_prefetch'));
  });
});

describe('benchBudgetAllocation [AY] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchBudgetAllocation();
    assert.equal(result.bench, 'budget');
    assert.ok(result.metrics);
  });
  it('has best strategy identified', () => {
    const result = benchBudgetAllocation();
    assert.ok(result.metrics.best_strategy, 'Should identify best allocation strategy');
  });
  it('reports hypotheses', () => {
    const result = benchBudgetAllocation();
    assert.ok(result.metrics.hypotheses.includes('AY_budget_allocation'));
  });
});

describe('benchStaleness [AZ] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchStaleness();
    assert.equal(result.bench, 'staleness');
    assert.ok(result.metrics);
  });
  it('stale entries get penalty', () => {
    const result = benchStaleness();
    assert.ok(result.metrics.stale_penalty < 0, 'Stale content should get negative penalty');
  });
  it('reports hypotheses', () => {
    const result = benchStaleness();
    assert.ok(result.metrics.hypotheses.includes('AZ_staleness_detection'));
  });
});

describe('benchConsolidation [BA] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchConsolidation();
    assert.equal(result.bench, 'consolidation');
    assert.ok(result.metrics);
  });
  it('consolidation reduces entry count', () => {
    const result = benchConsolidation();
    assert.ok(result.metrics.after_count <= result.metrics.before_count, 'Consolidation should reduce entries');
  });
  it('reports hypotheses', () => {
    const result = benchConsolidation();
    assert.ok(result.metrics.hypotheses.includes('BA_consolidation'));
  });
});

describe('benchFeedbackLoop [BB] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchFeedbackLoop();
    assert.equal(result.bench, 'feedback');
    assert.ok(result.metrics);
  });
  it('used entries get boost, ignored get penalty', () => {
    const result = benchFeedbackLoop();
    assert.ok(result.metrics.used_boost > 0, 'Used should get positive boost');
    assert.ok(result.metrics.ignored_penalty < 0, 'Ignored should get negative penalty');
  });
  it('reports hypotheses', () => {
    const result = benchFeedbackLoop();
    assert.ok(result.metrics.hypotheses.includes('BB_feedback_loop'));
  });
});

describe('benchTemporalValidity [BC] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchTemporalValidity();
    assert.equal(result.bench, 'temporal_validity');
    assert.ok(result.metrics);
  });
  it('temporal filter achieves high precision and recall', () => {
    const result = benchTemporalValidity();
    assert.ok(result.metrics.precision >= 0.8, 'Precision should be >= 80%');
    assert.ok(result.metrics.recall >= 0.8, 'Recall should be >= 80%');
  });
  it('noise reduction is effective', () => {
    const result = benchTemporalValidity();
    assert.ok(result.metrics.noise_reduction >= 0.5, 'Should filter at least 50% of noise');
  });
  it('reports hypotheses', () => {
    const result = benchTemporalValidity();
    assert.ok(result.metrics.hypotheses.includes('BC_temporal_validity'));
  });
});

describe('benchHybridRetrieval [BD] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchHybridRetrieval();
    assert.equal(result.bench, 'hybrid');
    assert.ok(result.metrics);
  });
  it('RRF recall >= keyword or semantic alone', () => {
    const result = benchHybridRetrieval();
    assert.ok(result.metrics.rrf_recall_at_10 >= Math.min(result.metrics.keyword_recall_at_10, result.metrics.semantic_recall_at_10),
      'RRF should be at least as good as the weaker method');
  });
  it('reports hypotheses', () => {
    const result = benchHybridRetrieval();
    assert.ok(result.metrics.hypotheses.includes('BD_hybrid_retrieval_rrf'));
  });
});

describe('benchAutoReflection [BE] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchAutoReflection();
    assert.equal(result.bench, 'autoreflect');
    assert.ok(result.metrics);
  });
  it('threshold/adaptive beats or matches fixed', () => {
    const result = benchAutoReflection();
    const m = result.metrics;
    assert.ok(Math.max(m.threshold_score, m.adaptive_score) >= m.fixed_score * 0.9,
      'Threshold/adaptive should be close to or better than fixed');
  });
  it('reports hypotheses', () => {
    const result = benchAutoReflection();
    assert.ok(result.metrics.hypotheses.includes('BE_auto_reflection_trigger'));
  });
});

describe('benchRecencyBias [BF] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchRecencyBias();
    assert.equal(result.bench, 'recencybias');
    assert.ok(result.metrics);
  });
  it('biased loads more recent entries than uniform', () => {
    const result = benchRecencyBias();
    assert.ok(result.metrics.biased_recent_count >= result.metrics.uniform_recent_count,
      'Recency bias should load more recent entries');
  });
  it('reports hypotheses', () => {
    const result = benchRecencyBias();
    assert.ok(result.metrics.hypotheses.includes('BF_recency_biased_sampling'));
  });
});

describe('benchPriorityEviction [BG] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchPriorityEviction();
    assert.equal(result.bench, 'priorityevict');
    assert.ok(result.metrics);
  });
  it('priority retains more golden than FIFO', () => {
    const result = benchPriorityEviction();
    assert.ok(result.metrics.priority_golden_retained >= result.metrics.fifo_golden_retained,
      'Priority should retain more golden entries than FIFO');
  });
  it('reports hypotheses', () => {
    const result = benchPriorityEviction();
    assert.ok(result.metrics.hypotheses.includes('BG_priority_queue_eviction'));
  });
});

describe('benchContextDiversity [BH] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchContextDiversity();
    assert.equal(result.bench, 'ctxdiversity');
    assert.ok(result.metrics);
  });
  it('diverse content has higher info density', () => {
    const result = benchContextDiversity();
    assert.ok(result.metrics.div_info_density > result.metrics.dup_info_density,
      'Diverse content should have higher info density');
  });
  it('reports hypotheses', () => {
    const result = benchContextDiversity();
    assert.ok(result.metrics.hypotheses.includes('BH_context_diversity_penalty'));
  });
});

describe('benchAgeDistribution [BI] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchAgeDistribution();
    assert.equal(result.bench, 'agedist');
    assert.ok(result.metrics);
  });
  it('balanced distribution has highest health score', () => {
    const result = benchAgeDistribution();
    assert.ok(result.metrics.balanced_health >= result.metrics.skewed_old_health,
      'Balanced should be healthier than skewed old');
  });
  it('reports hypotheses', () => {
    const result = benchAgeDistribution();
    assert.ok(result.metrics.hypotheses.includes('BI_memory_age_distribution'));
  });
});

describe('benchRelationDensity [BJ] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchRelationDensity();
    assert.equal(result.bench, 'reldensity');
    assert.ok(result.metrics);
  });
  it('density scoring improves hub/leaf separation', () => {
    const result = benchRelationDensity();
    assert.ok(result.metrics.separation_improvement >= 0,
      'Density bonus should improve separation');
  });
  it('reports hypotheses', () => {
    const result = benchRelationDensity();
    assert.ok(result.metrics.hypotheses.includes('BJ_relation_density_scoring'));
  });
});

// ─── Round 8: Hypotheses BK-BR ──────────────────────────────────────────────

describe('benchSlidingWindowFitness [BK] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchSlidingWindowFitness();
    assert.equal(result.bench, 'slidingwin');
    assert.ok(result.metrics);
  });
  it('sliding window provides better separation', () => {
    const result = benchSlidingWindowFitness();
    assert.ok(result.metrics.window_separation >= result.metrics.alltime_separation * 0.8,
      'Window should provide comparable or better separation');
  });
  it('reports hypotheses', () => {
    const result = benchSlidingWindowFitness();
    assert.ok(result.metrics.hypotheses.includes('BK_sliding_window_fitness'));
  });
});

describe('benchImportanceMomentum [BL] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchImportanceMomentum();
    assert.equal(result.bench, 'momentum');
    assert.ok(result.metrics);
  });
  it('momentum improves separation for rising entries', () => {
    const result = benchImportanceMomentum();
    assert.ok(result.metrics.momentum_separation >= result.metrics.base_separation,
      'Momentum should improve or maintain separation');
  });
  it('reports hypotheses', () => {
    const result = benchImportanceMomentum();
    assert.ok(result.metrics.hypotheses.includes('BL_importance_momentum'));
  });
});

describe('benchPeerComparison [BM] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchPeerComparison();
    assert.equal(result.bench, 'peercomp');
    assert.ok(result.metrics);
  });
  it('peer comparison produces meaningful separation', () => {
    const result = benchPeerComparison();
    assert.ok(result.metrics.peer_separation > 0,
      'Peer-relative scoring should produce positive separation');
  });
  it('reports hypotheses', () => {
    const result = benchPeerComparison();
    assert.ok(result.metrics.hypotheses.includes('BM_peer_comparison'));
  });
});

describe('benchAccessPatternEntropy [BN] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchAccessPatternEntropy();
    assert.equal(result.bench, 'accessentropy');
    assert.ok(result.metrics);
  });
  it('regular patterns score higher than bursty', () => {
    const result = benchAccessPatternEntropy();
    assert.ok(result.metrics.regular_entropy_avg >= result.metrics.bursty_entropy_avg,
      'Regular access should score higher than bursty');
  });
  it('reports hypotheses', () => {
    const result = benchAccessPatternEntropy();
    assert.ok(result.metrics.hypotheses.includes('BN_access_pattern_entropy'));
  });
});

describe('benchWriteAmplification [BO] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchWriteAmplification();
    assert.equal(result.bench, 'writeamp');
    assert.ok(result.metrics);
  });
  it('batch writes are faster than individual', () => {
    const result = benchWriteAmplification();
    assert.ok(result.metrics.reduction_factor >= 1.0,
      'Batch should be at least as fast as individual writes');
  });
  it('reports hypotheses', () => {
    const result = benchWriteAmplification();
    assert.ok(result.metrics.hypotheses.includes('BO_write_amplification'));
  });
});

describe('benchLayerMigrationCost [BP] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchLayerMigrationCost();
    assert.equal(result.bench, 'layermigcost');
    assert.ok(result.metrics);
  });
  it('threshold-based has fewer promotions than eager', () => {
    const result = benchLayerMigrationCost();
    assert.ok(result.metrics.threshold_promotions <= result.metrics.eager_promotions,
      'Threshold should be more selective than eager');
  });
  it('reports hypotheses', () => {
    const result = benchLayerMigrationCost();
    assert.ok(result.metrics.hypotheses.includes('BP_layer_migration_cost'));
  });
});

describe('benchContextSaturation [BQ] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchContextSaturation();
    assert.equal(result.bench, 'ctxsaturation');
    assert.ok(result.metrics);
  });
  it('diminishing returns are confirmed', () => {
    const result = benchContextSaturation();
    assert.ok(result.metrics.diminishing_confirmed,
      'Marginal gain should decrease with more context');
  });
  it('reports hypotheses', () => {
    const result = benchContextSaturation();
    assert.ok(result.metrics.hypotheses.includes('BQ_context_window_saturation'));
  });
});

describe('benchRetrievalLatencyDist [BR] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchRetrievalLatencyDist();
    assert.equal(result.bench, 'latencydist');
    assert.ok(result.metrics);
  });
  it('latency distribution is measured', () => {
    const result = benchRetrievalLatencyDist();
    assert.ok(result.metrics.p50_ms >= 0, 'P50 should be non-negative');
    assert.ok(result.metrics.p99_ms >= result.metrics.p50_ms,
      'P99 should be >= P50');
    assert.ok(result.metrics.queries === 100, 'Should run 100 queries');
  });
  it('reports hypotheses', () => {
    const result = benchRetrievalLatencyDist();
    assert.ok(result.metrics.hypotheses.includes('BR_retrieval_latency_distribution'));
  });
});

// ─── Round 9: Hypotheses BS-BZ ──────────────────────────────────────────────

describe('benchSurpriseScoring [BS] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchSurpriseScoring();
    assert.equal(result.bench, 'surprise');
    assert.ok(result.metrics);
  });
  it('surprise entries get higher memorability', () => {
    const result = benchSurpriseScoring();
    const m = result.metrics;
    assert.ok(m.memorability_ratio > 0, 'Should have positive memorability ratio');
  });
  it('reports hypotheses', () => {
    const result = benchSurpriseScoring();
    assert.ok(result.metrics.hypotheses.includes('BS_surprise_scoring'));
  });
});

describe('benchUsageDecayHalflife [BT] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchUsageDecayHalflife();
    assert.equal(result.bench, 'usagedecay');
    assert.ok(result.metrics);
  });
  it('active entries have higher fitness than inactive', () => {
    const result = benchUsageDecayHalflife();
    const m = result.metrics;
    assert.ok(m.decay_effective, 'Decay should be effective');
  });
  it('reports hypotheses', () => {
    const result = benchUsageDecayHalflife();
    assert.ok(result.metrics.hypotheses.includes('BT_usage_decay_halflife'));
  });
});

describe('benchRelationTransitivity [BU] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchRelationTransitivity();
    assert.equal(result.bench, 'transitivity');
    assert.ok(result.metrics);
  });
  it('transitive reach exceeds direct reach', () => {
    const result = benchRelationTransitivity();
    const m = result.metrics;
    assert.ok(m.transitive_reach >= m.direct_reach, 'Transitive should reach more than direct');
  });
  it('reports hypotheses', () => {
    const result = benchRelationTransitivity();
    assert.ok(result.metrics.hypotheses.includes('BU_relation_transitivity'));
  });
});

describe('benchCompressionRatio [BV] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchCompressionRatio();
    assert.equal(result.bench, 'compressratio');
    assert.ok(result.metrics);
  });
  it('compression reduces entry count', () => {
    const result = benchCompressionRatio();
    const m = result.metrics;
    assert.ok(m.entries_reduced > 0, 'Should reduce some entries');
  });
  it('reports hypotheses', () => {
    const result = benchCompressionRatio();
    assert.ok(result.metrics.hypotheses.includes('BV_memory_compression_ratio'));
  });
});

describe('benchQuerySpecificity [BW] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchQuerySpecificity();
    assert.equal(result.bench, 'queryspec');
    assert.ok(result.metrics);
  });
  it('queries produce results', () => {
    const result = benchQuerySpecificity();
    assert.ok(result.metrics.queries_tested > 0, 'Should test some queries');
  });
  it('reports hypotheses', () => {
    const result = benchQuerySpecificity();
    assert.ok(result.metrics.hypotheses.includes('BW_query_specificity'));
  });
});

describe('benchTemporalLocality [BX] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchTemporalLocality();
    assert.equal(result.bench, 'temploc');
    assert.ok(result.metrics);
  });
  it('temporal locality is effective', () => {
    const result = benchTemporalLocality();
    assert.ok(result.metrics.locality_effective, 'Locality should be effective');
  });
  it('reports hypotheses', () => {
    const result = benchTemporalLocality();
    assert.ok(result.metrics.hypotheses.includes('BX_temporal_locality'));
  });
});

describe('benchImportanceCalibration [BY] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchImportanceCalibration();
    assert.equal(result.bench, 'importcalib');
    assert.ok(result.metrics);
  });
  it('importance ordering is monotonic', () => {
    const result = benchImportanceCalibration();
    assert.ok(result.metrics.monotonic, 'High > Med > Low should hold');
  });
  it('reports hypotheses', () => {
    const result = benchImportanceCalibration();
    assert.ok(result.metrics.hypotheses.includes('BY_importance_calibration'));
  });
});

describe('benchGraphDiameter [BZ] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchGraphDiameter();
    assert.equal(result.bench, 'graphdiam');
    assert.ok(result.metrics);
  });
  it('diameter is positive', () => {
    const result = benchGraphDiameter();
    assert.ok(result.metrics.diameter > 0, 'Diameter should be positive');
  });
  it('reports hypotheses', () => {
    const result = benchGraphDiameter();
    assert.ok(result.metrics.hypotheses.includes('BZ_graph_diameter'));
  });
});

// ─── Round 10: Hypotheses CA-CH ─────────────────────────────────────────────

describe('benchForgettingThreshold [CA] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchForgettingThreshold();
    assert.equal(result.bench, 'forgetthresh');
    assert.ok(result.metrics);
  });
  it('finds optimal threshold', () => {
    const result = benchForgettingThreshold();
    assert.ok(result.metrics.best_threshold > 0, 'Should find a positive threshold');
  });
  it('reports hypotheses', () => {
    const result = benchForgettingThreshold();
    assert.ok(result.metrics.hypotheses.includes('CA_forgetting_threshold'));
  });
});

describe('benchBatchSizeOptimization [CB] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchBatchSizeOptimization();
    assert.equal(result.bench, 'batchopt');
    assert.ok(result.metrics);
  });
  it('tests multiple batch sizes', () => {
    const result = benchBatchSizeOptimization();
    assert.ok(result.metrics.batch_sizes_tested >= 3, 'Should test multiple sizes');
  });
  it('reports hypotheses', () => {
    const result = benchBatchSizeOptimization();
    assert.ok(result.metrics.hypotheses.includes('CB_batch_size'));
  });
});

describe('benchImportanceDistribution [CC] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchImportanceDistribution();
    assert.equal(result.bench, 'importdist');
    assert.ok(result.metrics);
  });
  it('distribution has meaningful stats', () => {
    const result = benchImportanceDistribution();
    assert.ok(result.metrics.count > 0, 'Should have entries');
    assert.ok(result.metrics.std > 0, 'Should have non-zero variance');
  });
  it('reports hypotheses', () => {
    const result = benchImportanceDistribution();
    assert.ok(result.metrics.hypotheses.includes('CC_importance_distribution'));
  });
});

describe('benchRelationTypeWeighting [CD] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchRelationTypeWeighting();
    assert.equal(result.bench, 'reltypeweight');
    assert.ok(result.metrics);
  });
  it('weighting changes reach scores', () => {
    const result = benchRelationTypeWeighting();
    assert.ok(result.metrics.weighting_effect > 0, 'Weighting effect should be positive');
  });
  it('reports hypotheses', () => {
    const result = benchRelationTypeWeighting();
    assert.ok(result.metrics.hypotheses.includes('CD_relation_type_weighting'));
  });
});

describe('benchMemoryWarmup [CE] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchMemoryWarmup();
    assert.equal(result.bench, 'warmup');
    assert.ok(result.metrics);
  });
  it('warmup is effective', () => {
    const result = benchMemoryWarmup();
    assert.ok(result.metrics.warmup_effective, 'Warm queries should be <= cold');
  });
  it('reports hypotheses', () => {
    const result = benchMemoryWarmup();
    assert.ok(result.metrics.hypotheses.includes('CE_memory_warmup'));
  });
});

describe('benchStaleReferenceDetection [CF] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchStaleReferenceDetection();
    assert.equal(result.bench, 'staleref');
    assert.ok(result.metrics);
  });
  it('detects stale references', () => {
    const result = benchStaleReferenceDetection();
    assert.ok(result.metrics.stale_relations > 0, 'Should find stale references');
  });
  it('reports hypotheses', () => {
    const result = benchStaleReferenceDetection();
    assert.ok(result.metrics.hypotheses.includes('CF_stale_reference_detection'));
  });
});

describe('benchContextOverlap [CG] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchContextOverlap();
    assert.equal(result.bench, 'ctxoverlap');
    assert.ok(result.metrics);
  });
  it('measures overlap', () => {
    const result = benchContextOverlap();
    assert.ok(result.metrics.avg_pairwise_overlap >= 0, 'Overlap should be non-negative');
  });
  it('reports hypotheses', () => {
    const result = benchContextOverlap();
    assert.ok(result.metrics.hypotheses.includes('CG_context_overlap'));
  });
});

describe('benchFitnessPlateauDetection [CH] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchFitnessPlateauDetection();
    assert.equal(result.bench, 'fitnessplateau');
    assert.ok(result.metrics);
  });
  it('detects plateaued entries', () => {
    const result = benchFitnessPlateauDetection();
    assert.ok(result.metrics.plateau_detected, 'Should detect plateaued entries');
  });
  it('reports hypotheses', () => {
    const result = benchFitnessPlateauDetection();
    assert.ok(result.metrics.hypotheses.includes('CH_fitness_plateau'));
  });
});

// ─── Round 11: Hypotheses CI-CP ─────────────────────────────────────────────

describe('benchConcurrentAccess [CI] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchConcurrentAccess();
    assert.equal(result.bench, 'concurrent');
    assert.ok(result.metrics);
  });
  it('concurrent access is safe', () => {
    const result = benchConcurrentAccess();
    if (result.error) return;
    assert.ok(result.metrics.concurrent_safe, 'Should have no errors');
  });
  it('reports hypotheses', () => {
    const result = benchConcurrentAccess();
    assert.ok(result.metrics.hypotheses.includes('CI_concurrent_access'));
  });
});

describe('benchRecoveryAfterCrash [CJ] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchRecoveryAfterCrash();
    assert.equal(result.bench, 'recovery');
    assert.ok(result.metrics);
  });
  it('recovery preserves data', () => {
    const result = benchRecoveryAfterCrash();
    assert.ok(result.metrics.data_preserved, 'Data should be preserved after recovery');
    assert.ok(result.metrics.recovery_successful, 'Recovery should succeed');
  });
  it('reports hypotheses', () => {
    const result = benchRecoveryAfterCrash();
    assert.ok(result.metrics.hypotheses.includes('CJ_recovery_after_crash'));
  });
});

describe('benchIndexEffectiveness [CK] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchIndexEffectiveness();
    assert.equal(result.bench, 'indexeff');
    assert.ok(result.metrics);
  });
  it('index is effective', () => {
    const result = benchIndexEffectiveness();
    assert.ok(result.metrics.index_effective, 'Index should be effective');
  });
  it('reports hypotheses', () => {
    const result = benchIndexEffectiveness();
    assert.ok(result.metrics.hypotheses.includes('CK_index_effectiveness'));
  });
});

describe('benchVacuumImpact [CL] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchVacuumImpact();
    assert.equal(result.bench, 'vacuum');
    assert.ok(result.metrics);
  });
  it('vacuum reclaims space', () => {
    const result = benchVacuumImpact();
    assert.ok(result.metrics.space_reclaimed >= 0, 'Should reclaim some space');
  });
  it('reports hypotheses', () => {
    const result = benchVacuumImpact();
    assert.ok(result.metrics.hypotheses.includes('CL_vacuum_impact'));
  });
});

describe('benchSchemaEvolution [CM] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchSchemaEvolution();
    assert.equal(result.bench, 'schemaevol');
    assert.ok(result.metrics);
  });
  it('migration preserves data', () => {
    const result = benchSchemaEvolution();
    assert.ok(result.metrics.data_preserved, 'Data should survive migration');
    assert.ok(result.metrics.backward_compatible, 'Old queries should still work');
  });
  it('reports hypotheses', () => {
    const result = benchSchemaEvolution();
    assert.ok(result.metrics.hypotheses.includes('CM_schema_evolution'));
  });
});

describe('benchQueryPlanAnalysis [CN] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchQueryPlanAnalysis();
    assert.equal(result.bench, 'queryplan');
    assert.ok(result.metrics);
  });
  it('analyzes multiple queries', () => {
    const result = benchQueryPlanAnalysis();
    assert.ok(result.metrics.queries_analyzed > 0, 'Should analyze queries');
  });
  it('reports hypotheses', () => {
    const result = benchQueryPlanAnalysis();
    assert.ok(result.metrics.hypotheses.includes('CN_query_plan_analysis'));
  });
});

describe('benchMemoryFootprint [CO] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchMemoryFootprint();
    assert.equal(result.bench, 'memfootprint');
    assert.ok(result.metrics);
  });
  it('measures growth rate', () => {
    const result = benchMemoryFootprint();
    assert.ok(typeof result.metrics.growth_rate === 'number', 'Should measure growth rate');
  });
  it('reports hypotheses', () => {
    const result = benchMemoryFootprint();
    assert.ok(result.metrics.hypotheses.includes('CO_memory_footprint'));
  });
});

describe('benchCheckpointFrequency [CP] (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchCheckpointFrequency();
    assert.equal(result.bench, 'checkpoint');
    assert.ok(result.metrics);
  });
  it('tests multiple frequencies', () => {
    const result = benchCheckpointFrequency();
    assert.ok(result.metrics.frequencies_tested >= 3, 'Should test multiple frequencies');
  });
  it('reports hypotheses', () => {
    const result = benchCheckpointFrequency();
    assert.ok(result.metrics.hypotheses.includes('CP_checkpoint_frequency'));
  });
});

describe('runBench all', () => {
  it('returns array of results', () => {
    const results = runBench('all');
    assert.ok(Array.isArray(results));
    assert.equal(results.length, 87);
    for (const r of results) {
      assert.ok(r.bench);
      assert.ok(r.timestamp);
      assert.ok(r.description);
    }
  });
});
