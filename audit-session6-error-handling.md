# Error Handling & Resilience Audit - ForgeTeam Gateway

**Date:** 2026-03-02
**Scope:** gateway/src/, viadp/src/ -- all error paths, exception handling, async safety
**Auditor:** Claude Opus 4.6

---

## Executive Summary

The ForgeTeam codebase has **mixed** error handling quality. The WebSocket handlers (`server.ts`) and workflow engine (`workflow-engine.ts`) generally have try/catch around async operations. However, the REST API layer (`index.ts`) has **27 route handlers without try/catch**, the database layer (`db.ts`) has **zero error handling**, and several async operations in Socket.IO handlers create fire-and-forget promises that can silently fail or leave the server in an inconsistent state (agent stuck in "working" status).

**Finding Summary:**
- **CRITICAL:** 5 findings
- **HIGH:** 9 findings
- **MEDIUM:** 12 findings
- **LOW:** 6 findings

---

## CRITICAL Findings (Can crash the server)

### C1. `db.ts` - Database pool has zero error handling or connection recovery

**File:** `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/db.ts:7-9`

```typescript
export async function query(text: string, params?: any[]): Promise<any> {
  return pool.query(text, params);
}
```

**Problem:** The `query()` function is a bare passthrough with no error handling. The `Pool` itself has no error event listener. If the database connection drops, every caller that does not wrap this in try/catch will cause an unhandled rejection. The `Pool` object has no `on('error')` handler -- a single idle client error can terminate the Node.js process.

**What could go wrong:**
- Database restart causes `pool.query` to throw; if any caller lacks try/catch, the process crashes with an unhandled rejection.
- Connection exhaustion has no monitoring or recovery.
- No connection timeout configured.

**Fix:** Add `pool.on('error', ...)` handler, configure `connectionTimeoutMillis`, `idleTimeoutMillis`, and `max` connections. Add a wrapper that catches and logs errors.

---

### C2. `index.ts` - Redis client has no error handler

**File:** `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/index.ts:90`

```typescript
const redis = new Redis(REDIS_URL);
```

**Problem:** The Redis client is instantiated without an `on('error')` handler. ioredis throws `ECONNREFUSED` errors as events. Without a listener, Node.js treats these as unhandled and may crash the process.

**What could go wrong:** If Redis is down or restarts, the process terminates with an uncaught error event.

**Fix:** Add `redis.on('error', (err) => console.error('[Redis] Error:', err.message));`

---

### C3. `index.ts:392-411` - `pool.query()` in model assignment save is fire-and-forget but uses `.catch()` -- however, the loop iterates synchronously over assignments and can throw for non-DB reasons

**File:** `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/index.ts:364-416`

```typescript
app.post('/api/models/assignments', express.json(), async (req, res): Promise<void> => {
  const { assignments } = req.body ?? {};
  if (!assignments || typeof assignments !== 'object') {
    res.status(400).json({ error: 'assignments object required' });
    return;
  }

  for (const [agentId, config] of Object.entries(assignments) as [string, any][]) {
    const primary = config?.primary;
    const fallback = config?.fallback || config?.fallback2 || '';
    if (primary) {
      modelRouter.updateAssignment(agentId as any, primary as any, (fallback || primary) as any);
    }
    // ...
    pool.query(...).catch((err: any) => {
      console.warn(...);
    });
  }
  // ...
  res.json({ success: true, ... });
});
```

**Problem:** `modelRouter.updateAssignment()` does not validate that `primary` or `fallback` exist in the model catalog. If an invalid `agentId` is passed, `route()` later throws `No model assignment found for agent`. The `pool.query()` call is fire-and-forget but properly `.catch()`-ed. However, if `Object.entries()` or the loop body throws for any reason (e.g., `config` is null), there is no try/catch around the handler, so Express will crash or send a default 500.

**What could go wrong:** Malformed request body causes unhandled exception in the handler, potentially crashing Express if no global error handler is configured.

