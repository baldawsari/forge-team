# Session 02 — Phase 1: LangGraph Runtime + Port 18789 + Redis Pub/Sub (Day 3-4)

> **Instructions for Claude Code Opus 4.6**: Read this entire prompt before taking any action. You must complete ALL tasks listed below in the ForgeTeam project at `/Users/bandar/Documents/AreebPro/forge-team/`. Use the **team/swarm feature** — create a team and spin up parallel agents to work on independent workstreams simultaneously. Each workstream is labeled. Do NOT skip any item. Do NOT introduce new features beyond what is listed. Do NOT add comments, docstrings, or type annotations to code you did not change. Preserve the existing TypeScript style and project conventions.

---

## CONTEXT

Session 01 (Phase 0) established the OpenClaw-compatible gateway layer and connected the VIADP package. This session converts the custom workflow engine to use LangGraph state machines, wires Redis pub/sub for real-time broadcasting, updates the default port to 18789, and connects dead code (WorkflowExecutor, voice handler WS types).

**Key gaps from the audit report addressed in this session:**
- Gap #2: No LangGraph runtime — workflows, checkpoints, interrupts all need this
- Gap #5: WorkflowExecutor never instantiated — entire engine is dead code
- Gap #6: Redis imported but never used — no pub/sub, in-process EventEmitter only
- Voice handler WS message types not wired to server.ts

---

## PRE-WORK: Read These Files First (Before Any Edits)

Every agent on the team must read the files relevant to their workstream before editing:

**Workflow engine (critical — read every line):**
- `/forge-team/gateway/src/workflow-engine.ts` — the entire file. This is the custom state machine that must be converted to LangGraph. Key classes: `WorkflowLoader` (YAML parser, lines 59-250), `CheckpointManager` (in-memory checkpoints, lines ~250-350), `WorkflowExecutor` (state machine runner, lines ~350-end). Note: `WorkflowExecutor` is NEVER instantiated in `index.ts` — it is dead code today.

**Gateway entry and server:**
- `/forge-team/gateway/src/index.ts` — current entry point. Note line 39: `PORT` defaults to `3001` (or `18789` if Session 01 already changed it). The `WorkflowExecutor` class is NOT imported or instantiated anywhere in this file. The `WorkflowLoader` IS imported at line ~370 for the seed endpoint but the executor is not.
- `/forge-team/gateway/src/server.ts` — WebSocket server. The `handleMessage()` switch (lines 278-381) has no voice-related cases (`voice.transcribe`, `voice.synthesize`, etc.).

**Voice handler:**
- `/forge-team/gateway/src/voice-handler.ts` — full Whisper STT + ElevenLabs TTS implementation. Has `transcribe()` and `synthesize()` methods. Currently only reachable via REST endpoints in `index.ts` (`POST /api/voice/transcribe`, `POST /api/voice/synthesize`). NOT reachable via WebSocket.

**OpenClaw layer (created in Session 01):**
- `/forge-team/gateway/src/openclaw/message-bus.ts` — the `MessageBus` class with `publish()`/`subscribe()` interface. Currently backed by EventEmitter. This session will add a Redis provider.

**Shared types:**
- `/forge-team/shared/types/workflow.ts` — WorkflowDefinition, WorkflowInstance, WorkflowPhase, WorkflowStep, WorkflowCheckpoint, etc.

**Existing workflows:**
- `/forge-team/workflows/full-sdlc.yaml` — main SDLC workflow with 6 phases, model overrides, approval gates
- `/forge-team/workflows/bug-fix.yaml`
- `/forge-team/workflows/feature-sprint.yaml`
- `/forge-team/workflows/security-review.yaml`

**Infrastructure:**
- `/forge-team/gateway/package.json` — current deps (no LangGraph, ioredis present but unused)
- `/forge-team/docker/docker-compose.yml` — Postgres + Redis services
- `/forge-team/infrastructure/init.sql` — Postgres schema (has `workflow_instances` table)

---

## WORKSTREAM 1: Install LangGraph and Convert Workflow Engine

**Files to modify:**
- `/forge-team/gateway/package.json` — add LangGraph deps
- `/forge-team/gateway/src/workflow-engine.ts` — major rewrite to use LangGraph
- `/forge-team/shared/types/workflow.ts` — add LangGraph-related type extensions if needed

