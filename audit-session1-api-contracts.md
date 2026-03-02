# API Contract Audit Report — ForgeTeam (Session 1)

**Date:** 2026-03-01
**Scope:** Dashboard (`dashboard/src/`) vs Gateway (`gateway/src/index.ts`) REST API surface
**Auditor:** Automated API contract analysis

---

## Executive Summary

**35 dashboard API functions** were audited against **45 gateway route handlers**. The audit found:

- **1 CRITICAL mismatch** — `PUT /api/tasks/:taskId` called by the dashboard has no matching gateway handler
- **4 MAJOR response shape mismatches** — response JSON structures differ between what the dashboard expects and what the gateway returns
- **2 MAJOR query parameter mismatches** — dashboard sends query params the gateway ignores
- **1 MODERATE issue** — hardcoded URL bypasses the API layer
- **1 MODERATE issue** — direct `fetch()` expects raw array but gateway wraps in object

Total: **9 issues** (1 critical, 6 major, 2 moderate)

---

## Part 1: Dashboard API Calls Inventory

All calls originate from `/Users/bandar/Documents/AreebPro/forge-team/dashboard/src/lib/api.ts` unless noted.

| # | Function | File:Line | Endpoint | Method | Payload / Params |
|---|----------|-----------|----------|--------|-----------------|
| 1 | `fetchHealth` | api.ts:161 | `/health` | GET | — |
| 2 | `fetchAgents` | api.ts:165 | `/api/agents` | GET | — |
| 3 | `fetchAgent` | api.ts:169 | `/api/agents/:agentId` | GET | path: `agentId` |
| 4 | `fetchTasks` | api.ts:173 | `/api/tasks` | GET | query: `?sessionId=` |
| 5 | `fetchKanban` | api.ts:178 | `/api/kanban/:sessionId` | GET | path: `sessionId` |
| 6 | `createTask` | api.ts:182 | `/api/tasks` | POST | `{ sessionId, title, description, priority, assignedTo? }` |
| 7 | `updateTask` | api.ts:192 | `/api/tasks/:taskId` | **PUT** | `{ status?, column?, assignedTo?, priority? }` |
| 8 | `fetchTaskStats` | api.ts:203 | `/api/tasks/stats/:sessionId` | GET | path: `sessionId` |
| 9 | `fetchModelAssignments` | api.ts:209 | `/api/models/assignments` | GET | — |
| 10 | `saveModelAssignments` | api.ts:215 | `/api/models/assignments` | POST | `{ assignments: Record<agentId, { primary, fallback, fallback2, temperature, dailyCap }> }` |
| 11 | `fetchModelCosts` | api.ts:227 | `/api/models/costs` | GET | query: `?agentId=` |
| 12 | `fetchViadpSummary` | api.ts:232 | `/api/viadp/summary` | GET | — |
| 13 | `fetchViadpDelegations` | api.ts:236 | `/api/viadp/delegations` | GET | query: `?agentId=` |
| 14 | `fetchViadpTrust` | api.ts:241 | `/api/viadp/trust/:agentId` | GET | path: `agentId` |
| 15 | `fetchViadpAudit` | api.ts:245 | `/api/viadp/audit` | GET | query: `?limit=` |
| 16 | `fetchSessions` | api.ts:250 | `/api/sessions` | GET | — |
| 17 | `createSession` | api.ts:254 | `/api/sessions` | POST | `Record<string, unknown>` |
| 18 | `fetchConnections` | api.ts:258 | `/api/connections` | GET | — |
| 19 | `fetchVoiceStatus` | api.ts:264 | `/api/voice/status` | GET | — |
| 20 | `transcribeAudio` | api.ts:275 | `/api/voice/transcribe` | POST | `{ audioBase64, language }` |
| 21 | `synthesizeText` | api.ts:291 | `/api/voice/synthesize` | POST | `{ text, language }` |
| 22 | `startTask` | api.ts:308 | `/api/tasks/:taskId/start` | POST | `{}` |
| 23 | `approveTask` | api.ts:312 | `/api/tasks/:taskId/approve` | POST | `{}` |
| 24 | `rejectTask` | api.ts:316 | `/api/tasks/:taskId/reject` | POST | `{ feedback }` |
| 25 | `assignTaskToAgent` | api.ts:320 | `/api/tasks/:taskId/assign` | POST | `{ agentId }` |
| 26 | `searchMemory` | api.ts:326 | `/api/memory/search` | GET | query: `?q=&scope=&agentId=&limit=` |
| 27 | `fetchMemoryStats` | api.ts:341 | `/api/memory/stats` | GET | — |
| 28 | `storeMemory` | api.ts:345 | `/api/memory/store` | POST | `{ scope, content, ...options }` |
| 29 | `fetchPendingInterrupts` | api.ts:369 | `/api/interrupts` | GET | — |
| 30 | `resolveInterrupt` | api.ts:373 | `/api/interrupts/:id/resolve` | POST | `{ approved, feedback? }` |
| 31 | `pauseAllWorkflows` | api.ts:379 | `/api/workflows/pause-all` | POST | `{}` |
| 32 | `resumeAllWorkflows` | api.ts:383 | `/api/workflows/resume-all` | POST | `{}` |
| 33 | `pauseWorkflow` | api.ts:387 | `/api/workflows/:instanceId/pause` | POST | `{}` |
| 34 | `resumeWorkflow` | api.ts:391 | `/api/workflows/:instanceId/resume` | POST | `{}` |
| 35 | `fetchWorkflowStatuses` | api.ts:395 | `/api/workflows/status` | GET | — |
| 36 | `fetchEscalations` | api.ts:416 | `/api/escalations` | GET | query: `?status=` |
| 37 | `reviewEscalation` | api.ts:421 | `/api/escalations/:id/review` | POST | `{ feedback? }` |
| 38 | `dismissEscalation` | api.ts:425 | `/api/escalations/:id/dismiss` | POST | `{}` |
| 39 | `takeOverAgent` | api.ts:431 | `/api/agents/:agentId/takeover` | POST | `{}` |
| 40 | `releaseAgent` | api.ts:435 | `/api/agents/:agentId/release` | POST | `{}` |
| 41 | `sendHumanMessage` | api.ts:439 | `/api/agents/:agentId/human-message` | POST | `{ content, taskId? }` |