---

### C4. `index.ts:1578-1588` - Artifact upload has no try/catch

**File:** `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/index.ts:1578-1588`

```typescript
app.post('/api/artifacts/upload', express.raw({ type: '*/*', limit: '50mb' }), async (req, res): Promise<void> => {
  const { sessionId, taskId, filename } = req.query as { ... };
  if (!sessionId || !taskId || !filename) {
    res.status(400).json({ error: 'Missing sessionId, taskId, or filename query params' });
    return;
  }
  const key = `${sessionId}/${taskId}/${filename}`;
  const contentType = req.headers['content-type'] ?? 'application/octet-stream';
  const result = await storageService.upload(key, req.body, contentType);
  res.json(result);
});
```

**Problem:** `storageService.upload()` is awaited without try/catch. If MinIO/S3 is down, this will throw an unhandled rejection in the async Express handler.

**What could go wrong:** S3/MinIO connection failure causes unhandled promise rejection; Express sends no response, leaving the client hanging.

---

### C5. `index.ts:1605-1610` - Artifact list has no try/catch

**File:** `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/index.ts:1605-1610`

```typescript
app.get('/api/artifacts/list', async (req, res) => {
  const { sessionId, taskId } = req.query as { sessionId: string; taskId: string };
  const prefix = taskId ? `${sessionId ?? ''}/${taskId}/` : `${sessionId ?? ''}/`;
  const objects = await storageService.list(prefix);
  res.json({ objects, timestamp: new Date().toISOString() });
});
```

**Problem:** No try/catch. If storage is unavailable, the handler throws and Express cannot send a response.

---

## HIGH Findings (Hanging requests or data loss)

### H1. 27 REST route handlers lack try/catch around synchronous code that can throw

**File:** `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/index.ts`

The following route handlers have NO try/catch and call methods that can throw:

| Line | Route | Throwing call |
|------|-------|---------------|
| 205 | `GET /health` | `gatewayServer.getConnectionStats()` (before server init) |
| 238 | `GET /api/health/providers` | `agentRunner.checkProviderHealth()` (no try/catch in handler) |
| 247 | `GET /api/agents` | `agentManager.getAgentSummary()` |
| 273 | `GET /api/sessions` | `sessionManager.getAllSessions()` |
| 313 | `GET /api/tasks` | `taskManager.getTasks()` |
| 325 | `GET /api/kanban/:sessionId` | `taskManager.getKanbanBoard()` |
| 333 | `POST /api/tasks` | `taskManager.createTask()` |
| 347 | `GET /api/tasks/stats/:sessionId` | `taskManager.getStats()` |
| 355 | `GET /api/models/assignments` | `modelRouter.getAllAssignments()` |
| 421 | `GET /api/models/costs` | `modelRouter.getCostSummary()` |
| 432 | `POST /api/models/route` | `modelRouter.route()` -- **throws** for unknown agentId |
| 448 | `GET /api/viadp/summary` | `viadpEngine.getSummary()` |
| 456 | `GET /api/viadp/delegations` | `viadpEngine.getAllRequests()` |
| 465 | `GET /api/viadp/trust` | `viadpEngine.getGlobalTrustScores()` |
| 473 | `GET /api/viadp/trust/:agentId` | `viadpEngine.getAllTrustScores()` |
| 482 | `GET /api/viadp/audit` | `viadpEngine.getFullAuditTrail()` |
| 494 | `GET /api/voice/status` | `voiceHandler.getStatus()` |
| 540 | `GET /api/openclaw/agents` | `agentRegistry.getAllWithCapabilities()` |
| 545 | `GET /api/openclaw/tools` | `toolRunner.listTools()` |
| 609 | `GET /api/workflows/status` | `workflowExecutor.getWorkflowStatuses()` |
| 663 | `GET /api/workflow-instances` | `workflowExecutor.getAllInstances()` |
| 681 | `GET /api/connections` | `gatewayServer.getConnectionStats()` |
| 686 | `GET /api/tools` | `toolRegistry.listAll()` |
| 696 | `GET /api/sandboxes` | `sandboxManager.listActive()` -- **async**, no try/catch |
| 705 | `GET /api/interrupts` | `workflowExecutor.getPendingInterrupts()` |
| 710 | `GET /api/interrupts/all` | `workflowExecutor.getAllInterrupts()` |

