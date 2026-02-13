#!/usr/bin/env node
/**
 * context-efficiency-bench.cjs — Benchmarks for context/memory efficiency optimization.
 *
 * 6 benchmarks testing the core hypothesis:
 *   "Targeted minimal context outperforms full memory dumps"
 *
 * Benchmarks:
 *   1. skeleton    — Skeleton index vs full context vs zero context
 *   2. compress    — Raw markdown vs compressed notation vs structured JSON
 *   3. ablation    — 2^N layer combination ablation study
 *   4. diminishing — Marginal value curve as context grows
 *   5. density     — Information density per token by content type
 *   6. delta       — Full reindex vs differential update cost
 *
 * Usage:
 *   node context-efficiency-bench.cjs [benchmark_name|all]
 *   node context-efficiency-bench.cjs skeleton
 *   node context-efficiency-bench.cjs all --json
 *
 * No external dependencies — uses Node.js built-ins only.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `ctx-bench-${prefix}-`));
}

function cleanTmpDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

function round2(n) { return Math.round(n * 100) / 100; }
function round4(n) { return Math.round(n * 10000) / 10000; }

/**
 * Simulate token count — approximation: 1 token ≈ 4 chars for English,
 * ~3 chars for code/mixed content.
 */
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 3.5);
}

/**
 * Simple keyword extraction for relevance scoring.
 */
function extractKeywords(text) {
  return new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9_\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 3 && !STOPWORDS.has(w))
  );
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'are', 'was', 'were',
  'been', 'have', 'has', 'had', 'not', 'but', 'what', 'all', 'can', 'will',
  'one', 'each', 'which', 'their', 'use', 'used', 'using', 'into', 'when',
  'how', 'its', 'also', 'more', 'some', 'than', 'other', 'about', 'out',
]);

/**
 * Jaccard similarity between two keyword sets.
 */
function jaccard(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 0;
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size;
}

// ─── Synthetic Project Generator ────────────────────────────────────────────

/**
 * Generate a realistic synthetic codebase for benchmarking.
 * Returns { files, skeleton, fullContext, tasks }
 */