**Additional raw `fetch()` call (not through api.ts):**

| # | Component | File:Line | Endpoint | Method | Notes |
|---|-----------|-----------|----------|--------|-------|
| 42 | ViadpAuditLog | ViadpAuditLog.tsx:78 | `/api/viadp/delegations` | GET | Hardcoded URL, expects raw array |

---

## Part 2: Gateway Route Handlers Inventory

All handlers are in `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/index.ts`.

| # | Line | Method | Endpoint | Response Shape |
|---|------|--------|----------|---------------|
| G1 | 205 | GET | `/health` | `{ status, timestamp, uptime, version, services: { sessions, agents, connections, voice, viadp, costs } }` |
| G2 | 238 | GET | `/api/health/providers` | `{ providers: Record<string, { available, latency?, error? }> }` |
| G3 | 247 | GET | `/api/agents` | `{ agents: AgentSummary[], timestamp }` |
| G4 | 257 | GET | `/api/agents/:agentId` | `{ config, state, timestamp }` |
| G5 | 273 | GET | `/api/sessions` | `{ sessions, timestamp }` |
| G6 | 283 | GET | `/api/sessions/:sessionId` | `{ session, timestamp }` |
| G7 | 298 | POST | `/api/sessions` | `{ session, timestamp }` (201) |
| G8 | 313 | GET | `/api/tasks` | `{ tasks, timestamp }` |
| G9 | 325 | GET | `/api/kanban/:sessionId` | `{ board, timestamp }` |
| G10 | 333 | POST | `/api/tasks` | `{ task, timestamp }` (201) |
| G11 | 347 | GET | `/api/tasks/stats/:sessionId` | `{ stats, timestamp }` |
| G12 | 355 | GET | `/api/models/assignments` | `{ assignments, catalog, timestamp }` |
| G13 | 364 | POST | `/api/models/assignments` | `{ success, assignments, timestamp }` |
| G14 | 421 | GET | `/api/models/costs` | `{ summary, timestamp }` (query: `?from=&to=`) |
| G15 | 432 | POST | `/api/models/route` | `{ result, timestamp }` |
| G16 | 448 | GET | `/api/viadp/summary` | `{ summary, timestamp }` |
| G17 | 456 | GET | `/api/viadp/delegations` | `{ delegations, timestamp }` (query: `?status=&from=&to=`) |
| G18 | 465 | GET | `/api/viadp/trust` | `{ trustScores, timestamp }` |
| G19 | 473 | GET | `/api/viadp/trust/:agentId` | `{ agentId, scores, timestamp }` |
| G20 | 482 | GET | `/api/viadp/audit` | `{ entries, total, timestamp }` (query: `?actor=&action=&since=`) |
| G21 | 494 | GET | `/api/voice/status` | `{ status, timestamp }` |
| G22 | 503 | POST | `/api/voice/transcribe` | `{ result, timestamp }` |
| G23 | 523 | POST | `/api/voice/synthesize` | `{ result, timestamp }` |
| G24 | 540 | GET | `/api/openclaw/agents` | `{ agents, timestamp }` |
| G25 | 545 | GET | `/api/openclaw/tools` | `{ tools, timestamp }` |
| G26 | 550 | POST | `/api/openclaw/tools/:name/execute` | tool result JSON |
| G27 | 566 | GET | `/api/workflows` | `{ workflows, timestamp }` |
| G28 | 575 | POST | `/api/workflows/start` | `{ instance, timestamp }` |
| G29 | 589 | POST | `/api/workflows/pause-all` | `{ success, paused }` |
| G30 | 599 | POST | `/api/workflows/resume-all` | `{ success, resumed }` |
| G31 | 609 | GET | `/api/workflows/status` | `{ workflows }` |
| G32 | 614 | POST | `/api/workflows/:instanceId/pause` | `{ status: 'paused', timestamp }` |
| G33 | 624 | POST | `/api/workflows/:instanceId/resume` | `{ status: 'resumed', timestamp }` |
| G34 | 635 | GET | `/api/workflows/:instanceId/progress` | `{ progress, timestamp }` |
| G35 | 644 | POST | `/api/workflows/:instanceId/cancel` | `{ status: 'cancelled', timestamp }` |
| G36 | 653 | GET | `/api/workflows/:name` | `{ workflow, timestamp }` |
| G37 | 663 | GET | `/api/workflow-instances` | `{ instances, timestamp }` |
| G38 | 669 | GET | `/api/workflow-instances/:id` | `{ instance, timestamp }` |
| G39 | 681 | GET | `/api/connections` | `{ stats, timestamp }` |
| G40 | 686 | GET | `/api/tools` | `{ tools }` |
| G41 | 690 | GET | `/api/tools/:agentId` | `{ agentId, tools }` |
| G42 | 696 | GET | `/api/sandboxes` | `{ sandboxes }` |
| G43 | 705 | GET | `/api/interrupts` | `{ interrupts }` |
| G44 | 710 | GET | `/api/interrupts/all` | `{ interrupts }` |
| G45 | 715 | POST | `/api/interrupts/:id/resolve` | `{ success }` |
| G46 | 732 | GET | `/api/escalations` | `{ escalations }` (query: `?status=`) |
| G47 | 741 | POST | `/api/escalations/:id/review` | `{ success }` |
| G48 | 755 | POST | `/api/escalations/:id/dismiss` | `{ success }` |
| G49 | 769 | POST | `/api/agents/:agentId/takeover` | `{ success, agentId }` |
| G50 | 782 | POST | `/api/agents/:agentId/release` | `{ success, agentId }` |
| G51 | 796 | POST | `/api/agents/:agentId/human-message` | `{ success, messageId }` |
| G52 | 833 | GET | `/api/memory/search` | `{ results, total }` |
| G53 | 852 | GET | `/api/memory/stats` | `{ stats }` |
| G54 | 873 | POST | `/api/memory/store` | `{ entry }` |
| G55 | 902 | POST | `/api/seed` | `{ success, created, timestamp }` |
| G56 | 1209 | POST | `/api/tasks/:taskId/start` | `{ task, agentId, response, model, timestamp }` |
| G57 | 1349 | POST | `/api/tasks/:taskId/approve` | `{ task, status, timestamp }` |
| G58 | 1384 | POST | `/api/tasks/:taskId/reject` | `{ task, feedback, response, timestamp }` |
| G59 | 1433 | POST | `/api/tasks/:taskId/assign` | `{ task, assignedTo, timestamp }` |
| G60 | 1466 | POST | `/api/auth/token` | `{ token, expiresIn }` |
| G61 | 1479 | GET | `/api/auth/verify` | `{ valid, payload }` |
| G62 | 1495 | GET | `/api/costs/summary` | `{ summary, timestamp }` |
| G63 | 1500 | GET | `/api/costs/agent/:agentId` | `{ agentId, capStatus, recentRecords, timestamp }` |
| G64 | 1507 | PUT | `/api/costs/caps/:agentId` | `{ agentId, cap, timestamp }` |
| G65 | 1518 | GET | `/api/costs/caps` | `{ caps, timestamp }` |
| G66 | 1529 | GET | `/api/audit` | `{ entries, total }` |
| G67 | 1543 | GET | `/api/audit/verify` | integrity result |
| G68 | 1549 | GET | `/api/system/sovereignty` | sovereignty config |
| G69 | 1578 | POST | `/api/artifacts/upload` | upload result |
| G70 | 1591 | GET | `/api/artifacts/download` | binary content |
| G71 | 1605 | GET | `/api/artifacts/list` | `{ objects, timestamp }` |