**Problem:** While most of these are simple getters that are unlikely to throw under normal conditions, `POST /api/models/route` will throw `No model assignment found for agent` if an invalid agentId is sent. `GET /api/sandboxes` awaits without try/catch.

**What could go wrong:** Invalid inputs or unexpected state causes Express to send a default 500 or hang on async routes.

---

### H2. `modelRouter.route()` throws on unknown agentId -- no fallback

**File:** `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/model-router.ts:336-337`

```typescript
if (!assignment) {
  throw new Error(`No model assignment found for agent: ${request.agentId}`);
}
```

**Problem:** This throw propagates to every caller. In `agentRunner.processUserMessage()` (line 186), there is no try/catch around the `route()` call. If a message arrives for an agentId that has been removed or was never registered, the entire `processUserMessage` call throws, which could crash the Socket.IO handler.

**What could go wrong:** A single message to an unknown agent crashes the chat message handler. In the Socket.IO path (index.ts:1782), the `.catch()` handles this, but in the `POST /api/models/route` REST handler (line 432), there is no try/catch.

---

### H3. Agent status stuck at "working" if promise chain breaks

**File:** `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/index.ts:1779-1804`

```typescript
agentManager.setAgentStatus(targetAgentId, 'working');

agentRunner
  .processUserMessage(targetAgentId, payload.content, sessionId)
  .then((result) => {
    // ... emit response ...
    agentManager.setAgentStatus(targetAgentId, 'idle');
  })
  .catch((error) => {
    // ... emit error message ...
    agentManager.setAgentStatus(targetAgentId, 'idle');
  });
```

**Problem:** This pattern is correct -- it resets to 'idle' in both `.then()` and `.catch()`. However, `PartyModeEngine.executePartyMode()` (line 1700-1772) does NOT reset individual agent statuses. Agents selected by party mode are set to 'working' internally but if the party mode itself fails, the fallback only resets 'bmad-master'. The other agents that were potentially set to 'working' remain stuck.

**What could go wrong:** After a party mode failure, agents other than bmad-master may be permanently stuck in "working" status.

---

### H4. `createInterrupt` calls `pauseWorkflow` without await

**File:** `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/workflow-engine.ts:649`

```typescript
createInterrupt(...): string {
  // ...
  if (this.instances.has(instanceId)) {
    this.pauseWorkflow(instanceId);  // pauseWorkflow is async!
  }
  return id;
}
```

**Problem:** `pauseWorkflow()` is an `async` method but is called without `await`. The return value (a Promise) is silently discarded. If `pauseWorkflow` throws internally, the error is an unhandled rejection.

**What could go wrong:** Workflow may not actually pause; unhandled rejection could crash the process.

---

### H5. `resolveInterrupt` calls `resumeWorkflow` without await

**File:** `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/workflow-engine.ts:659`

```typescript
resolveInterrupt(interruptId: string, approved: boolean, feedback?: string): void {
  // ...
  if (approved && this.instances.has(interrupt.instanceId)) {
    this.resumeWorkflow(interrupt.instanceId);  // async, no await!
  }
}
```

**Problem:** Same issue as H4. `resumeWorkflow` is async, called without await. Any error becomes an unhandled rejection.

---

### H6. No timeout on AI API calls

**File:** `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/agent-runner.ts:571, 684`

```typescript
const response = await client.messages.create(createParams);
// ...
const result = await chat.sendMessage(currentMessage as any);
```