**Files to create:**
- `/forge-team/gateway/src/langgraph/index.ts` — barrel export
- `/forge-team/gateway/src/langgraph/workflow-graph.ts` — LangGraph StateGraph builder
- `/forge-team/gateway/src/langgraph/nodes.ts` — graph node implementations
- `/forge-team/gateway/src/langgraph/state.ts` — LangGraph state schema
- `/forge-team/gateway/src/langgraph/checkpointer.ts` — Postgres checkpoint saver

### 1A. Install LangGraph packages

Run in `/forge-team/gateway/`:
```bash
npm install @langchain/langgraph @langchain/core
```

These are the only new npm packages for this workstream. Do NOT install `@langchain/openai`, `@langchain/anthropic`, or `langchain` — we only need the graph runtime and core abstractions.

### 1B. Define LangGraph State Schema (`langgraph/state.ts`)

Create the state schema that LangGraph will manage for each workflow instance:

```typescript
import { Annotation } from '@langchain/langgraph';

// Define the workflow state that flows through the graph
export const WorkflowState = Annotation.Root({
  // Workflow identity
  workflowId: Annotation<string>,
  instanceId: Annotation<string>,
  sessionId: Annotation<string>,
  definitionName: Annotation<string>,

  // Current position in the workflow
  currentPhaseIndex: Annotation<number>,
  currentStepIndex: Annotation<number>,
  status: Annotation<'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'>,

  // Phase and step results (accumulated)
  phaseResults: Annotation<Record<string, PhaseResult>>,
  stepResults: Annotation<Record<string, StepResult>>,

  // Human-in-loop
  waitingForApproval: Annotation<boolean>,
  approvalRequest: Annotation<ApprovalRequest | null>,

  // Error tracking
  lastError: Annotation<string | null>,
  retryCount: Annotation<number>,

  // Metadata
  startedAt: Annotation<string>,
  updatedAt: Annotation<string>,
  completedAt: Annotation<string | null>,

  // The full workflow definition (loaded from YAML)
  definition: Annotation<WorkflowDefinition>,
});
```

Import the necessary types from `@forge-team/shared`. Adjust the Annotation syntax to match the installed version of `@langchain/langgraph` (check the actual package version).

### 1C. Create Graph Node Implementations (`langgraph/nodes.ts`)

Create the node functions that represent each step type in the workflow graph:

```typescript
// Node: executeStep
// Takes the current state, finds the active step in the workflow definition,
// dispatches it to the assigned agent via AgentManager, and returns updated state.
// For now, this node should:
// 1. Look up the step definition from state.definition
// 2. Log that it would dispatch to the step's assigned agent
// 3. Return state with the step marked as 'completed' in stepResults
// 4. Full agent dispatch integration comes in a later session

// Node: checkApproval
// If the current step requires approval (approval_required: true in YAML),
// set waitingForApproval: true and return. This triggers LangGraph's
// interrupt mechanism for human-in-loop.

// Node: advancePhase
// When all steps in the current phase are complete, increment currentPhaseIndex
// and reset currentStepIndex to 0. If all phases complete, set status: 'completed'.

// Node: handleError
// On step failure, increment retryCount. If retryCount < 3, re-attempt.
// Otherwise, mark workflow as 'failed' and set lastError.

// Node: checkTransition
// Read the transition rule between current phase and next phase from the
// workflow definition's transitions map. If 'requires_approval', route to
// checkApproval. If 'auto', route to advancePhase.
```

Each node function must accept and return `typeof WorkflowState.State`. Import `AgentManager`, `ModelRouter`, etc. as dependencies but do NOT make LLM calls in this session — just log what would happen and mark steps as completed.

### 1D. Build the StateGraph (`langgraph/workflow-graph.ts`)

Create a function that builds a LangGraph `StateGraph` from a `WorkflowDefinition`:

```typescript
import { StateGraph, END, START } from '@langchain/langgraph';
import { WorkflowState } from './state';
import { executeStep, checkApproval, advancePhase, handleError, checkTransition } from './nodes';

export function buildWorkflowGraph(deps: {
  agentManager: AgentManager;
  modelRouter: ModelRouter;
  viadpEngine: VIADPEngine;
}) {
  const graph = new StateGraph(WorkflowState)
    .addNode('executeStep', executeStep(deps))
    .addNode('checkApproval', checkApproval(deps))
    .addNode('advancePhase', advancePhase(deps))
    .addNode('handleError', handleError(deps))
    .addNode('checkTransition', checkTransition(deps));

  // Edges
  graph.addEdge(START, 'executeStep');
  graph.addConditionalEdges('executeStep', (state) => {
    if (state.lastError) return 'handleError';
    if (state.waitingForApproval) return 'checkApproval';
    return 'checkTransition';
  });
  graph.addConditionalEdges('checkTransition', (state) => {
    if (state.status === 'completed') return END;
    if (state.waitingForApproval) return 'checkApproval';
    return 'advancePhase';
  });
  graph.addEdge('advancePhase', 'executeStep');
  graph.addConditionalEdges('handleError', (state) => {
    if (state.status === 'failed') return END;
    return 'executeStep'; // retry
  });
  // checkApproval uses LangGraph interrupt — the graph pauses here
  // and resumes when the human provides approval via the API

  return graph;
}
```

The `checkApproval` node must use LangGraph's `interrupt()` function to pause execution and wait for human input. This is the mechanism that enables the human-in-loop pattern.

### 1E. Create Postgres Checkpointer (`langgraph/checkpointer.ts`)

Create a LangGraph checkpoint saver backed by Postgres (using the existing `workflow_instances` table from `infrastructure/init.sql`):

```typescript
import { BaseCheckpointSaver } from '@langchain/langgraph';
```

Implement the `BaseCheckpointSaver` interface:
- `getTuple(config)` — load checkpoint from Postgres `workflow_instances` table
- `put(config, checkpoint, metadata)` — save/update checkpoint to Postgres
- `list(config)` — list checkpoints for a workflow instance

The Postgres connection should use the `DATABASE_URL` environment variable. Use the `pg` package (add it to dependencies if not present). The schema should use the existing `workflow_instances` table:

```sql
-- From init.sql, the table already exists:
-- workflow_instances (id, workflow_id, session_id, status, current_phase, current_step, ...)
```

If the existing table schema doesn't have a `checkpoint_data JSONB` column, add an ALTER TABLE migration or create a new `workflow_checkpoints` table with columns:
- `id` — UUID primary key
- `instance_id` — foreign key to workflow_instances
- `thread_id` — LangGraph thread ID
- `checkpoint_data` — JSONB blob storing the serialized LangGraph checkpoint
- `metadata` — JSONB for LangGraph metadata
- `created_at` — timestamp

Add the SQL migration to `/forge-team/infrastructure/init.sql` (append at the end, guarded with `CREATE TABLE IF NOT EXISTS`).

### 1F. Rewrite `WorkflowExecutor` in `workflow-engine.ts`

The existing `WorkflowExecutor` class (lines ~350+ of `workflow-engine.ts`) is a custom in-memory state machine. Replace its internals to use LangGraph:

1. Keep the `WorkflowLoader` class unchanged (lines 59-250) — it correctly parses YAML
2. Keep the `CheckpointManager` interface but re-implement using the Postgres checkpointer
3. Rewrite `WorkflowExecutor`:

```typescript
export class WorkflowExecutor extends EventEmitter {
  private loader: WorkflowLoader;
  private checkpointer: PostgresCheckpointSaver;
  private graphBuilder: typeof buildWorkflowGraph;
  private compiledGraphs: Map<string, CompiledStateGraph>;

  constructor(deps: {
    workflowsDir: string;
    agentManager: AgentManager;
    modelRouter: ModelRouter;
    viadpEngine: VIADPEngine;
    databaseUrl: string;
  }) {
    super();
    this.loader = new WorkflowLoader(deps.workflowsDir);
    this.checkpointer = new PostgresCheckpointSaver(deps.databaseUrl);
    this.compiledGraphs = new Map();
    // ... build graph with deps
  }

  // startWorkflow(definitionName, sessionId) — load YAML, compile graph, invoke
  // pauseWorkflow(instanceId) — uses LangGraph interrupt
  // resumeWorkflow(instanceId, approvalData) — uses LangGraph updateState + continue
  // getProgress(instanceId) — read state from checkpointer
  // cancelWorkflow(instanceId) — update state to cancelled
}
```

Preserve the existing `WorkflowExecutor` event emissions (`'workflow:started'`, `'workflow:phase-changed'`, `'workflow:step-completed'`, `'workflow:completed'`, etc.) so that `server.ts` can subscribe and broadcast to dashboards.

---

## WORKSTREAM 2: Wire Redis Pub/Sub for Real-Time Broadcasting

