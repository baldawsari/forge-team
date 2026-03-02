# Audit Session 4: Agent Lifecycle End-to-End Trace

**Date:** 2026-03-02
**Auditor:** Claude Opus 4.6
**Scope:** Complete task lifecycle from dashboard creation through agent execution to completion, tracing every handoff between gateway, agents, storage, and dashboard.

---

## Executive Summary

The task lifecycle has a **functional core path** (create -> start -> agent executes -> review -> approve/reject) that works end-to-end through the REST API. However, there are **14 distinct broken handoffs** where the dashboard and gateway disagree on protocols, event shapes, or state names. The Kanban drag-and-drop is confirmed dead (no `PUT /api/tasks/:taskId`), workflow events use mismatched schemas, and the LangGraph workflow nodes are stubs that never make real LLM calls.

---

## Step 1: Task Creation

### What SHOULD Happen
Dashboard creates a task -> gateway stores it -> task appears on Kanban in "backlog".

### What ACTUALLY Happens

**Dashboard side** (`/Users/bandar/Documents/AreebPro/forge-team/dashboard/src/app/page.tsx:521-546`):
1. User clicks "New Task" in KanbanBoard
2. `handleTaskCreate()` optimistically adds a task with `column: "backlog"` and a temp ID (`temp-${Date.now()}`)
3. Calls `createTask()` from `api.ts` which POSTs to `/api/tasks`
4. Sends: `{ sessionId: "default", title, description, priority, assignedTo }`

**Gateway side** (`/Users/bandar/Documents/AreebPro/forge-team/gateway/src/index.ts:333-342`):
1. `POST /api/tasks` handler receives the request
2. Calls `taskManager.createTask(req.body, sessionId)` (line 340)
3. TaskManager stores in **in-memory Map** only (line 113 of task-manager.ts: `this.tasks.set(task.id, task)`)
4. Emits `task:created` event
5. Returns `{ task, timestamp }` with status 201

**Broken Handoffs:**

| # | Issue | File:Line | Severity |
|---|-------|-----------|----------|
| B1 | **In-memory only storage.** Tasks are stored in a `Map<string, Task>` with no database persistence. Server restart loses all tasks. | `task-manager.ts:65` | CRITICAL |
| B2 | **Hardcoded sessionId "default".** Dashboard always sends `sessionId: "default"` because there is no session selection UI. If no session named "default" exists, tasks are orphaned. | `page.tsx:540` | HIGH |
| B3 | **Temp ID not reconciled.** Dashboard creates a temp task with `temp-${Date.now()}` but never replaces it with the real UUID returned by the gateway. The `task_update` Socket.IO event for `created` uses the real ID, but the optimistic task already exists with the temp ID -- so the dashboard ends up with a duplicate (the temp one + the real one appended by the socket handler at `page.tsx:413-429`). | `page.tsx:523` + `page.tsx:412` | HIGH |

---

## Step 2: Task Assignment

### What SHOULD Happen
A task gets assigned to an agent based on its content, or manually via the dashboard.

### What ACTUALLY Happens

**Auto-assignment** occurs inside `POST /api/tasks/:taskId/start` (`/Users/bandar/Documents/AreebPro/forge-team/gateway/src/index.ts:1218-1225`):
1. If `task.assignedTo` is null, calls `autoAssignAgent(task.title, task.description)`
2. `autoAssignAgent` (line 1194) does keyword matching against `TASK_KEYWORD_CAPABILITIES`
3. For each matching pattern, calls `agentManager.findAgentForCapability(cap)`
4. Falls back to `'bmad-master'` if nothing matches (line 1206)

**Manual assignment** via `POST /api/tasks/:taskId/assign` (`index.ts:1433-1462`):
1. Takes `agentId` from request body
2. Calls `taskManager.assignTask()` and `agentManager.assignTask()`
3. Emits `task_update` with type `assigned`

**Dashboard calls** `startTask()` from `api.ts:308` or `assignTaskToAgent()` from `api.ts:320`.

