# WebSocket Event Audit Report

**Project:** ForgeTeam (BMAD-Claw Edition)
**Date:** 2026-03-01
**Scope:** All Socket.IO event references in `dashboard/src/` and `gateway/src/index.ts`

---

## 1. Dashboard Socket Events

All dashboard Socket.IO usage goes through the `useSocket()` hook in `dashboard/src/lib/socket.ts`, which provides typed `on()` and `emit()` methods.

### 1.1 Events the Dashboard LISTENS for (incoming from gateway)

| # | Event Name | File : Line | Expected Payload (TypeScript interface) | Notes |
|---|-----------|-------------|----------------------------------------|-------|
| 1 | `connect` | `lib/socket.ts:246` | (built-in) | Socket.IO internal |
| 2 | `disconnect` | `lib/socket.ts:252` | `(reason: string)` | Socket.IO internal |
| 3 | `connect_error` | `lib/socket.ts:257` | `(error: Error)` | Socket.IO internal |
| 4 | `agent_status` | `app/page.tsx:379` | `AgentStatusEvent { agentId, oldStatus?, newStatus?, status?, currentTask?, sessionId?, model?, error? }` | Updates agent grid |
| 5 | `task_update` | `app/page.tsx:396` | `TaskUpdateEvent { type: 'created'|'updated'|'moved'|'assigned'|'completed'|'cancelled', event: { taskId, sessionId, currentStatus, ... } }` | Updates Kanban board |
| 6 | `message` | `app/page.tsx:447` | `GatewayMessageEvent { id, type, from, to, payload: { content, data?, artifacts? }, sessionId, timestamp, correlationId? }` | Appends to message feed |
| 7 | `message` | `ConversationPanel.tsx:230` | Same `GatewayMessageEvent` | Appends to conversation panel |
| 8 | `workflow_update` | `app/page.tsx:457` | `WorkflowUpdateEvent { phase: string, progress: number, status: 'complete'|'active'|'pending' }` | Updates workflow progress bar |
| 9 | `session_update` | `app/page.tsx:468` | `SessionUpdateEvent { type: 'created'|'destroyed'|'state_changed'|'agent_joined'|'agent_left', ... }` | Triggers full data reload |
| 10 | `viadp_update` | `app/page.tsx:472` | `ViadpUpdateEvent { type: string, data: unknown }` | Triggers full data reload |
| 11 | `viadp_update` | `ViadpAuditLog.tsx:61` | `ViadpUpdateEvent { type: 'delegation_requested'|'delegation_accepted'|..., data: unknown }` | Appends delegation entries |
| 12 | `cost_update` | `app/page.tsx:477` | `CostUpdateEvent { agentId: string, tokensUsed: number, cost: number, model: string }` | Increments today's cost |
| 13 | `escalation_update` | `app/page.tsx:484` | `{ type: 'created'|'reviewed'|'dismissed', escalation?: {...}, escalationId?, timestamp }` | Appends/refreshes escalations |
| 14 | `escalation_update` | `EscalationQueue.tsx:48` | Same as above | Same logic, separate component |
| 15 | `interrupt_update` | `InterruptModal.tsx:66` | `{ type: 'created'|'approved'|'rejected', interrupt?: { id, instanceId, agentId, agentName, stepId, type, question, ... }, interruptId?, feedback?, timestamp }` | Shows interrupt modal |
| 16 | `party_mode_selection` | `ConversationPanel.tsx:281` | `PartyModeSelectionEvent { sessionId, correlationId, selections: [{ agentId, role, reason }], timestamp }` | Shows agent selection UI |
| 17 | `voice_transcript` | `VoiceTranscriptViewer.tsx:33` | `{ id, sessionId, direction: 'stt'|'tts', language, text, confidence?, duration, timestamp }` | Appends transcript entry |

### 1.2 Events the Dashboard EMITS (outgoing to gateway)

| # | Event Name | File : Line | Payload Shape | Notes |
|---|-----------|-------------|---------------|-------|
| 1 | `chat.message` | `ConversationPanel.tsx:342` | `{ payload: { to: string, content: string, correlationId?: string }, sessionId: string }` | Sends user chat message |

### 1.3 Events in Type Map but Never Subscribed

The `SocketEvents` interface in `lib/socket.ts:168-221` declares these events, but some are never actually subscribed to with `on()`:

| Event Name | Typed at Line | Actually Subscribed? |
|-----------|---------------|---------------------|
| `initial_state` | `socket.ts:169` | **NO** -- never listened for |

---

## 2. Gateway Socket Events

All Socket.IO usage is in `gateway/src/index.ts`. The gateway uses both `io.emit()` (broadcast to all) and `socket.emit()` (unicast to one client).

### 2.1 Events the Gateway EMITS (outgoing to dashboard)

| # | Event Name | Line(s) | Emit Type | Payload Shape | Trigger |
|---|-----------|---------|-----------|---------------|---------|
| 1 | `initial_state` | 1659 | `socket.emit` (unicast) | `{ agents: AgentSummary[], tasks: Task[], sessions: Session[], viadp: ViadpSummary, health: { uptime, connections } }` | On new connection |
| 2 | `agent_status` | 772, 786, 1945, 1949, 1958, 1981, 2034 | `io.emit` | `{ agentId, oldStatus?, newStatus?, status?, currentTask?, sessionId?, model?, error?, reason? }` | Agent status changes, takeover, cost-cap |
| 3 | `task_update` | 1334, 1367, 1401, 1418, 1455, 2047, 2051, 2055, 2059, 2063, 2075 | `io.emit` | `{ type: 'created'|'updated'|'moved'|'assigned'|'completed'|'cancelled', event: TaskEvent }` | Task lifecycle |
| 4 | `message` | 817, 1322, 1692, 1732, 1765, 1803, 1851, 1992, 2100 | `io.emit` | `AgentMessage { id, type, from, to, payload: { content, data? }, sessionId, timestamp, correlationId? }` | Agent/user messages |
| 5 | `workflow_update` | 592, 602, 617, 628, 2166, 2170, 2174, 2178, 2182 | `io.emit` | `{ type: 'global_pause'|'global_resume'|'instance_paused'|'instance_resumed'|'started'|'completed'|'failed'|'phase_changed'|'step_completed', instanceId?, workflowName?, phaseName?, stepName?, error?, paused?, resumed? }` | Workflow lifecycle |
| 6 | `session_update` | 2080, 2084, 2088, 2092, 2096 | `io.emit` | `{ type: 'created'|'destroyed'|'state_changed'|'agent_joined'|'agent_left', session?, sessionId?, oldState?, newState?, agentId? }` | Session lifecycle |
| 7 | `viadp_update` | 2105-2161 | `io.emit` | `{ type: 'delegation_requested'|'delegation_accepted'|...|'audit_entry', data: mixed }` | VIADP delegation lifecycle |
| 8 | `cost_update` | 2035, 2038, 2041 | `io.emit` | `{ type: 'agent-blocked'|'agent-throttled'|'threshold-warning', agentId, dailyUsed, dailyCap }` | Cost alert thresholds |
| 9 | `interrupt_update` | 720, 1812, 2008 | `io.emit` | `{ type: 'created'|'approved'|'rejected', interrupt?, interruptId?, feedback?, timestamp }` | Interrupt lifecycle |
| 10 | `escalation_update` | 744, 758 | `io.emit` | `{ type: 'reviewed'|'dismissed', escalationId, timestamp }` | Escalation review/dismiss |
| 11 | `party_mode_selection` | 1704 | `io.emit` | `{ sessionId, selections: [{ agentId, role, reason }], correlationId }` | Party mode agent selection |
| 12 | `approval_requested` | 2186 | `io.emit` | `{ instanceId, approval }` | Workflow waiting for approval |
| 13 | `workflow_progress` | 2190 | `io.emit` | `{ instanceId, progress }` | Workflow progress update |
| 14 | `cost.cap_exceeded` | 2196 | `io.emit` | `{ type: 'cost.cap_exceeded', payload: alertData, timestamp }` | Cost cap exceeded alert |
| 15 | `cost.alert` | 2196 | `io.emit` | `{ type: 'cost.alert', payload: alertData, timestamp }` | Cost warning alert |
| 16 | `workflow:list` | 1863 | `socket.emit` (unicast) | `{ workflows: WorkflowDefinition[] }` | Response to client `workflow:list` |
| 17 | `workflow:started` | 1876 | `socket.emit` (unicast) | `{ instanceId, workflowName }` | Response to client `workflow:start` |
| 18 | `workflow:approved` | 1889 | `socket.emit` (unicast) | `{ instanceId }` | Response to client `workflow:approve` |
| 19 | `workflow:rejected` | 1902 | `socket.emit` (unicast) | `{ instanceId }` | Response to client `workflow:reject` |
| 20 | `workflow:paused` | 1915 | `socket.emit` (unicast) | `{ instanceId }` | Response to client `workflow:pause` |
| 21 | `workflow:resumed` | 1928 | `socket.emit` (unicast) | `{ instanceId }` | Response to client `workflow:resume` |
| 22 | `workflow:error` | 1865, 1872, 1878, 1885, 1891, 1898, 1904, 1911, 1917, 1924, 1930 | `socket.emit` (unicast) | `{ error: string }` | Error response for any workflow socket command |