**Problem:** Neither the Anthropic nor Gemini API calls have timeouts. If the AI provider hangs, the entire request hangs indefinitely. The Anthropic SDK has a default timeout but Gemini does not explicitly configure one.

**What could go wrong:** An unresponsive AI API causes the agent runner to hang forever, blocking the caller (Socket.IO chat handler or REST task start endpoint) indefinitely. User sees no response.

---

### H7. `spawnSubAgent` has unbounded recursion potential

**File:** `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/agent-runner.ts:291-306`

```typescript
if (result.content.includes('[DELEGATE:')) {
  const delegateMatch = result.content.match(...);
  if (delegateMatch) {
    const subResult = await this.spawnSubAgent(agentId, targetId, delegatedTask, sessionId);
    // ...
  }
}
```

And in `spawnSubAgent` (line 438):
```typescript
const result = await this.processUserMessage(targetAgentId, taskDescription, sessionId, delegationPrompt);
```

**Problem:** `processUserMessage` calls `spawnSubAgent`, which calls `processUserMessage` again. If the sub-agent's response also contains `[DELEGATE:]`, this creates a recursive chain. There is NO depth limit.

**What could go wrong:** A chain of delegation markers (agent A -> B -> C -> A) creates infinite recursion, eventually causing a stack overflow or memory exhaustion.

---

### H8. `PostgresCheckpointSaver` has no error handling around DB queries

**File:** `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/langgraph/checkpointer.ts:43-86`

```typescript
async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
  await this.ensureTable();
  // ...
  let result;
  if (checkpointId) {
    result = await this.pool.query(...);
  } else {
    result = await this.pool.query(...);
  }
  // ...
}
```

**Problem:** All `pool.query()` calls in the checkpointer have no try/catch. If the database connection fails during a workflow checkpoint save or retrieval, the error propagates up through LangGraph and crashes the workflow execution.

**What could go wrong:** Database hiccup during workflow execution causes the entire workflow to crash with an unhandled error. The `ensureTable()` method also has no try/catch -- if the table creation fails (permissions issue), every subsequent call will retry the CREATE TABLE and fail.

---

### H9. `ModelRouter.recordCost` uses dynamic import with fire-and-forget

**File:** `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/model-router.ts:478-486`

```typescript
import('./db.js').then(({ query }) => {
  query(
    `INSERT INTO cost_tracking ...`,
    [...]
  ).catch((err: any) => {
    console.warn('[ModelRouter] Failed to persist cost record:', err?.message);
  });
}).catch(() => {});
```

**Problem:** The outer `.catch(() => {})` silently swallows ALL errors from the dynamic import, including module-not-found errors. Cost records may never be persisted, and there is no indication other than a warning log.

**What could go wrong:** All cost tracking data is silently lost if the db module path is wrong or the import fails for any reason. The empty `catch` hides the root cause.

---

## MEDIUM Findings (Swallowed errors that hide bugs)

### M1. `StorageService` methods have no error handling

**File:** `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/storage.ts:47-101`

All methods (`upload`, `download`, `delete`, `list`) throw raw AWS SDK errors without wrapping them. Callers must handle S3-specific errors. The `ensureBucket` method silently catches ALL errors from `HeadBucketCommand` (not just "bucket not found") and tries to create the bucket.

---

### M2. Memory operations fail silently

**File:** `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/agent-runner.ts:340-364, 368-383`

```typescript
if (this.memoryManager) {
  try {
    await this.memoryManager.store('thread', userMessage, ...);
    await this.memoryManager.store('thread', result.content, ...);
  } catch (err: any) {
    console.warn(`[AgentRunner] Failed to store memory for ${agentId}:`, err?.message);
  }
}
```

**Problem:** Memory storage failures are silently swallowed. The user gets their response but context is lost. Over time, the RAG pipeline has stale data with no indication.

---

### M3. VectorStore operations fail silently

**File:** `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/agent-runner.ts:368-383`

Same pattern as M2 -- vector store indexing failures are caught and warned but the user is never notified.