**Broken Handoffs:**

| # | Issue | File:Line | Severity |
|---|-------|-----------|----------|
| B4 | **No manual drag-to-assign.** The KanbanBoard has no drag-to-agent functionality. Assignment only happens implicitly when "Start" is clicked or explicitly via `POST /api/tasks/:taskId/assign`, which has no UI trigger on the Kanban. | `KanbanBoard.tsx` (entire file) | MEDIUM |
| B5 | **Assignment event shape mismatch.** The gateway emits `{ type: 'assigned', event: { taskId, sessionId, assignedTo } }` (line 1455) but the TaskManager event emitter sends `{ type: 'task.assigned', taskId, sessionId, triggeredBy, data: { title, assignedTo, priority } }` (line 486-501). The dashboard handler at `page.tsx:396-443` expects the nested `event` format with `currentStatus`. The manual-assign emit at line 1455 is missing `currentStatus` and `data` fields, so the dashboard cannot properly update the task card. | `index.ts:1455` vs `page.tsx:432-443` | HIGH |

---

## Step 3: Task State Transitions (Kanban)

### What SHOULD Happen
Tasks flow: backlog -> todo -> in-progress -> review -> done. Dashboard drag-and-drop should move tasks.

### What ACTUALLY Happens

**Valid transitions defined in TaskManager** (`task-manager.ts:51-58`):
```
backlog -> [todo, cancelled]
todo -> [in-progress, backlog, cancelled]
in-progress -> [review, todo, cancelled]
review -> [done, in-progress, cancelled]
done -> [in-progress]
cancelled -> [backlog]
```

**Dashboard Kanban column IDs** (`KanbanBoard.tsx:31-37`):
```
"backlog", "todo", "inProgress", "review", "done"
```

**Gateway TaskManager column IDs** (`task-manager.ts:41-48`):
```
"backlog", "todo", "in-progress", "review", "done", "cancelled"
```

**Broken Handoffs:**

| # | Issue | File:Line | Severity |
|---|-------|-----------|----------|
| B6 | **CRITICAL: No `PUT /api/tasks/:taskId` handler.** The dashboard `updateTask()` function (`api.ts:192-201`) sends a PUT request to `/api/tasks/${taskId}`, but the gateway has **no PUT route** for this path. There is only `app.get` and `app.post` for `/api/tasks`. The PUT returns 404, and the dashboard silently swallows the error (`console.warn` only). This means **all Kanban drag-and-drop moves are lost** -- the dashboard updates optimistically in local state but the gateway never persists the change. | `api.ts:192-201`, `index.ts` (missing route) | CRITICAL |
| B7 | **Column name mismatch: "inProgress" vs "in-progress".** Dashboard uses `"inProgress"` (camelCase) while gateway uses `"in-progress"` (kebab-case). The mapping exists in `page.tsx:201-208` (`statusToColumn`) and `page.tsx:509-515` (`columnToStatus`), but only for the polling/display path. When the dashboard tries to sync a drag-drop via the missing PUT endpoint, it sends `"in-progress"` (line 512), which would work IF the PUT existed. However, the column names in the KanbanBoard component itself use `"inProgress"`, creating a constant need for translation. | `KanbanBoard.tsx:34` vs `task-manager.ts:43` | MEDIUM |
| B8 | **Missing "cancelled" column in dashboard.** The gateway supports a "cancelled" status column, but the dashboard Kanban has no "cancelled" column. Cancelled tasks would map to "done" via the `statusToColumn` mapping at `page.tsx:207`, silently mixing cancelled and done tasks. | `page.tsx:207` | LOW |

---

## Step 4: Agent Execution (The "Start" Flow)

### What SHOULD Happen
User clicks "Start" on a task -> agent is assigned -> AI model processes the task -> result comes back -> task moves to "review".

### What ACTUALLY Happens

