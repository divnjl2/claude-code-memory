#!/usr/bin/env node
/**
 * Tests for gepa-effort.cjs — GEPA v2.1 Effort Controller (Dual-Axis)
 * Validates: dual-axis escalation, per-level complexity profiles,
 *            opus effort multiplier, phase-aware mid-execution tuning
 */

'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  MODEL_TIERS,
  MAX_ESCALATION_LEVEL,
  MAX_COST_PER_TASK,
  COST_PER_1K_TOKENS,
  DEFAULT_EFFORT,
  ESCALATION_LADDER,
  COMPLEXITY_PROFILES,
  SIGNAL_TYPES,
  RESTART_FROM,
  MODEL_WEIGHT,

  classifyComplexity,
  tierUp,
  tierDown,
  estimateCost,
  effectiveEffort,
  opusEffortMultiplier,

  assessAndPropagateDown,
  handleFailure,
  midExecutionTune,

  loadEffortState,
  saveEffortState,
  resetEffort,
  getNodeStates,
  getNodeEffort,
  getEffortReport,
} = require('../src/lib/gepa-effort.cjs');

// ── Helper: create temp project ──
function makeTmpProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-effort-'));
  const memDir = path.join(tmpDir, '.claude-memory');
  fs.mkdirSync(path.join(memDir, 'db'), { recursive: true });
  fs.mkdirSync(path.join(memDir, 'gepa'), { recursive: true });
  fs.writeFileSync(path.join(memDir, 'config.json'), JSON.stringify({ gepa: { enabled: true } }));
  fs.writeFileSync(path.join(memDir, 'gepa', 'state.json'), JSON.stringify({ cycle: 0 }));
  return tmpDir;
}

describe('dual-axis constants', () => {
  it('MAX_ESCALATION_LEVEL is 6 (7 levels: 0-6)', () => {
    assert.equal(MAX_ESCALATION_LEVEL, 6);
  });

  it('ESCALATION_LADDER has 7 entries', () => {
    assert.equal(ESCALATION_LADDER.length, 7);
  });

  it('ladder phases: model(0-2), effort(3-5), circuit_break(6)', () => {
    assert.equal(ESCALATION_LADDER[0].phase, 'model');
    assert.equal(ESCALATION_LADDER[1].phase, 'model');
    assert.equal(ESCALATION_LADDER[2].phase, 'model');
    assert.equal(ESCALATION_LADDER[3].phase, 'effort');
    assert.equal(ESCALATION_LADDER[4].phase, 'effort');
    assert.equal(ESCALATION_LADDER[5].phase, 'effort');
    assert.equal(ESCALATION_LADDER[6].phase, 'circuit_break');
  });

  it('COMPLEXITY_PROFILES have per-level (L1/L2/L3) entries', () => {
    for (const [name, profile] of Object.entries(COMPLEXITY_PROFILES)) {
      assert.ok(profile.L1, `${name} missing L1`);
      assert.ok(profile.L2, `${name} missing L2`);
      assert.ok(profile.L3, `${name} missing L3`);
      assert.ok(profile.L1.model, `${name}.L1 missing model`);
      assert.equal(typeof profile.L1.reasoning_effort, 'number', `${name}.L1 missing reasoning_effort`);
    }
  });

  it('MODEL_WEIGHT: local=0, sonnet=0.33, opus=0.66', () => {
    assert.equal(MODEL_WEIGHT.local, 0.0);
    assert.equal(MODEL_WEIGHT.sonnet, 0.33);
    assert.equal(MODEL_WEIGHT.opus, 0.66);
  });

  it('RESTART_FROM maps levels 0-5', () => {
    assert.equal(RESTART_FROM[0], 'L3');
    assert.equal(RESTART_FROM[1], 'L3');
    assert.equal(RESTART_FROM[2], 'L2');
    assert.equal(RESTART_FROM[3], 'L2');
    assert.equal(RESTART_FROM[4], 'L2');
    assert.equal(RESTART_FROM[5], 'L1');
  });
});

