# Audit Session 5: Shared Types vs Actual Usage

**Date:** 2026-03-02
**Scope:** `shared/types/` definitions vs gateway + dashboard actual usage
**Auditor:** Claude Opus 4.6

---

## 1. Complete Catalog of Shared Types

### 1.1 `shared/types/agent.ts`

| Type/Interface | Fields | Notes |
|---|---|---|
| `AgentId` (union type) | 12 literal strings: `'bmad-master'` through `'tech-writer'` | Used correctly across gateway |
| `AgentStatus` (union type) | `'idle' \| 'working' \| 'reviewing' \| 'blocked' \| 'offline' \| 'error'` | Dashboard mock-data omits `'offline'` and `'error'` |
| `AgentRole` (interface) | `id: AgentId`, `name: string`, `description: string`, `capabilities: string[]`, `phases: string[]` | **STALE -- not used anywhere in gateway or dashboard** |
| `AgentConfig` (interface) | `id`, `name`, `role`, `description`, `capabilities`, `phases`, `systemPrompt`, `maxConcurrentTasks`, `canDelegateTo`, `receivesFrom`, `defaultModelTier` | Used correctly in gateway `agent-manager.ts` |
| `AgentState` (interface) | `agentId`, `status`, `currentTaskId`, `sessionId`, `lastActiveAt`, `tasksCompleted`, `tasksFailed` | Used correctly in gateway `agent-manager.ts` |
| `AgentMessage` (interface) | `id`, `type`, `from`, `to`, `payload`, `sessionId`, `timestamp`, `correlationId?`, `metadata?` | Used correctly across gateway |
| `AgentMessageType` (union) | 16 message types | Gateway uses correctly |
| `AgentMessagePayload` (interface) | `content?`, `data?`, `artifacts?`, `error?` | Gateway uses correctly |
| `ArtifactReference` (interface) | `id`, `name`, `type`, `path?`, `url?`, `mimeType?`, `sizeBytes?` | **STALE -- never instantiated anywhere** |

### 1.2 `shared/types/task.ts`

| Type/Interface | Fields | Notes |
|---|---|---|
| `TaskStatus` (union) | `'backlog' \| 'todo' \| 'in-progress' \| 'review' \| 'done' \| 'cancelled'` | Dashboard uses DIFFERENT values: `'inProgress'` instead of `'in-progress'` |
| `TaskPriority` (union) | `'critical' \| 'high' \| 'medium' \| 'low'` | Used consistently |
| `TaskComplexity` (union) | `'trivial' \| 'simple' \| 'moderate' \| 'complex' \| 'critical'` | Gateway uses; dashboard does not reference |
| `Task` (interface) | 22 required fields + metadata | Dashboard `Task` has MAJOR divergence (see below) |
| `CreateTaskInput` (interface) | Partial input type | Gateway uses correctly |
| `UpdateTaskInput` (interface) | Partial input type | Gateway uses correctly |
| `KanbanColumn` (interface) | `id: TaskStatus`, `label: string`, `tasks: Task[]`, `wipLimit: number \| null` | Dashboard `GatewayKanbanColumn` diverges (see below) |
| `KanbanBoard` (interface) | `sessionId`, `columns`, `totalTasks`, `lastUpdated` | Gateway returns correctly |
| `TaskEvent` (interface) | `type`, `taskId`, `sessionId`, `timestamp`, etc. | Gateway uses correctly |

### 1.3 `shared/types/workflow.ts`