---

## Part 3: Cross-Reference — Mismatches Found

### CRITICAL: Missing Gateway Endpoint

| # | Severity | Dashboard Call | Gateway Handler | Issue |
|---|----------|---------------|-----------------|-------|
| **M1** | **CRITICAL** | `updateTask()` at api.ts:192 — `PUT /api/tasks/:taskId` | **NONE** | **No PUT handler exists for `/api/tasks/:taskId`.** The dashboard sends `PUT` requests with `{ status, column, assignedTo, priority }` updates, but the gateway has no handler to receive them. Calls silently fail (dashboard only logs a console warning). This is used by the Kanban drag-and-drop (page.tsx:516). |

### MAJOR: Response Shape Mismatches

| # | Severity | Dashboard Call | Gateway Handler | Issue |
|---|----------|---------------|-----------------|-------|
| **M2** | **MAJOR** | `fetchAgent()` at api.ts:169 — expects `{ agent: GatewayAgent & Record<...> }` | G4 at index.ts:257 — returns `{ config, state, timestamp }` | **Structural mismatch.** Dashboard expects a single `agent` key with flat fields (`id`, `name`, `role`, `status`, etc.). Gateway returns two separate objects `config` and `state` under different keys. Dashboard would receive `undefined` for `agent`. |
| **M3** | **MAJOR** | `fetchConnections()` at api.ts:258 — expects `{ connections: { total, users, agents, dashboards } }` | G39 at index.ts:681 — returns `{ stats: { total, users, agents, dashboards, connectedAgents }, timestamp }` | **Key name mismatch.** Dashboard expects data under `connections` key, but gateway wraps it under `stats` key. Additionally, gateway includes `connectedAgents: AgentId[]` which the dashboard type does not expect. |
| **M4** | **MAJOR** | `fetchModelCosts()` at api.ts:227 — `CostsResponse.summary` expects `perAgent: Record<string, { cost, requests, tokens }>`, `perModel: Record<string, { cost, requests }>`, etc. | G14 at index.ts:421 — `getCostSummary()` returns `perAgent: Record<AgentId, number>`, `perModel: Record<ModelId, number>`, etc. | **Value shape mismatch.** Dashboard expects each per-agent/per-model entry to be an object like `{ cost: number, requests: number, tokens: number }`. Gateway returns plain `number` values (just cost). The `requests` and `tokens` breakdown per agent/model is not provided by the gateway. |
| **M5** | **MAJOR** | `fetchViadpTrust()` at api.ts:241 — expects `{ trust: { score, alpha, beta, history } }` | G19 at index.ts:473 — returns `{ agentId, scores: TrustScore[], timestamp }` | **Structural mismatch.** Dashboard expects a single `trust` object. Gateway returns `scores` (an array of `TrustScore` objects). Key names differ (`trust` vs `scores`), and shape differs (single object vs array). |