**Dashboard** (`page.tsx:548-563`):
1. `handleTaskStart(taskId)` adds taskId to `processingTasks` set (spinner shows)
2. Calls `startTask(taskId)` -> `POST /api/tasks/${taskId}/start`
3. On success, stores `result.response` as `agentResponse` on the task
4. Clears processing state

**Gateway** (`index.ts:1209-1347`):
1. Looks up task, auto-assigns agent if none
2. Moves task: `backlog -> todo -> in-progress` (lines 1233-1234)
3. Calls `agentManager.assignTask(assignedAgent, task.id, task.sessionId)` (line 1236)
4. Builds a task prompt with title, description, priority, complexity, tags
5. Calls `agentRunner.processUserMessage(assignedAgent, taskPrompt, task.sessionId)` (line 1248)
6. **This is where the actual AI call happens** (agent-runner.ts:167-396)
7. Extracts code-block artifacts from response using regex (lines 1253-1295)
8. Uploads artifacts to MinIO via `storageService.upload()` (line 1286)
9. Stores `agentResponse` in task metadata (line 1302-1304)
10. Moves task to `review` (line 1307)
11. Emits `message` event and `task_update` event via Socket.IO
12. Returns `{ task, agentId, response, model, timestamp }`

**AgentRunner internals** (`agent-runner.ts:167-396`):
1. Gets agent config from AgentManager
2. Routes to correct model via `modelRouter.route()` (line 186-190)
3. Loads `SOUL.md` personality file from disk (line 204)
4. Builds system prompt with model-specific preamble (lines 199-211)
5. Retrieves RAG context from MemoryManager + GeminiFileSearch + VectorStore (line 214)
6. Gets conversation history from SessionManager (line 220)
7. Calls Anthropic or Google API based on provider (lines 251-263)
8. Supports tool use with up to 5 rounds (line 559-609 for Anthropic, 683-724 for Gemini)
9. Checks for delegation markers `[DELEGATE: @agent-id]` (lines 292-306)
10. Records cost via `modelRouter.recordCost()` (line 309-317)
11. Checks confidence and creates escalation if low (lines 320-336)
12. Stores exchange in memory for future RAG (lines 339-383)

**This flow is the most complete path in the entire system.** It genuinely works end-to-end.

**Broken Handoffs:**

| # | Issue | File:Line | Severity |
|---|-------|-----------|----------|
| B9 | **Synchronous HTTP request for AI call.** The `/api/tasks/:taskId/start` handler is `async` and awaits the full AI response before returning. For premium models (Claude Opus), this can take 10-30+ seconds. The dashboard `startTask()` has no timeout, but browser/proxy timeouts could kill the request. There is no streaming or background-job pattern. | `index.ts:1248`, `api.ts:308` | HIGH |
| B10 | **Agent status not properly broadcast.** The start handler calls `agentManager.assignTask()` which triggers `agent:task-assigned` -> `io.emit('agent_status', { status: 'working' })`. But the handler does NOT set agent status back to 'idle' after the AI call completes. The `agentManager.completeTask()` is only called in the `/approve` handler (line 1364), meaning the agent stays "working" even after delivering its response until the user approves. | `index.ts:1236` + `index.ts:1364` | MEDIUM |

---

## Step 5: Artifact Handling

### What SHOULD Happen
Agent produces code/documents -> extracted as artifacts -> stored in object storage -> dashboard shows download links.

### What ACTUALLY Happens

**Extraction** (`index.ts:1253-1299`):
1. Regex scans response for code blocks: `` ```language\n...\n``` ``
2. Skips blocks under 10 characters
3. Creates filename from task title slug + language extension
4. Upload key format: `${sessionId}/${taskId}/${filename}`
5. Uploads to MinIO via `storageService.upload()`
6. Creates download URL: `/api/artifacts/download?key=${encodeURIComponent(artifactKey)}`
7. Adds URL to task via `taskManager.addArtifact(task.id, downloadUrl)`