function generateSyntheticProject() {
  const files = [
    {
      path: 'src/auth/login.ts',
      content: `import { hash } from '../crypto/hash';\nimport { validateEmail } from '../utils/validate';\n\nexport async function login(email: string, password: string): Promise<Session> {\n  const user = await db.findByEmail(email);\n  if (!user) throw new AuthError('USER_NOT_FOUND');\n  const valid = await hash.verify(password, user.passwordHash);\n  if (!valid) throw new AuthError('INVALID_PASSWORD');\n  return createSession(user.id, { expiresIn: '24h' });\n}`,
      exports: ['login'],
      deps: ['crypto/hash', 'utils/validate'],
      type: 'auth',
    },
    {
      path: 'src/auth/session.ts',
      content: `import { sign, verify } from 'jsonwebtoken';\n\nexport function createSession(userId: string, opts: SessionOpts): Session {\n  const token = sign({ sub: userId }, SECRET, { expiresIn: opts.expiresIn });\n  return { token, userId, createdAt: Date.now() };\n}\n\nexport function validateSession(token: string): SessionPayload {\n  return verify(token, SECRET) as SessionPayload;\n}`,
      exports: ['createSession', 'validateSession'],
      deps: ['jsonwebtoken'],
      type: 'auth',
    },
    {
      path: 'src/api/users.ts',
      content: `import { Router } from 'express';\nimport { login } from '../auth/login';\nimport { validateSession } from '../auth/session';\n\nconst router = Router();\n\nrouter.post('/login', async (req, res) => {\n  const { email, password } = req.body;\n  const session = await login(email, password);\n  res.json({ token: session.token });\n});\n\nrouter.get('/me', authMiddleware, async (req, res) => {\n  const user = await db.findById(req.userId);\n  res.json(user);\n});\n\nexport default router;`,
      exports: ['router'],
      deps: ['auth/login', 'auth/session', 'express'],
      type: 'api',
    },
    {
      path: 'src/db/models/user.ts',
      content: `import { Schema, model } from 'mongoose';\n\nconst userSchema = new Schema({\n  email: { type: String, required: true, unique: true },\n  passwordHash: { type: String, required: true },\n  name: { type: String },\n  role: { type: String, enum: ['user', 'admin'], default: 'user' },\n  createdAt: { type: Date, default: Date.now },\n});\n\nuserSchema.index({ email: 1 });\n\nexport const User = model('User', userSchema);`,
      exports: ['User'],
      deps: ['mongoose'],
      type: 'db',
    },
    {
      path: 'src/crypto/hash.ts',
      content: `import bcrypt from 'bcrypt';\n\nconst SALT_ROUNDS = 12;\n\nexport const hash = {\n  async create(password: string): Promise<string> {\n    return bcrypt.hash(password, SALT_ROUNDS);\n  },\n  async verify(password: string, hash: string): Promise<boolean> {\n    return bcrypt.compare(password, hash);\n  },\n};`,
      exports: ['hash'],
      deps: ['bcrypt'],
      type: 'crypto',
    },
    {
      path: 'src/utils/validate.ts',
      content: `export function validateEmail(email: string): boolean {\n  return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email);\n}\n\nexport function validatePassword(password: string): { valid: boolean; errors: string[] } {\n  const errors: string[] = [];\n  if (password.length < 8) errors.push('min 8 chars');\n  if (!/[A-Z]/.test(password)) errors.push('needs uppercase');\n  if (!/[0-9]/.test(password)) errors.push('needs digit');\n  return { valid: errors.length === 0, errors };\n}`,
      exports: ['validateEmail', 'validatePassword'],
      deps: [],
      type: 'utils',
    },
    {
      path: 'src/middleware/auth.ts',
      content: `import { validateSession } from '../auth/session';\n\nexport function authMiddleware(req, res, next) {\n  const token = req.headers.authorization?.replace('Bearer ', '');\n  if (!token) return res.status(401).json({ error: 'No token' });\n  try {\n    const payload = validateSession(token);\n    req.userId = payload.sub;\n    next();\n  } catch {\n    res.status(401).json({ error: 'Invalid token' });\n  }\n}`,
      exports: ['authMiddleware'],
      deps: ['auth/session'],
      type: 'middleware',
    },
    {
      path: 'src/config/index.ts',
      content: `export const config = {\n  port: parseInt(process.env.PORT || '3000'),\n  dbUrl: process.env.DATABASE_URL || 'mongodb://localhost/app',\n  jwtSecret: process.env.JWT_SECRET || 'dev-secret',\n  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '12'),\n  sessionTTL: process.env.SESSION_TTL || '24h',\n};`,
      exports: ['config'],
      deps: [],
      type: 'config',
    },
  ];

  // Generate skeleton (minimal structural info)
  const skeleton = files.map(f => ({
    path: f.path,
    exports: f.exports,
    deps: f.deps,
    lines: f.content.split('\n').length,
  }));

  // Full context (everything)
  const fullContext = [
    '## Project Structure',
    ...files.map(f => `### ${f.path}\n\`\`\`typescript\n${f.content}\n\`\`\``),
    '',
    '## Known Issues',
    '- JWT secret is hardcoded in dev mode',
    '- No rate limiting on login endpoint',
    '- Password validation is basic',
    '',
    '## Recent Changes',
    '- Added bcrypt salt rounds config',
    '- Fixed email validation regex',
    '- Added user role enum',
  ].join('\n');

  // Memory layers (simulating existing 4-layer system)
  const memoryLayers = {
    planning: `## Goal\nRefactor auth module for better security\n\n## Current Phase\nPhase 2: Session management\n\n### Phase 1: Password hashing [complete]\n### Phase 2: Session management [in_progress]\n### Phase 3: Rate limiting [pending]`,
    findings: `## Security Audit\n- bcrypt rounds should be >= 12 ✓\n- JWT expiry set to 24h ✓\n- Missing CSRF protection\n- No brute force protection on login\n\n## Performance\n- User lookup by email uses index ✓\n- Session creation is synchronous — consider async`,
    progress: `## Session 1\n- Implemented bcrypt hashing\n- Created user model with proper schema\n\n## Session 2\n- Added JWT session management\n- Created auth middleware\n\n## Session 3 (current)\n- Working on rate limiting`,
    graphMemory: `[PATTERN] (fit=0.90) Always validate input before DB operations\n[DECISION] (fit=0.85) Use bcrypt over argon2 for compatibility\n[ERROR] (fit=0.75) JWT verify throws on expired tokens — need try/catch\n[PATTERN] (fit=0.70) Extract middleware to separate files\n[FACT] (fit=0.60) mongoose index on email field for fast lookups`,
  };

  // Tasks to benchmark against
  const tasks = [
    {
      id: 'task-1',
      description: 'Add rate limiting to the login endpoint',
      relevant_files: ['src/api/users.ts', 'src/auth/login.ts', 'src/middleware/auth.ts'],
      relevant_keywords: new Set(['rate', 'limit', 'login', 'endpoint', 'middleware', 'brute', 'force']),
    },
    {
      id: 'task-2',
      description: 'Fix the JWT secret hardcoding issue in production',
      relevant_files: ['src/config/index.ts', 'src/auth/session.ts'],
      relevant_keywords: new Set(['jwt', 'secret', 'config', 'production', 'environment', 'variable']),
    },
    {
      id: 'task-3',
      description: 'Add password validation to the registration flow',
      relevant_files: ['src/utils/validate.ts', 'src/auth/login.ts', 'src/api/users.ts'],
      relevant_keywords: new Set(['password', 'validate', 'registration', 'register', 'signup']),
    },
  ];

  return { files, skeleton, fullContext, memoryLayers, tasks };
}