### MAJOR: Query Parameter Mismatches

| # | Severity | Dashboard Call | Gateway Handler | Issue |
|---|----------|---------------|-----------------|-------|
| **M6** | **MAJOR** | `fetchViadpDelegations(agentId?)` at api.ts:236 — sends `?agentId=` | G17 at index.ts:456 — reads `?status=`, `?from=`, `?to=` | **Query parameter ignored.** Dashboard sends `?agentId=xxx` to filter delegations by agent, but the gateway only reads `status`, `from`, and `to` query parameters. The `agentId` filter is silently ignored, and all delegations are returned regardless. |
| **M7** | **MAJOR** | `fetchModelCosts(agentId?)` at api.ts:227 — sends `?agentId=` | G14 at index.ts:421 — reads `?from=`, `?to=` | **Query parameter ignored.** Dashboard sends `?agentId=xxx` to filter costs by agent. Gateway only reads `from` and `to` date range parameters. The `agentId` filter is silently ignored. |

### MODERATE: Other Issues

| # | Severity | Dashboard Call | Gateway Handler | Issue |
|---|----------|---------------|-----------------|-------|
| **M8** | **MODERATE** | `fetchViadpAudit(limit?)` at api.ts:245 — sends `?limit=` | G20 at index.ts:482 — reads `?actor=`, `?action=`, `?since=` | **Query parameter ignored.** Dashboard sends `?limit=N` but gateway does not read a `limit` param. The gateway returns all matching entries. The `total` field is returned by the gateway which is fine, but pagination/limiting is not server-side. |
| **M9** | **MODERATE** | `ViadpAuditLog.tsx:78` — raw `fetch('http://localhost:18789/api/viadp/delegations')` — expects response to be a raw JSON array (`Array.isArray(data)`) | G17 at index.ts:456 — returns `{ delegations: [...], timestamp }` | **Response shape mismatch in direct fetch.** The component checks `Array.isArray(data)` on the raw response body, but the gateway wraps delegations in an object `{ delegations: [...] }`. The check will always be `false`, so polled data is never used. Additionally, the URL is hardcoded rather than using the `API_BASE` constant. |

