# ForgeTeam Session 08 — Phase 8: Human-in-the-Loop (Interrupts, Pause/Resume, Take-Over)

> **Instructions for Claude Code Opus 4.6**: Read this entire prompt before taking any action. You must complete ALL items listed below in the ForgeTeam project at `/Users/bandar/Documents/AreebPro/forge-team/`. Use the **team/swarm feature** — create a team and spin up parallel agents to work on independent workstreams simultaneously. Each workstream is labeled. Do NOT skip any item. Do NOT introduce new features beyond what is listed. Do NOT add comments, docstrings, or type annotations to code you did not change. Preserve the existing glass-card dark aesthetic. All fixes must maintain full RTL Arabic support.

---

## PRE-WORK: Read These Files First (Before Any Edits)

Every agent on the team must read the files relevant to their workstream before editing. The ground-truth references are:

### Gateway files
- **Gateway index (REST routes + Socket.IO):** `/forge-team/gateway/src/index.ts` — port 3001, all REST endpoints and socket handlers
- **Workflow engine:** `/forge-team/gateway/src/workflow-engine.ts` — has `pauseWorkflow()` (line ~630) and `resumeWorkflow()` (line ~651) already implemented
- **Agent runner:** `/forge-team/gateway/src/agent-runner.ts` — dispatches tasks to agents via model router
- **Agent manager:** `/forge-team/gateway/src/agent-manager.ts` — agent state and lifecycle
- **Task manager:** `/forge-team/gateway/src/task-manager.ts` — task CRUD and status transitions
- **Session manager:** `/forge-team/gateway/src/session-manager.ts` — session lifecycle
- **VIADP engine:** `/forge-team/gateway/src/viadp-engine.ts` — delegation protocol
- **Model router:** `/forge-team/gateway/src/model-router.ts` — model selection and cost tracking
- **Server (WebSocket):** `/forge-team/gateway/src/server.ts` — WebSocket connection handling

### Dashboard files
- **Main page:** `/forge-team/dashboard/src/app/page.tsx`
- **All components:** `/forge-team/dashboard/src/components/*.tsx`
- **API client:** `/forge-team/dashboard/src/lib/api.ts`
- **Socket client:** `/forge-team/dashboard/src/lib/socket.ts`
- **i18n:** `/forge-team/dashboard/src/lib/i18n.ts`, `/forge-team/dashboard/src/lib/locale-context.tsx`
- **Translations:** `/forge-team/dashboard/src/messages/ar.json`, `/forge-team/dashboard/src/messages/en.json`
- **Mock data:** `/forge-team/dashboard/src/lib/mock-data.ts`

### Shared types
- **Shared types:** `/forge-team/shared/types/*.ts` — TypeScript interfaces used by both gateway and dashboard

---

## WORKSTREAM 1: LangGraph Interrupt UI (Dashboard ↔ Gateway)

**Files to modify:**
- `/forge-team/gateway/src/index.ts` — add REST endpoints for interrupt management
- `/forge-team/gateway/src/workflow-engine.ts` — add interrupt state tracking
- `/forge-team/dashboard/src/lib/api.ts` — add API functions
- `/forge-team/dashboard/src/lib/socket.ts` — add interrupt event type
- `/forge-team/dashboard/src/components/InterruptModal.tsx` — NEW FILE
- `/forge-team/dashboard/src/app/page.tsx` — wire interrupt modal
- `/forge-team/dashboard/src/messages/ar.json`
- `/forge-team/dashboard/src/messages/en.json`

### 1A. Add interrupt state to gateway workflow engine

In `workflow-engine.ts`, add an interrupt queue mechanism. The workflow engine already has `pauseWorkflow()`/`resumeWorkflow()` and approval gates in the YAML workflows (`approval_required: true`).

Add the following to the `WorkflowExecutor` class:

1. Add a `pendingInterrupts` Map:

```typescript
private pendingInterrupts: Map<string, {
  id: string;
  instanceId: string;
  agentId: string;
  agentName: string;
  stepId: string;
  type: 'approval_gate' | 'human_mention' | 'confidence_low';
  question: string;
  context?: string;
  confidence?: number;
  createdAt: string;
  status: 'pending' | 'approved' | 'rejected';
}> = new Map();
```

2. Add methods:

```typescript
createInterrupt(instanceId: string, agentId: string, agentName: string, stepId: string, type: string, question: string, context?: string, confidence?: number): string {
  const id = uuid();
  const interrupt = {
    id,
    instanceId,
    agentId,
    agentName,
    stepId,
    type: type as any,
    question,
    context,
    confidence,
    createdAt: new Date().toISOString(),
    status: 'pending' as const,
  };
  this.pendingInterrupts.set(id, interrupt);
  // Pause the workflow while waiting for human
  if (this.instances.has(instanceId)) {
    this.pauseWorkflow(instanceId);
  }
  return id;
}

resolveInterrupt(interruptId: string, approved: boolean, feedback?: string): void {
  const interrupt = this.pendingInterrupts.get(interruptId);
  if (!interrupt) throw new Error(`Interrupt ${interruptId} not found`);
  interrupt.status = approved ? 'approved' : 'rejected';
  // If approved, resume the workflow
  if (approved && this.instances.has(interrupt.instanceId)) {
    this.resumeWorkflow(interrupt.instanceId);
  }
}

getPendingInterrupts(): Array<typeof this.pendingInterrupts extends Map<string, infer V> ? V : never> {
  return Array.from(this.pendingInterrupts.values()).filter(i => i.status === 'pending');
}

getAllInterrupts(): Array<typeof this.pendingInterrupts extends Map<string, infer V> ? V : never> {
  return Array.from(this.pendingInterrupts.values());
}
```

