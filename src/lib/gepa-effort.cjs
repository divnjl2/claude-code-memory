#!/usr/bin/env node
/**
 * gepa-effort.cjs — GEPA v2.1 Effort Controller (Dual-Axis).
 *
 * Two axes of effort control:
 *   - Axis 1: Model Routing — local → sonnet → opus
 *   - Axis 2: Reasoning Effort — 0.0 → 1.0 (only meaningful on opus)
 *
 * When not yet on opus → escalate model tier.
 * When already on opus → escalate reasoning_effort depth.
 *
 * Features:
 *   - Top-Down: complexity → per-level (L1/L2/L3) model + effort profiles
 *   - Bottom-Up: 7-level escalation ladder (Phase 1: model, Phase 2: effort, Phase 3: circuit break)
 *   - Mid-Execution: dual-axis aware signals (struggling/confident/novel/pattern)
 *   - Cost: opus effort multiplier (effort 0.3 ≈ 1x, effort 1.0 ≈ 3x base cost)
 *   - Circuit breaker at level 6 or $2 budget exceed
 *
 * Pure JavaScript, zero dependencies, no LLM calls.
 * State is persisted to .claude-memory/gepa/effort-state.json
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { getGepaDir, getState, updateState, logEvent } = require('./gepa-core.cjs');

// ─── Constants ───────────────────────────────────────────────────────────────

const MODEL_TIERS = ['local', 'sonnet', 'opus'];

/** Circuit break at level 6 (7 levels: 0-6) */
const MAX_ESCALATION_LEVEL = 6;

const MAX_COST_PER_TASK = 5.00; // USD — dual-axis needs room for all-opus + high effort

/** Base cost per 1k tokens (before effort multiplier) */
const COST_PER_1K_TOKENS = {
  local: 0.0,
  sonnet: 0.003,
  opus: 0.015,
};

/**
 * Opus effort multiplier: higher reasoning_effort = more reasoning tokens.
 * effort 0.3 ≈ 1x, effort 0.5 ≈ 2x, effort 1.0 ≈ 3x base cost.
 */
function opusEffortMultiplier(effort) {
  return 1.0 + (effort * 2.0);
}

/** Model weight for effective_effort calculation */
const MODEL_WEIGHT = { local: 0.0, sonnet: 0.33, opus: 0.66 };

/**
 * Combined effort score: model tier + reasoning effort (0.0–1.0).
 * local=0.0, sonnet=0.33, opus=0.66–1.0 (depending on reasoning_effort).
 */
function effectiveEffort(state) {
  const base = MODEL_WEIGHT[state.model_tier] || 0;
  if (state.model_tier === 'opus') {
    return round2(base + (state.reasoning_effort * 0.34));
  }
  return base;
}

/** Default EffortState for each node role */
const DEFAULT_EFFORT = {
  L1_vision:      { reasoning_effort: 0.5, temperature: 0.4, model_tier: 'opus',   n_variants: 1, max_mutation_cycles: 1, max_retries: 1, token_budget: 15000 },
  L1_variant_gen: { reasoning_effort: 0.5, temperature: 0.7, model_tier: 'opus',   n_variants: 3, max_mutation_cycles: 2, max_retries: 1, token_budget: 20000 },
  L2_decomposer:  { reasoning_effort: 0.5, temperature: 0.5, model_tier: 'sonnet', n_variants: 3, max_mutation_cycles: 2, max_retries: 2, token_budget: 12000 },
  L2_selector:    { reasoning_effort: 0.5, temperature: 0.1, model_tier: 'sonnet', n_variants: 1, max_mutation_cycles: 0, max_retries: 1, token_budget: 8000 },
  L2_adapter:     { reasoning_effort: 0.5, temperature: 0.5, model_tier: 'sonnet', n_variants: 2, max_mutation_cycles: 3, max_retries: 2, token_budget: 12000 },
  L3_executor:    { reasoning_effort: 0.5, temperature: 0.2, model_tier: 'local',  n_variants: 1, max_mutation_cycles: 0, max_retries: 3, token_budget: 10000 },
  L3_verifier:    { reasoning_effort: 0.5, temperature: 0.1, model_tier: 'sonnet', n_variants: 1, max_mutation_cycles: 0, max_retries: 1, token_budget: 8000 },
};

