#!/usr/bin/env node
/**
 * Tests for context-efficiency-bench.cjs — Context/memory efficiency benchmarks
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  BENCHMARKS,
  runBench,
  benchSkeleton,
  benchCompress,
  benchAblation,
  benchDiminishing,
  benchDensity,
  benchDelta,
  generateSyntheticProject,
  estimateTokens,
  extractKeywords,
  jaccard,
} = require('../scripts/context-efficiency-bench.cjs');

// ─── Helpers ─────────────────────────────────────────────────────────────────

describe('helpers', () => {
  it('estimateTokens returns reasonable counts', () => {
    assert.equal(estimateTokens(''), 0);
    assert.ok(estimateTokens('hello world') > 0);
    // ~11 chars / 3.5 ≈ 4 tokens
    assert.ok(estimateTokens('hello world') < 10);
  });

  it('extractKeywords filters stopwords and short words', () => {
    const kw = extractKeywords('the quick brown fox and the lazy dog');
    assert.ok(kw.has('quick'));
    assert.ok(kw.has('brown'));
    assert.ok(kw.has('lazy'));
    assert.ok(!kw.has('the'));
    assert.ok(!kw.has('and'));
  });

  it('jaccard computes similarity correctly', () => {
    const a = new Set(['a', 'b', 'c']);
    const b = new Set(['b', 'c', 'd']);
    // intersection=2, union=4 → 0.5
    assert.equal(jaccard(a, b), 0.5);
    assert.equal(jaccard(new Set(), new Set()), 0);
    assert.equal(jaccard(a, a), 1);
  });
});

// ─── Synthetic Project ──────────────────────────────────────────────────────

describe('generateSyntheticProject', () => {
  it('returns all expected fields', () => {
    const p = generateSyntheticProject();
    assert.ok(Array.isArray(p.files));
    assert.ok(Array.isArray(p.skeleton));
    assert.ok(typeof p.fullContext === 'string');
    assert.ok(p.memoryLayers);
    assert.ok(Array.isArray(p.tasks));
    assert.ok(p.files.length >= 5);
    assert.ok(p.tasks.length >= 3);
  });
});

// ─── Individual Benchmarks ──────────────────────────────────────────────────

describe('benchSkeleton', () => {
  it('runs without error and returns expected structure', () => {
    const r = benchSkeleton();
    assert.equal(r.bench, 'skeleton');
    assert.ok(r.metrics.strategies);
    assert.ok(r.metrics.strategies.full_context);
    assert.ok(r.metrics.strategies.skeleton);
    assert.ok(r.metrics.strategies.compressed_skeleton);
    assert.ok(r.metrics.strategies.zero_context);
    assert.ok(typeof r.metrics.winner === 'string');
    assert.ok(r.duration_ms >= 0);
  });

  it('skeleton uses fewer tokens than full_context', () => {
    const r = benchSkeleton();
    const s = r.metrics.strategies;
    assert.ok(s.skeleton.tokens < s.full_context.tokens);
    assert.ok(s.compressed_skeleton.tokens < s.skeleton.tokens);
  });

  it('skeleton has higher efficiency than full_context', () => {
    const r = benchSkeleton();
    const s = r.metrics.strategies;
    assert.ok(s.skeleton.efficiency > s.full_context.efficiency);
  });
});

describe('benchCompress', () => {
  it('runs without error and returns expected structure', () => {
    const r = benchCompress();
    assert.equal(r.bench, 'compress');
    assert.ok(r.metrics.strategies.raw_markdown);
    assert.ok(r.metrics.strategies.symbolic_notation);
    assert.ok(r.metrics.strategies.structured_json);
    assert.ok(r.metrics.strategies.one_liner);
    assert.ok(r.metrics.raw_keywords_count > 0);
  });

  it('compressed strategies use fewer tokens than raw', () => {
    const r = benchCompress();
    const raw = r.metrics.strategies.raw_markdown.tokens;
    assert.ok(r.metrics.strategies.symbolic_notation.tokens < raw);
    assert.ok(r.metrics.strategies.one_liner.tokens < raw);
  });

  it('compression_ratio > 1 for all compressed', () => {
    const r = benchCompress();
    for (const [name, s] of Object.entries(r.metrics.strategies)) {
      if (name !== 'raw_markdown') {
        assert.ok(s.compression_ratio > 1, `${name} should have ratio > 1`);
      }
    }
  });
});

describe('benchAblation', () => {
  it('runs without error and has 16 combinations', () => {
    const r = benchAblation();
    assert.equal(r.bench, 'ablation');
    assert.equal(r.metrics.total_combinations, 16);
    assert.ok(r.metrics.top_5_efficient.length === 5);
    assert.ok(r.metrics.marginal_values);
    assert.ok(typeof r.metrics.most_valuable_layer === 'string');
    assert.ok(typeof r.metrics.least_valuable_layer === 'string');
  });

  it('marginal values exist for all 4 layers', () => {
    const r = benchAblation();
    const mv = r.metrics.marginal_values;
    assert.ok(mv.planning);
    assert.ok(mv.findings);
    assert.ok(mv.progress);
    assert.ok(mv.graphMemory);
  });
});

describe('benchDiminishing', () => {
  it('confirms diminishing returns', () => {
    const r = benchDiminishing();
    assert.equal(r.bench, 'diminishing');
    assert.ok(r.metrics.diminishing_confirmed, 'diminishing returns should be confirmed');
    assert.ok(r.metrics.coverage_curve.length > 2);
    assert.ok(r.metrics.optimal_point);
    assert.ok(r.metrics.optimal_point.tokens > 0);
  });

  it('optimal point saves tokens vs full', () => {
    const r = benchDiminishing();
    assert.ok(r.metrics.token_savings_at_optimal > 0);
  });
});

describe('benchDensity', () => {
  it('runs and ranks content types', () => {
    const r = benchDensity();
    assert.equal(r.bench, 'density');
    assert.ok(r.metrics.ranking.length >= 5);
    assert.ok(typeof r.metrics.highest_density === 'string');
    assert.ok(typeof r.metrics.lowest_density === 'string');
  });

  it('full_code has lowest density', () => {
    const r = benchDensity();
    assert.equal(r.metrics.lowest_density, 'full_code');
  });
});

describe('benchDelta', () => {
  it('runs with 5 sessions', () => {
    const r = benchDelta();
    assert.equal(r.bench, 'delta');
    assert.equal(r.metrics.sessions.length, 5);
    assert.ok(r.metrics.cumulative);
  });

  it('delta saves >80% tokens vs full reindex', () => {
    const r = benchDelta();
    assert.ok(r.metrics.cumulative.savings_delta_vs_full >= 0.8,
      `Expected >=80% savings, got ${r.metrics.cumulative.savings_delta_vs_full}`);
  });

  it('each session delta < full reindex', () => {
    const r = benchDelta();
    for (const s of r.metrics.sessions) {
      assert.ok(s.delta_only_tokens < s.full_reindex_tokens);
      assert.ok(s.skeleton_plus_delta_tokens < s.full_reindex_tokens);
    }
  });
});

// ─── runBench('all') ────────────────────────────────────────────────────────

describe('runBench', () => {
  it('all returns results for every benchmark', () => {
    const results = runBench('all');
    for (const key of Object.keys(BENCHMARKS)) {
      assert.ok(results[key], `Missing result for ${key}`);
      assert.ok(!results[key].error, `${key} errored: ${results[key].error}`);
    }
  });
});