// ─── Bench 1: Skeleton Index ────────────────────────────────────────────────

/**
 * Hypothesis: Minimal structural index is more token-efficient than full dumps
 * while maintaining similar task-relevance scores.
 */
function benchSkeleton() {
  const start = Date.now();
  const project = generateSyntheticProject();

  // Strategy A: Full context (all code + memory)
  const fullCtx = project.fullContext;

  // Strategy B: Skeleton index
  const skeletonCtx = [
    '## File Map',
    ...project.skeleton.map(f =>
      `${f.path} → exports:[${f.exports.join(',')}] deps:[${f.deps.join(',')}] (${f.lines}L)`
    ),
    '',
    '## Active Decisions',
    '- bcrypt over argon2 (compatibility)',
    '- JWT 24h expiry',
    '- mongoose for DB',
    '',
    '## Known Issues',
    '- No rate limiting on login',
    '- Hardcoded JWT secret in dev',
  ].join('\n');

  // Strategy C: Compressed skeleton
  const compressedCtx = [
    '[MAP]',
    ...project.skeleton.map(f =>
      `${f.path}→${f.exports.join(',')}|${f.deps.length}deps|${f.lines}L`
    ),
    '[DECISIONS] bcrypt(compat) jwt-24h mongoose',
    '[ISSUES] no-ratelimit hardcoded-jwt-dev',
  ].join('\n');

  // Strategy D: Zero context (nothing)
  const zeroCtx = '';

  const strategies = {
    full_context: fullCtx,
    skeleton: skeletonCtx,
    compressed_skeleton: compressedCtx,
    zero_context: zeroCtx,
  };

  const results = {};

  for (const [name, ctx] of Object.entries(strategies)) {
    const tokens = estimateTokens(ctx);
    const ctxKeywords = extractKeywords(ctx);

    // Score: how many task-relevant keywords are present in context?
    const taskScores = project.tasks.map(task => {
      const relevance = jaccard(ctxKeywords, task.relevant_keywords);
      // File coverage: how many relevant files are mentioned?
      const fileMentions = task.relevant_files.filter(f =>
        ctx.toLowerCase().includes(f.toLowerCase()) ||
        ctx.includes(path.basename(f).replace('.ts', ''))
      ).length;
      const fileCoverage = fileMentions / task.relevant_files.length;
      return { task: task.id, relevance: round4(relevance), fileCoverage: round2(fileCoverage) };
    });

    const avgRelevance = round4(taskScores.reduce((s, t) => s + t.relevance, 0) / taskScores.length);
    const avgFileCoverage = round2(taskScores.reduce((s, t) => s + t.fileCoverage, 0) / taskScores.length);

    results[name] = {
      tokens,
      chars: ctx.length,
      avg_relevance: avgRelevance,
      avg_file_coverage: avgFileCoverage,
      efficiency: tokens > 0 ? round4(avgRelevance / (tokens / 1000)) : 0, // relevance per 1K tokens
      task_scores: taskScores,
    };
  }

  // Compute relative metrics
  const fullTokens = results.full_context.tokens;
  for (const [name, r] of Object.entries(results)) {
    r.token_savings_vs_full = round2(1 - r.tokens / Math.max(fullTokens, 1));
    r.efficiency_vs_full = fullTokens > 0
      ? round2(r.efficiency / Math.max(results.full_context.efficiency, 0.0001))
      : 0;
  }

  return {
    bench: 'skeleton',
    metrics: {
      strategies: results,
      winner: Object.entries(results)
        .filter(([k]) => k !== 'zero_context')
        .sort((a, b) => b[1].efficiency - a[1].efficiency)[0][0],
      hypotheses: ['skeleton_index_more_efficient', 'compressed_even_better'],
    },
    duration_ms: Date.now() - start,
  };
}