**Files to modify:**
- `/forge-team/gateway/src/openclaw/message-bus.ts` — add Redis provider
- `/forge-team/gateway/src/server.ts` — use MessageBus for broadcasting
- `/forge-team/gateway/src/index.ts` — initialize Redis connection and pass to MessageBus

**Files to create:**
- `/forge-team/gateway/src/openclaw/redis-provider.ts` — Redis pub/sub implementation of MessageBus

### 2A. Create Redis Provider (`openclaw/redis-provider.ts`)

Create a Redis pub/sub implementation of the `IMessageBus` interface defined in Session 01:

```typescript
import Redis from 'ioredis';

export class RedisMessageBusProvider {
  private publisher: Redis;
  private subscriber: Redis;
  private handlers: Map<string, Set<(message: any) => void>>;

  constructor(redisUrl: string) {
    // ioredis requires SEPARATE connections for pub and sub
    this.publisher = new Redis(redisUrl);
    this.subscriber = new Redis(redisUrl);
    this.handlers = new Map();

    this.subscriber.on('message', (channel, message) => {
      const parsed = JSON.parse(message);
      const channelHandlers = this.handlers.get(channel);
      if (channelHandlers) {
        for (const handler of channelHandlers) {
          handler(parsed);
        }
      }
    });
  }

  async publish(channel: string, message: any): Promise<void> {
    await this.publisher.publish(channel, JSON.stringify(message));
  }

  subscribe(channel: string, handler: (message: any) => void): () => void {
    if (!this.handlers.has(channel)) {
      this.handlers.set(channel, new Set());
      this.subscriber.subscribe(channel);
    }
    this.handlers.get(channel)!.add(handler);

    // Return unsubscribe function
    return () => {
      const set = this.handlers.get(channel);
      if (set) {
        set.delete(handler);
        if (set.size === 0) {
          this.handlers.delete(channel);
          this.subscriber.unsubscribe(channel);
        }
      }
    };
  }

  async disconnect(): Promise<void> {
    await this.publisher.quit();
    await this.subscriber.quit();
  }
}
```

Note: `ioredis` is already in `gateway/package.json` (`"ioredis": "^5.4.2"`) — no install needed.

### 2B. Update MessageBus to Support Redis Provider

Modify `/forge-team/gateway/src/openclaw/message-bus.ts` to accept an optional Redis provider:

```typescript
import { RedisMessageBusProvider } from './redis-provider';

export class MessageBus implements IMessageBus {
  private localEmitter: EventEmitter;
  private redisProvider: RedisMessageBusProvider | null;

  constructor(options?: { redisUrl?: string }) {
    this.localEmitter = new EventEmitter();
    this.redisProvider = options?.redisUrl
      ? new RedisMessageBusProvider(options.redisUrl)
      : null;
  }

  async publish(channel: string, message: any): Promise<void> {
    // Always emit locally (for in-process subscribers like dashboard WS connections)
    this.localEmitter.emit(channel, message);

    // Also publish to Redis if available (for cross-process subscribers)
    if (this.redisProvider) {
      await this.redisProvider.publish(channel, message);
    }
  }

  subscribe(channel: string, handler: (message: any) => void): () => void {
    // Subscribe locally
    this.localEmitter.on(channel, handler);
    let redisUnsub: (() => void) | null = null;

    // Also subscribe via Redis if available
    if (this.redisProvider) {
      redisUnsub = this.redisProvider.subscribe(channel, handler);
    }

    return () => {
      this.localEmitter.off(channel, handler);
      if (redisUnsub) redisUnsub();
    };
  }
}
```

### 2C. Initialize Redis in `index.ts`

In `/forge-team/gateway/src/index.ts`, update the `MessageBus` instantiation to pass the Redis URL:

```typescript
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

const messageBus = new MessageBus({ redisUrl: REDIS_URL });
```

### 2D. Wire `GatewayServer` to use MessageBus for broadcasts

In `/forge-team/gateway/src/server.ts`, update the `broadcastToDashboards()` method to also publish to the MessageBus:

```typescript
broadcastToDashboards(message: WSMessage): void {
  // Existing: send to all connected dashboard WS clients
  for (const [clientId, client] of this.clients) {
    if (client.type === 'dashboard' && client.ws.readyState === WebSocket.OPEN) {
      this.sendToClient(clientId, message);
    }
  }

  // NEW: also publish to Redis channel for cross-process subscribers
  if (this.messageBus) {
    this.messageBus.publish('dashboard', message);
  }
}
```