**Storage** (`storage.ts`):
- S3-compatible (MinIO) with configurable endpoint
- Bucket: `forgeteam-artifacts`
- `ensureBucket()` auto-creates if missing

**Dashboard display** (`KanbanBoard.tsx:158-179`):
1. Expanded task card shows `task.artifacts` array
2. For each artifact, checks if it starts with `/api/`
3. If yes, constructs full URL: `http://localhost:18789${artifact}`
4. Renders as clickable link that opens in new tab

**Download endpoint** (`index.ts:1591-1602`):
1. `GET /api/artifacts/download?key=...`
2. Calls `storageService.download(key)`
3. Returns raw file with correct Content-Type

**This path works correctly IF MinIO is running.** The artifact viewer in the dashboard properly constructs download URLs that match the gateway's artifact download endpoint.

**Broken Handoffs:**

| # | Issue | File:Line | Severity |
|---|-------|-----------|----------|
| B11 | **MinIO dependency not guaranteed.** If MinIO is not running (common in dev), `storageService.upload()` throws, artifacts are silently lost (caught at line 1291), but the task still moves to review. The agent response content is preserved in metadata but artifacts are gone. No fallback to filesystem. | `index.ts:1285-1294` | MEDIUM |
| B12 | **Artifact URL fragility.** Download URLs stored in `task.artifacts` are relative paths like `/api/artifacts/download?key=...`. Since tasks are in-memory only (B1), these URLs are ephemeral. Also, the dashboard hardcodes `http://localhost:18789` (line 163 of KanbanBoard.tsx), which breaks in any deployment. | `KanbanBoard.tsx:163` | MEDIUM |

---

## Step 6: Human-in-the-Loop (Approve / Reject)

### What SHOULD Happen
Task in "review" -> human approves or rejects -> task moves to "done" or back to "in-progress" with feedback.

### What ACTUALLY Happens

**Approve** (`index.ts:1349-1382`):
1. `POST /api/tasks/:taskId/approve`
2. Validates task is in "review" status
3. Calls `taskManager.moveTask(task.id, 'done', 'user')`
4. Calls `agentManager.completeTask(task.assignedTo, task.id)` -- sets agent to idle
5. Emits `task_update` with `currentStatus: 'done'`
6. Triggers memory summarization via `summarizer.checkAndCompact(sessionId)`
7. Returns `{ task, status: 'done' }`

**Reject** (`index.ts:1384-1431`):
1. `POST /api/tasks/:taskId/reject` with `{ feedback }`
2. Validates task is in "review" status
3. Moves task back to "in-progress"
4. Emits `task_update`
5. **Sends feedback to agent** via `agentRunner.processUserMessage()` (line 1413)
6. The agent processes the feedback and generates a revised response (synchronous, same timeout issue as B9)
7. Moves task back to "review" (line 1417)
8. Emits another `task_update`
9. Returns `{ task, feedback, response }`

**Dashboard** (`page.tsx:565-585`):
1. `handleTaskApprove(taskId)` calls `approveTask(taskId)` (POST to `/api/tasks/:taskId/approve`)
2. `handleTaskReject(taskId, feedback)` calls `rejectTask(taskId, feedback)` (POST to `/api/tasks/:taskId/reject`)
3. Both set/clear `processingTasks` for spinner UI

**This flow works correctly.** The approve/reject buttons appear only for tasks in the "review" column (`KanbanBoard.tsx:457-484`). The gateway handlers properly validate status, move tasks, and communicate with agents.

**Minor Issues:**

| # | Issue | File:Line | Severity |
|---|-------|-----------|----------|
| B13 | **Reject doesn't re-extract artifacts.** When the agent revises its response after rejection, the new code blocks are not extracted as artifacts. The artifact extraction logic only runs in the `/start` handler. The revised `result.content` is returned but not stored in task metadata either. | `index.ts:1414` (no artifact extraction after line 1413) | MEDIUM |

---

## Step 7: WebSocket Event Flow

### Complete Event Mapping

**Gateway emits (via Socket.IO):**