// ─── Bench 2: Context Compression ──────────────────────────────────────────

/**
 * Hypothesis: Compressed context preserves information while using fewer tokens.
 * Tests multiple compression strategies.
 */
function benchCompress() {
  const start = Date.now();
  const project = generateSyntheticProject();

  // Original planning context
  const rawPlanning = project.memoryLayers.planning;
  const rawFindings = project.memoryLayers.findings;
  const rawProgress = project.memoryLayers.progress;
  const rawGraph = project.memoryLayers.graphMemory;
  const rawTotal = [rawPlanning, rawFindings, rawProgress, rawGraph].join('\n\n---\n\n');

  // Compression Strategy 1: Symbolic notation
  const symbolicPlanning = '[PLAN] Auth security refactor | Ph2/3 sessions | ✓hash ⟳sessions ○ratelimit';
  const symbolicFindings = '[AUDIT] ✓bcrypt≥12 ✓jwt-24h ✗csrf ✗bruteforce | [PERF] ✓email-idx ⚠sync-session';
  const symbolicProgress = '[S1]✓bcrypt+schema [S2]✓jwt+middleware [S3]⟳ratelimit';
  const symbolicGraph = '[P]validate→db(0.9) [D]bcrypt>argon2(0.85) [E]jwt-verify-catch(0.75) [P]extract-mw(0.7)';
  const symbolicTotal = [symbolicPlanning, symbolicFindings, symbolicProgress, symbolicGraph].join('\n');

  // Compression Strategy 2: Structured JSON
  const jsonCompressed = JSON.stringify({
    plan: { goal: 'auth-security', phase: '2/3', done: ['hash'], active: ['sessions'], pending: ['ratelimit'] },
    audit: { ok: ['bcrypt12', 'jwt24h'], fail: ['csrf', 'bruteforce'] },
    perf: { ok: ['email_idx'], warn: ['sync_session'] },
    sessions: [{ n: 1, done: 'bcrypt+schema' }, { n: 2, done: 'jwt+mw' }, { n: 3, active: 'ratelimit' }],
    patterns: [{ t: 'P', s: 0.9, v: 'validate_before_db' }, { t: 'D', s: 0.85, v: 'bcrypt_compat' }],
  });

  // Compression Strategy 3: One-liner summary
  const oneLiner = 'Auth refactor Ph2/3: ✓bcrypt ✓jwt ⟳sessions ○ratelimit. Issues: no csrf/bruteforce. Patterns: validate→db, bcrypt>argon2.';

  const strategies = {
    raw_markdown: rawTotal,
    symbolic_notation: symbolicTotal,
    structured_json: jsonCompressed,
    one_liner: oneLiner,
  };

  const results = {};
  const rawKeywords = extractKeywords(rawTotal);

  for (const [name, text] of Object.entries(strategies)) {
    const tokens = estimateTokens(text);
    const keywords = extractKeywords(text);

    // Information preservation: how many of the raw keywords survive compression?
    const rawKwArray = [...rawKeywords];
    const preserved = rawKwArray.filter(kw => keywords.has(kw)).length;
    const preservation = round4(preserved / Math.max(rawKwArray.length, 1));

    // Task relevance
    const taskRelevance = project.tasks.map(task =>
      round4(jaccard(keywords, task.relevant_keywords))
    );
    const avgTaskRelevance = round4(taskRelevance.reduce((s, v) => s + v, 0) / taskRelevance.length);

    results[name] = {
      tokens,
      chars: text.length,
      compression_ratio: round2(rawTotal.length / Math.max(text.length, 1)),
      keyword_preservation: preservation,
      avg_task_relevance: avgTaskRelevance,
      info_density: round4(preservation / (tokens / 1000)), // preserved info per 1K tokens
    };
  }

  return {
    bench: 'compress',
    metrics: {
      strategies: results,
      raw_keywords_count: rawKeywords.size,
      best_density: Object.entries(results)
        .sort((a, b) => b[1].info_density - a[1].info_density)[0][0],
      best_preservation: Object.entries(results)
        .sort((a, b) => b[1].keyword_preservation - a[1].keyword_preservation)[0][0],
      hypotheses: ['compressed_preserves_info', 'symbolic_best_density'],
    },
    duration_ms: Date.now() - start,
  };
}