| Type/Interface | Fields | Notes |
|---|---|---|
| `YAMLStepDefinition` | `name`, `agent`, `action`, etc. | Gateway uses correctly |
| `YAMLPhaseDefinition` | `name`, `display_name`, `display_name_ar`, `agents`, etc. | Gateway uses correctly |
| `TransitionType` | `'auto' \| 'requires_approval'` | Used correctly |
| `WorkflowDefinition` | `name`, `version`, `description`, `phases`, `transitions` | Used correctly |
| `WorkflowStepStatus` | 7 values | Used correctly |
| `WorkflowInstanceStatus` | 7 values | Used correctly |
| `WorkflowStep` | 22 fields | Gateway builds correctly in `workflow-engine.ts` |
| `StepResult` | `success`, `outputs`, `logs`, `durationMs`, `modelUsed`, `tokenUsage` | Used correctly |
| `PhaseResult` | `phaseName`, `success`, `stepResults`, `outputs`, `durationMs`, `completedAt` | Used correctly |
| `WorkflowPhase` | 17 fields | Dashboard `WorkflowPhase` is COMPLETELY DIFFERENT (see below) |
| `ApprovalRequest` | 11 fields | Gateway creates correctly |
| `WorkflowCheckpoint` | 7 fields | Gateway uses correctly |
| `WorkflowInstanceState` | 5 fields | Used correctly |
| `WorkflowHistoryEntry` | `timestamp`, `type`, `phaseName?`, `stepName?`, `message`, `data?` | Used correctly |
| `WorkflowInstance` | 15 fields | Gateway builds correctly |
| `WorkflowProgress` | 7 fields | Gateway calculates correctly |
| `SDLCPipeline` | Legacy type | **STALE -- not used anywhere** |
| `PipelineTemplate` | Template type | **STALE -- not used anywhere** |
| `PipelineConfig` | 6 fields | Used by `WorkflowInstance` |
| `WorkflowEvent` | 11 fields | Used correctly |
| `WorkflowEventType` | 20+ event types | Used correctly |
| `SDLC_PHASES` | const array | **STALE -- not used anywhere** |
| `SDLCPhaseId` | derived type | **STALE -- not used anywhere** |

### 1.4 `shared/types/viadp.ts`

| Type/Interface | Fields | Notes |
|---|---|---|
| `DelegationStatus` | 8 values | Used correctly |
| `RiskLevel` | 4 values | Used correctly |
| `DelegationToken` | 12 fields | Gateway creates correctly |
| `DelegationScope` | 3 fields | Used correctly |
| `TrustScore` | 10 fields | Gateway creates (mapping from VIADP lib) |
| `TrustScoreChange` | 5 fields | **STALE in practice -- gateway always passes `history: []`** |
| `VerificationProof` | 10 fields | Gateway creates correctly |
| `CriteriaResult` | `criterion`, `passed`, `notes` | Used correctly |
| `DelegationRequest` | 14 fields | Gateway creates correctly |
| `DelegationCheckpoint` | 6 fields | Used by type but never populated |
| `EscalationConfig` | 5 fields | Used correctly |
| `DelegationAuditEntry` | 6 fields | Gateway maps correctly |
| `DelegationAuditAction` | 12 values | Used correctly |

### 1.5 `shared/types/memory.ts`

| Type/Interface | Fields | Notes |
|---|---|---|
| `MemoryScope` | 5 values | Used indirectly via MemoryManager |
| `MemoryContentType` | 10 values | Used indirectly |
| `MemoryEntry` | 17 fields | Used indirectly |
| `CreateMemoryInput` | 10 fields | Used indirectly |
| `SearchResult` | `entry`, `relevanceScore`, `matchedOn` | Used indirectly |
| `MemorySearchQuery` | 11 fields | Used indirectly |
| `AgentContext` | 5 fields + `estimatedTokens` | **STALE -- never constructed in gateway** |

### 1.6 `shared/types/models.ts`

| Type/Interface | Fields | Notes |
|---|---|---|
| `ModelProvider` | `'anthropic' \| 'google'` | Used correctly |
| `ModelTier` | `'premium' \| 'balanced' \| 'fast'` | Used correctly |
| `AnthropicModel` | 3 model IDs | Used correctly |
| `GoogleModel` | 2 model IDs | Used correctly |
| `ModelId` | Union of above | Used correctly |
| `ModelConfig` | 12 fields | Gateway builds catalog correctly |
| `AgentModelAssignment` | 4 fields | Used correctly |
| `ModelRoutingRequest` | 7 fields | Used correctly |
| `ModelRoutingResult` | 4 fields | Gateway EXTENDS with extra fields (see below) |
| `CostRecord` | 11 fields | Used correctly |
| `CostSummary` | 10 fields | Used correctly |

---

## 2. Type Divergence Table

### 2.1 CRITICAL: Dashboard Does NOT Import from `@forge-team/shared`