3. When a workflow step has `approval_required: true` (in `executeStep()` or wherever approval gates are checked), call `createInterrupt()` and emit a socket event instead of silently blocking.

### 1B. Add gateway REST endpoints for interrupts

In `index.ts`, add these routes:

```typescript
// GET /api/interrupts — list all pending interrupts
app.get('/api/interrupts', (req, res) => {
  const pending = workflowExecutor.getPendingInterrupts();
  res.json({ interrupts: pending });
});

// GET /api/interrupts/all — list all interrupts (including resolved)
app.get('/api/interrupts/all', (req, res) => {
  const all = workflowExecutor.getAllInterrupts();
  res.json({ interrupts: all });
});

// POST /api/interrupts/:id/resolve — approve or reject
app.post('/api/interrupts/:id/resolve', express.json(), (req, res) => {
  const { id } = req.params;
  const { approved, feedback } = req.body;
  try {
    workflowExecutor.resolveInterrupt(id, approved, feedback);
    // Broadcast the resolution to all connected dashboards
    io.emit('interrupt_update', {
      type: approved ? 'approved' : 'rejected',
      interruptId: id,
      feedback,
      timestamp: new Date().toISOString(),
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
```

Also emit a socket event when an interrupt is created:

```typescript
// In workflow engine or wherever createInterrupt is called:
io.emit('interrupt_update', {
  type: 'created',
  interrupt: { id, instanceId, agentId, agentName, stepId, type, question, context, confidence, createdAt },
  timestamp: new Date().toISOString(),
});
```

### 1C. Add interrupt socket event type to dashboard

In `socket.ts`, add to the `SocketEvents` interface:

```typescript
interrupt_update: (data: {
  type: 'created' | 'approved' | 'rejected';
  interrupt?: {
    id: string;
    instanceId: string;
    agentId: string;
    agentName: string;
    stepId: string;
    type: 'approval_gate' | 'human_mention' | 'confidence_low';
    question: string;
    context?: string;
    confidence?: number;
    createdAt: string;
  };
  interruptId?: string;
  feedback?: string;
  timestamp: string;
}) => void;
```

### 1D. Add interrupt API functions to dashboard

In `api.ts`, add:

```typescript
export interface Interrupt {
  id: string;
  instanceId: string;
  agentId: string;
  agentName: string;
  stepId: string;
  type: 'approval_gate' | 'human_mention' | 'confidence_low';
  question: string;
  context?: string;
  confidence?: number;
  createdAt: string;
  status: 'pending' | 'approved' | 'rejected';
}

export async function fetchPendingInterrupts(): Promise<{ interrupts: Interrupt[] }> {
  return fetchAPI('/api/interrupts');
}

export async function resolveInterrupt(interruptId: string, approved: boolean, feedback?: string): Promise<void> {
  await postAPI(`/api/interrupts/${interruptId}/resolve`, { approved, feedback });
}
```

### 1E. Create InterruptModal component

Create `/forge-team/dashboard/src/components/InterruptModal.tsx`:

```typescript
"use client";

import React, { useState, useEffect, useCallback } from "react";
import { AlertTriangle, CheckCircle2, XCircle, Clock, MessageSquare } from "lucide-react";
import { useLocale } from "@/lib/locale-context";
import { useSocket } from "@/lib/socket";
import { cn } from "@/lib/utils";
import { fetchPendingInterrupts, resolveInterrupt, type Interrupt } from "@/lib/api";
```

The component must:

1. **Poll for pending interrupts** on mount via `fetchPendingInterrupts()` every 5 seconds
2. **Listen for real-time interrupt events** via `on('interrupt_update', ...)` from socket
3. **Show a floating notification badge** in the top-right corner showing the count of pending interrupts (e.g., a red circle with number)
4. **When clicked, open a modal/drawer** showing all pending interrupts in a list
5. **Each interrupt card shows:**
   - Agent avatar + name (bilingual)
   - Interrupt type badge: "Approval Gate" / "بوابة موافقة", "@human Mention" / "إشارة @إنسان", "Low Confidence" / "ثقة منخفضة"
   - The agent's question/request text
   - Context text (if present)
   - Confidence percentage (if type is `confidence_low`, show as a colored bar)
   - Timestamp
   - **Approve** button (green) — calls `resolveInterrupt(id, true)`
   - **Reject** button (red) — opens a text input for feedback, then calls `resolveInterrupt(id, false, feedback)`
6. **Use glass-card styling** consistent with the rest of the dashboard
7. **Full RTL support** — use `useLocale()` for all labels, `dir` attributes on text inputs
8. **Show a toast notification** when a new interrupt arrives (use a simple absolute-positioned div that fades out after 5 seconds)

### 1F. Wire InterruptModal into page.tsx

In `page.tsx`:

1. Import `InterruptModal`
2. Render it at the top level (inside the main layout, always visible regardless of active tab):

```tsx
<InterruptModal agents={agents} />
```

The modal should float as an overlay — it does NOT need its own tab/route.

### 1G. Add translation keys for interrupts

Add to both `ar.json` and `en.json`:

```json
// en.json
"interrupt": {
  "title": "Pending Approvals",
  "approvalGate": "Approval Gate",
  "humanMention": "@human Mention",
  "confidenceLow": "Low Confidence",
  "approve": "Approve",
  "reject": "Reject",
  "feedbackPlaceholder": "Reason for rejection...",
  "noInterrupts": "No pending approvals",
  "newInterrupt": "New approval request from",
  "approved": "Approved",
  "rejected": "Rejected",
  "pendingCount": "pending approvals"
}

// ar.json
"interrupt": {
  "title": "الموافقات المعلقة",
  "approvalGate": "بوابة الموافقة",
  "humanMention": "إشارة @إنسان",
  "confidenceLow": "ثقة منخفضة",
  "approve": "موافقة",
  "reject": "رفض",
  "feedbackPlaceholder": "سبب الرفض...",
  "noInterrupts": "لا توجد موافقات معلقة",
  "newInterrupt": "طلب موافقة جديد من",
  "approved": "تمت الموافقة",
  "rejected": "تم الرفض",
  "pendingCount": "موافقات معلقة"
}
```

---

## WORKSTREAM 2: Global & Per-Session Workflow Pause/Resume

**Files to modify:**
- `/forge-team/gateway/src/index.ts` — add REST endpoints
- `/forge-team/gateway/src/workflow-engine.ts` — add global pause method
- `/forge-team/dashboard/src/components/WorkflowProgress.tsx` — add buttons
- `/forge-team/dashboard/src/lib/api.ts` — add API functions
- `/forge-team/dashboard/src/app/page.tsx` — pass workflow state
- `/forge-team/dashboard/src/messages/ar.json`
- `/forge-team/dashboard/src/messages/en.json`

### 2A. Add global pause/resume to gateway

In `workflow-engine.ts`, add methods:

```typescript
/**
 * Pause ALL running workflow instances.
 */
pauseAllWorkflows(): { paused: string[] } {
  const paused: string[] = [];
  for (const [id, instance] of this.instances.entries()) {
    if (instance.status === 'in-progress' || instance.status === 'waiting_approval') {
      this.pauseWorkflow(id);
      paused.push(id);
    }
  }
  return { paused };
}

/**
 * Resume ALL paused workflow instances.
 */
async resumeAllWorkflows(): Promise<{ resumed: string[] }> {
  const resumed: string[] = [];
  for (const [id, instance] of this.instances.entries()) {
    if (instance.status === 'paused') {
      await this.resumeWorkflow(id);
      resumed.push(id);
    }
  }
  return { resumed };
}

/**
 * Get the status of all workflow instances.
 */
getWorkflowStatuses(): Array<{ id: string; label: string; status: string; progress: number }> {
  return Array.from(this.instances.values()).map(inst => ({
    id: inst.id,
    label: inst.workflowId,
    status: inst.status,
    progress: inst.state.completedPhases?.length ?? 0,
  }));
}
```

### 2B. Add REST endpoints for workflow control

In `index.ts`, add:

```typescript
// POST /api/workflows/pause-all
app.post('/api/workflows/pause-all', (req, res) => {
  try {
    const result = workflowExecutor.pauseAllWorkflows();
    io.emit('workflow_update', { type: 'global_pause', paused: result.paused });
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/workflows/resume-all
app.post('/api/workflows/resume-all', async (req, res) => {
  try {
    const result = await workflowExecutor.resumeAllWorkflows();
    io.emit('workflow_update', { type: 'global_resume', resumed: result.resumed });
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/workflows/:instanceId/pause
app.post('/api/workflows/:instanceId/pause', (req, res) => {
  try {
    workflowExecutor.pauseWorkflow(req.params.instanceId);
    io.emit('workflow_update', { type: 'instance_paused', instanceId: req.params.instanceId });
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/workflows/:instanceId/resume
app.post('/api/workflows/:instanceId/resume', async (req, res) => {
  try {
    await workflowExecutor.resumeWorkflow(req.params.instanceId);
    io.emit('workflow_update', { type: 'instance_resumed', instanceId: req.params.instanceId });
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/workflows/status
app.get('/api/workflows/status', (req, res) => {
  const statuses = workflowExecutor.getWorkflowStatuses();
  res.json({ workflows: statuses });
});
```

### 2C. Add dashboard API functions

In `api.ts`, add:

```typescript
export async function pauseAllWorkflows(): Promise<{ paused: string[] }> {
  return postAPI('/api/workflows/pause-all', {});
}

export async function resumeAllWorkflows(): Promise<{ resumed: string[] }> {
  return postAPI('/api/workflows/resume-all', {});
}

export async function pauseWorkflow(instanceId: string): Promise<void> {
  await postAPI(`/api/workflows/${instanceId}/pause`, {});
}

export async function resumeWorkflow(instanceId: string): Promise<void> {
  await postAPI(`/api/workflows/${instanceId}/resume`, {});
}

export async function fetchWorkflowStatuses(): Promise<{
  workflows: Array<{ id: string; label: string; status: string; progress: number }>;
}> {
  return fetchAPI('/api/workflows/status');
}
```

### 2D. Add Pause All / Resume buttons to WorkflowProgress

In `WorkflowProgress.tsx`, modify the header section (currently lines ~79-86):

Add two buttons next to the progress percentage:

```tsx
<div className="flex items-center gap-2">
  <button
    onClick={onPauseAll}
    className="text-[10px] px-2.5 py-1 rounded-lg bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 border border-amber-500/20 transition-colors flex items-center gap-1 font-medium"
  >
    <Pause size={10} />
    {t("workflow.pauseAll")}
  </button>
  <button
    onClick={onResumeAll}
    className="text-[10px] px-2.5 py-1 rounded-lg bg-green-500/15 text-green-400 hover:bg-green-500/25 border border-green-500/20 transition-colors flex items-center gap-1 font-medium"
  >
    <Play size={10} />
    {t("workflow.resumeAll")}
  </button>
  <span className="text-xs text-accent font-semibold ltr-nums">
    {totalProgress}%
  </span>
</div>
```

Update the `WorkflowProgressProps` interface to accept:

```typescript
interface WorkflowProgressProps {
  phases: WorkflowPhase[];
  onPauseAll?: () => void;
  onResumeAll?: () => void;
}
```

In `page.tsx`, pass handlers:

```tsx
<WorkflowProgress
  phases={workflowPhases}
  onPauseAll={async () => {
    try { await pauseAllWorkflows(); } catch (err) { console.error(err); }
  }}
  onResumeAll={async () => {
    try { await resumeAllWorkflows(); } catch (err) { console.error(err); }
  }}
/>
```

Import `Pause`, `Play` from `lucide-react` in `WorkflowProgress.tsx`.

### 2E. Add translation keys for workflow controls

Add to both JSON files:

```json
// en.json
"workflow.pauseAll": "Pause All",
"workflow.resumeAll": "Resume All",
"workflow.paused": "Paused",
"workflow.resumed": "Resumed",
"workflow.pause": "Pause",
"workflow.resume": "Resume"

// ar.json
"workflow.pauseAll": "إيقاف الكل",
"workflow.resumeAll": "استئناف الكل",
"workflow.paused": "متوقف",
"workflow.resumed": "مستأنف",
"workflow.pause": "إيقاف",
"workflow.resume": "استئناف"
```

---

## WORKSTREAM 3: Confidence-Based Auto-Escalation

**Files to modify:**
- `/forge-team/gateway/src/agent-runner.ts` — add confidence check after agent response
- `/forge-team/gateway/src/index.ts` — add escalation endpoint
- `/forge-team/dashboard/src/components/EscalationQueue.tsx` — NEW FILE
- `/forge-team/dashboard/src/components/AgentStatusGrid.tsx` — add escalation badge
- `/forge-team/dashboard/src/lib/api.ts` — add escalation API
- `/forge-team/dashboard/src/lib/socket.ts` — add escalation event type
- `/forge-team/dashboard/src/app/page.tsx` — wire escalation UI
- `/forge-team/dashboard/src/messages/ar.json`
- `/forge-team/dashboard/src/messages/en.json`

### 3A. Add confidence detection in gateway agent-runner

In `agent-runner.ts`, after an agent produces a response, check if the response contains a confidence indicator. The approach:

1. After the model generates a response, parse the response for confidence patterns. Look for:
   - Explicit `confidence: 0.XX` or `CONFIDENCE: XX%` in the response
   - Hedging language patterns: "I'm not sure", "I think", "possibly", "might be"
   - If no explicit confidence is found, default to 0.90 (assume high confidence)

2. If detected confidence < 0.85, create an escalation record:

```typescript
interface EscalationRecord {
  id: string;
  agentId: string;
  agentName: string;
  taskId: string;
  taskTitle: string;
  confidence: number;
  reason: string;
  agentResponse: string;
  createdAt: string;
  status: 'pending' | 'reviewed' | 'dismissed';
}
```

3. Store escalations in an in-memory array on the AgentRunner (or a dedicated EscalationManager). Emit a socket event when an escalation is created.

Add a simple `extractConfidence()` helper function:

```typescript
function extractConfidence(response: string): number {
  // Check for explicit confidence markers
  const explicitMatch = response.match(/confidence[:\s]+(\d+(?:\.\d+)?)\s*%?/i);
  if (explicitMatch) {
    const val = parseFloat(explicitMatch[1]);
    return val > 1 ? val / 100 : val;
  }

  // Check for hedging language
  const hedgingPatterns = [
    /\bi(?:'m| am) not (?:entirely |fully )?(?:sure|certain|confident)/i,
    /\bi think\b/i,
    /\bpossibly\b/i,
    /\bmight be\b/i,
    /\bperhaps\b/i,
    /\bunlikely\b/i,
    /\bunsure\b/i,
    /\bneed(?:s)? (?:more |further )?(?:review|verification|input|clarification)/i,
  ];

  const hedgeCount = hedgingPatterns.filter(p => p.test(response)).length;
  if (hedgeCount >= 3) return 0.60;
  if (hedgeCount >= 2) return 0.70;
  if (hedgeCount >= 1) return 0.80;

  return 0.95; // Default high confidence
}
```

### 3B. Add escalation REST endpoints to gateway

In `index.ts`, add:

```typescript
// GET /api/escalations — list all escalations
app.get('/api/escalations', (req, res) => {
  const status = req.query.status as string | undefined;
  let escalations = agentRunner.getEscalations();
  if (status) {
    escalations = escalations.filter(e => e.status === status);
  }
  res.json({ escalations });
});

// POST /api/escalations/:id/review — mark as reviewed
app.post('/api/escalations/:id/review', express.json(), (req, res) => {
  try {
    agentRunner.reviewEscalation(req.params.id, req.body.feedback);
    io.emit('escalation_update', {
      type: 'reviewed',
      escalationId: req.params.id,
      timestamp: new Date().toISOString(),
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/escalations/:id/dismiss — dismiss escalation
app.post('/api/escalations/:id/dismiss', (req, res) => {
  try {
    agentRunner.dismissEscalation(req.params.id);
    io.emit('escalation_update', {
      type: 'dismissed',
      escalationId: req.params.id,
      timestamp: new Date().toISOString(),
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
```