/**
 * Dual-Axis Escalation Ladder.
 * Phase 1 (levels 0-2): model escalation (cheap → expensive).
 * Phase 2 (levels 3-5): effort escalation (all on opus, raise reasoning_effort).
 * Phase 3 (level 6): circuit break.
 */
const ESCALATION_LADDER = [
  // Phase 1: Model escalation — effort stays at default
  { level: 0, phase: 'model', changes: {
    L3: { model: 'local',  reasoning_effort: 0.5 },
    L2: { model: 'sonnet', reasoning_effort: 0.5 },
    L1: { model: 'opus',   reasoning_effort: 0.5 },
  }},
  { level: 1, phase: 'model', changes: {
    L3: { model: 'sonnet', reasoning_effort: 0.5 },
  }},
  { level: 2, phase: 'model', changes: {
    L3: { model: 'opus',   reasoning_effort: 0.5 },
    L2: { model: 'opus',   reasoning_effort: 0.5 },
  }},

  // Phase 2: Effort escalation — all on opus, raise reasoning_effort
  { level: 3, phase: 'effort', changes: {
    L3: { model: 'opus', reasoning_effort: 0.7 },
    L2: { model: 'opus', reasoning_effort: 0.8 },
  }},
  { level: 4, phase: 'effort', changes: {
    L3: { model: 'opus', reasoning_effort: 0.85 },
    L2: { model: 'opus', reasoning_effort: 0.9 },
    L1: { model: 'opus', reasoning_effort: 0.8 },
  }},
  { level: 5, phase: 'effort', changes: {
    L3: { model: 'opus', reasoning_effort: 0.95 },
    L2: { model: 'opus', reasoning_effort: 0.95 },
    L1: { model: 'opus', reasoning_effort: 0.95 },
  }},

  // Phase 3: Circuit break
  { level: 6, phase: 'circuit_break', changes: {} },
];

/** Restart level mapping for dual-axis ladder */
const RESTART_FROM = {
  0: 'L3',
  1: 'L3',
  2: 'L2',
  3: 'L2',
  4: 'L2',
  5: 'L1',
};

/**
 * Dual-Axis Complexity Profiles — per-level model + effort.
 * L1 always starts on opus (planning is important).
 * L2/L3 start cheaper and scale up with complexity.
 */
const COMPLEXITY_PROFILES = {
  trivial: {
    L1: { model: 'sonnet', reasoning_effort: 0.3 },
    L2: { model: 'local',  reasoning_effort: 0.3 },
    L3: { model: 'local',  reasoning_effort: 0.3 },
  },
  simple: {
    L1: { model: 'opus',   reasoning_effort: 0.3 },
    L2: { model: 'local',  reasoning_effort: 0.3 },
    L3: { model: 'local',  reasoning_effort: 0.3 },
  },
  medium: {
    L1: { model: 'opus',   reasoning_effort: 0.5 },
    L2: { model: 'sonnet', reasoning_effort: 0.5 },
    L3: { model: 'sonnet', reasoning_effort: 0.5 },
  },
  complex: {
    L1: { model: 'opus',   reasoning_effort: 0.7 },
    L2: { model: 'opus',   reasoning_effort: 0.5 },
    L3: { model: 'sonnet', reasoning_effort: 0.5 },
  },
  extreme: {
    L1: { model: 'opus',   reasoning_effort: 0.9 },
    L2: { model: 'opus',   reasoning_effort: 0.7 },
    L3: { model: 'opus',   reasoning_effort: 0.5 },
  },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}