Add `messageBus` to the `GatewayServer` constructor deps (it was added in Session 01). If Session 01 already did this, just verify it works.

Similarly update `broadcastToSession()` to publish to `session:{sessionId}` channel and `routeToAgent()` to publish to `agent:{agentId}` channel.

---

## WORKSTREAM 3: Wire WorkflowExecutor into Gateway

**Files to modify:**
- `/forge-team/gateway/src/index.ts` — instantiate WorkflowExecutor, add REST endpoints
- `/forge-team/gateway/src/server.ts` — add WS message types for workflow control

### 3A. Instantiate WorkflowExecutor in `index.ts`

After the existing manager instantiations, add:

```typescript
import { WorkflowExecutor } from './workflow-engine';
import { resolve } from 'path';

const workflowExecutor = new WorkflowExecutor({
  workflowsDir: resolve(__dirname, '../../workflows'),
  agentManager,
  modelRouter,
  viadpEngine,
  databaseUrl: process.env.DATABASE_URL ?? 'postgresql://forgeteam:forgeteam_secret@localhost:5432/forgeteam',
});
```

### 3B. Add workflow REST endpoints

Add these routes to `index.ts` (after the existing routes):

```typescript
// GET /api/workflows — list available workflow definitions
app.get('/api/workflows', (_req, res) => {
  try {
    const definitions = workflowExecutor.listDefinitions();
    res.json({ workflows: definitions, timestamp: new Date().toISOString() });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'Failed to list workflows' });
  }
});

// POST /api/workflows/start — start a workflow instance
app.post('/api/workflows/start', express.json(), async (req, res) => {
  try {
    const { definitionName, sessionId } = req.body;
    if (!definitionName || !sessionId) {
      return res.status(400).json({ error: 'definitionName and sessionId are required' });
    }
    const instance = await workflowExecutor.startWorkflow(definitionName, sessionId);
    res.json({ instance, timestamp: new Date().toISOString() });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'Failed to start workflow' });
  }
});

// POST /api/workflows/:instanceId/pause — pause a running workflow
app.post('/api/workflows/:instanceId/pause', async (req, res) => {
  try {
    await workflowExecutor.pauseWorkflow(req.params.instanceId);
    res.json({ status: 'paused', timestamp: new Date().toISOString() });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'Failed to pause workflow' });
  }
});

// POST /api/workflows/:instanceId/resume — resume a paused workflow
app.post('/api/workflows/:instanceId/resume', express.json(), async (req, res) => {
  try {
    const { approvalData } = req.body;
    await workflowExecutor.resumeWorkflow(req.params.instanceId, approvalData);
    res.json({ status: 'resumed', timestamp: new Date().toISOString() });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'Failed to resume workflow' });
  }
});

// GET /api/workflows/:instanceId/progress — get workflow progress
app.get('/api/workflows/:instanceId/progress', async (req, res) => {
  try {
    const progress = await workflowExecutor.getProgress(req.params.instanceId);
    res.json({ progress, timestamp: new Date().toISOString() });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'Failed to get progress' });
  }
});

// POST /api/workflows/:instanceId/cancel — cancel a workflow
app.post('/api/workflows/:instanceId/cancel', async (req, res) => {
  try {
    await workflowExecutor.cancelWorkflow(req.params.instanceId);
    res.json({ status: 'cancelled', timestamp: new Date().toISOString() });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'Failed to cancel workflow' });
  }
});
```

### 3C. Add workflow WS message types to `server.ts`

In the `handleMessage()` switch statement in `server.ts`, add these cases AFTER the existing delegation cases (around line 341):

```typescript
// -- Workflow control --
case 'workflow.list':
  this.handleWorkflowList(clientId);
  break;
case 'workflow.start':
  this.handleWorkflowStart(clientId, parsed);
  break;
case 'workflow.pause':
  this.handleWorkflowPause(clientId, parsed);
  break;
case 'workflow.resume':
  this.handleWorkflowResume(clientId, parsed);
  break;
case 'workflow.progress':
  this.handleWorkflowProgress(clientId, parsed);
  break;
case 'workflow.cancel':
  this.handleWorkflowCancel(clientId, parsed);
  break;
```