Also emit when escalation is created:

```typescript
io.emit('escalation_update', {
  type: 'created',
  escalation: { id, agentId, agentName, taskId, taskTitle, confidence, reason, createdAt },
  timestamp: new Date().toISOString(),
});
```

### 3C. Add dashboard API functions for escalations

In `api.ts`:

```typescript
export interface Escalation {
  id: string;
  agentId: string;
  agentName: string;
  taskId: string;
  taskTitle: string;
  confidence: number;
  reason: string;
  agentResponse: string;
  createdAt: string;
  status: 'pending' | 'reviewed' | 'dismissed';
}

export async function fetchEscalations(status?: string): Promise<{ escalations: Escalation[] }> {
  const query = status ? `?status=${status}` : '';
  return fetchAPI(`/api/escalations${query}`);
}

export async function reviewEscalation(id: string, feedback?: string): Promise<void> {
  await postAPI(`/api/escalations/${id}/review`, { feedback });
}

export async function dismissEscalation(id: string): Promise<void> {
  await postAPI(`/api/escalations/${id}/dismiss`, {});
}
```

### 3D. Add escalation socket event type

In `socket.ts`, add to the `SocketEvents` interface:

```typescript
escalation_update: (data: {
  type: 'created' | 'reviewed' | 'dismissed';
  escalation?: {
    id: string;
    agentId: string;
    agentName: string;
    taskId: string;
    taskTitle: string;
    confidence: number;
    reason: string;
    createdAt: string;
  };
  escalationId?: string;
  timestamp: string;
}) => void;
```

### 3E. Create EscalationQueue component

Create `/forge-team/dashboard/src/components/EscalationQueue.tsx`:

This component shows a dedicated panel for all escalations. It must have:

1. **Header** with title "Escalation Queue" / "قائمة التصعيد" and a badge showing pending count
2. **Filter tabs**: All / Pending / Reviewed / Dismissed
3. **Escalation cards**, each showing:
   - Agent avatar + name (bilingual)
   - Task title
   - Confidence bar (colored: red < 70%, amber 70-84%, green >= 85%)
   - Confidence percentage
   - Reason text
   - Truncated agent response (expandable on click)
   - Timestamp
   - **Review** button — opens feedback input, calls `reviewEscalation()`
   - **Dismiss** button — calls `dismissEscalation()`
4. **Real-time updates** via `on('escalation_update', ...)` socket subscription
5. **Glass-card styling**, full RTL support

### 3F. Add escalation badge to AgentStatusGrid

In `AgentStatusGrid.tsx`, add a small amber/red badge to agent cards when that agent has a pending escalation. In `page.tsx`, maintain an `escalations` state array and pass it to `AgentStatusGrid`:

```tsx
<AgentStatusGrid agents={agents} escalations={escalations} />
```

In `AgentStatusGrid`, check if any pending escalation matches the agent's ID, and if so show:

```tsx
{hasEscalation && (
  <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 ms-auto">
    {t("escalation.badge")}
  </span>
)}
```

### 3G. Wire EscalationQueue into page.tsx

Add "Escalations" / "التصعيدات" as a new sidebar nav item and page tab. Add to `Sidebar.tsx` `navItems` array:

```typescript
{ id: "escalations", icon: AlertTriangle, enLabel: "Escalations", arLabel: "التصعيدات" },
```

In `page.tsx`, add the escalation tab:

```tsx
{activeTab === "escalations" && (
  <EscalationQueue agents={agents} />
)}
```

Add state for escalations in `page.tsx`:

```typescript
const [escalations, setEscalations] = useState<Escalation[]>([]);
```

Fetch on mount and listen for socket events:

```typescript
// In loadData():
const escalRes = await fetchEscalations().catch(() => ({ escalations: [] }));
setEscalations(escalRes.escalations);

// Socket listener:
const unsubEscalation = on('escalation_update' as any, (data: any) => {
  if (data.type === 'created' && data.escalation) {
    setEscalations(prev => [...prev, data.escalation]);
  } else {
    // Refresh full list
    fetchEscalations().then(r => setEscalations(r.escalations)).catch(() => {});
  }
});
```

### 3H. Add translation keys for escalations

Add to both JSON files:

```json
// en.json
"escalation": {
  "title": "Escalation Queue",
  "badge": "Needs Review",
  "pending": "Pending",
  "reviewed": "Reviewed",
  "dismissed": "Dismissed",
  "confidence": "Confidence",
  "reason": "Reason",
  "review": "Review",
  "dismiss": "Dismiss",
  "feedbackPlaceholder": "Your feedback...",
  "noEscalations": "No escalations",
  "threshold": "Auto-escalation threshold: 85%"
}

// ar.json
"escalation": {
  "title": "قائمة التصعيد",
  "badge": "يحتاج مراجعة",
  "pending": "معلق",
  "reviewed": "تمت المراجعة",
  "dismissed": "تم الرفض",
  "confidence": "الثقة",
  "reason": "السبب",
  "review": "مراجعة",
  "dismiss": "رفض",
  "feedbackPlaceholder": "ملاحظاتك...",
  "noEscalations": "لا توجد تصعيدات",
  "threshold": "حد التصعيد التلقائي: ٨٥٪"
}
```