describe('effectiveEffort (combined score)', () => {
  it('local = 0.0 regardless of reasoning_effort', () => {
    assert.equal(effectiveEffort({ model_tier: 'local', reasoning_effort: 0.9 }), 0.0);
  });

  it('sonnet = 0.33 regardless of reasoning_effort', () => {
    assert.equal(effectiveEffort({ model_tier: 'sonnet', reasoning_effort: 0.9 }), 0.33);
  });

  it('opus with effort 0.0 = 0.66', () => {
    assert.equal(effectiveEffort({ model_tier: 'opus', reasoning_effort: 0.0 }), 0.66);
  });

  it('opus with effort 1.0 = 1.0', () => {
    assert.equal(effectiveEffort({ model_tier: 'opus', reasoning_effort: 1.0 }), 1.0);
  });

  it('opus with effort 0.5 ≈ 0.83', () => {
    const val = effectiveEffort({ model_tier: 'opus', reasoning_effort: 0.5 });
    assert.ok(val > 0.8 && val < 0.85, `Expected ~0.83, got ${val}`);
  });
});

describe('opusEffortMultiplier', () => {
  it('effort 0 = 1x', () => assert.equal(opusEffortMultiplier(0), 1.0));
  it('effort 0.5 = 2x', () => assert.equal(opusEffortMultiplier(0.5), 2.0));
  it('effort 1.0 = 3x', () => assert.equal(opusEffortMultiplier(1.0), 3.0));
});

describe('estimateCost (dual-axis)', () => {
  it('local nodes cost $0', () => {
    assert.equal(estimateCost({ n1: { model_tier: 'local', token_budget: 10000, reasoning_effort: 0.5 } }), 0);
  });

  it('sonnet cost = flat (no effort multiplier)', () => {
    assert.equal(estimateCost({ n1: { model_tier: 'sonnet', token_budget: 10000, reasoning_effort: 0.9 } }), 0.03);
  });

  it('opus with effort 0 = base cost', () => {
    // 0.015 * 10 * 1.0 = 0.15
    assert.equal(estimateCost({ n1: { model_tier: 'opus', token_budget: 10000, reasoning_effort: 0 } }), 0.15);
  });

  it('opus with effort 0.5 = 2x base cost', () => {
    // 0.015 * 10 * 2.0 = 0.30
    assert.equal(estimateCost({ n1: { model_tier: 'opus', token_budget: 10000, reasoning_effort: 0.5 } }), 0.3);
  });

  it('opus with effort 1.0 = 3x base cost', () => {
    // 0.015 * 10 * 3.0 = 0.45
    assert.equal(estimateCost({ n1: { model_tier: 'opus', token_budget: 10000, reasoning_effort: 1.0 } }), 0.45);
  });
});

describe('helper functions', () => {
  describe('classifyComplexity', () => {
    it('trivial for < 0.2', () => assert.equal(classifyComplexity(0.1), 'trivial'));
    it('simple for 0.2-0.4', () => assert.equal(classifyComplexity(0.3), 'simple'));
    it('medium for 0.4-0.6', () => assert.equal(classifyComplexity(0.5), 'medium'));
    it('complex for 0.6-0.8', () => assert.equal(classifyComplexity(0.7), 'complex'));
    it('extreme for >= 0.8', () => assert.equal(classifyComplexity(0.9), 'extreme'));
  });

  describe('tierUp/tierDown', () => {
    it('local → sonnet → opus', () => {
      assert.equal(tierUp('local'), 'sonnet');
      assert.equal(tierUp('sonnet'), 'opus');
      assert.equal(tierUp('opus'), 'opus');
    });
    it('opus → sonnet → local', () => {
      assert.equal(tierDown('opus'), 'sonnet');
      assert.equal(tierDown('sonnet'), 'local');
      assert.equal(tierDown('local'), 'local');
    });
  });
});