Implement each handler method. They should delegate to the `WorkflowExecutor` instance. The `WorkflowExecutor` must be added to the `GatewayServer` constructor deps.

### 3D. Wire WorkflowExecutor events to dashboard broadcasts

In the `wireManagerEvents()` method of `server.ts`, add event listeners for the WorkflowExecutor:

```typescript
// Workflow events
if (this.workflowExecutor) {
  this.workflowExecutor.on('workflow:started', (instance) => {
    this.broadcastToDashboards({
      type: 'workflow.started',
      payload: instance,
      timestamp: new Date().toISOString(),
      sessionId: instance.sessionId,
    });
  });

  this.workflowExecutor.on('workflow:phase-changed', (instance, phase) => {
    this.broadcastToDashboards({
      type: 'workflow.phase-changed',
      payload: { instance, phase },
      timestamp: new Date().toISOString(),
      sessionId: instance.sessionId,
    });
  });

  this.workflowExecutor.on('workflow:step-completed', (instance, step) => {
    this.broadcastToDashboards({
      type: 'workflow.step-completed',
      payload: { instance, step },
      timestamp: new Date().toISOString(),
      sessionId: instance.sessionId,
    });
  });

  this.workflowExecutor.on('workflow:waiting-approval', (instance, approval) => {
    this.broadcastToDashboards({
      type: 'workflow.waiting-approval',
      payload: { instance, approval },
      timestamp: new Date().toISOString(),
      sessionId: instance.sessionId,
    });
  });

  this.workflowExecutor.on('workflow:completed', (instance) => {
    this.broadcastToDashboards({
      type: 'workflow.completed',
      payload: instance,
      timestamp: new Date().toISOString(),
      sessionId: instance.sessionId,
    });
  });

  this.workflowExecutor.on('workflow:failed', (instance, error) => {
    this.broadcastToDashboards({
      type: 'workflow.failed',
      payload: { instance, error },
      timestamp: new Date().toISOString(),
      sessionId: instance.sessionId,
    });
  });
}
```

---

## WORKSTREAM 4: Wire Voice Handler WS Message Types

**Files to modify:**
- `/forge-team/gateway/src/server.ts` — add voice WS message handlers
- `/forge-team/gateway/src/index.ts` — ensure voiceHandler is passed to GatewayServer (already done)

### 4A. Add voice WS message types to `server.ts`

In the `handleMessage()` switch statement, add these cases after the existing `voice.status` case (around line 356):

```typescript
// -- Voice (existing) --
case 'voice.status':
  this.handleVoiceStatus(clientId);
  break;

// -- Voice (new WS-based STT/TTS) --
case 'voice.transcribe':
  this.handleVoiceTranscribe(clientId, parsed);
  break;
case 'voice.synthesize':
  this.handleVoiceSynthesize(clientId, parsed);
  break;
case 'voice.languages':
  this.handleVoiceLanguages(clientId);
  break;
```

### 4B. Implement voice WS handlers

Add these handler methods to the `GatewayServer` class:

```typescript
private async handleVoiceTranscribe(clientId: string, msg: WSMessage): Promise<void> {
  try {
    // The payload should contain base64-encoded audio data
    const audioData = msg.payload?.audio; // base64 string
    const language = msg.payload?.language; // 'ar' | 'en' | undefined (auto-detect)

    if (!audioData) {
      this.sendError(clientId, 'AUDIO_REQUIRED', 'audio (base64) is required for transcription');
      return;
    }

    // Convert base64 to Buffer
    const audioBuffer = Buffer.from(audioData, 'base64');

    const result = await this.voiceHandler.transcribe(audioBuffer, {
      language,
      responseFormat: 'verbose_json',
    });

    this.sendToClient(clientId, {
      type: 'voice.transcribed',
      payload: result,
      timestamp: new Date().toISOString(),
      sessionId: msg.sessionId ?? '',
    });

    // Also broadcast to dashboards for transcript viewer
    this.broadcastToDashboards({
      type: 'voice.transcribed',
      payload: result,
      timestamp: new Date().toISOString(),
      sessionId: msg.sessionId ?? '',
    });
  } catch (error: any) {
    this.sendError(clientId, 'TRANSCRIBE_FAILED', error?.message ?? 'Transcription failed');
  }
}

private async handleVoiceSynthesize(clientId: string, msg: WSMessage): Promise<void> {
  try {
    const text = msg.payload?.text;
    const language = msg.payload?.language ?? 'en';
    const voiceId = msg.payload?.voiceId;

    if (!text) {
      this.sendError(clientId, 'TEXT_REQUIRED', 'text is required for synthesis');
      return;
    }

    const result = await this.voiceHandler.synthesize({
      text,
      language,
      voiceId,
    });

    this.sendToClient(clientId, {
      type: 'voice.synthesized',
      payload: {
        audio: result.audio.toString('base64'), // base64 encoded audio
        durationMs: result.durationMs,
        language,
      },
      timestamp: new Date().toISOString(),
      sessionId: msg.sessionId ?? '',
    });

    // Also broadcast to dashboards for transcript viewer
    this.broadcastToDashboards({
      type: 'voice.synthesized',
      payload: {
        text,
        durationMs: result.durationMs,
        language,
      },
      timestamp: new Date().toISOString(),
      sessionId: msg.sessionId ?? '',
    });
  } catch (error: any) {
    this.sendError(clientId, 'SYNTHESIZE_FAILED', error?.message ?? 'Synthesis failed');
  }
}

private handleVoiceLanguages(clientId: string): void {
  this.sendToClient(clientId, {
    type: 'voice.languages',
    payload: {
      stt: ['en', 'ar', 'en-US', 'ar-SA'],
      tts: ['en', 'ar', 'en-US', 'ar-SA'],
      default: 'ar',
    },
    timestamp: new Date().toISOString(),
    sessionId: '',
  });
}
```