### 2.2 Events the Gateway LISTENS for (incoming from dashboard)

| # | Event Name | Line | Expected Payload | Notes |
|---|-----------|------|-----------------|-------|
| 1 | `connection` | 1655 | (built-in) | Socket.IO internal |
| 2 | `chat.message` | 1671 | `{ payload: { to: string, content: string, correlationId?: string }, sessionId: string }` | User chat message |
| 3 | `workflow:list` | 1860 | (no data) | Request workflow definitions |
| 4 | `workflow:start` | 1869 | `{ workflowName: string, sessionId: string }` | Start a workflow |
| 5 | `workflow:approve` | 1882 | `{ instanceId: string, comment?: string }` | Approve a workflow step |
| 6 | `workflow:reject` | 1895 | `{ instanceId: string, comment?: string }` | Reject a workflow step |
| 7 | `workflow:pause` | 1908 | `{ instanceId: string }` | Pause a workflow instance |
| 8 | `workflow:resume` | 1921 | `{ instanceId: string }` | Resume a workflow instance |
| 9 | `disconnect` | 1934 | (built-in) | Socket.IO internal |

---

## 3. Cross-Reference: Mismatches

### 3.1 Orphaned Listeners (Dashboard listens, Gateway NEVER emits)

| Event Name | Dashboard Location | Severity | Description |
|-----------|-------------------|----------|-------------|
| `voice_transcript` | `VoiceTranscriptViewer.tsx:33` | **HIGH** | Dashboard listens for live voice transcripts but the gateway has zero code emitting this event. The `VoiceTranscriptViewer` component will only ever show mock data. |
| `escalation_update` (type `'created'`) | `app/page.tsx:484`, `EscalationQueue.tsx:48` | **HIGH** | Dashboard expects `{ type: 'created', escalation: {...} }` to add new escalations in real-time. The gateway only emits `escalation_update` with types `'reviewed'` and `'dismissed'` (from REST endpoints at lines 744, 758). New escalations are never pushed over WebSocket -- the dashboard only discovers them via HTTP polling. |

### 3.2 Unhandled Events (Gateway emits, Dashboard NEVER listens)

| Event Name | Gateway Location | Severity | Description |
|-----------|-----------------|----------|-------------|
| `initial_state` | `index.ts:1659` | **HIGH** | Gateway sends a full state snapshot (agents, tasks, sessions, VIADP summary, health) on every new Socket.IO connection. The dashboard declares the type (`InitialStateEvent` in `socket.ts:169`) but never subscribes to it. This means the dashboard ignores the server-sent snapshot and instead relies solely on HTTP polling every 3 seconds. Subscribing to this event would eliminate the initial loading delay. |
| `approval_requested` | `index.ts:2186` | **MEDIUM** | Gateway emits when a workflow step requires human approval. Dashboard never listens -- approval gates are completely invisible to the user in real-time. The `InterruptModal` component handles `interrupt_update` but not `approval_requested`, which is a separate event. |
| `workflow_progress` | `index.ts:2190` | **MEDIUM** | Gateway emits periodic workflow progress data (`{ instanceId, progress }`). Dashboard never listens. The `WorkflowProgress` component only updates from mock data or from `workflow_update` events (which have a different shape). |
| `cost.cap_exceeded` | `index.ts:2196` | **MEDIUM** | Gateway emits when a cost cap is exceeded. Dashboard never listens. Note: the separate `cost_update` event (which the dashboard does listen to) also fires for cost cap events but with a different payload shape. This is a redundant emission path. |
| `cost.alert` | `index.ts:2196` | **LOW** | Gateway emits for cost threshold warnings. Dashboard never listens. Same redundancy concern as above. |
| `workflow:list` | `index.ts:1863` | **LOW** | Gateway emits in response to a `workflow:list` request. Dashboard never sends `workflow:list` nor listens for the response -- it uses HTTP `GET /api/workflows` instead. |
| `workflow:started` | `index.ts:1876` | **LOW** | Gateway response to `workflow:start`. Dashboard never emits `workflow:start` nor listens for the response. |
| `workflow:approved` | `index.ts:1889` | **LOW** | Gateway response to `workflow:approve`. Dashboard never uses this socket-based workflow control. |
| `workflow:rejected` | `index.ts:1902` | **LOW** | Same -- unused socket workflow control. |
| `workflow:paused` | `index.ts:1915` | **LOW** | Same -- unused. Dashboard uses HTTP for pause/resume. |
| `workflow:resumed` | `index.ts:1928` | **LOW** | Same -- unused. |
| `workflow:error` | `index.ts:1865+` | **LOW** | Error response for socket workflow commands. Dashboard never uses socket-based workflow control. |