**The dashboard has ZERO imports from `@forge-team/shared`.** Instead, it defines its own parallel type universe in two locations:
- `dashboard/src/lib/mock-data.ts` -- defines `Agent`, `Task`, `Message`, `WorkflowPhase`, `DelegationEntry`, etc.
- `dashboard/src/lib/api.ts` -- defines `GatewayAgent`, `GatewayTask`, `GatewayKanbanColumn`, `CostsResponse`, `ViadpDelegation`, etc.

This is the **root cause** of the mismatches found in Session 1's API Contract Audit.

### 2.2 Agent Type Divergence

| Field | Shared `AgentConfig` + `AgentState` | Gateway API Response (`getAgentSummary()`) | Dashboard `GatewayAgent` (api.ts) | Dashboard `Agent` (mock-data.ts) |
|---|---|---|---|---|
| `id` | `AgentId` (typed union) | `id: AgentId` | `id: string` | `id: string` |
| `name` | `AgentConfig.name: string` | `name: string` | `name: string` | `name: string` |
| `nameAr` | NOT DEFINED | NOT PRESENT | NOT PRESENT | `nameAr: string` (mock only) |
| `role` | `AgentConfig.role: string` | `role: string` | `role: string` | `role: string` (different values) |
| `roleAr` | NOT DEFINED | NOT PRESENT | NOT PRESENT | `roleAr: string` (mock only) |
| `avatar` | NOT DEFINED | NOT PRESENT | NOT PRESENT | `avatar: string` (mock only) |
| `status` | `AgentStatus` (6 values) | `status: AgentStatus` | `status: string` | `status` (only 4 values: no `'offline'`/`'error'`) |
| `currentTaskId` | `AgentState.currentTaskId` | `currentTaskId: string \| null` | `currentTaskId: string \| null` | **`currentTask: string \| null`** (DIFFERENT NAME -- text not ID) |
| `currentTaskAr` | NOT DEFINED | NOT PRESENT | NOT PRESENT | `currentTaskAr: string \| null` (mock only) |
| `model` | NOT IN shared types | NOT IN API response | NOT PRESENT | `model: string` (mock only) |
| `fallbackModel` | NOT IN shared types | NOT IN API response | NOT PRESENT | `fallbackModel: string` (mock only) |
| `temperature` | NOT IN shared types | NOT IN API response | NOT PRESENT | `temperature: number` (mock only) |
| `tokensUsed` | NOT IN shared types | NOT IN API response | NOT PRESENT | `tokensUsed: number` (mock only) |
| `cost` | NOT IN shared types | NOT IN API response | NOT PRESENT | `cost: number` (mock only) |
| `dailyCap` | NOT IN shared types | NOT IN API response | NOT PRESENT | `dailyCap?: number` (mock only) |
| `tasksCompleted` | `AgentState.tasksCompleted` | `tasksCompleted: number` | `tasksCompleted: number` | NOT PRESENT |
| `tasksFailed` | `AgentState.tasksFailed` | `tasksFailed: number` | `tasksFailed: number` | NOT PRESENT |
| `lastActiveAt` | `AgentState.lastActiveAt` | `lastActiveAt: string` | `lastActiveAt: string` | NOT PRESENT |
| `description` | `AgentConfig.description` | NOT IN summary | NOT PRESENT | NOT PRESENT |
| `capabilities` | `AgentConfig.capabilities` | NOT IN summary | NOT PRESENT | NOT PRESENT |
| `systemPrompt` | `AgentConfig.systemPrompt` | NOT IN summary | NOT PRESENT | NOT PRESENT |

**Key Issues:**
1. Mock `Agent.currentTask` is a description string; gateway returns `currentTaskId` (an ID).
2. Mock `Agent` has 8 extra fields (`nameAr`, `roleAr`, `avatar`, `model`, `fallbackModel`, `temperature`, `tokensUsed`, `cost`, `dailyCap`) that are not in shared types or gateway response.
3. Mock `Agent` is missing 3 gateway fields (`tasksCompleted`, `tasksFailed`, `lastActiveAt`).

### 2.3 Agent Detail Endpoint Mismatch (Session 1 Root Cause)

| | Dashboard expects (api.ts `fetchAgent()`) | Gateway actually returns |
|---|---|---|
| Shape | `{ agent: GatewayAgent & Record<string, unknown> }` | `{ config: AgentConfig, state: AgentState, timestamp: string }` |
| Root cause | Dashboard expects `{ agent: {...} }` wrapper | Gateway returns `{ config, state, timestamp }` -- separate objects, no wrapper |