// ─── Bench 3: Layer Ablation ────────────────────────────────────────────────

/**
 * Hypothesis: Not all memory layers contribute equally.
 * Ablation study: test all 2^4 combinations of layers.
 */
function benchAblation() {
  const start = Date.now();
  const project = generateSyntheticProject();

  const layers = {
    planning: project.memoryLayers.planning,
    findings: project.memoryLayers.findings,
    progress: project.memoryLayers.progress,
    graphMemory: project.memoryLayers.graphMemory,
  };

  const layerNames = Object.keys(layers);
  const combinations = [];

  // Generate all 2^4 = 16 combinations
  for (let mask = 0; mask < (1 << layerNames.length); mask++) {
    const combo = {};
    const included = [];
    for (let i = 0; i < layerNames.length; i++) {
      if (mask & (1 << i)) {
        combo[layerNames[i]] = layers[layerNames[i]];
        included.push(layerNames[i]);
      }
    }
    combinations.push({ mask, included, layers: combo });
  }

  const results = combinations.map(combo => {
    const context = Object.values(combo.layers).join('\n\n---\n\n');
    const tokens = estimateTokens(context);
    const keywords = extractKeywords(context);

    // Score against all tasks
    const taskScores = project.tasks.map(task => {
      const relevance = jaccard(keywords, task.relevant_keywords);
      return round4(relevance);
    });
    const avgRelevance = round4(taskScores.reduce((s, v) => s + v, 0) / taskScores.length);

    return {
      layers: combo.included,
      layer_count: combo.included.length,
      tokens,
      avg_relevance: avgRelevance,
      efficiency: tokens > 0 ? round4(avgRelevance / (tokens / 1000)) : 0,
    };
  });

  // Sort by efficiency (relevance per token)
  results.sort((a, b) => b.efficiency - a.efficiency);

  // Compute marginal value for each layer
  const fullResult = results.find(r => r.layer_count === layerNames.length);
  const marginalValues = {};

  for (const layer of layerNames) {
    // Find combo with all layers EXCEPT this one
    const without = results.find(r =>
      r.layer_count === layerNames.length - 1 &&
      !r.layers.includes(layer)
    );
    // Find combo with ONLY this layer
    const onlyThis = results.find(r =>
      r.layer_count === 1 &&
      r.layers.includes(layer)
    );

    if (fullResult && without) {
      const deltaRelevance = fullResult.avg_relevance - without.avg_relevance;
      const deltaTokens = fullResult.tokens - without.tokens;
      marginalValues[layer] = {
        delta_relevance: round4(deltaRelevance),
        delta_tokens: deltaTokens,
        marginal_efficiency: deltaTokens > 0 ? round4(deltaRelevance / (deltaTokens / 1000)) : 0,
        solo_relevance: onlyThis ? onlyThis.avg_relevance : 0,
        solo_tokens: onlyThis ? onlyThis.tokens : 0,
      };
    }
  }

  return {
    bench: 'ablation',
    metrics: {
      total_combinations: combinations.length,
      top_5_efficient: results.slice(0, 5).map(r => ({
        layers: r.layers, tokens: r.tokens, relevance: r.avg_relevance, efficiency: r.efficiency,
      })),
      marginal_values: marginalValues,
      most_valuable_layer: Object.entries(marginalValues)
        .sort((a, b) => b[1].marginal_efficiency - a[1].marginal_efficiency)[0]?.[0],
      least_valuable_layer: Object.entries(marginalValues)
        .sort((a, b) => a[1].marginal_efficiency - b[1].marginal_efficiency)[0]?.[0],
      hypotheses: ['not_all_layers_equal', 'planning_highest_value'],
    },
    duration_ms: Date.now() - start,
  };
}

// ─── Bench 4: Diminishing Returns Curve ─────────────────────────────────────

/**
 * Hypothesis: Information value follows diminishing returns.
 * At some point, adding more context hurts more than helps.
 */