### 3.3 Payload Shape Mismatches

| Event Name | Field | Dashboard Expects | Gateway Sends | Severity | Impact |
|-----------|-------|-------------------|---------------|----------|--------|
| `workflow_update` | shape | `{ phase: string, progress: number, status: 'complete'\|'active'\|'pending' }` | `{ type: 'started'\|'completed'\|'failed'\|'phase_changed'\|'step_completed'\|'global_pause'\|'global_resume'\|'instance_paused'\|'instance_resumed', instanceId?, workflowName?, phaseName?, ... }` | **CRITICAL** | The dashboard checks `data.phase` (line `page.tsx:458`) which is **never present** in the gateway payload. The gateway sends `type`, `instanceId`, `workflowName`, `phaseName`, etc. The dashboard's `workflow_update` handler is effectively dead code -- the condition `if (data && data.phase)` always fails. |
| `cost_update` | shape | `CostUpdateEvent { agentId: string, tokensUsed: number, cost: number, model: string }` | `{ type: 'agent-blocked'\|'agent-throttled'\|'threshold-warning', agentId: string, dailyUsed: number, dailyCap: number }` | **HIGH** | Dashboard reads `data.cost` (`page.tsx:478-479`) to increment today's cost. Gateway sends `dailyUsed` and `dailyCap` but no `cost` field. The check `typeof data.cost === "number"` always fails, so real-time cost updates are silently dropped. |
| `escalation_update` | `escalation` field | `{ type: 'created', escalation: { id, agentId, agentName, taskId, taskTitle, confidence, reason, createdAt } }` | `{ type: 'reviewed'\|'dismissed', escalationId: string, timestamp: string }` (no `escalation` object) | **HIGH** | Even for the types the gateway does send (`reviewed`/`dismissed`), the payload shape differs: gateway sends `escalationId` (a string), dashboard expects an `escalation` object. The dashboard's `else` branch works around this by re-fetching via HTTP, so `reviewed`/`dismissed` events work indirectly. But `created` is never emitted at all. |
| `party_mode_selection` | `timestamp` field | `PartyModeSelectionEvent { sessionId, correlationId, selections, timestamp }` | `{ sessionId, selections, correlationId }` (no `timestamp`) | **LOW** | Dashboard type expects a `timestamp` field. Gateway omits it. Not currently used by the component logic so no runtime impact. |

---

## 4. Summary of Issues

### Critical (breaks functionality)

| # | Issue | Category |
|---|-------|----------|
| 1 | `workflow_update` payload shape is completely mismatched. Dashboard expects `{ phase, progress, status }` but gateway sends `{ type, instanceId, workflowName, ... }`. The dashboard handler is dead code. | Payload Mismatch |
| 2 | `cost_update` payload mismatch. Dashboard checks for `data.cost` which is never present. Real-time cost tracking is broken. | Payload Mismatch |

### High (feature not working)