---

### M4. `ModelRouter.route()` returns `null` model when cost-cap blocked

**File:** `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/model-router.ts:342-349`

```typescript
if (capStatus.severity === 'blocked') {
  return {
    model: null,
    reason: 'hard-cap-blocked',
    // ...
  } as any;
}
```

**Problem:** The `as any` cast hides the fact that `model` is null. Every caller that accesses `routingResult.model.id` will get a TypeError. In `agentRunner.processUserMessage()` (line 192), `routingResult.model.id` is accessed without null check.

**What could go wrong:** When an agent exceeds its cost cap, attempting to chat with that agent throws `Cannot read properties of null (reading 'id')`.

---

### M5. Company KB initialization is fire-and-forget with lost result

**File:** `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/index.ts:102-109`

```typescript
let companyKBId: string | null = null;
if (geminiFileSearch) {
  initCompanyKB(geminiFileSearch).then(id => {
    companyKBId = id;
  }).catch(err => {
    console.warn('[Gateway] Company KB init failed:', err?.message);
  });
}
```

**Problem:** `companyKBId` is captured by closure in `agentRunner` constructor (line 151), but at that point it is still `null` because the async init hasn't completed. The agentRunner gets `undefined` for companyKBId permanently, even after the KB init finishes.

**What could go wrong:** Company knowledge base is never used by the agent runner, even after successful initialization.

---

### M6. No global Express error handler

**File:** `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/index.ts`

There is no `app.use((err, req, res, next) => ...)` error handler registered. If any synchronous route handler throws or an async handler's promise rejects without being caught, Express will send a raw HTML 500 page or the request hangs.

**What could go wrong:** Any uncaught throw in a route handler causes an ugly HTML error response instead of a JSON error.

---

### M7. `server.ts` - `handleDelegationRequest` passes unvalidated payload directly to VIADP

**File:** `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/server.ts:1177-1191`

```typescript
const request = this.viadpEngine.createDelegationRequest({
  from: msg.payload?.from,
  to: msg.payload?.to,
  taskId: msg.payload?.taskId,
  // ...
});
```

**Problem:** No validation on `from`, `to`, or `taskId`. If any of these are undefined, the delegation is created with undefined fields, which may cause downstream errors when those fields are accessed.

---

### M8. `agentRunner.callAnthropic` creates a new client on every call

**File:** `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/agent-runner.ts:548`

```typescript
const client = new Anthropic({ apiKey });
```

**Problem:** A new Anthropic SDK client instance is created for every single API call. This wastes resources and bypasses any connection pooling the SDK might offer.

---

### M9. Escalation array grows unboundedly

**File:** `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/agent-runner.ts:334`

```typescript
this.escalations.push(escalation);
```

**Problem:** The `escalations` array is never pruned. Over time it grows without bound, consuming memory.

---

### M10. `VIADPEngine.monitor()` swallows all errors

**File:** `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/viadp-engine.ts:234-245`

```typescript
private monitor(): void {
  const now = Date.now();
  for (const req of this.requests.values()) {
    // ...
  }
}
```

**Problem:** The `monitor()` method is called via `setInterval` but has no try/catch. If any error occurs (e.g., mutating the map during iteration), the interval callback throws and may stop future monitoring cycles.

---

### M11. `workflowExecutor.pauseAllWorkflows()` calls async method synchronously

**File:** `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/workflow-engine.ts:671-680`

```typescript
pauseAllWorkflows(): { paused: string[] } {
  const paused: string[] = [];
  for (const [id, instance] of this.instances.entries()) {
    if (...) {
      this.pauseWorkflow(id);  // async, no await!
      paused.push(id);
    }
  }
  return { paused };
}
```

**Problem:** `pauseWorkflow` is async but called without await. The method returns before any pause actually completes.

---

### M12. `DelegationEngine.redelegate()` can throw without recovery