function tierUp(current) {
  const idx = MODEL_TIERS.indexOf(current);
  if (idx < 0) return 'sonnet';
  return MODEL_TIERS[Math.min(idx + 1, MODEL_TIERS.length - 1)];
}

function tierDown(current) {
  const idx = MODEL_TIERS.indexOf(current);
  if (idx < 0) return 'local';
  return MODEL_TIERS[Math.max(idx - 1, 0)];
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function makeEffortState(overrides) {
  return {
    reasoning_effort: 0.5,
    temperature: 0.3,
    model_tier: 'sonnet',
    n_variants: 1,
    max_mutation_cycles: 0,
    max_retries: 2,
    token_budget: 10000,
    ...overrides,
  };
}

/**
 * Classify complexity score into a named profile.
 * @param {number} score - 0.0 to 1.0
 * @returns {string} Profile name
 */
function classifyComplexity(score) {
  if (score < 0.2) return 'trivial';
  if (score < 0.4) return 'simple';
  if (score < 0.6) return 'medium';
  if (score < 0.8) return 'complex';
  return 'extreme';
}

/** Valid mid-execution signal types */
const SIGNAL_TYPES = ['struggling', 'confident', 'novel_territory', 'pattern_match'];

// ─── Effort State Persistence ───────────────────────────────────────────────

function getEffortStatePath(projectRoot) {
  return path.join(getGepaDir(projectRoot), 'effort-state.json');
}

/**
 * Load persisted effort controller state.
 * @param {string} projectRoot
 * @returns {object}
 */
function loadEffortState(projectRoot) {
  const filePath = getEffortStatePath(projectRoot);
  const defaults = {
    nodeStates: {},
    escalationLevel: 0,
    failureTraces: [],
    effortHistory: [],
    taskId: null,
    complexityScore: null,
    totalCost: 0,
    createdAt: new Date().toISOString(),
  };
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return { ...defaults, ...data };
  } catch {
    return defaults;
  }
}

/**
 * Save effort controller state.
 * @param {string} projectRoot
 * @param {object} state
 */
function saveEffortState(projectRoot, state) {
  const filePath = getEffortStatePath(projectRoot);
  const gepaDir = path.dirname(filePath);
  try { fs.mkdirSync(gepaDir, { recursive: true }); } catch { /* ok */ }
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
}

// ─── Top-Down: Complexity → Effort (Dual-Axis) ─────────────────────────────

/**
 * Assess complexity and propagate effort down to all nodes.
 * Uses per-level profiles: each L1/L2/L3 gets its own model + effort.
 *
 * @param {string} projectRoot
 * @param {number} complexityScore - 0.0 to 1.0
 * @param {object} [options]
 * @param {string} [options.taskId] - Task identifier
 * @returns {{ nodeStates: object, profile: string, complexityScore: number }}
 */