| Event Name | Emitted By | Payload Shape |
|------------|-----------|---------------|
| `initial_state` | `index.ts:1659` on connection | `{ agents, tasks, sessions, viadp, health }` |
| `agent_status` | `index.ts:1944-1988` | `{ agentId, oldStatus?, newStatus?, status?, currentTask?, sessionId? }` |
| `task_update` | `index.ts:2046-2075` | `{ type: string, event: TaskEvent }` |
| `message` | `index.ts:1692,1732,1803,1992,2100` | AgentMessage format |
| `session_update` | `index.ts:2079-2097` | `{ type, session?, sessionId?, ... }` |
| `viadp_update` | `index.ts:2104-2162` | `{ type, data }` |
| `workflow_update` | `index.ts:2166-2182` | `{ type, instanceId, workflowName?, phaseName?, ... }` |
| `approval_requested` | `index.ts:2186` | `{ instanceId, approval }` |
| `workflow_progress` | `index.ts:2190` | `{ instanceId, progress }` |
| `cost_update` | `index.ts:2034-2041` | `{ type, agentId, dailyUsed, dailyCap }` |
| `interrupt_update` | `index.ts:1812,2008` | `{ type, interrupt, timestamp }` |
| `escalation_update` | (not found -- see B14) | N/A |
| `party_mode_selection` | `index.ts:1704` | `{ sessionId, selections, correlationId }` |

**Dashboard listens (via Socket.IO):**

| Event Name | Handler | Expected Payload |
|------------|---------|-----------------|
| `initial_state` | `socket.ts:169` (typed) | NOT subscribed in `page.tsx` |
| `agent_status` | `page.tsx:379-394` | `{ agentId, newStatus?, status?, currentTask?, model? }` |
| `task_update` | `page.tsx:396-443` | `{ type, event: { taskId, currentStatus, data } }` |
| `message` | `page.tsx:447-454` | `{ id, ... }` |
| `workflow_update` | `page.tsx:457-465` | `{ phase, progress, status }` |
| `session_update` | `page.tsx:468-470` | triggers full reload |
| `viadp_update` | `page.tsx:472-474` | triggers full reload |
| `cost_update` | `page.tsx:477-480` | `{ cost }` |
| `escalation_update` | `page.tsx:484-489` | `{ type, escalation }` |
| `interrupt_update` | `socket.ts:188` (typed) | Used by InterruptModal |
| `approval_requested` | **NOT LISTENED** | -- |
| `workflow_progress` | **NOT LISTENED** | -- |

**Broken Handoffs:**

| # | Issue | File:Line | Severity |
|---|-------|-----------|----------|
| B14 | **`initial_state` event is emitted but never consumed.** Gateway sends a comprehensive state snapshot on Socket.IO connection (`index.ts:1659-1668`), but the dashboard `page.tsx` never subscribes to `initial_state`. The dashboard instead polls via REST every 3 seconds (`page.tsx:373`). The `initial_state` type is defined in `socket.ts:103-135` but no `on("initial_state", ...)` call exists in page.tsx. | `socket.ts:169` defined, `page.tsx` missing | MEDIUM |
| B15 | **`workflow_update` payload mismatch.** Gateway emits `{ type: 'started', instanceId, workflowName }` (line 2166), `{ type: 'phase_changed', instanceId, phaseName }` (line 2178), etc. Dashboard expects `{ phase: string, progress: number, status: "complete" \| "active" \| "pending" }` (socket.ts:138-142 and page.tsx:457-465). The gateway never sends `phase` or `progress` directly -- it sends `instanceId` + `phaseName`. **The dashboard handler is dead code** -- it tries to match `data.phase` against `workflowPhases` but the gateway sends completely different keys. | `index.ts:2166-2182` vs `socket.ts:138-142` | HIGH |
| B16 | **`cost_update` payload mismatch.** Gateway emits `{ type: 'agent-blocked', agentId, dailyUsed, dailyCap }` (line 2035) or `{ type: 'threshold-warning', ... }`. Dashboard expects `{ agentId, tokensUsed, cost, model }` (socket.ts:146-150) and specifically checks `typeof data.cost === "number"` (page.tsx:478). The gateway never sends a `cost` field -- it sends `dailyUsed` and `dailyCap`. **The dashboard cost_update handler is dead code.** | `index.ts:2034-2041` vs `socket.ts:146-150` | MEDIUM |
| B17 | **`approval_requested` and `workflow_progress` have no listeners.** Gateway emits `approval_requested` (line 2186) and `workflow_progress` (line 2190) but the dashboard socket handler in page.tsx never subscribes to these events. These events are typed in socket.ts but there is no `on(...)` call. Approval requests from workflows are invisible to the user. | `index.ts:2186,2190` vs `page.tsx` | HIGH |
| B18 | **`escalation_update` never emitted by gateway.** The dashboard subscribes to `escalation_update` (page.tsx:484) but the gateway never emits this event. Escalations are only created inside `agentRunner` as in-memory records (agent-runner.ts:321-336) and exposed via `GET /api/escalations`. There is no Socket.IO emit when an escalation is created. The dashboard falls back to polling (`fetchEscalations()` at page.tsx:357). | `page.tsx:484` vs `index.ts` (missing emit) | MEDIUM |