function benchDiminishing() {
  const start = Date.now();
  const project = generateSyntheticProject();

  // Create a pool of context chunks ordered by estimated value
  const chunks = [];

  // High value: skeleton entries
  for (const f of project.skeleton) {
    chunks.push({
      content: `${f.path} → exports:[${f.exports.join(',')}] deps:[${f.deps.join(',')}]`,
      value: 'high',
      type: 'skeleton',
    });
  }

  // Medium value: findings
  for (const line of project.memoryLayers.findings.split('\n').filter(l => l.trim())) {
    chunks.push({ content: line, value: 'medium', type: 'findings' });
  }

  // Medium value: planning phases
  for (const line of project.memoryLayers.planning.split('\n').filter(l => l.trim())) {
    chunks.push({ content: line, value: 'medium', type: 'planning' });
  }

  // Low value: full code
  for (const f of project.files) {
    for (const line of f.content.split('\n')) {
      chunks.push({ content: `${f.path}: ${line}`, value: 'low', type: 'code' });
    }
  }

  // Low value: progress history
  for (const line of project.memoryLayers.progress.split('\n').filter(l => l.trim())) {
    chunks.push({ content: line, value: 'low', type: 'progress' });
  }

  // Sort: high → medium → low (simulating intelligent ordering)
  const valueOrder = { high: 0, medium: 1, low: 2 };
  chunks.sort((a, b) => valueOrder[a.value] - valueOrder[b.value]);

  // Measure coverage at different budget levels
  const budgets = [5, 10, 20, 30, 50, 75, 100, chunks.length];
  const coveragePoints = [];

  for (const budget of budgets) {
    const selected = chunks.slice(0, Math.min(budget, chunks.length));
    const context = selected.map(c => c.content).join('\n');
    const tokens = estimateTokens(context);
    const keywords = extractKeywords(context);

    const taskCoverage = project.tasks.map(task => jaccard(keywords, task.relevant_keywords));
    const avgCoverage = round4(taskCoverage.reduce((s, v) => s + v, 0) / taskCoverage.length);

    coveragePoints.push({
      chunks: selected.length,
      tokens,
      avg_coverage: avgCoverage,
      types: {
        skeleton: selected.filter(c => c.type === 'skeleton').length,
        findings: selected.filter(c => c.type === 'findings').length,
        planning: selected.filter(c => c.type === 'planning').length,
        code: selected.filter(c => c.type === 'code').length,
        progress: selected.filter(c => c.type === 'progress').length,
      },
    });
  }

  // Compute marginal gains
  const marginalGains = [];
  for (let i = 1; i < coveragePoints.length; i++) {
    const prev = coveragePoints[i - 1];
    const curr = coveragePoints[i];
    const deltaTokens = curr.tokens - prev.tokens;
    const deltaCoverage = curr.avg_coverage - prev.avg_coverage;
    marginalGains.push({
      from_chunks: prev.chunks,
      to_chunks: curr.chunks,
      delta_tokens: deltaTokens,
      delta_coverage: round4(deltaCoverage),
      marginal_rate: deltaTokens > 0 ? round4(deltaCoverage / (deltaTokens / 1000)) : 0,
    });
  }

  // Find optimal point (where marginal gain drops below 50% of initial)
  const initialRate = marginalGains[0]?.marginal_rate || 0;
  const optimalIdx = marginalGains.findIndex(g => g.marginal_rate < initialRate * 0.5);
  const optimalBudget = optimalIdx >= 0
    ? coveragePoints[optimalIdx + 1]
    : coveragePoints[coveragePoints.length - 1];

  return {
    bench: 'diminishing',
    metrics: {
      total_chunks: chunks.length,
      coverage_curve: coveragePoints,
      marginal_gains: marginalGains,
      diminishing_confirmed: marginalGains.length > 1 &&
        marginalGains[marginalGains.length - 1].marginal_rate < marginalGains[0].marginal_rate,
      optimal_point: {
        chunks: optimalBudget.chunks,
        tokens: optimalBudget.tokens,
        coverage: optimalBudget.avg_coverage,
      },
      coverage_at_optimal_vs_full: round4(
        optimalBudget.avg_coverage / Math.max(coveragePoints[coveragePoints.length - 1].avg_coverage, 0.001)
      ),
      token_savings_at_optimal: round2(
        1 - optimalBudget.tokens / Math.max(coveragePoints[coveragePoints.length - 1].tokens, 1)
      ),
      hypotheses: ['diminishing_returns_exist', 'optimal_budget_is_30_50_percent'],
    },
    duration_ms: Date.now() - start,
  };
}

// ─── Bench 5: Information Density ───────────────────────────────────────────

/**
 * Hypothesis: Different content types have different information density.
 * Some types (skeleton, decisions) pack more signal per token than others (progress logs).
 */