function assessAndPropagateDown(projectRoot, complexityScore, options = {}) {
  const score = clamp(complexityScore, 0, 1);
  const profileName = classifyComplexity(score);
  const profile = COMPLEXITY_PROFILES[profileName];

  // Build node states from per-level profiles
  const l1 = profile.L1;
  const l2 = profile.L2;
  const l3 = profile.L3;

  const nodeStates = {
    L1_vision: makeEffortState({
      reasoning_effort: l1.reasoning_effort,
      temperature: 0.3 + (score * 0.3),
      model_tier: l1.model,
      n_variants: 1,
      token_budget: Math.round(10000 + score * 10000),
    }),
    L1_variant_gen: makeEffortState({
      reasoning_effort: l1.reasoning_effort,
      temperature: round2(0.5 + score * 0.3),
      model_tier: l1.model,
      n_variants: Math.max(1, Math.round(1 + score * 6)),
      max_mutation_cycles: Math.round(1 + score * 4),
      token_budget: Math.round(12000 + score * 12000),
    }),
    L2_decomposer: makeEffortState({
      reasoning_effort: l2.reasoning_effort,
      temperature: round2(0.4 + score * 0.2),
      model_tier: l2.model,
      n_variants: Math.max(2, Math.round(1 + score * 4)),
      token_budget: Math.round(8000 + score * 8000),
    }),
    L2_selector: makeEffortState({
      reasoning_effort: round2(clamp(l2.reasoning_effort - 0.1, 0.1, 1)),
      temperature: 0.1, // selector always deterministic
      model_tier: l2.model === 'opus' ? 'sonnet' : l2.model, // selector never needs opus
      token_budget: Math.round(5000 + score * 5000),
    }),
    L2_adapter: makeEffortState({
      reasoning_effort: l2.reasoning_effort,
      temperature: round2(0.4 + score * 0.3),
      model_tier: l2.model,
      max_mutation_cycles: Math.round(2 + score * 4),
      token_budget: Math.round(8000 + score * 8000),
    }),
    L3_executor: makeEffortState({
      reasoning_effort: l3.reasoning_effort,
      temperature: 0.2,
      model_tier: l3.model,
      max_retries: Math.round(1 + score * 3),
      token_budget: Math.round(8000 + score * 10000),
    }),
    L3_verifier: makeEffortState({
      reasoning_effort: round2(clamp(l3.reasoning_effort - 0.1, 0.1, 1)),
      temperature: 0.1,
      model_tier: l3.model === 'local' ? 'sonnet' : l3.model, // verifier at least sonnet
      token_budget: Math.round(5000 + score * 5000),
    }),
  };

  // Persist state
  const effortState = loadEffortState(projectRoot);
  effortState.nodeStates = nodeStates;
  effortState.escalationLevel = 0;
  effortState.failureTraces = [];
  effortState.complexityScore = score;
  effortState.taskId = options.taskId || `task-${Date.now().toString(36)}`;
  effortState.totalCost = 0;

  const historyEntry = {
    timestamp: new Date().toISOString(),
    direction: 'top_down',
    trigger: score,
    profile: profileName,
    escalationLevel: 0,
    states: _summarizeStates(nodeStates),
  };
  effortState.effortHistory = [historyEntry];
  saveEffortState(projectRoot, effortState);

  // Log GEPA event
  logEvent(projectRoot, {
    eventType: 'effort_top_down',
    hookType: 'effort',
    details: { complexityScore: score, profile: profileName, taskId: effortState.taskId },
  });

  return { nodeStates, profile: profileName, complexityScore: score };
}

// ─── Bottom-Up: Dual-Axis Escalation Ladder ─────────────────────────────────

/**
 * Handle a node failure — dual-axis escalation.
 * Phase 1 (model): raise model tier, keep effort.
 * Phase 2 (effort): all on opus, raise reasoning_effort.
 * Phase 3: circuit break.
 *
 * @param {string} projectRoot
 * @param {string} failedNode - Node name (e.g. 'L3_executor')
 * @param {object} failureTrace - { reason, details, ... }
 * @returns {{ action: string, level: number, phase?: string, restartFrom?: string, affectedNodes?: Array, reason?: string, costEstimate?: number }}
 */