---

## Step 8: VIADP Integration with Task Lifecycle

### What SHOULD Happen
VIADP delegation should be part of the task execution flow -- when an agent needs help, it creates a delegation request through VIADP.

### What ACTUALLY Happens

**VIADP has two integration points:**

1. **AgentRunner delegation markers** (`agent-runner.ts:291-306`): When an agent's response contains `[DELEGATE: @agent-id]`, the AgentRunner calls `spawnSubAgent()` which recursively calls `processUserMessage()` on the target agent. This does NOT go through VIADPEngine at all -- it bypasses trust scoring, capability assessment, audit logging, and scope enforcement.

2. **LangGraph workflow VIADP node** (`langgraph/nodes.ts:39-80`): The `viadpPreCheck` node calls `viadpEngine.assessDelegation()` before each workflow phase. If risk is "critical", it pauses for approval. **However, the LangGraph nodes are explicitly documented as stubs** (nodes.ts:8: "Nodes do NOT make actual LLM calls. They log what they would dispatch and mark steps/phases as completed").

3. **VIADPEngine standalone** (`viadp-engine.ts`): Full delegation protocol with trust scoring, verification, token management, and audit logging. Exposed via REST API (`/api/viadp/*`) and WebSocket handlers. But it is **never called by the task start/execute flow**. The `POST /api/tasks/:taskId/start` handler (index.ts:1209) calls `agentRunner.processUserMessage()` directly without any VIADP delegation.

**Broken Handoffs:**

| # | Issue | File:Line | Severity |
|---|-------|-----------|----------|
| B19 | **VIADP is disconnected from task execution.** The core task lifecycle (`/api/tasks/:taskId/start`) goes directly to AgentRunner without VIADP. The AgentRunner's inline delegation (`[DELEGATE:]` markers) bypasses VIADP entirely. VIADP only runs inside LangGraph workflows, which are stubs. The elaborate trust/verification/audit machinery in VIADPEngine is effectively unused in the real task flow. | `index.ts:1248` (no VIADP call), `agent-runner.ts:292-306` (bypasses VIADP) | HIGH |
| B20 | **LangGraph nodes are stubs.** The `executeStep` node in `langgraph/nodes.ts` logs what it would do but does NOT call the AI. The comment at line 8 explicitly says "Nodes do NOT make actual LLM calls." This means `workflowExecutor.startWorkflow()` will go through phases but no real work happens. | `langgraph/nodes.ts:8` | CRITICAL |

---

## Step 9: Full Lifecycle Sequence Diagram