function benchDensity() {
  const start = Date.now();
  const project = generateSyntheticProject();

  const contentTypes = {
    skeleton: project.skeleton.map(f =>
      `${f.path} → exports:[${f.exports.join(',')}] deps:[${f.deps.join(',')}]`
    ).join('\n'),

    decisions: [
      'Use bcrypt over argon2 for cross-platform compatibility',
      'JWT tokens with 24h expiry for session management',
      'Mongoose with indexed email field for user lookups',
      'Express Router pattern for API endpoints',
      'Middleware pattern for auth checks',
    ].join('\n'),

    findings: project.memoryLayers.findings,
    planning: project.memoryLayers.planning,
    progress: project.memoryLayers.progress,
    graph_memory: project.memoryLayers.graphMemory,

    full_code: project.files.map(f => f.content).join('\n\n'),

    import_graph: project.files.map(f =>
      `${f.path} → [${f.deps.join(', ')}]`
    ).join('\n'),
  };

  const results = {};

  for (const [type, content] of Object.entries(contentTypes)) {
    const tokens = estimateTokens(content);
    const keywords = extractKeywords(content);
    const uniqueKeywords = keywords.size;

    // Task relevance per token
    const taskScores = project.tasks.map(task => jaccard(keywords, task.relevant_keywords));
    const avgRelevance = round4(taskScores.reduce((s, v) => s + v, 0) / taskScores.length);

    results[type] = {
      tokens,
      chars: content.length,
      unique_keywords: uniqueKeywords,
      keyword_density: tokens > 0 ? round4(uniqueKeywords / (tokens / 100)) : 0, // unique KW per 100 tokens
      avg_task_relevance: avgRelevance,
      relevance_per_1k_tokens: tokens > 0 ? round4(avgRelevance / (tokens / 1000)) : 0,
    };
  }

  // Rank by relevance_per_1k_tokens
  const ranked = Object.entries(results)
    .sort((a, b) => b[1].relevance_per_1k_tokens - a[1].relevance_per_1k_tokens)
    .map(([name, r], i) => ({ rank: i + 1, type: name, ...r }));

  return {
    bench: 'density',
    metrics: {
      content_types: results,
      ranking: ranked.map(r => ({ rank: r.rank, type: r.type, rel_per_1k: r.relevance_per_1k_tokens, tokens: r.tokens })),
      highest_density: ranked[0].type,
      lowest_density: ranked[ranked.length - 1].type,
      density_spread: round4(ranked[0].relevance_per_1k_tokens - ranked[ranked.length - 1].relevance_per_1k_tokens),
      hypotheses: ['skeleton_highest_density', 'full_code_lowest_density', 'decisions_high_density'],
    },
    duration_ms: Date.now() - start,
  };
}

// ─── Bench 6: Delta vs Full Reindex ─────────────────────────────────────────

/**
 * Hypothesis: Between sessions, <5% of codebase changes.
 * Delta-based memory update uses far fewer tokens than full reindex.
 */
