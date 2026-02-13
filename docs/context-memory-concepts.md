# Context Memory Optimization: Концепции для бенчмарков

## Диагноз: почему агент БЕЗ индекса был точнее и дешевле

### Что произошло

Агент A (с MCP + planning files) = больше токенов, хуже результат
Агент B (сток, без индекса) = меньше токенов, точнее

### Корневая причина: Attention Dilution Problem

Модели-трансформеры работают через механизм внимания (attention). Когда ты загружаешь в контекст 10K символов из 4 слоёв памяти, модель:

1. **Тратит токены на ЧТЕНИЕ индекса** — прежде чем что-то делать, модель "переваривает" весь контекст
2. **Размазывает attention по нерелевантным чанкам** — даже если 80% памяти нерелевантно текущей задаче, модель всё равно обрабатывает её
3. **Создаёт anchoring bias** — модель "привязывается" к паттернам из памяти вместо того, чтобы свежо анализировать код
4. **Стоковый агент работает "чанками"** — он открывает файлы по необходимости, каждый раз получая точно релевантный контекст

**Ключевой инсайт**: файловая система — это уже RAG. Когда Claude Code открывает файл через `Read`, он получает идеально таргетированный контекст. Заранее загруженный индекс — это по сути "pre-fetch" который часто промахивается.

---

## 7 Концепций для бенчмарков

### Концепция 1: Skeleton Index (Скелетный индекс)

**Гипотеза**: Минимальный структурный индекс (имена файлов + сигнатуры функций + связи) эффективнее полного дампа кода.

```
БЫЛО (full context): ~10K chars
├── Полные findings.md
├── Полный progress.md  
├── GraphMemory dump (все ноды)
└── MEMORY.md sections

СТАЛО (skeleton): ~2K chars
├── file_map: {path → [exports, deps]}
├── recent_changes: [last 3 diffs summary, 1 line each]
├── active_decisions: [max 5 key decisions]
└── anti_patterns: [max 3 known pitfalls]
```

**Бенчмарк**: Замерить hit_rate и токены для одной и той же задачи при:
- skeleton (2K chars)
- full_context (10K chars)
- zero_context (0 chars, сток)

**Метрика**: `accuracy_per_token = task_completion_score / total_tokens_used`

---

### Концепция 2: Lazy Retrieval (Ленивая подгрузка)

**Гипотеза**: Вместо загрузки всего контекста на SessionStart, подгружать только по запросу через PreToolUse hook.

```
SessionStart: загружаем ТОЛЬКО skeleton (200 tokens)
PreToolUse(Read file X): 
  → hook ищет в GraphMemory всё, связанное с X
  → инжектит micro-context (50-100 tokens) про конкретный файл
PreToolUse(Edit file Y):
  → hook инжектит known_issues + anti_patterns для Y
```

**Бенчмарк**: Сравнить суммарные токены за сессию:
- eager_load (всё на старте) 
- lazy_load (по запросу)
- hybrid (skeleton + lazy)

**Метрика**: `total_tokens` при одинаковом `task_completion_score`

---

### Концепция 3: Differential Memory (Дифференциальная память)

**Гипотеза**: Между сессиями меняется <5% кодовой базы. Храни только дельту.

```
Session N: полный индекс (baseline snapshot)
Session N+1: 
  baseline_hash: "abc123"
  delta: [
    {file: "src/lib/gepa-core.cjs", change: "added fitness decay", lines: [45-67]},
    {file: "hooks/memory-bridge.cjs", change: "fixed PII regex", lines: [66-73]}
  ]
  → модель получает: skeleton + delta (вместо повторного полного индекса)
```

**Бенчмарк**: 
- Симулировать 10 сессий с инкрементальными изменениями
- Замерить токены при full_reindex vs delta_only
- Проверить accuracy на задаче "what changed and why"

**Метрика**: `token_savings = 1 - (delta_tokens / full_tokens)` при `accuracy_delta < 5%`

---

### Концепция 4: Compressed Embeddings Index (Сжатый индекс через эмбеддинги)

**Гипотеза**: Вместо текстового индекса — использовать кластеризованные эмбеддинги как "карту памяти".

```
Offline (один раз):
  1. Эмбеддинг каждого файла/функции через local model (e5-small, ~33M params)
  2. Кластеризация: K-Means → 10-20 кластеров
  3. Для каждого кластера: centroid + top-3 representative entries (summary)

Runtime (каждая сессия):
  4. Эмбеддинг текущей задачи
  5. Cosine similarity → top-3 кластера
  6. Загрузить ТОЛЬКО summaries этих кластеров (~500 tokens)
```

**Бенчмарк**:
- Подготовить 20 задач разной сложности
- Для каждой: embedding_retrieval vs full_context vs keyword_search
- Измерить precision@k и recall@k для k={3,5,10}

**Метрика**: `retrieval_precision * accuracy / tokens_used`

---

### Концепция 5: Context Compression Ratio (Сжатие контекста)

**Гипотеза**: Текущий load-context загружает сырой markdown. Можно сжать в 3-5x через:

```
RAW (сейчас):
## Planning Context (task_plan.md)
**Goal:** Implement GEPA fitness engine
**Current Phase:** Phase 3: Testing
**Phases:**
  1. Core schema [complete]
  2. Fitness calc [complete]
  3. Testing [in_progress]
  4. Integration [pending]

COMPRESSED (предлагаю):
[PLAN] GEPA fitness | Ph3/4 Testing | ✓schema ✓fitness ⟳test ○integration

RAW: ~400 chars → COMPRESSED: ~70 chars (5.7x сжатие)
```

