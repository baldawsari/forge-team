# Session 14 — Cost Enforcement, Memory Wiring & CI Pipeline

> **Instructions for Claude Code Opus 4.6**: Read this entire prompt before taking any action. You must complete ALL tasks listed below in the ForgeTeam project at `/Users/bandar/Documents/AreebPro/forge-team/`. Use the **team/swarm feature** — create a team and spin up parallel agents to work on independent workstreams simultaneously. Each workstream is labeled. Do NOT skip any item. Do NOT introduce new features beyond what is listed. Do NOT add comments, docstrings, or type annotations to code you did not change. Preserve the existing TypeScript style and project conventions.

---

## CONTEXT

The re-audit (AUDIT-REPORT.md) shows ForgeTeam at ~82% completion. This session closes 6 gaps:

| # | Gap | Audit Reference |
|---|-----|-----------------|
| 1 | **Per-agent cost caps not enforced** — `ModelRouter` tracks cost and has `checkCostCap()` but there is no hard block at 120% daily cap and no model downgrade chain | Phase 10, item "Per-agent daily/weekly cost caps + alerts" (PARTIAL) |
| 2 | **No task-close trigger for summarization** — `Summarizer` only auto-compacts at 50-turn threshold, never on task completion | Phase 3, "Auto-summarization every 50 turns + on task close" (PARTIAL) |
| 3 | **No CI pipeline** — 13 test files exist but no GitHub Actions workflow runs them on PR | Phase 11 / Infrastructure gap |
| 4 | **Economic self-regulation hooks missing** — cost tracking + dashboard visualization exist, but no automated self-regulation (auto-pause, throttle, escalation) | Phase 10, "Economic self-regulation hooks" (PARTIAL) |
| 5 | **Memory scope naming inconsistency** — DB `memory_entries.scope` CHECK accepts `'global','session','phase','task'` in addition to the 5 canonical scopes (`company`,`team`,`project`,`agent`,`thread`). `MemoryManager` uses the canonical 5 but `shared/types/memory.ts` may list different names | Phase 3, "Hierarchical scopes" (PARTIAL) |
| 6 | **Hash embeddings fallback produces nonsensical search** — `VectorStore` silently falls back to hash embeddings when `GOOGLE_AI_API_KEY` is absent, producing useless similarity search with no warning to users | Phase 3, "Fallback: pgvector + real embeddings" (PARTIAL) |

---

## PRE-WORK: Read These Files First (Before Any Edits)

Every agent on the team must read the files relevant to their workstream before editing. The ground-truth references are:

**Cost system:**
- `/forge-team/gateway/src/model-router.ts` — `ModelRouter` class: cost caps (lines 30-43, 230-256), `checkCostCap()` (lines 596-615), `route()` (lines 332-437), `recordCost()` (lines 442-499), `cost:alert` event emission (lines 484-496)
- `/forge-team/gateway/src/index.ts` — Gateway entry point, where `ModelRouter` is instantiated and event listeners would be attached
- `/forge-team/gateway/src/__tests__/model-router.test.ts` — existing unit tests

**Memory system:**
- `/forge-team/gateway/src/index.ts` — look for task event emissions (`task:completed`, `task:updated`, etc.)
- `/forge-team/memory/src/memory-manager.ts` — `MemoryManager.compact()` (lines 350-459), scope types
- `/forge-team/memory/src/summarizer.ts` — `Summarizer` class, `checkAndCompact()` method
- `/forge-team/memory/src/vector-store.ts` — `VectorStore.embed()` (lines 114-122), `hashEmbed()` (lines 124-146), constructor warning (line 68-69)
- `/forge-team/shared/types/memory.ts` — `MemoryScope` type definition
- `/forge-team/infrastructure/init.sql` — `memory_entries` table, scope CHECK constraint (line 153)

**CI:**
- `/forge-team/gateway/package.json` — scripts section (test, typecheck commands)
- `/forge-team/package.json` — root workspace scripts (if any)

---

## WORKSTREAM 1: Cost Enforcement & Economic Self-Regulation

**Files to modify:**
- `/forge-team/gateway/src/model-router.ts`
- `/forge-team/gateway/src/index.ts`
- `/forge-team/gateway/src/__tests__/model-router.test.ts`

### 1A. Hard block at 120% daily cap with model downgrade chain

Currently `route()` (line 338) calls `checkCostCap()` and when the cap is exceeded, it returns the cheapest model. This is too abrupt. Replace the cost-cap section in `route()` with a graduated response:

1. **At 100% daily cap**: Force downgrade the agent from their assigned model to the next cheapest model in the same provider. For example:
   - `claude-opus-4-6` → `claude-sonnet-4-6`
   - `claude-sonnet-4-6` → `claude-haiku-4-5`
   - `gemini-3.1-pro` → `gemini-flash-3`
   - `gemini-flash-3` stays as `gemini-flash-3` (already cheapest)
   - `claude-haiku-4-5` stays as `claude-haiku-4-5` (already cheapest)