describe('assessAndPropagateDown (dual-axis top-down)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = makeTmpProject(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('creates all 7 node states', () => {
    const result = assessAndPropagateDown(tmpDir, 0.5);
    assert.equal(Object.keys(result.nodeStates).length, 7);
  });

  it('trivial: L1=sonnet, L2=local, L3=local', () => {
    const r = assessAndPropagateDown(tmpDir, 0.1);
    assert.equal(r.nodeStates.L1_vision.model_tier, 'sonnet');
    assert.equal(r.nodeStates.L2_decomposer.model_tier, 'local');
    assert.equal(r.nodeStates.L3_executor.model_tier, 'local');
  });

  it('simple: L1=opus, L2=local, L3=local', () => {
    const r = assessAndPropagateDown(tmpDir, 0.3);
    assert.equal(r.nodeStates.L1_vision.model_tier, 'opus');
    assert.equal(r.nodeStates.L2_decomposer.model_tier, 'local');
    assert.equal(r.nodeStates.L3_executor.model_tier, 'local');
  });

  it('medium: L1=opus, L2=sonnet, L3=sonnet', () => {
    const r = assessAndPropagateDown(tmpDir, 0.5);
    assert.equal(r.nodeStates.L1_vision.model_tier, 'opus');
    assert.equal(r.nodeStates.L2_decomposer.model_tier, 'sonnet');
    assert.equal(r.nodeStates.L3_executor.model_tier, 'sonnet');
  });

  it('complex: L1=opus, L2=opus, L3=sonnet', () => {
    const r = assessAndPropagateDown(tmpDir, 0.7);
    assert.equal(r.nodeStates.L1_vision.model_tier, 'opus');
    assert.equal(r.nodeStates.L2_decomposer.model_tier, 'opus');
    assert.equal(r.nodeStates.L3_executor.model_tier, 'sonnet');
  });

  it('extreme: all opus', () => {
    const r = assessAndPropagateDown(tmpDir, 0.9);
    assert.equal(r.nodeStates.L1_vision.model_tier, 'opus');
    assert.equal(r.nodeStates.L2_decomposer.model_tier, 'opus');
    assert.equal(r.nodeStates.L3_executor.model_tier, 'opus');
  });

  it('extreme L1 reasoning_effort = 0.9', () => {
    const r = assessAndPropagateDown(tmpDir, 0.9);
    assert.equal(r.nodeStates.L1_vision.reasoning_effort, 0.9);
  });

  it('L2_selector is never opus (cost efficiency)', () => {
    const r = assessAndPropagateDown(tmpDir, 0.9); // extreme
    assert.notEqual(r.nodeStates.L2_selector.model_tier, 'opus');
  });

  it('L3_verifier is at least sonnet', () => {
    const r = assessAndPropagateDown(tmpDir, 0.1); // trivial, L3=local
    assert.equal(r.nodeStates.L3_verifier.model_tier, 'sonnet'); // upgraded
  });

  it('selector temperature always 0.1', () => {
    for (const score of [0.1, 0.5, 0.9]) {
      const r = assessAndPropagateDown(tmpDir, score);
      assert.equal(r.nodeStates.L2_selector.temperature, 0.1);
    }
  });

  it('persists state with complexityScore', () => {
    assessAndPropagateDown(tmpDir, 0.65, { taskId: 'test-dual' });
    const state = loadEffortState(tmpDir);
    assert.equal(state.taskId, 'test-dual');
    assert.equal(state.complexityScore, 0.65);
    assert.equal(state.escalationLevel, 0);
  });
});