**Бенчмарк**: Для одной и той же задачи сравнить:
- raw_markdown (как сейчас)
- compressed_notation (символьная нотация)
- structured_json (JSON с сокращёнными ключами)
- bullet_summary (1 пункт на секцию)

**Метрика**: `comprehension_accuracy / context_tokens`

---

### Концепция 6: Attention Budget Profiling (Профилирование бюджета внимания)

**Гипотеза**: Не все части контекста одинаково полезны. Можно профилировать какие чанки реально влияют на качество.

```
Эксперимент (ablation study):
1. Полный контекст → run task → score = 0.85, tokens = 50K
2. Убрать GraphMemory → run task → score = 0.83, tokens = 40K  (δ = -0.02, saved 10K)
3. Убрать findings.md → run task → score = 0.80, tokens = 35K  (δ = -0.05, saved 15K)
4. Убрать progress.md → run task → score = 0.84, tokens = 38K  (δ = -0.01, saved 12K)
5. Убрать planning → run task → score = 0.70, tokens = 30K     (δ = -0.15, saved 20K)
6. Оставить ТОЛЬКО skeleton → run task → score = 0.82, tokens = 25K

→ Вывод: planning даёт 80% пользы, остальное — шум
→ Optimal: skeleton + planning_summary + lazy_retrieve
```

**Бенчмарк**: Ablation matrix — 2^N комбинаций слоёв, замер accuracy и tokens

**Метрика**: `marginal_value(layer) = Δaccuracy / Δtokens` для каждого слоя

---

### Концепция 7: Session-Aware Caching (Кэширование с учётом сессий)

**Гипотеза**: Модель работает над одним и тем же проектом сессия за сессией. Prompt caching Anthropic позволяет переиспользовать prefix.

```
Prompt structure:
[SYSTEM: cached prefix — не меняется] ← prompt cache hit
├── Project skeleton (2K tokens)
├── Constant memory / proven patterns
└── Architecture overview

[DYNAMIC: меняется каждую сессию]
├── Delta since last session (200-500 tokens)
├── Current task description
└── Micro-context from lazy retrieval
```

**Экономия**: При prompt caching cached tokens стоят 90% дешевле. Если 80% контекста стабильно — экономия ~70% на input tokens.

**Бенчмарк**: Симулировать 10 сессий, подсчитать:
- cache_hit_ratio (% стабильного контекста)
- cost_savings при кэшировании
- accuracy_stability (не деградирует ли от кэша)

---

## Матрица бенчмарков

| # | Концепция | Что измеряем | Baseline | Expected gain |
|---|-----------|--------------|----------|---------------|
| 1 | Skeleton Index | accuracy_per_token | full_context | 2-3x tokens savings |
| 2 | Lazy Retrieval | total_tokens per session | eager_load | 30-50% reduction |
| 3 | Differential Memory | reindex_tokens | full_reindex | 80-95% savings |
| 4 | Embeddings Index | retrieval_precision | keyword_search | +20-30% precision |
| 5 | Compression | comprehension/tokens | raw_markdown | 3-5x compression |
| 6 | Attention Profiling | marginal_value per layer | equal weights | identify 80/20 |
| 7 | Session Caching | cost per session | no caching | 60-70% cost reduction |

---

## Приоритетный порядок реализации

### Phase 1: Quick Wins (можно проверить сейчас)
1. **Концепция 5** (Compression) — просто переписать load-context, замерить
2. **Концепция 6** (Ablation) — выключать слои по одному, замерить 
3. **Концепция 1** (Skeleton) — новый формат индекса, замерить

### Phase 2: Architecture Changes
4. **Концепция 2** (Lazy Retrieval) — переделать hook pipeline
5. **Концепция 3** (Differential) — добавить delta tracking

### Phase 3: Advanced
6. **Концепция 4** (Embeddings) — требует локальную модель эмбеддингов
7. **Концепция 7** (Session Caching) — зависит от API Anthropic

---

## Реализация: новые бенчмарки для bench.cjs

Нужно добавить в bench.cjs:

```javascript
// bench skeleton   — Концепция 1: skeleton vs full vs zero
// bench lazy       — Концепция 2: eager vs lazy vs hybrid token count
// bench delta      — Концепция 3: full reindex vs delta tokens
// bench compress   — Концепция 5: raw vs compressed comprehension
// bench ablation   — Концепция 6: 2^N layer combinations
// bench caching    — Концепция 7: cache hit ratio simulation
```

Для Концепции 4 (embeddings) — отдельный скрипт с Python + numpy/sklearn.

---

## Ключевой вывод

Твоё наблюдение ("агент без индекса точнее") — это НЕ баг, это фундаментальное свойство трансформеров:

> **Больше контекста ≠ лучше результат.**
> **Точно таргетированный маленький контекст > большой нерелевантный дамп.**

Оптимальная стратегия: **минимальный скелет + ленивая подгрузка + дельты между сессиями**.

Это по сути переход от "загрузи всю память в голову" к "знай где искать и доставай по необходимости" — точно как работает человеческая память (ассоциативный доступ, а не полный скан).