Also add to `nav` in both files:

```json
// en.json nav
"escalations": "Escalations"

// ar.json nav
"escalations": "التصعيدات"
```

---

## WORKSTREAM 4: "Take Over" Mode

**Files to modify:**
- `/forge-team/gateway/src/index.ts` — add takeover endpoints
- `/forge-team/gateway/src/agent-manager.ts` — add takeover state
- `/forge-team/dashboard/src/components/AgentStatusGrid.tsx` — add Take Over button
- `/forge-team/dashboard/src/components/TakeOverBanner.tsx` — NEW FILE
- `/forge-team/dashboard/src/lib/api.ts` — add takeover API
- `/forge-team/dashboard/src/app/page.tsx` — wire takeover state and banner
- `/forge-team/dashboard/src/messages/ar.json`
- `/forge-team/dashboard/src/messages/en.json`

### 4A. Add takeover state to gateway agent-manager

In `agent-manager.ts`, add takeover tracking:

```typescript
private takenOverAgents: Map<string, {
  agentId: string;
  takenOverAt: string;
  originalStatus: string;
}> = new Map();

takeOverAgent(agentId: string): void {
  const agent = this.getAgent(agentId);
  if (!agent) throw new Error(`Agent ${agentId} not found`);
  this.takenOverAgents.set(agentId, {
    agentId,
    takenOverAt: new Date().toISOString(),
    originalStatus: agent.status,
  });
  agent.status = 'human_controlled';
}

releaseAgent(agentId: string): void {
  const record = this.takenOverAgents.get(agentId);
  if (!record) throw new Error(`Agent ${agentId} is not taken over`);
  const agent = this.getAgent(agentId);
  if (agent) {
    agent.status = record.originalStatus;
  }
  this.takenOverAgents.delete(agentId);
}

isAgentTakenOver(agentId: string): boolean {
  return this.takenOverAgents.has(agentId);
}

getTakenOverAgents(): string[] {
  return Array.from(this.takenOverAgents.keys());
}
```

### 4B. Add takeover REST endpoints

In `index.ts`:

```typescript
// POST /api/agents/:agentId/takeover — user takes control of an agent
app.post('/api/agents/:agentId/takeover', (req, res) => {
  try {
    agentManager.takeOverAgent(req.params.agentId);
    io.emit('agent_status', {
      agentId: req.params.agentId,
      newStatus: 'human_controlled',
    });
    res.json({ success: true, agentId: req.params.agentId });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/agents/:agentId/release — user releases control
app.post('/api/agents/:agentId/release', (req, res) => {
  try {
    agentManager.releaseAgent(req.params.agentId);
    const agent = agentManager.getAgent(req.params.agentId);
    io.emit('agent_status', {
      agentId: req.params.agentId,
      newStatus: agent?.status ?? 'idle',
    });
    res.json({ success: true, agentId: req.params.agentId });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/agents/:agentId/human-message — user sends a message as the agent
app.post('/api/agents/:agentId/human-message', express.json(), (req, res) => {
  const { agentId } = req.params;
  const { content, taskId } = req.body;

  if (!agentManager.isAgentTakenOver(agentId)) {
    return res.status(400).json({ error: `Agent ${agentId} is not in takeover mode` });
  }

  // Create a message as if the agent sent it
  const messageId = uuid();
  const message = {
    id: messageId,
    type: 'task',
    from: agentId,
    to: 'human-proxy',
    payload: { content },
    sessionId: 'human-takeover',
    timestamp: new Date().toISOString(),
    metadata: { humanProxy: true },
  };

  // Broadcast the message to all connected clients
  io.emit('message', message);

  // If there's a taskId, update the task with this response
  if (taskId) {
    const task = taskManager.getTask(taskId);
    if (task) {
      task.metadata = task.metadata || {};
      task.metadata.agentResponse = content;
      task.metadata.humanProxy = true;
    }
  }

  res.json({ success: true, messageId });
});
```

### 4C. Add dashboard API functions for takeover

In `api.ts`:

```typescript
export async function takeOverAgent(agentId: string): Promise<void> {
  await postAPI(`/api/agents/${agentId}/takeover`, {});
}

export async function releaseAgent(agentId: string): Promise<void> {
  await postAPI(`/api/agents/${agentId}/release`, {});
}

export async function sendHumanMessage(agentId: string, content: string, taskId?: string): Promise<void> {
  await postAPI(`/api/agents/${agentId}/human-message`, { content, taskId });
}
```

### 4D. Add Take Over button to AgentDetailModal

In `AgentStatusGrid.tsx`, inside the `AgentDetailModal` component, add a "Take Over" / "السيطرة" button at the bottom:

```tsx
{/* Take Over button */}
<div className="border-t border-border/40 pt-4 mt-4">
  {isTakenOver ? (
    <button
      onClick={() => onRelease?.(agent.id)}
      className="w-full py-2.5 rounded-lg bg-amber-500/20 text-amber-400 text-sm font-medium hover:bg-amber-500/30 transition-colors flex items-center justify-center gap-2"
    >
      <UserX size={14} />
      {t("takeover.release")}
    </button>
  ) : (
    <button
      onClick={() => onTakeOver?.(agent.id)}
      className="w-full py-2.5 rounded-lg bg-primary/20 text-primary-light text-sm font-medium hover:bg-primary/30 transition-colors flex items-center justify-center gap-2"
    >
      <UserCheck size={14} />
      {t("takeover.takeOver")}
    </button>
  )}
</div>
```