function handleFailure(projectRoot, failedNode, failureTrace) {
  const effortState = loadEffortState(projectRoot);

  effortState.failureTraces.push({
    node: failedNode,
    timestamp: new Date().toISOString(),
    ...failureTrace,
  });

  effortState.escalationLevel += 1;
  const level = effortState.escalationLevel;

  // Cost check — circuit break if over budget
  const currentCost = estimateCost(effortState.nodeStates);
  if (currentCost > MAX_COST_PER_TASK) {
    effortState.escalationLevel = MAX_ESCALATION_LEVEL;
    saveEffortState(projectRoot, effortState);

    logEvent(projectRoot, {
      eventType: 'effort_circuit_break',
      hookType: 'effort',
      details: { reason: 'cost_exceeded', cost: currentCost, maxCost: MAX_COST_PER_TASK, level },
    });

    return {
      action: 'circuit_break',
      level: MAX_ESCALATION_LEVEL,
      phase: 'circuit_break',
      reason: `Cost $${round2(currentCost)} exceeds max $${MAX_COST_PER_TASK}`,
      recommendation: 'needs_human',
      totalFailures: effortState.failureTraces.length,
    };
  }

  // Get ladder step (clamp to last entry)
  const stepIdx = Math.min(level, ESCALATION_LADDER.length - 1);
  const ladderStep = ESCALATION_LADDER[stepIdx];

  // Circuit break phase
  if (ladderStep.phase === 'circuit_break') {
    effortState.escalationLevel = MAX_ESCALATION_LEVEL;
    saveEffortState(projectRoot, effortState);

    logEvent(projectRoot, {
      eventType: 'effort_circuit_break',
      hookType: 'effort',
      details: { reason: 'max_escalation', level, failures: effortState.failureTraces.length },
    });

    return {
      action: 'circuit_break',
      level: MAX_ESCALATION_LEVEL,
      phase: 'circuit_break',
      reason: `Max escalation level (${MAX_ESCALATION_LEVEL}) reached after ${effortState.failureTraces.length} failures`,
      recommendation: 'needs_human',
      totalFailures: effortState.failureTraces.length,
      costSpent: round2(currentCost),
    };
  }

  // Apply ladder step changes
  const phase = ladderStep.phase;
  const affectedNodes = [];

  for (const [levelKey, params] of Object.entries(ladderStep.changes)) {
    const matchingNodes = Object.keys(effortState.nodeStates).filter(n => n.startsWith(levelKey));
    for (const nodeName of matchingNodes) {
      const oldState = { ...effortState.nodeStates[nodeName] };
      let newState;

      if (phase === 'model') {
        // Phase 1: raise model, keep effort
        newState = {
          ...oldState,
          model_tier: params.model,
          // reasoning_effort stays as-is (will matter when reaching opus)
        };
      } else if (phase === 'effort') {
        // Phase 2: all on opus, raise reasoning_effort
        newState = {
          ...oldState,
          model_tier: 'opus',
          reasoning_effort: params.reasoning_effort,
          n_variants: oldState.n_variants + 1,
          max_mutation_cycles: oldState.max_mutation_cycles + 1,
          token_budget: Math.round(oldState.token_budget * 1.2),
        };
      } else {
        newState = { ...oldState };
      }

      effortState.nodeStates[nodeName] = newState;
      affectedNodes.push({ node: nodeName, old: oldState, new: newState });
    }
  }

  const restartFrom = RESTART_FROM[level] || 'L1';

  // Log history
  effortState.effortHistory.push({
    timestamp: new Date().toISOString(),
    direction: 'bottom_up',
    trigger: `level_${level}`,
    phase,
    escalationLevel: level,
    failedNode,
    reason: failureTrace.reason || '',
    states: _summarizeStates(effortState.nodeStates),
  });

  saveEffortState(projectRoot, effortState);

  logEvent(projectRoot, {
    eventType: 'effort_escalate',
    hookType: 'effort',
    details: { level, phase, failedNode, restartFrom, affectedCount: affectedNodes.length },
  });

  return {
    action: 'escalate',
    level,
    phase,
    restartFrom,
    affectedNodes: affectedNodes.map(n => n.node),
    message: escalationMessage(level, phase, failureTrace, effortState.failureTraces.length),
    costEstimate: round2(estimateCost(effortState.nodeStates)),
  };
}