function benchDelta() {
  const start = Date.now();
  const project = generateSyntheticProject();

  // Simulate 5 sessions with incremental changes
  const sessions = [
    {
      id: 'session-1',
      changes: [
        { file: 'src/auth/login.ts', type: 'modify', description: 'Added rate limit check before login attempt' },
      ],
    },
    {
      id: 'session-2',
      changes: [
        { file: 'src/middleware/ratelimit.ts', type: 'create', description: 'New rate limiting middleware using sliding window' },
        { file: 'src/api/users.ts', type: 'modify', description: 'Applied ratelimit middleware to login route' },
      ],
    },
    {
      id: 'session-3',
      changes: [
        { file: 'src/config/index.ts', type: 'modify', description: 'Added RATE_LIMIT_WINDOW and RATE_LIMIT_MAX env vars' },
      ],
    },
    {
      id: 'session-4',
      changes: [
        { file: 'src/auth/session.ts', type: 'modify', description: 'Switch JWT secret to config import' },
        { file: 'src/auth/login.ts', type: 'modify', description: 'Added failed attempt counter' },
      ],
    },
    {
      id: 'session-5',
      changes: [
        { file: 'src/utils/validate.ts', type: 'modify', description: 'Added password strength scoring' },
      ],
    },
  ];

  // Full reindex: reload entire project context each session
  const fullIndexTokens = estimateTokens(project.fullContext);

  const results = sessions.map(session => {
    // Delta: only the changes
    const deltaLines = session.changes.map(c =>
      `[${c.type.toUpperCase()}] ${c.file}: ${c.description}`
    );
    const deltaContext = deltaLines.join('\n');
    const deltaTokens = estimateTokens(deltaContext);

    // Skeleton + delta
    const skeletonDelta = [
      ...project.skeleton.map(f => `${f.path}→${f.exports.join(',')}`),
      '---',
      `[Session ${session.id}]`,
      ...deltaLines,
    ].join('\n');
    const skeletonDeltaTokens = estimateTokens(skeletonDelta);

    return {
      session: session.id,
      changes_count: session.changes.length,
      full_reindex_tokens: fullIndexTokens,
      delta_only_tokens: deltaTokens,
      skeleton_plus_delta_tokens: skeletonDeltaTokens,
      savings_delta_vs_full: round2(1 - deltaTokens / fullIndexTokens),
      savings_skeleton_delta_vs_full: round2(1 - skeletonDeltaTokens / fullIndexTokens),
    };
  });

  // Cumulative over 5 sessions
  const totalFullTokens = fullIndexTokens * sessions.length;
  const totalDeltaTokens = results.reduce((s, r) => s + r.delta_only_tokens, 0);
  const totalSkeletonDelta = results.reduce((s, r) => s + r.skeleton_plus_delta_tokens, 0);

  // First session needs full index + all subsequent use delta
  const hybridTokens = fullIndexTokens + results.slice(1).reduce((s, r) => s + r.skeleton_plus_delta_tokens, 0);

  return {
    bench: 'delta',
    metrics: {
      sessions: results,
      cumulative: {
        total_full_reindex_tokens: totalFullTokens,
        total_delta_only_tokens: totalDeltaTokens,
        total_skeleton_delta_tokens: totalSkeletonDelta,
        hybrid_tokens: hybridTokens, // full first + delta rest
        savings_delta_vs_full: round2(1 - totalDeltaTokens / totalFullTokens),
        savings_skeleton_delta_vs_full: round2(1 - totalSkeletonDelta / totalFullTokens),
        savings_hybrid_vs_full: round2(1 - hybridTokens / totalFullTokens),
      },
      avg_changes_per_session: round2(sessions.reduce((s, sess) => s + sess.changes.length, 0) / sessions.length),
      hypotheses: ['delta_saves_80_percent', 'skeleton_delta_optimal', 'hybrid_best_first_session'],
    },
    duration_ms: Date.now() - start,
  };
}

// ─── Runner ─────────────────────────────────────────────────────────────────

const BENCHMARKS = {
  skeleton:    { fn: benchSkeleton,    desc: 'Skeleton index vs full context vs zero' },
  compress:    { fn: benchCompress,    desc: 'Raw markdown vs compressed representations' },
  ablation:    { fn: benchAblation,    desc: '2^N layer combination ablation study' },
  diminishing: { fn: benchDiminishing, desc: 'Marginal value curve as context grows' },
  density:     { fn: benchDensity,     desc: 'Information density per token by content type' },
  delta:       { fn: benchDelta,       desc: 'Full reindex vs differential update cost' },
};

function runBench(name) {
  if (name === 'all') {
    const results = {};
    for (const [key, { fn }] of Object.entries(BENCHMARKS)) {
      try {
        results[key] = fn();
      } catch (e) {
        results[key] = { bench: key, error: e.message, duration_ms: 0 };
      }
    }
    return results;
  }
  return BENCHMARKS[name].fn();
}

function printResult(r) {
  if (r.error) {
    console.log(`  ERROR: ${r.error}`);
    return;
  }
  console.log(`\n═══ ${r.bench.toUpperCase()} ═══`);
  console.log(`Duration: ${r.duration_ms}ms\n`);
  console.log(JSON.stringify(r.metrics, null, 2));
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const sub = args[0] || 'all';
  const isJson = args.includes('--json');

  const validNames = [...Object.keys(BENCHMARKS), 'all'];
  if (!validNames.includes(sub)) {
    console.log(`Usage: node context-efficiency-bench.cjs [${validNames.join('|')}] [--json]`);
    process.exit(1);
  }

  console.log(`Running: ${sub}...\n`);
  const result = runBench(sub);

  if (isJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (sub === 'all') {
    for (const [, r] of Object.entries(result)) {
      printResult(r);
    }
    console.log('\n═══ SUMMARY ═══');
    for (const [key, r] of Object.entries(result)) {
      const status = r.error ? '✗' : '✓';
      const time = `${r.duration_ms}ms`;
      console.log(`  ${status} ${key.padEnd(12)} ${time}`);
    }
  } else {
    printResult(result);
  }
}

// ─── Exports (for testing) ───────────────────────────────────────────────────

module.exports = {
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
};

if (require.main === module) {
  main();
}