**Fix required:** Either (a) gateway wraps in `{ agent: {...} }`, or (b) dashboard changes to destructure `{ config, state }`.

### 2.4 Task Type Divergence

| Field | Shared `Task` | Gateway API Returns | Dashboard `GatewayTask` (api.ts) | Dashboard `Task` (mock-data.ts) |
|---|---|---|---|---|
| `id` | `string` | `string` | `string` | `string` |
| `title` | `string` | `string` | `string` | `string` |
| `titleAr` | NOT DEFINED | NOT PRESENT | NOT PRESENT | `titleAr: string` (mock only) |
| `description` | `string` (required) | `string` | `string` | `string` |
| `descriptionAr` | NOT DEFINED | NOT PRESENT | NOT PRESENT | `descriptionAr: string` (mock only) |
| `status` | `TaskStatus` (`'in-progress'`) | `TaskStatus` | `string` | NOT PRESENT (uses `column`) |
| `column` | NOT DEFINED | NOT PRESENT | NOT PRESENT | **`column: "backlog" \| "todo" \| "inProgress" \| "review" \| "done"`** |
| `priority` | `TaskPriority` (typed) | typed | `string` | typed correctly |
| `complexity` | `TaskComplexity` (required) | present | `complexity?: string` (optional) | NOT PRESENT |
| `assignedTo` | `AgentId \| null` | `AgentId \| null` | `string \| null` | NOT PRESENT (uses `assignedAgent`) |
| `assignedAgent` | NOT DEFINED | NOT PRESENT | NOT PRESENT | **`assignedAgent: string \| null`** (DIFFERENT NAME) |
| `createdBy` | `AgentId \| 'user' \| 'system'` (required) | present | `createdBy?: string` (optional) | NOT PRESENT |
| `parentTaskId` | `string \| null` (required) | present | `parentTaskId?: string \| null` (optional) | NOT PRESENT |
| `subtaskIds` | `string[]` (required) | present | `subtaskIds?: string[]` (optional) | NOT PRESENT |
| `dependsOn` | `string[]` (required) | present | `dependsOn?: string[]` (optional) | NOT PRESENT |
| `blocks` | `string[]` (required) | present | `blocks?: string[]` (optional) | NOT PRESENT |
| `tags` | `string[]` (required) | present | `tags?: string[]` (optional) | NOT PRESENT |
| `phase` | `string` (required) | present | `phase?: string \| null` (optional, nullable) | NOT PRESENT |
| `sessionId` | `string` (required) | present | `sessionId?: string` (optional) | NOT PRESENT |
| `storyPoints` | `number \| null` (required) | present | `storyPoints?: number \| null` (optional) | NOT PRESENT |
| `artifacts` | `string[]` (required) | present | `artifacts?: string[]` (optional) | `artifacts?: string[]` |
| `delegationChain` | `AgentId[]` (required) | present | `delegationChain?: string[]` (optional) | NOT PRESENT |
| `startTime` | NOT DEFINED | NOT PRESENT | NOT PRESENT | `startTime: string` (mock only) |
| `startedAt` | `string \| null` | present | `startedAt?: string \| null` | NOT PRESENT |
| `waitingForHuman` | NOT DEFINED | NOT PRESENT | NOT PRESENT | `waitingForHuman?: boolean` (mock only) |
| `agentResponse` | NOT DEFINED | NOT PRESENT | NOT PRESENT | `agentResponse?: string` (mock only) |
| `metadata` | `Record<string, unknown>` (required) | present | `metadata?: Record<string, unknown>` (optional) | NOT PRESENT |

**Key Issues:**
1. **`column` vs `status`**: Mock data uses `column` field with camelCase values (`inProgress`), shared type uses `status` with kebab-case (`in-progress`). This means Kanban rendering from live data would be broken.
2. **`assignedAgent` vs `assignedTo`**: Mock uses `assignedAgent`, shared uses `assignedTo`. The field name mismatch means dashboard components consuming live data will show null assignments.
3. **`startTime` vs `startedAt`**: Different field name.
4. Mock has `titleAr`, `descriptionAr`, `waitingForHuman`, `agentResponse` -- these are dashboard-only concepts not represented in shared types.
5. Dashboard `GatewayTask` makes almost everything optional, losing type safety.