---

## Part 4: Gateway-Only Endpoints (No Dashboard Consumer)

These gateway endpoints exist but have no corresponding dashboard API call. They are available for other consumers (agents, CLI, etc.) or are unused.

| Gateway Line | Endpoint | Notes |
|-------------|----------|-------|
| 238 | `GET /api/health/providers` | Provider health check |
| 283 | `GET /api/sessions/:sessionId` | Individual session detail |
| 432 | `POST /api/models/route` | Model routing/classification |
| 465 | `GET /api/viadp/trust` | Global trust scores (all agents) |
| 540 | `GET /api/openclaw/agents` | OpenClaw agent registry |
| 545 | `GET /api/openclaw/tools` | OpenClaw tool list |
| 550 | `POST /api/openclaw/tools/:name/execute` | Tool execution |
| 566 | `GET /api/workflows` | Workflow definitions list |
| 575 | `POST /api/workflows/start` | Start workflow |
| 635 | `GET /api/workflows/:instanceId/progress` | Workflow progress |
| 644 | `POST /api/workflows/:instanceId/cancel` | Cancel workflow |
| 653 | `GET /api/workflows/:name` | Single workflow definition |
| 663 | `GET /api/workflow-instances` | All workflow instances |
| 669 | `GET /api/workflow-instances/:id` | Single workflow instance |
| 686 | `GET /api/tools` | Tool registry list |
| 690 | `GET /api/tools/:agentId` | Agent-specific tools |
| 696 | `GET /api/sandboxes` | Active sandboxes |
| 710 | `GET /api/interrupts/all` | All interrupts (not just pending) |
| 1466 | `POST /api/auth/token` | Generate auth token |
| 1479 | `GET /api/auth/verify` | Verify auth token |
| 1495 | `GET /api/costs/summary` | Standalone cost summary |
| 1500 | `GET /api/costs/agent/:agentId` | Per-agent cost details with cap status |
| 1507 | `PUT /api/costs/caps/:agentId` | Update agent cost caps |
| 1518 | `GET /api/costs/caps` | All agent cost caps |
| 1529 | `GET /api/audit` | Audit middleware entries |
| 1543 | `GET /api/audit/verify` | Audit integrity verification |
| 1549 | `GET /api/system/sovereignty` | Data sovereignty config |
| 1578 | `POST /api/artifacts/upload` | Artifact upload |
| 1591 | `GET /api/artifacts/download` | Artifact download |
| 1605 | `GET /api/artifacts/list` | Artifact listing |
| 902 | `POST /api/seed` | Demo data seeding |