Update `AgentStatusGrid` props:

```typescript
interface AgentStatusGridProps {
  agents: Agent[];
  escalations?: Escalation[];
  takenOverAgents?: string[];
  onTakeOver?: (agentId: string) => void;
  onRelease?: (agentId: string) => void;
}
```

Pass `isTakenOver` to the modal: `const isTakenOver = takenOverAgents?.includes(agent.id) ?? false;`

### 4E. Create TakeOverBanner component

Create `/forge-team/dashboard/src/components/TakeOverBanner.tsx`:

This is a prominent banner shown at the top of the page when the user has taken over an agent. It must:

1. Show: "You are controlling [Agent Name]" / "أنت تتحكم في [اسم الوكيل]"
2. Have a distinct border color (amber/gold) to clearly indicate takeover mode
3. Include a text input for sending messages as the agent
4. Include a **Send** button that calls `sendHumanMessage(agentId, text)`
5. Include a **Release** button that calls `releaseAgent(agentId)`
6. Be fixed at the top of the main content area

```tsx
interface TakeOverBannerProps {
  agentId: string;
  agentName: string;
  agentNameAr: string;
  agentAvatar: string;
  onRelease: () => void;
  onSendMessage: (content: string) => void;
}
```

Style with amber border and distinct background:

```tsx
<div className="glass-card border-2 border-amber-500/50 p-4 mb-4">
  <div className="flex items-center gap-3 mb-3">
    <span className="text-2xl">{agentAvatar}</span>
    <div className="flex-1">
      <p className="text-sm font-bold text-amber-400">
        {t("takeover.controlling")} {isAr ? agentNameAr : agentName}
      </p>
    </div>
    <button onClick={onRelease} className="text-xs px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors font-medium">
      {t("takeover.release")}
    </button>
  </div>
  <div className="flex gap-2">
    <input
      dir="auto"
      type="text"
      value={messageText}
      onChange={(e) => setMessageText(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter' && messageText.trim()) { onSendMessage(messageText.trim()); setMessageText(''); } }}
      placeholder={t("takeover.messagePlaceholder")}
      className="flex-1 px-3 py-2 rounded-lg bg-surface-light/30 border border-amber-500/30 text-text-primary text-sm focus:outline-none focus:border-amber-500/60"
    />
    <button
      onClick={() => { if (messageText.trim()) { onSendMessage(messageText.trim()); setMessageText(''); } }}
      className="px-4 py-2 rounded-lg bg-amber-500/20 text-amber-400 text-sm font-medium hover:bg-amber-500/30 transition-colors"
    >
      {t("takeover.send")}
    </button>
  </div>
</div>
```

### 4F. Wire takeover into page.tsx

In `page.tsx`:

1. Add state:

```typescript
const [takenOverAgent, setTakenOverAgent] = useState<string | null>(null);
```

2. Add handlers:

```typescript
const handleTakeOver = useCallback(async (agentId: string) => {
  try {
    await takeOverAgent(agentId);
    setTakenOverAgent(agentId);
  } catch (err) {
    console.error("Failed to take over agent:", err);
  }
}, []);

const handleRelease = useCallback(async () => {
  if (!takenOverAgent) return;
  try {
    await releaseAgent(takenOverAgent);
    setTakenOverAgent(null);
  } catch (err) {
    console.error("Failed to release agent:", err);
  }
}, [takenOverAgent]);

const handleTakeOverMessage = useCallback(async (content: string) => {
  if (!takenOverAgent) return;
  try {
    await sendHumanMessage(takenOverAgent, content);
  } catch (err) {
    console.error("Failed to send human message:", err);
  }
}, [takenOverAgent]);
```

3. Render TakeOverBanner when an agent is taken over:

```tsx
{takenOverAgent && (() => {
  const agent = agents.find(a => a.id === takenOverAgent);
  if (!agent) return null;
  return (
    <TakeOverBanner
      agentId={agent.id}
      agentName={agent.name}
      agentNameAr={agent.nameAr}
      agentAvatar={agent.avatar}
      onRelease={handleRelease}
      onSendMessage={handleTakeOverMessage}
    />
  );
})()}
```

4. Pass takeover props to AgentStatusGrid:

```tsx
<AgentStatusGrid
  agents={agents}
  escalations={escalations}
  takenOverAgents={takenOverAgent ? [takenOverAgent] : []}
  onTakeOver={handleTakeOver}
  onRelease={handleRelease}
/>
```

### 4G. Add visual indicator for taken-over agents in grid

In `AgentStatusGrid.tsx`, add a `human_controlled` status style. In the compact card, when an agent is taken over:

- Show a different border color (amber ring)
- Show "Human Controlled" / "تحكم بشري" instead of the normal status label
- Show a small user icon instead of the normal status dot

Add to `statusLabels`:

```typescript
human_controlled: { en: "Human Controlled", ar: "تحكم بشري" },
```

### 4H. Add translation keys for takeover

Add to both JSON files:

```json
// en.json
"takeover": {
  "takeOver": "Take Over",
  "release": "Release Control",
  "controlling": "You are controlling",
  "messagePlaceholder": "Type as this agent...",
  "send": "Send as Agent",
  "humanControlled": "Human Controlled"
}

// ar.json
"takeover": {
  "takeOver": "السيطرة",
  "release": "إطلاق السيطرة",
  "controlling": "أنت تتحكم في",
  "messagePlaceholder": "اكتب كهذا الوكيل...",
  "send": "إرسال كوكيل",
  "humanControlled": "تحكم بشري"
}
```