2. **At 120% daily cap**: Hard block — throw an error or return a special result with `reason: 'hard-cap-blocked'` and `model: null`. The caller (`AgentRunner`) must handle this by not making the API call.

Add a `private getDowngradeModel(currentModelId: ModelId): ModelId` method that implements the downgrade chain above.

Modify `checkCostCap()` to return a new field `severity: 'ok' | 'warning' | 'downgrade' | 'blocked'`:
- `ok`: under `alertThreshold` (default 80%)
- `warning`: between `alertThreshold` and 100%
- `downgrade`: between 100% and 120%
- `blocked`: above 120%

Update the `CostCapStatus` interface to include `severity`.

### 1B. Wire `cost:alert` listener in gateway index.ts

In `/forge-team/gateway/src/index.ts`, find where the `ModelRouter` is instantiated. After instantiation, add a listener:

```typescript
modelRouter.on('cost:alert', (alert) => {
  const { agentId, alertType, message, dailyUsed, dailyCap } = alert;
  const ratio = dailyUsed / dailyCap;

  if (ratio >= 1.2) {
    // Hard block: pause the agent
    console.error(`[CostControl] BLOCKED: ${agentId} at ${(ratio * 100).toFixed(0)}% of daily cap`);
    agentManager.updateAgentStatus(agentId, 'blocked');
    io.emit('agent_status', { agentId, status: 'blocked', reason: 'cost-cap-exceeded' });
    io.emit('cost_update', { type: 'agent-blocked', agentId, dailyUsed, dailyCap });
  } else if (ratio >= 1.0) {
    // Throttle: emit warning, model will auto-downgrade
    console.warn(`[CostControl] THROTTLE: ${agentId} at ${(ratio * 100).toFixed(0)}% — model downgraded`);
    io.emit('cost_update', { type: 'agent-throttled', agentId, dailyUsed, dailyCap });
  } else {
    // Alert threshold crossed
    console.warn(`[CostControl] ALERT: ${message}`);
    io.emit('cost_update', { type: 'threshold-warning', agentId, dailyUsed, dailyCap });
  }
});
```

Verify that `agentManager` and `io` (Socket.IO server) are in scope where the listener is added. If `agentManager.updateAgentStatus` does not exist, use whatever method exists on `AgentManager` to change an agent's status.

### 1C. Update model-router tests

Add the following test cases to `/forge-team/gateway/src/__tests__/model-router.test.ts`:

1. **Test: downgrade chain at 100% cap** — Record enough cost to exceed 100% daily cap for an agent, then call `route()` and verify the returned model is the downgraded one (e.g., if agent is `architect` with `claude-opus-4-6`, result should be `claude-sonnet-4-6`).

2. **Test: hard block at 120% cap** — Record enough cost to exceed 120% daily cap and verify `route()` returns `reason: 'hard-cap-blocked'`.

3. **Test: severity field in checkCostCap** — Test all four severity levels (`ok`, `warning`, `downgrade`, `blocked`) by recording appropriate cost amounts.

---

## WORKSTREAM 2: Memory Wiring

**Files to modify:**
- `/forge-team/gateway/src/index.ts`
- `/forge-team/memory/src/memory-manager.ts`
- `/forge-team/memory/src/vector-store.ts`
- `/forge-team/shared/types/memory.ts` (if needed)
- `/forge-team/infrastructure/init.sql`

### 2A. Wire `task:completed` event to summarizer

In `/forge-team/gateway/src/index.ts`, find the task update handler (look for where task status is changed to `'done'` or `'completed'`). This is likely in the PUT `/api/tasks/:taskId` handler or in the WebSocket `task_update` handler.

After a task transitions to `done` or `completed`, trigger summarization:

```typescript
// After task status changes to done/completed:
if (updatedTask.status === 'done' || updatedTask.status === 'completed') {
  // Trigger memory summarization for this task's session
  const sessionId = updatedTask.sessionId || updatedTask.session_id;
  if (sessionId && summarizer) {
    summarizer.checkAndCompact(sessionId).catch((err: any) => {
      console.warn('[Memory] Task-close summarization failed:', err?.message);
    });
  }
}
```

Look for how `summarizer` is referenced in `index.ts`. It may be accessed via the `Summarizer` class imported from `@forge-team/memory`. If no `summarizer` instance exists in `index.ts`, create one during initialization alongside `memoryManager`.

### 2B. Memory scope validation with legacy aliases

The DB `memory_entries.scope` CHECK constraint (init.sql line 153) accepts 9 values: `company`, `team`, `project`, `agent`, `thread`, `global`, `session`, `phase`, `task`. But the canonical hierarchy is only 5: `company`, `team`, `project`, `agent`, `thread`.

In `/forge-team/memory/src/memory-manager.ts`, add a private method to normalize legacy scope names before storing:

```typescript
private normalizeScope(scope: MemoryScope | string): MemoryScope {
  const aliases: Record<string, MemoryScope> = {
    'global': 'company',
    'session': 'thread',
    'phase': 'project',
    'task': 'agent',
  };
  return (aliases[scope] ?? scope) as MemoryScope;
}
```