function escalationMessage(level, phase, failureTrace, totalFailures) {
  const reason = failureTrace.reason || 'unknown';
  if (phase === 'model') {
    return `Phase 1 (model↑) level ${level}: upgrading model tier after failure (${reason}). ${totalFailures} total failures.`;
  }
  if (phase === 'effort') {
    return `Phase 2 (effort↑) level ${level}: all on opus, raising reasoning_effort (${reason}). ${totalFailures} total failures.`;
  }
  return `Escalation level ${level} (${reason})`;
}

// ─── Mid-Execution Tuning (Dual-Axis) ───────────────────────────────────────

/**
 * Tune effort during execution based on a signal.
 * Dual-axis aware:
 *   - struggling: if not opus → upgrade model; if opus → raise effort
 *   - confident: if opus + effort > 0.3 → lower effort; if opus + low effort → downgrade model; else → downgrade model
 *   - novel_territory: jump straight to opus + high effort
 *   - pattern_match: minimize — downgrade model + reduce effort
 *
 * @param {string} projectRoot
 * @param {string} nodeName - e.g. 'L3_executor'
 * @param {string} signalType - 'struggling' | 'confident' | 'novel_territory' | 'pattern_match'
 * @returns {{ success: boolean, newState?: object, error?: string }}
 */
function midExecutionTune(projectRoot, nodeName, signalType) {
  if (!SIGNAL_TYPES.includes(signalType)) {
    return { success: false, error: `Unknown signal: ${signalType}. Valid: ${SIGNAL_TYPES.join(', ')}` };
  }

  const effortState = loadEffortState(projectRoot);
  const current = effortState.nodeStates[nodeName];

  if (!current) {
    return { success: false, error: `Node ${nodeName} not found in effort state` };
  }

  let newState;

  switch (signalType) {
    case 'struggling':
      if (current.model_tier !== 'opus') {
        // Phase 1: not yet on opus → upgrade model
        newState = {
          ...current,
          model_tier: tierUp(current.model_tier),
          token_budget: Math.round(current.token_budget * 1.3),
        };
      } else {
        // Phase 2: already on opus → raise reasoning_effort
        newState = {
          ...current,
          reasoning_effort: round2(clamp(current.reasoning_effort + 0.15, 0, 1)),
          token_budget: Math.round(current.token_budget * 1.3),
        };
      }
      break;

    case 'confident':
      if (current.model_tier === 'opus' && current.reasoning_effort > 0.3) {
        // On opus with room to lower effort → lower effort (stay on opus)
        newState = {
          ...current,
          reasoning_effort: round2(current.reasoning_effort - 0.1),
        };
      } else if (current.model_tier === 'opus' && current.reasoning_effort <= 0.3) {
        // On opus but effort already minimal → downgrade model
        newState = {
          ...current,
          model_tier: 'sonnet',
        };
      } else {
        // Not on opus → downgrade model
        newState = {
          ...current,
          model_tier: tierDown(current.model_tier),
        };
      }
      break;

    case 'novel_territory':
      // Jump straight to opus + high effort
      newState = {
        ...current,
        model_tier: 'opus',
        reasoning_effort: round2(clamp(current.reasoning_effort + 0.25, 0, 1)),
        temperature: round2(clamp(current.temperature + 0.2, 0, 0.9)),
        n_variants: current.n_variants + 2,
        max_mutation_cycles: current.max_mutation_cycles + 1,
        token_budget: Math.round(current.token_budget * 1.5),
      };
      break;

    case 'pattern_match':
      // Minimize: downgrade model + reduce effort
      newState = {
        ...current,
        reasoning_effort: round2(clamp(current.reasoning_effort - 0.2, 0.1, 1)),
        temperature: 0.1,
        model_tier: tierDown(current.model_tier),
        n_variants: 1,
        max_mutation_cycles: 0,
        token_budget: Math.round(current.token_budget * 0.7),
      };
      break;
  }

  effortState.nodeStates[nodeName] = newState;
  effortState.effortHistory.push({
    timestamp: new Date().toISOString(),
    direction: 'mid_execution',
    trigger: signalType,
    node: nodeName,
    escalationLevel: effortState.escalationLevel,
    states: { [nodeName]: _summarizeNode(newState) },
  });

  saveEffortState(projectRoot, effortState);

  logEvent(projectRoot, {
    eventType: 'effort_mid_tune',
    hookType: 'effort',
    details: { nodeName, signalType, phase: newState.model_tier === 'opus' ? 'effort' : 'model' },
  });

  return { success: true, newState };
}