---

## WORKSTREAM 5: @human Interrupt Mechanism

**Files to modify:**
- `/forge-team/gateway/src/index.ts` — add @human detection in message handler
- `/forge-team/gateway/src/server.ts` — add @human detection in WebSocket message handler
- `/forge-team/dashboard/src/components/ConversationPanel.tsx` — highlight @human mentions

### 5A. Detect @human / @إنسان in agent messages (gateway)

In `index.ts` or `server.ts`, wherever agent messages are processed (the socket `message` handler and/or the agent-to-agent communication pipeline), add detection:

```typescript
function containsHumanMention(content: string): boolean {
  return /@human\b/i.test(content) || /@إنسان\b/.test(content);
}
```

When an agent message contains `@human` or `@إنسان`:

1. Call `workflowExecutor.createInterrupt()` (from Workstream 1) with type `'human_mention'`
2. Set the question to the content of the agent's message
3. Emit the interrupt socket event

This is in the message processing pipeline — find where agent messages are received and processed (likely in the Socket.IO `message` event handler in `index.ts` around line ~694). After the message is processed, check for @human:

```typescript
// After processing the message:
if (containsHumanMention(payload.content)) {
  const interruptId = workflowExecutor.createInterrupt(
    sessionId,
    fromAgentId,
    fromAgentName,
    taskId ?? 'direct-message',
    'human_mention',
    payload.content,
    `Agent ${fromAgentName} requested human attention`,
  );
  io.emit('interrupt_update', {
    type: 'created',
    interrupt: {
      id: interruptId,
      instanceId: sessionId,
      agentId: fromAgentId,
      agentName: fromAgentName,
      stepId: taskId ?? 'direct-message',
      type: 'human_mention',
      question: payload.content,
      context: `Agent ${fromAgentName} requested human attention via @human mention`,
      createdAt: new Date().toISOString(),
    },
    timestamp: new Date().toISOString(),
  });
}
```

### 5B. Highlight @human mentions in ConversationPanel

In `ConversationPanel.tsx`, when rendering message content, detect `@human` and `@إنسان` patterns and wrap them in a highlighted span:

```typescript
function highlightMentions(text: string): React.ReactNode {
  const parts = text.split(/(@human|@إنسان)/gi);
  return parts.map((part, i) => {
    if (/^@(human|إنسان)$/i.test(part)) {
      return (
        <span key={i} className="px-1 py-0.5 rounded bg-amber-500/20 text-amber-400 font-semibold text-xs">
          {part}
        </span>
      );
    }
    return part;
  });
}
```

Apply this to the message content rendering in the conversation feed (both main chat and agent-to-agent side channel).

---

## FINAL CHECKLIST (Every Agent Must Verify)

After all changes, verify:

- [ ] `npm run build` in `/forge-team/dashboard/` succeeds with zero errors
- [ ] `npx tsc --noEmit` in `/forge-team/gateway/` succeeds (or passes with existing known issues only)
- [ ] Gateway has REST endpoints: `/api/interrupts`, `/api/interrupts/:id/resolve`, `/api/workflows/pause-all`, `/api/workflows/resume-all`, `/api/workflows/:id/pause`, `/api/workflows/:id/resume`, `/api/escalations`, `/api/escalations/:id/review`, `/api/escalations/:id/dismiss`, `/api/agents/:id/takeover`, `/api/agents/:id/release`, `/api/agents/:id/human-message`
- [ ] Socket events `interrupt_update` and `escalation_update` are defined and emitted
- [ ] `InterruptModal.tsx` exists and renders floating notification badge + approval modal
- [ ] `EscalationQueue.tsx` exists with filter tabs and review/dismiss actions
- [ ] `TakeOverBanner.tsx` exists with message input and release button
- [ ] "Pause All" and "Resume All" buttons appear in WorkflowProgress header
- [ ] Sidebar has "Escalations" nav item
- [ ] Agent detail modal has "Take Over" / "Release" button
- [ ] Taken-over agents show amber ring and "Human Controlled" status
- [ ] @human and @إنسان mentions in agent messages trigger an interrupt
- [ ] @human mentions are highlighted in ConversationPanel
- [ ] Both `ar.json` and `en.json` have all new keys (interrupt, escalation, takeover, workflow control)
- [ ] Glass-card dark aesthetic is preserved
- [ ] Full RTL Arabic support maintained

---

## TEAM STRUCTURE SUGGESTION

Create a team with these agents working in parallel:

1. **interrupt-builder** — Handles WORKSTREAM 1 (LangGraph interrupt UI: gateway interrupt state, REST endpoints, InterruptModal component, socket events)
2. **workflow-controller** — Handles WORKSTREAM 2 (global/per-session pause/resume: gateway methods, REST endpoints, WorkflowProgress buttons)
3. **escalation-builder** — Handles WORKSTREAM 3 (confidence detection, escalation API, EscalationQueue component, agent grid badges)
4. **takeover-builder** — Handles WORKSTREAM 4 (Take Over mode: gateway state, TakeOverBanner, agent modal button, visual indicators)
5. **mention-detector** — Handles WORKSTREAM 5 (@human detection in gateway + ConversationPanel highlighting)

After all agents finish, run `npm run build` in both gateway and dashboard to verify zero errors.