---

## Part 5: Recommended Fixes

### Fix M1 (CRITICAL) — Add `PUT /api/tasks/:taskId` handler to gateway

```typescript
// gateway/src/index.ts — add after the POST /api/tasks handler (line ~342)
app.put('/api/tasks/:taskId', express.json(), (req, res) => {
  const task = taskManager.getTask(req.params.taskId);
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  const updates = req.body;
  // Map 'column' to 'status' if provided (Kanban drag-and-drop sends column names)
  if (updates.column && !updates.status) {
    updates.status = updates.column;
  }

  if (updates.status && updates.status !== task.status) {
    taskManager.moveTask(task.id, updates.status, 'user');
  }
  if (updates.assignedTo) {
    taskManager.assignTask(task.id, updates.assignedTo, 'user');
  }
  if (updates.priority) {
    taskManager.updateTask(task.id, { priority: updates.priority }, 'user');
  }

  res.json({ task: taskManager.getTask(task.id), timestamp: new Date().toISOString() });
});
```

### Fix M2 (MAJOR) — Align `fetchAgent` response

**Option A** (fix gateway): Change gateway response to `{ agent: { ...config, ...state } }`.
**Option B** (fix dashboard): Change dashboard type to `{ config, state, timestamp }`.

### Fix M3 (MAJOR) — Align `fetchConnections` response

**Option A** (fix gateway, line 683): Change `res.json({ stats, ... })` to `res.json({ connections: stats, ... })`.
**Option B** (fix dashboard): Change `ConnectionsResponse` to use `stats` key.

### Fix M4 (MAJOR) — Align cost summary shapes

Either enrich the gateway `getCostSummary()` to return `{ cost, requests, tokens }` per agent/model, or simplify the dashboard `CostsResponse` type to accept plain numbers.

### Fix M5 (MAJOR) — Align VIADP trust response

**Option A** (fix gateway, line 476): Change to `res.json({ trust: scores[0] ?? null, ... })`.
**Option B** (fix dashboard): Change `ViadpTrust` type to `{ agentId, scores: TrustScore[] }`.

### Fix M6 (MAJOR) — Add `agentId` filter to VIADP delegations

Add `agentId` query parameter support to the gateway handler at line 456:
```typescript
const agentId = req.query.agentId as string;
// filter where from === agentId || to === agentId
```

### Fix M7 (MAJOR) — Add `agentId` filter to model costs

Add `agentId` query parameter support to the gateway handler at line 421:
```typescript
const agentId = req.query.agentId as string;
if (agentId) {
  // filter cost records by agentId before summarizing
}
```

### Fix M8 (MODERATE) — Add `limit` support to VIADP audit

Add `limit` query parameter to the gateway handler at line 482:
```typescript
const limit = parseInt(req.query.limit as string) || 0;
const result = limit ? entries.slice(0, limit) : entries;
```

### Fix M9 (MODERATE) — Fix ViadpAuditLog direct fetch

