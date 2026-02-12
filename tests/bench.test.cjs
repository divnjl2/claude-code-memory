#!/usr/bin/env node
/**
 * Tests for bench.cjs — Memory system benchmarks
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  runBench,
  BENCHMARKS,
  benchRecall,
  benchPersist,
  benchFitness,
  benchEffort,
  benchContext,
  benchDrift,
} = require('../src/lib/bench.cjs');

const { detectPython } = require('../src/lib/python-detector.cjs');

const python = detectPython();
const skipSqlite = !python.available;

describe('bench module', () => {
  it('exports BENCHMARKS with 6 entries', () => {
    assert.equal(Object.keys(BENCHMARKS).length, 6);
    assert.ok(BENCHMARKS.recall);
    assert.ok(BENCHMARKS.persist);
    assert.ok(BENCHMARKS.fitness);
    assert.ok(BENCHMARKS.effort);
    assert.ok(BENCHMARKS.context);
    assert.ok(BENCHMARKS.drift);
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
});

describe('benchEffort (no SQLite needed)', () => {
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
    // Cost should generally increase with escalation
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
    // With exact unique keywords, recall should be ~1.0
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

describe('benchFitness (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
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
});

describe('benchContext (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchContext();
    assert.equal(result.bench, 'context');
    assert.ok(!result.error, result.error);
    assert.ok(result.metrics);
  });

  it('budget-aware should beat random', () => {
    const result = benchContext();
    const m = result.metrics;
    assert.ok(m.budget_aware.hits >= m.random_baseline.hits,
      `Budget-aware (${m.budget_aware.hits}) should have >= hits than random (${m.random_baseline.hits})`);
  });

  it('budget-aware hit rate should be high', () => {
    const result = benchContext();
    const m = result.metrics;
    assert.ok(m.budget_aware.hit_rate >= 0.5, `Hit rate ${m.budget_aware.hit_rate} should be >= 0.5`);
  });
});

describe('benchDrift (requires SQLite)', { skip: skipSqlite && 'Python/SQLite not available' }, () => {
  it('runs and returns metrics', () => {
    const result = benchDrift();
    assert.equal(result.bench, 'drift');
    assert.ok(!result.error, result.error);
    assert.ok(result.metrics);
  });

  it('should detect some violations', () => {
    const result = benchDrift();
    const m = result.metrics;
    assert.ok(m.detected_violations > 0, 'Should detect at least some violations');
    assert.ok(m.drift_detection_rate > 0, 'Detection rate should be > 0');
  });

  it('precision should be reasonable', () => {
    const result = benchDrift();
    const m = result.metrics;
    // Keyword overlap is imperfect, but should still be mostly right
    assert.ok(m.precision >= 0.3, `Precision ${m.precision} should be >= 0.3`);
  });
});

describe('runBench all', () => {
  it('returns array of results', () => {
    const results = runBench('all');
    assert.ok(Array.isArray(results));
    assert.equal(results.length, 6);
    for (const r of results) {
      assert.ok(r.bench);
      assert.ok(r.timestamp);
      assert.ok(r.description);
    }
  });
});