```
Dashboard                   Gateway (REST)              TaskManager (memory)      AgentRunner           AI Provider
   |                             |                           |                        |                    |
   |-- POST /api/tasks --------->|                           |                        |                    |
   |                             |-- createTask() ---------->|                        |                    |
   |                             |                           |-- tasks.set() [RAM]    |                    |
   |                             |                           |-- emit task:created    |                    |
   |<-- { task } ---------------|                           |                        |                    |
   |                             |                           |                        |                    |
   |   [Socket.IO: task_update { type: created }]           |                        |                    |
   |                             |                           |                        |                    |
   |-- POST /tasks/:id/start -->|                           |                        |                    |
   |                             |-- autoAssignAgent()       |                        |                    |
   |                             |-- moveTask(todo) -------->|                        |                    |
   |                             |-- moveTask(in-progress) ->|                        |                    |
   |                             |-- assignTask() ---------->|                        |                    |
   |                             |                           |                        |                    |
   |                             |-- processUserMessage() ---|----------------------->|                    |
   |                             |                           |                        |-- route()          |
   |                             |                           |                        |-- loadSoulMd()     |
   |                             |                           |                        |-- retrieveContext() |
   |                             |                           |                        |-- callAnthropic() -|---------------->|
   |                             |                           |                        |                    |<-- response ----|
   |                             |                           |                        |-- recordCost()     |                    |
   |                             |                           |                        |-- checkConfidence() |                    |
   |                             |<-- { content, model } ----|------------------------|                    |
   |                             |                           |                        |                    |
   |                             |-- extract artifacts       |                        |                    |
   |                             |-- storageService.upload() |                        |                    |
   |                             |-- addArtifact() --------->|                        |                    |
   |                             |-- updateTask(metadata) -->|                        |                    |
   |                             |-- moveTask(review) ------>|                        |                    |
   |                             |                           |                        |                    |
   |   [Socket.IO: message { from: agent, content }]        |                        |                    |
   |   [Socket.IO: task_update { type: moved, status: review }]                      |                    |
   |                             |                           |                        |                    |
   |<-- { task, response } -----|                           |                        |                    |
   |                             |                           |                        |                    |
   |-- POST /tasks/:id/approve->|                           |                        |                    |
   |                             |-- moveTask(done) -------->|                        |                    |
   |                             |-- completeTask() -------->|  (agent -> idle)       |                    |
   |   [Socket.IO: task_update { type: completed }]         |                        |                    |
   |<-- { task, status: done } -|                           |                        |                    |
```

---

## Complete Broken Handoff Registry

| ID | Category | Description | Files | Severity |
|----|----------|-------------|-------|----------|
| B1 | Storage | Tasks stored in-memory only, lost on restart | `task-manager.ts:65` | CRITICAL |
| B2 | Session | Dashboard hardcodes sessionId "default" | `page.tsx:540` | HIGH |
| B3 | State | Temp task ID never reconciled, causes duplicates | `page.tsx:523` + `page.tsx:412` | HIGH |
| B4 | UI | No drag-to-assign agent in Kanban | `KanbanBoard.tsx` | MEDIUM |
| B5 | Events | Manual assign event missing required fields | `index.ts:1455` vs `page.tsx:432` | HIGH |
| B6 | API | **No PUT /api/tasks/:taskId** -- drag-and-drop is dead | `api.ts:192`, `index.ts` (missing) | CRITICAL |
| B7 | Naming | Column name mismatch: "inProgress" vs "in-progress" | `KanbanBoard.tsx:34` vs `task-manager.ts:43` | MEDIUM |
| B8 | UI | No "cancelled" column in dashboard | `page.tsx:207` | LOW |
| B9 | Perf | Synchronous AI call blocks HTTP request 10-30s | `index.ts:1248` | HIGH |
| B10 | State | Agent stays "working" until approval, not completion | `index.ts:1236` vs `index.ts:1364` | MEDIUM |
| B11 | Infra | No MinIO fallback -- artifacts silently lost | `index.ts:1285-1294` | MEDIUM |
| B12 | Config | Artifact URLs hardcode localhost | `KanbanBoard.tsx:163` | MEDIUM |
| B13 | Logic | Reject doesn't re-extract artifacts | `index.ts:1414` | MEDIUM |
| B14 | Events | `initial_state` emitted but never consumed | `index.ts:1659` vs `page.tsx` | MEDIUM |
| B15 | Events | `workflow_update` payload completely mismatched | `index.ts:2166` vs `socket.ts:138` | HIGH |
| B16 | Events | `cost_update` payload mismatched | `index.ts:2034` vs `socket.ts:146` | MEDIUM |
| B17 | Events | `approval_requested` + `workflow_progress` never listened | `index.ts:2186,2190` | HIGH |
| B18 | Events | `escalation_update` never emitted by gateway | `page.tsx:484` vs `index.ts` | MEDIUM |
| B19 | Arch | VIADP disconnected from actual task execution | `index.ts:1248`, `agent-runner.ts:292` | HIGH |
| B20 | Arch | LangGraph workflow nodes are stubs (no real LLM calls) | `langgraph/nodes.ts:8` | CRITICAL |