**IMPORTANT**: Check the actual method signatures in `voice-handler.ts` before writing these handlers. The `transcribe()` and `synthesize()` methods may have different parameter signatures than shown above. Match the actual API — read the file first.

---

## WORKSTREAM 5: Port Update Verification and Cleanup

**Files to check/modify:**
- `/forge-team/gateway/src/index.ts` — verify port is 18789
- `/forge-team/docker/docker-compose.yml` — verify port mappings
- `/forge-team/docker/gateway.Dockerfile` — verify EXPOSE
- `/forge-team/dashboard/.env.local` — verify gateway URL
- `/forge-team/dashboard/src/lib/api.ts` — verify fallback URL
- `/forge-team/dashboard/src/lib/socket.ts` — verify fallback URL

### 5A. Verify gateway default port

If Session 01 already changed the port to 18789, verify it is correct in all locations. If it was NOT changed, make these changes now:

**`/forge-team/gateway/src/index.ts` line 39:**
```typescript
const PORT = parseInt(process.env.GATEWAY_PORT ?? '18789', 10);
```

### 5B. Verify Docker Compose

**`/forge-team/docker/docker-compose.yml` gateway service:**
```yaml
ports:
  - "${PORT:-18789}:18789"
environment:
  - PORT=18789
healthcheck:
  test: ["CMD", "node", "-e", "fetch('http://localhost:18789/health').then(...)"]
```

Dashboard environment:
```yaml
- NEXT_PUBLIC_GATEWAY_URL=http://localhost:18789
- NEXT_PUBLIC_WS_URL=http://localhost:18789
```

### 5C. Verify dashboard connection defaults

**`/forge-team/dashboard/.env.local`:**
```
NEXT_PUBLIC_GATEWAY_URL=http://localhost:18789
```

**`/forge-team/dashboard/src/lib/api.ts` (lines ~1-3):**
The fallback URL should be `http://localhost:18789` (not `3001`).

**`/forge-team/dashboard/src/lib/socket.ts` (lines ~6-8):**
Same — fallback should be `http://localhost:18789`.

### 5D. Verify gateway Dockerfile

**`/forge-team/docker/gateway.Dockerfile`:**
```dockerfile
EXPOSE 18789
```

---

## TEAM STRUCTURE SUGGESTION

Create a team with these agents working in parallel:

1. **langgraph-engineer** — Handles WORKSTREAM 1 (install LangGraph, create graph layer, rewrite WorkflowExecutor) — this is the largest and most complex workstream
2. **redis-engineer** — Handles WORKSTREAM 2 (Redis pub/sub provider, MessageBus update, broadcast wiring)
3. **gateway-wirer** — Handles WORKSTREAM 3 (wire WorkflowExecutor into index.ts and server.ts) — depends on WORKSTREAM 1 for the WorkflowExecutor API, but can start the REST endpoints and WS handler skeletons immediately
4. **voice-wirer** — Handles WORKSTREAM 4 (voice handler WS message types) + WORKSTREAM 5 (port verification) — these are smaller and can be done by one agent