### 2.5 KanbanColumn Divergence

| Field | Shared `KanbanColumn` | Gateway Returns | Dashboard `GatewayKanbanColumn` |
|---|---|---|---|
| `id` | `TaskStatus` (typed) | `TaskStatus` | `string` (untyped) |
| `label` | `string` | `string` | **`title: string`** (DIFFERENT NAME) |
| `tasks` | `Task[]` | `Task[]` (shared type) | `GatewayTask[]` (dashboard's own type) |
| `wipLimit` | `number \| null` | present | NOT PRESENT |

**Issue:** Dashboard uses `title` where shared type and gateway use `label`. Dashboard accessing `column.title` from live gateway data will get `undefined`.

### 2.6 Connections Endpoint Mismatch (Session 1 Root Cause)

| | Dashboard expects (api.ts `fetchConnections()`) | Gateway actually returns |
|---|---|---|
| Shape | `{ connections: { total, users, agents, dashboards } }` | `{ stats: { total, users, agents, dashboards, connectedAgents }, timestamp }` |
| Root cause | Dashboard wraps in `connections` key | Gateway wraps in `stats` key |

**Fix required:** Gateway returns `{ stats: {...} }` but dashboard expects `{ connections: {...} }`.

### 2.7 Costs Endpoint Divergence

| Field | Shared `CostSummary` | Gateway Returns | Dashboard `CostsResponse` |
|---|---|---|---|
| `perAgent` | `Record<AgentId, number>` (simple number) | `Record<AgentId, number>` | `Record<string, { cost, requests, tokens }>` (object) |
| `perModel` | `Record<ModelId, number>` (simple number) | `Record<ModelId, number>` | `Record<string, { cost, requests }>` (object) |
| `perProvider` | `Record<ModelProvider, number>` (simple number) | `Record<ModelProvider, number>` | `Record<string, { cost, requests }>` (object) |
| `perTier` | `Record<ModelTier, number>` (simple number) | `Record<ModelTier, number>` | `Record<string, { cost, requests }>` (object) |

**Issue:** The shared type and gateway only return a flat `number` per agent/model/provider/tier (total cost). The dashboard expects richer objects with `{ cost, requests, tokens }`. Either the gateway must be enriched or the dashboard must adapt.

### 2.8 VIADP Trust Endpoint Divergence

| | Dashboard expects (`fetchViadpTrust()`) | Gateway actually returns |
|---|---|---|
| Shape | `{ trust: { score, alpha, beta, history } }` | `{ agentId, scores: TrustScore[], timestamp }` |
| Root cause | Dashboard expects `{ trust: {...} }` | Gateway returns `{ agentId, scores: [...], timestamp }` |

### 2.9 VIADP Delegation Type Divergence

| Field | Shared `DelegationRequest` | Gateway Returns | Dashboard `ViadpDelegation` (api.ts) |
|---|---|---|---|
| `delegator`/`from` | `from: AgentId` | `from` | `delegator: string` (DIFFERENT NAME) |
| `delegatee`/`to` | `to: AgentId` | `to` | `delegatee: string` (DIFFERENT NAME) |
| `task`/`taskId` | `taskId: string` | `taskId` | `task: string` (DIFFERENT NAME, also a description) |
| `taskAr` | NOT DEFINED | NOT PRESENT | `taskAr?: string` (dashboard only) |
| `trustScore` | NOT IN DelegationRequest | NOT IN response | `trustScore: number` (dashboard only) |
| `proofChain` | NOT IN DelegationRequest | NOT IN response | `proofChain: string[]` (dashboard only) |

**Issue:** The dashboard's `ViadpDelegation` type is a completely custom shape that doesn't match `DelegationRequest` at all. The field names are different, and the dashboard adds fields (`trustScore`, `proofChain`, `taskAr`) that the gateway never returns.

### 2.10 WorkflowPhase Divergence

| Field | Shared `WorkflowPhase` | Dashboard `WorkflowPhase` (mock-data.ts) |
|---|---|---|
| `id` | Generated UUID string | Simple string like `"requirements"` |
| `name` | Phase name | Phase name |
| `nameAr` | NOT DEFINED (uses `displayNameAr`) | `nameAr: string` |
| `displayName` | `string` | NOT PRESENT |
| `displayNameAr` | `string` | NOT PRESENT |
| `description` | `string` | NOT PRESENT |
| `progress` | NOT DEFINED (calculated from WorkflowProgress) | `progress: number` |
| `status` | `WorkflowStepStatus` (7 values) | **`"complete" \| "active" \| "pending"`** (only 3 values, different names) |
| `steps` | `WorkflowStep[]` | NOT PRESENT |
| `hasCheckpoint` | `boolean` | NOT PRESENT |
| `gateCondition` | `'all-pass' \| 'majority-pass' \| 'any-pass'` | NOT PRESENT |
| `involvedAgents` | `AgentId[]` | NOT PRESENT |
| `checkpoints` | NOT DEFINED (number) | `checkpoints: number` |
| `checkpointsComplete` | NOT DEFINED | `checkpointsComplete: number` |
| `startDate` | NOT DEFINED (uses `startedAt`) | `startDate: string` |
| `endDate` | NOT DEFINED (uses `completedAt`) | `endDate?: string` |

**Issue:** Completely different structures. Shared `WorkflowPhase` is a detailed runtime type; mock `WorkflowPhase` is a simplified display-oriented type. The status values are entirely different (`'completed'` vs `'complete'`, `'active'` vs `'active'`, `'pending'` vs `'pending'` -- the first differs).

### 2.11 Message Type Divergence

| Field | Shared `AgentMessage` | Dashboard `Message` (mock-data.ts) | Dashboard `GatewayMessageEvent` (socket.ts) |
|---|---|---|---|
| `id` | `string` | `string` | `string` |
| `type` | `AgentMessageType` (16 values) | **`"task" \| "question" \| "escalation"`** (3 values, DIFFERENT) | `string` |
| `from` | `AgentId \| 'user' \| 'system' \| 'gateway'` | **`string`** (human-readable names like `"BMad Master"`) | `string` |
| `to` | `AgentId \| 'user' \| 'dashboard' \| 'broadcast'` | `string?` (human-readable names) | `string` |
| `payload` | `AgentMessagePayload` (structured) | NOT PRESENT (uses `content`) | `{ content, data?, artifacts? }` (close) |
| `content` | NOT DEFINED (inside payload) | `content: string` | NOT at top level |
| `contentAr` | NOT DEFINED | `contentAr?: string` | NOT PRESENT |
| `sessionId` | `string` | NOT PRESENT | `string` |
| `timestamp` | `string` | `string` | `string` |
| `fromAvatar` | NOT DEFINED | `fromAvatar: string` | NOT PRESENT |
| `isHuman` | NOT DEFINED | `isHuman: boolean` | NOT PRESENT |
| `project` | NOT DEFINED | `project?: string` | NOT PRESENT |
| `correlationId` | `string?` | NOT PRESENT | `correlationId?: string` |

**Key Issues:**
1. Mock uses agent display names (`"BMad Master"`) for `from`/`to`; shared type uses agent IDs (`'bmad-master'`).
2. Mock uses simplified `type` values (`"task"`, `"question"`, `"escalation"`) while shared type uses dot-notation (`'task.assign'`, `'chat.message'`, etc.).
3. Message content is at `payload.content` in shared type but at top-level `content` in mock.

### 2.12 ModelRoutingResult Extension

The gateway's `model-router.ts` route() method returns extra fields not in the shared type:

```typescript
// Shared type:
interface ModelRoutingResult {
  model: ModelConfig;
  reason: 'primary' | 'fallback' | 'complexity-override' | 'cost-constraint' | 'capability-requirement';
  estimatedCost: number;
  classifiedTier: ModelTier;
}

// Gateway actually returns (when blocked by cost cap):
{
  model: null,                    // VIOLATION: type says ModelConfig, not nullable
  reason: 'hard-cap-blocked',    // VIOLATION: not in union type
  estimatedCost: 0,
  classifiedTier: 'fast',
  alertTriggered: true,          // EXTRA: not in shared type
  capStatus: CostCapStatus,      // EXTRA: not in shared type
}
```

This is cast with `as any` in the gateway code (line ~348 of `model-router.ts`), hiding the type violation.

---

## 3. Missing Types (Used in Code but Not Defined in Shared)

| Type | Where Used | Should Be in Shared? |
|---|---|---|
| `Session` / `SessionState` | `gateway/src/session-manager.ts` | YES -- defined locally, should be shared since dashboard reads sessions |
| `EscalationRecord` | `gateway/src/agent-runner.ts` | YES -- dashboard `Escalation` type duplicates this |
| `Interrupt` | `dashboard/src/lib/api.ts` + gateway's pendingInterrupts | YES -- defined in both places with slight differences |
| `CostCap` / `CostCapStatus` | `gateway/src/model-router.ts` | YES -- dashboard will need cap display |
| `GatewayAgent` (summary shape) | `gateway/src/agent-manager.ts` getAgentSummary() | YES -- this is the actual API shape, should be a shared type |
| `AgentRunnerResult` | `gateway/src/agent-runner.ts` | MAYBE -- internal to gateway |
| `PartyModeResult` / `AgentSelection` | `gateway/src/party-mode.ts` | MAYBE -- if dashboard needs to display party mode results |
| `ToolDefinition` / `ToolExecutionResult` | `gateway/src/tools/types.ts` | MAYBE -- if dashboard needs tool info |
| `OpenClawAgentRecord` / `OpenClawToolResult` | `gateway/src/openclaw/types.ts` | MAYBE -- depends on dashboard needs |
| `WorkflowStateType` | `gateway/src/langgraph/state.ts` | NO -- LangGraph-internal |
| `ConnectedClient` / `ClientType` | `gateway/src/server.ts` | NO -- server-internal |

---

## 4. Stale Types (Defined in Shared but Not Used Anywhere)

| Type | File | Reason |
|---|---|---|
| `AgentRole` | `agent.ts` | Never imported or instantiated in gateway or dashboard |
| `ArtifactReference` | `agent.ts` | Never imported or instantiated. `AgentMessagePayload.artifacts` references it but no code creates `ArtifactReference` objects |
| `SDLCPipeline` | `workflow.ts` | Marked as "legacy" but never used; superseded by `WorkflowInstance` |
| `PipelineTemplate` | `workflow.ts` | Never imported or instantiated |
| `SDLC_PHASES` / `SDLCPhaseId` | `workflow.ts` | Never imported or used |
| `TrustScoreChange` | `viadp.ts` | Defined and referenced by `TrustScore.history`, but gateway always passes `history: []` |
| `AgentContext` | `memory.ts` | Never constructed in gateway; the `AgentRunner` uses `memoryManager.getRecentContext()` directly |
| `SearchResult` (memory) | `memory.ts` | Not imported in gateway; `MemoryManager` returns its own result shape |
| `MemorySearchQuery` | `memory.ts` | Not imported in gateway; search params are passed ad-hoc |
| `CreateMemoryInput` | `memory.ts` | Not imported in gateway; `memoryManager.store()` takes individual params |

---

## 5. Summary of Root Causes for Session 1 API Mismatches

### 5.1 `fetchAgent()` -- expects `{ agent }` but gets `{ config, state }`

**Root cause in shared types:** There is no shared type for the "agent detail API response." The gateway returns `{ config: AgentConfig, state: AgentState }` which are both valid shared types, but the **response wrapper shape** is undefined. The dashboard guessed wrong about the wrapper.

**Location:** Gateway `index.ts:267`, Dashboard `api.ts:170`

### 5.2 `fetchConnections()` -- expects `{ connections }` but gets `{ stats }`

**Root cause in shared types:** There is no shared type for the connections API response at all. Both sides independently chose different wrapper key names.

**Location:** Gateway `index.ts:683`, Dashboard `api.ts:258`

### 5.3 KanbanColumn `title` vs `label`

**Root cause in shared types:** The shared type correctly defines `KanbanColumn.label`, but the dashboard's `GatewayKanbanColumn` independently defines `title`. The dashboard was not using the shared type.

**Location:** Shared `task.ts:99`, Dashboard `api.ts:80`

### 5.4 Cost summary shape mismatch

**Root cause in shared types:** `CostSummary.perAgent` is `Record<AgentId, number>` (a flat number), but the dashboard expects `{ cost, requests, tokens }` objects. Either the shared type is too simple or the dashboard expectations are wrong.

**Location:** Shared `models.ts:115`, Dashboard `api.ts:109`

### 5.5 VIADP trust endpoint mismatch

**Root cause in shared types:** The `TrustScore` type is correctly defined, but the API response wrapper shape is undefined. Gateway wraps in `{ agentId, scores: TrustScore[] }`, dashboard expects `{ trust: { score, alpha, beta, history } }`.

**Location:** Gateway `index.ts:476`, Dashboard `api.ts:141`

---

## 6. Recommendations

### 6.1 Immediate (P0) -- Fix Runtime Breakage

1. **Add API response types to shared:** Create `shared/types/api-responses.ts` that defines the exact shape of every REST endpoint response (wrapper keys, nested structures).
2. **Fix KanbanColumn.title/label mismatch:** Dashboard must use `label`, not `title`.
3. **Fix Task.column/status and assignedAgent/assignedTo mismatches:** Dashboard must use shared type field names when consuming live data.
4. **Fix connections endpoint:** Align on either `{ stats }` or `{ connections }` wrapper.
5. **Fix agent detail endpoint:** Align on either `{ agent }` or `{ config, state }` wrapper.

### 6.2 Short-term (P1) -- Type Consolidation

6. **Make dashboard import from `@forge-team/shared`:** The dashboard should use the shared types directly, not redefine them.
7. **Move Session types to shared:** `Session`, `SessionState`, `SessionEvents` should be shared.
8. **Move Escalation/Interrupt types to shared:** Both sides define these independently.
9. **Add Arabic display fields to shared types:** The dashboard needs `nameAr`, `roleAr`, `titleAr`, `descriptionAr`. These should be optional fields in the shared types.
10. **Add avatar/display fields to AgentConfig:** `avatar: string` should be in shared types.

### 6.3 Medium-term (P2) -- Remove Dead Code

11. **Remove `AgentRole`** -- unused, duplicates `AgentConfig` fields.
12. **Remove `SDLCPipeline`, `PipelineTemplate`, `SDLC_PHASES`** -- legacy code superseded by workflow types.
13. **Remove `ArtifactReference`** -- or start using it properly in artifact tracking.
14. **Populate `TrustScoreChange.history`** -- or simplify `TrustScore` to remove it.
15. **Remove `AgentContext`** -- or use it in the RAG pipeline.

### 6.4 Architectural (P3)

16. **Generate API client from shared types:** Use something like `zod` schemas exported from shared to generate typed fetch functions, eliminating the manual `api.ts` definitions.
17. **Add a shared `api-contracts.ts`:** Define request/response pairs for every endpoint, consumed by both gateway (for validation) and dashboard (for type-safe fetches).
18. **Fix ModelRoutingResult `as any` cast:** Either extend the shared type to include the cost-cap blocked case, or return a proper error response.

---

## 7. Files Audited

### Shared Types
- `/Users/bandar/Documents/AreebPro/forge-team/shared/types/index.ts`
- `/Users/bandar/Documents/AreebPro/forge-team/shared/types/agent.ts`
- `/Users/bandar/Documents/AreebPro/forge-team/shared/types/task.ts`
- `/Users/bandar/Documents/AreebPro/forge-team/shared/types/workflow.ts`
- `/Users/bandar/Documents/AreebPro/forge-team/shared/types/viadp.ts`
- `/Users/bandar/Documents/AreebPro/forge-team/shared/types/memory.ts`
- `/Users/bandar/Documents/AreebPro/forge-team/shared/types/models.ts`

### Gateway Sources (importing from shared)
- `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/index.ts`
- `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/agent-manager.ts`
- `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/agent-runner.ts`
- `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/model-router.ts`
- `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/server.ts`
- `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/session-manager.ts`
- `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/task-manager.ts`
- `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/viadp-engine.ts`
- `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/workflow-engine.ts`
- `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/party-mode.ts`
- `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/langgraph/state.ts`
- `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/langgraph/nodes.ts`
- `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/openclaw/types.ts`
- `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/tools/types.ts`
- `/Users/bandar/Documents/AreebPro/forge-team/gateway/src/tools/tool-registry.ts`

### Dashboard Sources
- `/Users/bandar/Documents/AreebPro/forge-team/dashboard/src/lib/api.ts`
- `/Users/bandar/Documents/AreebPro/forge-team/dashboard/src/lib/mock-data.ts`
- `/Users/bandar/Documents/AreebPro/forge-team/dashboard/src/lib/socket.ts`