---

## Priority Fix Recommendations

### Tier 1 -- Blocking (CRITICAL)

1. **B6: Add `PUT /api/tasks/:taskId` route** in `index.ts`. This is a single route handler that calls `taskManager.updateTask()` and `taskManager.moveTask()`. Without this, Kanban drag-and-drop is non-functional.

2. **B1: Add database persistence for tasks.** Either write tasks to Postgres via `db.ts` or add Redis caching. The `init.sql` already has a `tasks` table -- wire it up.

3. **B20: Make LangGraph nodes call real agents.** The `executeStep` node should call `agentRunner.processUserMessage()` instead of logging stubs.

### Tier 2 -- Major Handoff Fixes (HIGH)

4. **B15 + B16 + B17: Fix Socket.IO event schemas.** Either update gateway emitters to match dashboard expectations, or update dashboard handlers to match gateway payloads. The `workflow_update`, `cost_update`, and `approval_requested` events need aligned schemas.

5. **B9: Make task execution asynchronous.** Return a 202 Accepted immediately, execute in background, push result via Socket.IO. The dashboard already has the socket handler to update tasks.

6. **B3: Fix temp ID reconciliation.** Either remove optimistic add (wait for gateway response) or replace temp ID when the real task arrives via socket.

7. **B19: Wire VIADP into task start.** Before calling `agentRunner.processUserMessage()`, run `viadpEngine.assessDelegation()`. If risk is high, pause for approval.

### Tier 3 -- Polish (MEDIUM/LOW)

8. **B14: Subscribe to `initial_state`** in page.tsx to avoid 3-second polling delay.
9. **B18: Emit `escalation_update`** in gateway when AgentRunner creates an escalation.
10. **B13: Extract artifacts after rejection feedback.**
11. **B11: Add filesystem fallback for artifacts.**
12. **B5: Add missing fields to manual assign event emit.**

---

## What Actually Works Today

Despite the issues above, the following end-to-end path is **functional**:

1. Dashboard creates task via POST -> task appears in backlog (via polling)
2. User clicks "Start" -> agent is auto-assigned -> AI model is called -> response comes back
3. Artifacts are extracted from code blocks and stored in MinIO (if running)
4. Task moves to "review" with agent response visible in expanded card
5. User clicks "Approve" -> task moves to "done" -> agent goes idle
6. User clicks "Reject" with feedback -> agent revises -> task returns to "review"
7. Direct chat messages to agents work via ConversationPanel -> Socket.IO -> AgentRunner
8. All 12 agents with SOUL.md personalities are loaded and routed to correct models
9. Cost tracking and per-agent budget caps work correctly
10. VIADP delegation/trust/verification works as a standalone subsystem

The system is **usable for demo purposes** through the Start/Approve/Reject buttons, but **not through Kanban drag-and-drop** and **not through automated workflows**.