**Dependency order**: WORKSTREAM 1 should start first (it defines the WorkflowExecutor API). WORKSTREAM 3 depends on the WorkflowExecutor's public method signatures from WORKSTREAM 1. WORKSTREAMS 2, 4, and 5 are fully independent and can run in parallel with everything.

---

## FINAL CHECKLIST (Every Agent Must Verify)

After all work is complete, verify:

**LangGraph:**
- [x] `@langchain/langgraph` and `@langchain/core` are in `/forge-team/gateway/package.json` dependencies
- [x] `/forge-team/gateway/src/langgraph/` directory exists with files: `index.ts`, `workflow-graph.ts`, `nodes.ts`, `state.ts`, `checkpointer.ts`
- [x] `WorkflowState` annotation is defined with all required fields (workflowId, instanceId, sessionId, currentPhaseIndex, currentStepIndex, status, phaseResults, stepResults, waitingForApproval, etc.)
- [x] `buildWorkflowGraph()` creates a `StateGraph` with nodes: executeStep, checkApproval, advancePhase, handleError, checkTransition
- [x] `checkApproval` node uses LangGraph `interrupt()` for human-in-loop
- [x] `PostgresCheckpointSaver` implements `BaseCheckpointSaver` and uses the existing Postgres connection
- [x] `workflow_checkpoints` table migration is added to `/forge-team/infrastructure/init.sql`
- [x] `WorkflowExecutor` in `workflow-engine.ts` delegates to LangGraph internally
- [x] `WorkflowExecutor` preserves all existing event emissions (`workflow:started`, `workflow:phase-changed`, `workflow:step-completed`, `workflow:completed`, `workflow:failed`)
- [x] `WorkflowLoader` (YAML parser) is UNCHANGED

**Redis:**
- [x] `/forge-team/gateway/src/openclaw/redis-provider.ts` exists with `RedisMessageBusProvider` class
- [x] `RedisMessageBusProvider` uses two separate `ioredis` connections (one for pub, one for sub)
- [x] `MessageBus` accepts `{ redisUrl?: string }` in constructor
- [x] `MessageBus.publish()` sends to both local EventEmitter AND Redis
- [x] `MessageBus.subscribe()` subscribes to both local EventEmitter AND Redis
- [x] Redis URL is read from `REDIS_URL` env var in `index.ts`

**WorkflowExecutor wiring:**
- [x] `WorkflowExecutor` is instantiated in `index.ts` with correct workflowsDir path
- [x] REST endpoints respond: `GET /api/workflows`, `POST /api/workflows/start`, `POST /api/workflows/:id/pause`, `POST /api/workflows/:id/resume`, `GET /api/workflows/:id/progress`, `POST /api/workflows/:id/cancel`
- [x] WS message types handled in `server.ts`: `workflow.list`, `workflow.start`, `workflow.pause`, `workflow.resume`, `workflow.progress`, `workflow.cancel`
- [x] WorkflowExecutor events are wired to dashboard broadcasts in `wireManagerEvents()`

**Voice WS:**
- [x] WS message types handled in `server.ts`: `voice.transcribe`, `voice.synthesize`, `voice.languages`
- [x] `voice.transcribe` handler accepts base64 audio, calls `voiceHandler.transcribe()`, returns result
- [x] `voice.synthesize` handler accepts text + language, calls `voiceHandler.synthesize()`, returns base64 audio
- [x] Voice WS events are broadcast to dashboards for the transcript viewer

**Port:**
- [x] Default port in `index.ts` is `18789`
- [x] Docker Compose gateway service uses port `18789`
- [x] Gateway Dockerfile EXPOSE is `18789`
- [x] Dashboard `.env.local` points to `http://localhost:18789`
- [x] Dashboard `api.ts` fallback is `http://localhost:18789`
- [x] Dashboard `socket.ts` fallback is `http://localhost:18789`

**General:**
- [x] `npx tsc --noEmit` in `/forge-team/gateway/` succeeds with zero errors (or only pre-existing errors not introduced by this session)
- [x] No existing gateway functionality was removed
- [x] No new packages beyond `@langchain/langgraph`, `@langchain/core`, and optionally `pg` were added
- [x] The `WorkflowLoader` YAML parser was not modified
- [x] All 4 existing YAML workflows still parse correctly