// ─── Cost Estimation (Dual-Axis) ────────────────────────────────────────────

/**
 * Estimate total cost for current effort profile.
 * Opus cost is multiplied by effort: effort 0.3 ≈ 1x, effort 1.0 ≈ 3x.
 * @param {object} nodeStates - { nodeName: effortState, ... }
 * @returns {number} Estimated USD cost
 */
function estimateCost(nodeStates) {
  let total = 0;
  for (const state of Object.values(nodeStates)) {
    const costPer1k = COST_PER_1K_TOKENS[state.model_tier] || 0;
    let nodeCost = costPer1k * (state.token_budget / 1000);
    if (state.model_tier === 'opus') {
      nodeCost *= opusEffortMultiplier(state.reasoning_effort);
    }
    total += nodeCost;
  }
  return round2(total);
}

// ─── Effort Report ──────────────────────────────────────────────────────────

/**
 * Get full effort report for current task.
 * @param {string} projectRoot
 * @returns {object}
 */
function getEffortReport(projectRoot) {
  const effortState = loadEffortState(projectRoot);

  return {
    taskId: effortState.taskId,
    complexityScore: effortState.complexityScore,
    totalEscalations: effortState.escalationLevel,
    totalFailures: effortState.failureTraces.length,
    effortChanges: effortState.effortHistory.length,
    costEstimate: estimateCost(effortState.nodeStates),
    maxCost: MAX_COST_PER_TASK,
    finalStates: _summarizeStates(effortState.nodeStates),
    failureTraces: effortState.failureTraces.map(t => ({
      node: t.node,
      reason: t.reason,
      timestamp: t.timestamp,
    })),
    history: effortState.effortHistory,
  };
}

/**
 * Reset effort controller state (new task).
 * @param {string} projectRoot
 */
function resetEffort(projectRoot) {
  const filePath = getEffortStatePath(projectRoot);
  try { fs.unlinkSync(filePath); } catch { /* ok */ }
}

/**
 * Get the current node states (for external consumers).
 * @param {string} projectRoot
 * @returns {object|null}
 */
function getNodeStates(projectRoot) {
  const effortState = loadEffortState(projectRoot);
  if (!effortState.nodeStates || Object.keys(effortState.nodeStates).length === 0) return null;
  return effortState.nodeStates;
}

/**
 * Get effort for a specific node.
 * @param {string} projectRoot
 * @param {string} nodeName
 * @returns {object|null}
 */
function getNodeEffort(projectRoot, nodeName) {
  const states = getNodeStates(projectRoot);
  return states ? (states[nodeName] || null) : null;
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

function _summarizeNode(state) {
  return {
    effort: state.reasoning_effort,
    temp: state.temperature,
    model: state.model_tier,
    variants: state.n_variants,
    effectiveEffort: effectiveEffort(state),
  };
}

function _summarizeStates(nodeStates) {
  const result = {};
  for (const [name, state] of Object.entries(nodeStates)) {
    result[name] = _summarizeNode(state);
  }
  return result;
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  // Constants
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

  // Helpers
  classifyComplexity,
  tierUp,
  tierDown,
  estimateCost,
  effectiveEffort,
  opusEffortMultiplier,

  // Core operations
  assessAndPropagateDown,
  handleFailure,
  midExecutionTune,

  // State management
  loadEffortState,
  saveEffortState,
  resetEffort,
  getNodeStates,
  getNodeEffort,
  getEffortReport,
};