**File:** `/Users/bandar/Documents/AreebPro/forge-team/viadp/src/delegation-engine.ts:604-657`

```typescript
redelegate(delegationId: string, reason: string): DelegationToken {
  // ...
  if (oldToken.chain.length >= oldToken.maxChainDepth) {
    throw new Error(`Maximum re-delegation depth ...`);
  }
  // ...
  if (candidates.length === 0) {
    throw new Error(`No available delegates for re-delegation ...`);
  }
  // ...
}
```

**Problem:** When re-delegation fails, the old token is already revoked (line 614) and the old agent's load is decremented (line 618-619). But the throws happen after these mutations. The task is now in a limbo state: old delegation revoked, no new delegation created.

**What could go wrong:** A task's delegation is revoked but no replacement is found, leaving the task orphaned with no assigned delegate.

---

## LOW Findings (Missing error messages or logging)

### L1. `server.ts` - No logging when `routeToAgent` fails silently

**File:** `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/server.ts:1595-1597`

```typescript
routeToAgent(agentId: AgentId, message: WSMessage): boolean {
  const clientId = this.agentClientMap.get(agentId);
  if (!clientId) {
```

The method returns `false` silently when the agent is not connected. Callers never check the return value.

---

### L2. `model-router.ts` - `recordCost()` does not validate modelId exists in catalog

**File:** `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/model-router.ts:456`

```typescript
const modelConfig = MODEL_CATALOG[model];
const cost =
  (inputTokens / 1_000_000) * modelConfig.inputCostPer1M + ...;
```

If `model` is not in `MODEL_CATALOG`, `modelConfig` is `undefined` and accessing `inputCostPer1M` throws a TypeError.

---

### L3. Missing `process.on('unhandledRejection')` handler

**File:** `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/index.ts`

There is no global `process.on('unhandledRejection', ...)` handler. Unhandled promise rejections in Node.js 18+ terminate the process by default.

---

### L4. `GeminiFileSearch.createStore()` errors silently swallowed in RAG retrieval

**File:** `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/agent-runner.ts:900-910`

Auto-creation of per-agent corpus silently fails and continues without RAG context.

---

### L5. Cost records array grows unboundedly in memory

**File:** `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/model-router.ts:475`

```typescript
this.costRecords.push(record);
```

The in-memory `costRecords` array is never pruned. In a long-running server, this can consume significant memory.

---

### L6. `verification.ts` - Audit trail hash chain uses weak hash function

**File:** `/Users/bandar/Documents/AreebPro/forge-team/viadp/src/verification.ts:714-719`

```typescript
let hash = 0;
for (let i = 0; i < payload.length; i++) {
  const char = payload.charCodeAt(i);
  hash = ((hash << 5) - hash + char) | 0;
}
return `h_${Math.abs(hash).toString(36).padStart(10, '0')}`;
```

This is a simple djb2 hash with frequent collisions. The same weak hash is used in `delegation-engine.ts:930-938` for token signatures. Both have TODO comments noting this should use SHA-256 in production.

---

## Summary Table