| # | Issue | Category |
|---|-------|----------|
| 3 | `voice_transcript` -- dashboard listens but gateway never emits. Voice transcript live updates are non-functional. | Orphaned Listener |
| 4 | `initial_state` -- gateway emits but dashboard ignores. 3-second polling delay on initial load instead of instant state. | Unhandled Event |
| 5 | `escalation_update` type `'created'` -- dashboard listens but gateway never emits. Real-time escalation creation notifications are non-functional (relies on 3s HTTP polling fallback). | Orphaned Listener |
| 6 | `escalation_update` payload for `'reviewed'`/`'dismissed'` uses `escalationId` string instead of an `escalation` object. Dashboard works around this by re-fetching via HTTP. | Payload Mismatch |

### Medium (feature gap)

| # | Issue | Category |
|---|-------|----------|
| 7 | `approval_requested` -- gateway emits but dashboard never listens. Workflow approval gates are invisible. | Unhandled Event |
| 8 | `workflow_progress` -- gateway emits but dashboard never listens. Real-time workflow progress is invisible. | Unhandled Event |
| 9 | `cost.cap_exceeded` -- gateway emits but dashboard never listens. Redundant with `cost_update` but both have issues. | Unhandled Event |

### Low (unused socket RPC channel)

| # | Issue | Category |
|---|-------|----------|
| 10 | `workflow:list/start/approve/reject/pause/resume/error` -- gateway has a full socket-based workflow RPC interface. Dashboard never uses it (uses HTTP REST instead). This is dead gateway code unless other clients use it. | Unhandled Events |
| 11 | `cost.alert` -- redundant with `cost_update` and never listened to. | Unhandled Event |
| 12 | `party_mode_selection` missing `timestamp` field from gateway. | Minor Payload Mismatch |

---

## 5. Recommended Fixes

### P0 -- Critical

1. **Fix `workflow_update` payload alignment.** Either:
   - Update the dashboard `WorkflowUpdateEvent` type and handler to match the gateway's `{ type, instanceId, workflowName, phaseName, ... }` shape, OR
   - Update the gateway to emit a payload matching `{ phase, progress, status }` as the dashboard expects.

2. **Fix `cost_update` payload alignment.** Either:
   - Update `page.tsx:478` to read `data.dailyUsed` instead of `data.cost`, OR
   - Update the gateway to include a `cost` field in the `cost_update` payload.

### P1 -- High

3. **Subscribe to `initial_state` in `page.tsx`.** Use the server-pushed snapshot to populate agents/tasks/sessions immediately on connection, eliminating the 3-second polling delay.

4. **Emit `escalation_update` with type `'created'`** from the gateway when a new escalation is created (in the agent runner's escalation creation path).

5. **Implement `voice_transcript` emission** in the gateway's voice/STT pipeline, or remove the dead listener from the dashboard.

### P2 -- Medium

6. **Subscribe to `approval_requested`** in the dashboard to surface workflow approval gates to the user.

7. **Subscribe to `workflow_progress`** in the dashboard to show real-time workflow progress.

### P3 -- Low

8. **Remove or document** the unused `workflow:*` socket RPC channel in the gateway.

9. **Remove or consolidate** the `cost.cap_exceeded` / `cost.alert` events with the `cost_update` event.

---

## 6. File Reference Index

| File | Absolute Path |
|------|--------------|
| Dashboard socket hook | `/Users/bandar/Documents/AreebPro/forge-team/dashboard/src/lib/socket.ts` |
| Dashboard main page | `/Users/bandar/Documents/AreebPro/forge-team/dashboard/src/app/page.tsx` |
| ConversationPanel | `/Users/bandar/Documents/AreebPro/forge-team/dashboard/src/components/ConversationPanel.tsx` |
| ViadpAuditLog | `/Users/bandar/Documents/AreebPro/forge-team/dashboard/src/components/ViadpAuditLog.tsx` |
| InterruptModal | `/Users/bandar/Documents/AreebPro/forge-team/dashboard/src/components/InterruptModal.tsx` |
| EscalationQueue | `/Users/bandar/Documents/AreebPro/forge-team/dashboard/src/components/EscalationQueue.tsx` |
| VoiceTranscriptViewer | `/Users/bandar/Documents/AreebPro/forge-team/dashboard/src/components/VoiceTranscriptViewer.tsx` |
| Gateway main server | `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/index.ts` |
| Gateway legacy WS server | `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/server.ts` |