describe('handleFailure (dual-axis escalation)', () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = makeTmpProject();
    assessAndPropagateDown(tmpDir, 0.5); // medium: L1=opus, L2=sonnet, L3=sonnet
  });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('level 1: phase=model, L3 sonnet stays (already sonnet per medium)', () => {
    const r = handleFailure(tmpDir, 'L3_executor', { reason: 'test failed' });
    assert.equal(r.action, 'escalate');
    assert.equal(r.level, 1);
    assert.equal(r.phase, 'model');
    assert.equal(r.restartFrom, 'L3');
    // L3 gets sonnet from ladder step 1
    const l3 = getNodeEffort(tmpDir, 'L3_executor');
    assert.equal(l3.model_tier, 'sonnet');
  });

  it('level 2: phase=model, L3+L2 → opus', () => {
    handleFailure(tmpDir, 'L3_executor', { reason: 'fail 1' });
    const r = handleFailure(tmpDir, 'L3_executor', { reason: 'fail 2' });
    assert.equal(r.level, 2);
    assert.equal(r.phase, 'model');
    assert.equal(r.restartFrom, 'L2');
    assert.equal(getNodeEffort(tmpDir, 'L3_executor').model_tier, 'opus');
    assert.equal(getNodeEffort(tmpDir, 'L2_decomposer').model_tier, 'opus');
  });

  it('level 3: phase=effort, reasoning_effort goes up', () => {
    handleFailure(tmpDir, 'L3_executor', { reason: 'fail 1' });
    handleFailure(tmpDir, 'L3_executor', { reason: 'fail 2' });
    const r = handleFailure(tmpDir, 'L3_executor', { reason: 'fail 3' });
    assert.equal(r.level, 3);
    assert.equal(r.phase, 'effort');
    assert.equal(r.restartFrom, 'L2');
    assert.equal(getNodeEffort(tmpDir, 'L3_executor').reasoning_effort, 0.7);
    assert.equal(getNodeEffort(tmpDir, 'L2_decomposer').reasoning_effort, 0.8);
  });

  it('level 4: phase=effort, deeper thinking + L1 raised', () => {
    for (let i = 0; i < 3; i++) handleFailure(tmpDir, 'L3_executor', { reason: `fail ${i+1}` });
    const r = handleFailure(tmpDir, 'L3_executor', { reason: 'fail 4' });
    assert.equal(r.level, 4);
    assert.equal(r.phase, 'effort');
    assert.equal(r.restartFrom, 'L2');
    assert.equal(getNodeEffort(tmpDir, 'L3_executor').reasoning_effort, 0.85);
    assert.equal(getNodeEffort(tmpDir, 'L1_vision').reasoning_effort, 0.8);
  });

  it('level 5: phase=effort, all at 0.95', () => {
    for (let i = 0; i < 4; i++) handleFailure(tmpDir, 'L3_executor', { reason: `fail ${i+1}` });
    const r = handleFailure(tmpDir, 'L3_executor', { reason: 'fail 5' });
    assert.equal(r.level, 5);
    assert.equal(r.phase, 'effort');
    assert.equal(r.restartFrom, 'L1');
    assert.equal(getNodeEffort(tmpDir, 'L3_executor').reasoning_effort, 0.95);
    assert.equal(getNodeEffort(tmpDir, 'L2_decomposer').reasoning_effort, 0.95);
    assert.equal(getNodeEffort(tmpDir, 'L1_vision').reasoning_effort, 0.95);
  });

  it('level 6: circuit break', () => {
    for (let i = 0; i < 5; i++) handleFailure(tmpDir, 'L3_executor', { reason: `fail ${i+1}` });
    const r = handleFailure(tmpDir, 'L3_executor', { reason: 'fail 6' });
    assert.equal(r.action, 'circuit_break');
    assert.equal(r.phase, 'circuit_break');
    assert.equal(r.recommendation, 'needs_human');
    assert.equal(r.totalFailures, 6);
  });

  it('phase=effort increases n_variants and token_budget', () => {
    handleFailure(tmpDir, 'L3_executor', { reason: 'f1' });
    handleFailure(tmpDir, 'L3_executor', { reason: 'f2' });
    const before = getNodeEffort(tmpDir, 'L3_executor');
    const budgetBefore = before.token_budget;
    const variantsBefore = before.n_variants;
    handleFailure(tmpDir, 'L3_executor', { reason: 'f3' }); // level 3 = effort phase
    const after = getNodeEffort(tmpDir, 'L3_executor');
    assert.ok(after.n_variants > variantsBefore, 'variants should increase in effort phase');
    assert.ok(after.token_budget > budgetBefore, 'budget should increase in effort phase');
  });

  it('returns phase in result', () => {
    const r1 = handleFailure(tmpDir, 'L3_executor', { reason: 'f1' });
    assert.equal(r1.phase, 'model');
    handleFailure(tmpDir, 'L3_executor', { reason: 'f2' });
    const r3 = handleFailure(tmpDir, 'L3_executor', { reason: 'f3' });
    assert.equal(r3.phase, 'effort');
  });

  it('escalation message mentions phase', () => {
    const r = handleFailure(tmpDir, 'L3_executor', { reason: 'crash' });
    assert.ok(r.message.includes('Phase 1'));
    assert.ok(r.message.includes('model'));
  });
});