| ID | Severity | File | Line(s) | Issue |
|----|----------|------|---------|-------|
| C1 | CRITICAL | `db.ts` | 5-9 | No pool error handler; bare query passthrough |
| C2 | CRITICAL | `index.ts` | 90 | Redis client missing `on('error')` |
| C3 | CRITICAL | `index.ts` | 364-416 | Model assignment handler can throw without try/catch |
| C4 | CRITICAL | `index.ts` | 1578-1588 | Artifact upload `await` without try/catch |
| C5 | CRITICAL | `index.ts` | 1605-1610 | Artifact list `await` without try/catch |
| H1 | HIGH | `index.ts` | various | 27 route handlers without try/catch |
| H2 | HIGH | `model-router.ts` | 336-337 | `route()` throws on unknown agentId |
| H3 | HIGH | `index.ts` | 1700-1772 | Party mode does not reset agent statuses on failure |
| H4 | HIGH | `workflow-engine.ts` | 649 | `createInterrupt` calls async `pauseWorkflow` without await |
| H5 | HIGH | `workflow-engine.ts` | 659 | `resolveInterrupt` calls async `resumeWorkflow` without await |
| H6 | HIGH | `agent-runner.ts` | 571, 684 | No timeout on AI API calls |
| H7 | HIGH | `agent-runner.ts` | 291-306, 438 | Delegation recursion has no depth limit |
| H8 | HIGH | `langgraph/checkpointer.ts` | 43-86 | No try/catch around DB queries in checkpointer |
| H9 | HIGH | `model-router.ts` | 478-486 | Fire-and-forget dynamic import with empty catch |
| M1 | MEDIUM | `storage.ts` | 38-45 | `ensureBucket` catches all errors, not just 404 |
| M2 | MEDIUM | `agent-runner.ts` | 340-364 | Memory storage failures silently swallowed |
| M3 | MEDIUM | `agent-runner.ts` | 368-383 | VectorStore failures silently swallowed |
| M4 | MEDIUM | `model-router.ts` | 342-349 | Returns null model with `as any` cast |
| M5 | MEDIUM | `index.ts` | 102-109, 151 | Company KB ID captured before async init completes |
| M6 | MEDIUM | `index.ts` | - | No global Express error handler |
| M7 | MEDIUM | `server.ts` | 1177-1191 | Unvalidated delegation request payload |
| M8 | MEDIUM | `agent-runner.ts` | 548 | New Anthropic client created per call |
| M9 | MEDIUM | `agent-runner.ts` | 334 | Escalation array grows unboundedly |
| M10 | MEDIUM | `viadp-engine.ts` | 234-245 | Monitor interval has no try/catch |
| M11 | MEDIUM | `workflow-engine.ts` | 671-680 | `pauseAllWorkflows` calls async without await |
| M12 | MEDIUM | `delegation-engine.ts` | 604-657 | Re-delegation mutates state before throwing |
| L1 | LOW | `server.ts` | 1595-1597 | Silent failure in `routeToAgent` |
| L2 | LOW | `model-router.ts` | 456 | `recordCost` does not validate modelId |
| L3 | LOW | `index.ts` | - | Missing `process.on('unhandledRejection')` |
| L4 | LOW | `agent-runner.ts` | 900-910 | Agent corpus creation silently fails |
| L5 | LOW | `model-router.ts` | 475 | Cost records array grows unboundedly |
| L6 | LOW | `verification.ts` | 714-719 | Weak hash for audit trail integrity |

---

## Recommendations (Priority Order)

1. **Add process-level error handlers** -- `process.on('unhandledRejection')` and `process.on('uncaughtException')` to prevent silent crashes.

2. **Add Redis and PG pool error handlers** -- Both `redis.on('error')` and `pool.on('error')` are mandatory to prevent process termination.

3. **Add a global Express error handler** -- `app.use((err, req, res, next) => { res.status(500).json({ error: err.message }); })` as the last middleware.

4. **Wrap all async route handlers** -- Create a helper `asyncHandler(fn)` that catches rejected promises and passes to Express `next(err)`.

5. **Add null check for `routingResult.model`** in `agentRunner.processUserMessage()` before accessing `.id` or `.provider`.

6. **Add delegation recursion depth limit** -- Track delegation depth in `processUserMessage` and cap at e.g. 3 levels.

7. **Add timeouts to AI API calls** -- Use `AbortController` or SDK timeout options (Anthropic: `timeout` parameter; Gemini: `requestOptions.timeout`).

8. **Fix `createInterrupt` and `resolveInterrupt`** to properly `await` the async workflow methods, or refactor them to be async.

9. **Fix `companyKBId` race condition** -- Pass it as a getter/callback rather than a captured value, or await the init before constructing agentRunner.

10. **Add periodic pruning** for `costRecords` and `escalations` arrays to prevent memory leaks in long-running processes.