In `ViadpAuditLog.tsx:78-83`, change:
```typescript
// Before (broken):
const data = await res.json();
if (Array.isArray(data) && data.length > 0) {
  setDelegations(data);
}

// After (fixed):
const data = await res.json();
if (data.delegations && Array.isArray(data.delegations)) {
  setDelegations(data.delegations);
}
```

Also replace the hardcoded URL with the `API_BASE` constant from `lib/api.ts` or import the `fetchViadpDelegations` function directly.

---

## Part 6: Matched Endpoints (No Issues)

These dashboard-to-gateway pairs are correctly aligned:

| Dashboard Function | Gateway Endpoint | Status |
|-------------------|-----------------|--------|
| `fetchHealth` | `GET /health` | OK |
| `fetchAgents` | `GET /api/agents` | OK |
| `fetchTasks` | `GET /api/tasks` | OK |
| `fetchKanban` | `GET /api/kanban/:sessionId` | OK |
| `createTask` | `POST /api/tasks` | OK |
| `fetchTaskStats` | `GET /api/tasks/stats/:sessionId` | OK |
| `fetchModelAssignments` | `GET /api/models/assignments` | OK (gateway adds extra `catalog` field, harmless) |
| `saveModelAssignments` | `POST /api/models/assignments` | OK |
| `fetchViadpSummary` | `GET /api/viadp/summary` | OK |
| `fetchSessions` | `GET /api/sessions` | OK |
| `createSession` | `POST /api/sessions` | OK |
| `fetchVoiceStatus` | `GET /api/voice/status` | OK |
| `transcribeAudio` | `POST /api/voice/transcribe` | OK |
| `synthesizeText` | `POST /api/voice/synthesize` | OK |
| `startTask` | `POST /api/tasks/:taskId/start` | OK |
| `approveTask` | `POST /api/tasks/:taskId/approve` | OK |
| `rejectTask` | `POST /api/tasks/:taskId/reject` | OK |
| `assignTaskToAgent` | `POST /api/tasks/:taskId/assign` | OK |
| `searchMemory` | `GET /api/memory/search` | OK |
| `fetchMemoryStats` | `GET /api/memory/stats` | OK |
| `storeMemory` | `POST /api/memory/store` | OK |
| `fetchPendingInterrupts` | `GET /api/interrupts` | OK |
| `resolveInterrupt` | `POST /api/interrupts/:id/resolve` | OK |
| `pauseAllWorkflows` | `POST /api/workflows/pause-all` | OK |
| `resumeAllWorkflows` | `POST /api/workflows/resume-all` | OK |
| `pauseWorkflow` | `POST /api/workflows/:instanceId/pause` | OK |
| `resumeWorkflow` | `POST /api/workflows/:instanceId/resume` | OK |
| `fetchWorkflowStatuses` | `GET /api/workflows/status` | OK |
| `fetchEscalations` | `GET /api/escalations` | OK |
| `reviewEscalation` | `POST /api/escalations/:id/review` | OK |
| `dismissEscalation` | `POST /api/escalations/:id/dismiss` | OK |
| `takeOverAgent` | `POST /api/agents/:agentId/takeover` | OK |
| `releaseAgent` | `POST /api/agents/:agentId/release` | OK |
| `sendHumanMessage` | `POST /api/agents/:agentId/human-message` | OK |

---

## Files Analyzed

- `/Users/bandar/Documents/AreebPro/forge-team/dashboard/src/lib/api.ts` (442 lines) — all 41 API functions
- `/Users/bandar/Documents/AreebPro/forge-team/dashboard/src/lib/socket.ts` (298 lines) — WebSocket event types
- `/Users/bandar/Documents/AreebPro/forge-team/dashboard/src/components/ViadpAuditLog.tsx` — direct fetch call
- `/Users/bandar/Documents/AreebPro/forge-team/dashboard/src/app/page.tsx` — API function usage
- `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/index.ts` (2293 lines) — all 71 route handlers
- `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/server.ts` — WebSocket server, `getConnectionStats()`
- `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/model-router.ts` — `getCostSummary()`, `getAllAssignments()`
- `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/viadp-engine.ts` — `getAllTrustScores()`
- `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/agent-manager.ts` — `getAgentSummary()`