Call `this.normalizeScope(scope)` at the top of `store()` and `search()` methods.

If `/forge-team/shared/types/memory.ts` has a `MemoryScope` type that does not include the canonical 5 names, update it to:

```typescript
export type MemoryScope = 'company' | 'team' | 'project' | 'agent' | 'thread';
```

### 2C. Hash embedding degradation warnings

In `/forge-team/memory/src/vector-store.ts`, the `embed()` method (line 114) silently falls back to `hashEmbed()`. Add a visible warning:

1. Add a private flag `private hashEmbeddingWarningLogged = false;` in the class.

2. In `embed()`, when falling back to `hashEmbed()`, log a warning once and mark results as degraded:

```typescript
async embed(text: string): Promise<number[]> {
  if (!this.genAI) {
    if (!this.hashEmbeddingWarningLogged) {
      console.warn(
        '[VectorStore] WARNING: Using hash embeddings (no GOOGLE_AI_API_KEY). ' +
        'Similarity search results will be low quality. ' +
        'Set GOOGLE_AI_API_KEY for real embeddings.'
      );
      this.hashEmbeddingWarningLogged = true;
    }
    return this.hashEmbed(text);
  }

  const model = this.genAI.getGenerativeModel({ model: this.embeddingModel });
  const result = await model.embedContent(text);
  return result.embedding.values;
}
```

3. In `similaritySearch()`, if `!this.genAI`, prepend a note to the results metadata or log a per-search warning indicating degraded results.

---

## WORKSTREAM 3: CI Pipeline

**Files to create:**
- `/forge-team/.github/workflows/ci.yml`

### 3A. Create GitHub Actions CI workflow

Create the file `/forge-team/.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: pgvector/pgvector:pg16
        env:
          POSTGRES_USER: forgeteam
          POSTGRES_PASSWORD: forgeteam_test
          POSTGRES_DB: forgeteam
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U forgeteam"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    env:
      DATABASE_URL: postgresql://forgeteam:forgeteam_test@localhost:5432/forgeteam
      REDIS_URL: redis://localhost:6379
      NODE_ENV: test
      ANTHROPIC_API_KEY: test-key-not-real
      GOOGLE_AI_API_KEY: test-key-not-real

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Initialize database
        run: |
          PGPASSWORD=forgeteam_test psql -h localhost -U forgeteam -d forgeteam -f infrastructure/init.sql

      - name: Type check
        run: npm run typecheck --if-present

      - name: Run tests
        run: npm test
```

Before writing this file, verify:
- Read `/forge-team/package.json` root to check if `npm test` and `npm run typecheck` scripts exist.
- Read `/forge-team/gateway/package.json` to check its test/typecheck scripts.
- If the root `package.json` does not have a `test` script that runs all workspace tests, add one:
  ```json
  "test": "npm run test --workspaces --if-present"
  ```
- If `typecheck` doesn't exist, add:
  ```json
  "typecheck": "npm run typecheck --workspaces --if-present"
  ```

Ensure the `.github/workflows/` directory is created.

---

## TEAM STRUCTURE SUGGESTION

Create a team with these agents working in parallel:

1. **cost-engineer** — Handles WORKSTREAM 1 (cost enforcement, downgrade chain, self-regulation hooks, tests)
2. **memory-wirer** — Handles WORKSTREAM 2 (task-close summarization, scope validation, hash embedding warnings)
3. **ci-builder** — Handles WORKSTREAM 3 (GitHub Actions CI pipeline)

All workstreams are fully independent and can run in parallel.

---

## FINAL CHECKLIST (Every Agent Must Verify)

After all work is complete, verify:

- [x] `ModelRouter.route()` returns downgraded model at 100% daily cap
- [x] `ModelRouter.route()` returns `reason: 'hard-cap-blocked'` at 120% daily cap
- [x] `CostCapStatus` has a `severity` field with 4 levels
- [x] `getDowngradeModel()` exists and maps every model to its cheaper alternative
- [x] `cost:alert` listener in `index.ts` auto-pauses agents at 120%, throttles at 100%, warns at threshold
- [x] Socket.IO emits `cost_update` events for each severity level
- [x] Task completion (`status === 'done'`) triggers `summarizer.checkAndCompact()`
- [x] `MemoryManager` has `normalizeScope()` that maps `global→company`, `session→thread`, etc.
- [x] `VectorStore` logs a visible warning on first hash embedding fallback
- [x] `VectorStore` warning is logged only once (not per-call)
- [x] `.github/workflows/ci.yml` exists with Node 22, postgres service, redis service
- [x] CI runs `npm ci`, typecheck, and `npm test`
- [x] Root `package.json` has `test` and `typecheck` scripts (or CI uses workspace-specific commands)
- [x] 3 new test cases added to `model-router.test.ts` (downgrade, hard block, severity levels)
- [x] No `gpt-4o` or `gpt-4o-mini` references introduced
- [x] No new files created beyond `.github/workflows/ci.yml`