describe('midExecutionTune (dual-axis)', () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = makeTmpProject();
    assessAndPropagateDown(tmpDir, 0.5); // medium: L3=sonnet, L1=opus
  });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  describe('struggling', () => {
    it('not on opus → upgrade model (Phase 1)', () => {
      // L3 is sonnet for medium complexity
      const before = getNodeEffort(tmpDir, 'L3_executor');
      assert.equal(before.model_tier, 'sonnet');
      const r = midExecutionTune(tmpDir, 'L3_executor', 'struggling');
      assert.ok(r.success);
      assert.equal(r.newState.model_tier, 'opus'); // sonnet → opus
      // reasoning_effort should NOT change (Phase 1)
      assert.equal(r.newState.reasoning_effort, before.reasoning_effort);
    });

    it('already on opus → raise reasoning_effort (Phase 2)', () => {
      // L1 is already opus
      const before = getNodeEffort(tmpDir, 'L1_vision');
      assert.equal(before.model_tier, 'opus');
      const r = midExecutionTune(tmpDir, 'L1_vision', 'struggling');
      assert.ok(r.success);
      assert.equal(r.newState.model_tier, 'opus'); // stays opus
      assert.ok(r.newState.reasoning_effort > before.reasoning_effort);
    });

    it('increases token budget in both phases', () => {
      const before = getNodeEffort(tmpDir, 'L3_executor');
      const r = midExecutionTune(tmpDir, 'L3_executor', 'struggling');
      assert.ok(r.newState.token_budget > before.token_budget);
    });
  });

  describe('confident', () => {
    it('on opus with high effort → lower effort (stay on opus)', () => {
      // L1 is opus with effort 0.5
      const before = getNodeEffort(tmpDir, 'L1_vision');
      assert.equal(before.model_tier, 'opus');
      assert.ok(before.reasoning_effort > 0.3);
      const r = midExecutionTune(tmpDir, 'L1_vision', 'confident');
      assert.ok(r.success);
      assert.equal(r.newState.model_tier, 'opus'); // stays opus
      assert.ok(r.newState.reasoning_effort < before.reasoning_effort);
    });

    it('on opus with effort <= 0.3 → downgrade to sonnet', () => {
      // Set L1 to opus/0.3
      const state = loadEffortState(tmpDir);
      state.nodeStates.L1_vision.reasoning_effort = 0.3;
      saveEffortState(tmpDir, state);
      const r = midExecutionTune(tmpDir, 'L1_vision', 'confident');
      assert.ok(r.success);
      assert.equal(r.newState.model_tier, 'sonnet');
    });

    it('not on opus → downgrade model', () => {
      // L3 is sonnet
      const r = midExecutionTune(tmpDir, 'L3_executor', 'confident');
      assert.ok(r.success);
      assert.equal(r.newState.model_tier, 'local'); // sonnet → local
    });
  });

  describe('novel_territory', () => {
    it('jumps to opus regardless of current model', () => {
      // L3 is sonnet
      const r = midExecutionTune(tmpDir, 'L3_executor', 'novel_territory');
      assert.ok(r.success);
      assert.equal(r.newState.model_tier, 'opus');
    });

    it('raises reasoning_effort', () => {
      const before = getNodeEffort(tmpDir, 'L3_executor');
      const r = midExecutionTune(tmpDir, 'L3_executor', 'novel_territory');
      assert.ok(r.newState.reasoning_effort > before.reasoning_effort);
    });

    it('raises temperature and variants', () => {
      const before = getNodeEffort(tmpDir, 'L3_executor');
      const r = midExecutionTune(tmpDir, 'L3_executor', 'novel_territory');
      assert.ok(r.newState.temperature > before.temperature);
      assert.ok(r.newState.n_variants > before.n_variants);
    });
  });

  describe('pattern_match', () => {
    it('downgrades model', () => {
      const before = getNodeEffort(tmpDir, 'L3_executor');
      const r = midExecutionTune(tmpDir, 'L3_executor', 'pattern_match');
      assert.ok(r.success);
      assert.equal(r.newState.model_tier, tierDown(before.model_tier));
    });

    it('reduces effort and sets deterministic temp', () => {
      const before = getNodeEffort(tmpDir, 'L1_vision');
      const r = midExecutionTune(tmpDir, 'L1_vision', 'pattern_match');
      assert.ok(r.newState.reasoning_effort < before.reasoning_effort);
      assert.equal(r.newState.temperature, 0.1);
      assert.equal(r.newState.n_variants, 1);
    });
  });

  it('rejects unknown signal', () => {
    const r = midExecutionTune(tmpDir, 'L3_executor', 'invalid');
    assert.equal(r.success, false);
  });

  it('rejects unknown node', () => {
    const r = midExecutionTune(tmpDir, 'L99_fake', 'struggling');
    assert.equal(r.success, false);
  });
});

describe('effort report (dual-axis)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = makeTmpProject(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('empty report before init', () => {
    const r = getEffortReport(tmpDir);
    assert.equal(r.totalEscalations, 0);
    assert.equal(r.taskId, null);
  });

  it('full report with effectiveEffort in states', () => {
    assessAndPropagateDown(tmpDir, 0.7, { taskId: 'dual-test' });
    handleFailure(tmpDir, 'L3_executor', { reason: 'oops' });
    const r = getEffortReport(tmpDir);
    assert.equal(r.taskId, 'dual-test');
    assert.equal(r.totalFailures, 1);
    assert.ok(r.finalStates.L1_vision.effectiveEffort > 0);
  });

  it('resetEffort clears state', () => {
    assessAndPropagateDown(tmpDir, 0.5);
    resetEffort(tmpDir);
    assert.equal(getNodeStates(tmpDir), null);
  });
});
