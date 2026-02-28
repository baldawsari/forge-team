# Session 01 — Phase 0: OpenClaw Fork + Merge (Day 1-2)

> **Instructions for Claude Code Opus 4.6**: Read this entire prompt before taking any action. You must complete ALL tasks listed below in the ForgeTeam project at `/Users/bandar/Documents/AreebPro/forge-team/`. Use the **team/swarm feature** — create a team and spin up parallel agents to work on independent workstreams simultaneously. Each workstream is labeled. Do NOT skip any item. Do NOT introduce new features beyond what is listed. Do NOT add comments, docstrings, or type annotations to code you did not change. Preserve the existing TypeScript style and project conventions. The goal is to establish an OpenClaw-compatible gateway foundation while keeping every existing module intact.

---

## CONTEXT

The ForgeTeam project currently has a fully custom gateway built from scratch (`gateway/src/`). According to the project checklist and audit report, Phase 0 requires forking OpenClaw as the base framework. OpenClaw (https://github.com/openclaw/openclaw) provides patterns for:

- Session-based multi-agent orchestration
- Agent lifecycle management (register, heartbeat, disconnect)
- Tool execution framework with sandboxed runners
- Structured message routing with typed envelopes

**Practical approach**: Since OpenClaw may not exist as a public forkable repo at the time of this session, we will **build the OpenClaw-compatible gateway layer from scratch** using the documented OpenClaw patterns. The existing gateway code already implements much of this functionality — the task is to restructure it into an OpenClaw-compatible architecture and add the missing OpenClaw primitives.

---

## PRE-WORK: Read These Files First (Before Any Edits)

Every agent on the team must read the files relevant to their workstream before editing. The ground-truth references are:

**Gateway core (all must read):**
- `/forge-team/gateway/src/index.ts` — current entry point, Express + WS server setup, REST routes, Socket.IO, demo seed
- `/forge-team/gateway/src/server.ts` — raw WebSocket server, connection management, message routing, heartbeat
- `/forge-team/gateway/src/session-manager.ts` — session lifecycle: create, join, leave, destroy, state transitions
- `/forge-team/gateway/src/agent-manager.ts` — agent registry, status tracking, dispatch, config loading from agents/ folder
- `/forge-team/gateway/src/task-manager.ts` — Kanban board CRUD, task state transitions
- `/forge-team/gateway/src/model-router.ts` — model selection, complexity routing, cost tracking, fallback chains
- `/forge-team/gateway/src/viadp-engine.ts` — delegation protocol, trust scoring, audit trail
- `/forge-team/gateway/src/voice-handler.ts` — Whisper STT + ElevenLabs TTS pipeline
- `/forge-team/gateway/src/workflow-engine.ts` — YAML loader, state machine executor, checkpoint manager
- `/forge-team/gateway/src/agent-runner.ts` — agent LLM execution, prompt construction
- `/forge-team/gateway/src/party-mode.ts` — multi-agent party mode routing

**Configuration and infrastructure:**
- `/forge-team/gateway/package.json` — current dependencies
- `/forge-team/gateway/tsconfig.json` — TypeScript config
- `/forge-team/package.json` — root monorepo config (npm workspaces)
- `/forge-team/docker/docker-compose.yml` — Docker services (gateway, dashboard, postgres, redis, qdrant)
- `/forge-team/docker/gateway.Dockerfile` — gateway Docker build

**Shared types:**
- `/forge-team/shared/types/` — all shared TypeScript interfaces

**Agent configs (read at least 2-3 to understand the pattern):**
- `/forge-team/agents/bmad-master/config.json`
- `/forge-team/agents/architect/config.json`
- `/forge-team/agents/backend-dev/config.json`

**Existing VIADP package (important for integration gap):**
- `/forge-team/viadp/src/` — standalone VIADP implementation (currently NOT imported by gateway)

---

## WORKSTREAM 1: Create OpenClaw-Compatible Core Framework

**Files to create:**
- `/forge-team/gateway/src/openclaw/index.ts` — re-exports for the OpenClaw layer
- `/forge-team/gateway/src/openclaw/types.ts` — OpenClaw core type definitions
- `/forge-team/gateway/src/openclaw/session.ts` — OpenClaw session primitive
- `/forge-team/gateway/src/openclaw/agent-registry.ts` — OpenClaw agent registry pattern
- `/forge-team/gateway/src/openclaw/message-bus.ts` — typed message bus (EventEmitter-based for now, Redis-ready interface)
- `/forge-team/gateway/src/openclaw/tool-runner.ts` — tool execution framework skeleton

**Files to modify:**
- `/forge-team/gateway/src/server.ts` — import and delegate to OpenClaw primitives where applicable

### 1A. Define OpenClaw Core Types (`openclaw/types.ts`)

Create the type definitions that represent the OpenClaw contract. These must be compatible with the existing `@forge-team/shared` types but add the OpenClaw-specific patterns:

```typescript
// Key types to define:
// - OpenClawSession: extends existing session with tool context, agent slots, lifecycle hooks
// - OpenClawAgent: agent registration record with capabilities, heartbeat tracking
// - OpenClawMessage: typed message envelope (already partially exists as WSMessage in server.ts)
// - OpenClawToolDef: tool definition (name, description, input schema, handler ref)
// - OpenClawToolResult: result of a tool execution (success/error, output, timing)
// - MessageBusChannel: channel names for pub/sub routing
```

Import and extend existing types from `@forge-team/shared` where possible. Do NOT duplicate existing type definitions — use `extends` or `&` intersection types.

### 1B. Create OpenClaw Session Primitive (`openclaw/session.ts`)

Create an `OpenClawSession` class that wraps the existing `SessionManager` functionality and adds:

- `registerAgent(agentId, capabilities)` — register an agent into the session with declared capabilities
- `deregisterAgent(agentId)` — remove an agent from the session
- `getActiveAgents()` — return all currently registered agents with their capabilities
- `addToolContext(tools: OpenClawToolDef[])` — attach available tools to the session
- `getToolContext()` — return the session's tool manifest
- `onLifecycle(event, handler)` — lifecycle hooks: `'agent-joined'`, `'agent-left'`, `'session-paused'`, `'session-resumed'`

This class should delegate to the existing `SessionManager` for core state management but layer the OpenClaw-specific patterns on top.

### 1C. Create OpenClaw Agent Registry (`openclaw/agent-registry.ts`)

Create an `OpenClawAgentRegistry` class that wraps the existing `AgentManager` and adds:

- `register(agentId, config)` — register an agent with its full config (model, capabilities, tools, SOUL identity)
- `heartbeat(agentId)` — update agent liveness timestamp
- `getCapabilities(agentId)` — return agent's declared capabilities
- `findByCapability(capability)` — find agents that have a specific capability
- `getHealthy(timeoutMs)` — return agents that have heartbeated within timeout window

The registry must load agent configs from `/forge-team/agents/*/config.json` on initialization (the existing `AgentManager` already does this — wrap it, don't rewrite it).

### 1D. Create Message Bus Interface (`openclaw/message-bus.ts`)

Create a `MessageBus` class with a provider-agnostic interface:

```typescript
interface IMessageBus {
  publish(channel: string, message: OpenClawMessage): Promise<void>;
  subscribe(channel: string, handler: (message: OpenClawMessage) => void): () => void;
  unsubscribe(channel: string): void;
  // Channel patterns:
  // - 'session:{sessionId}' — session-scoped broadcast
  // - 'agent:{agentId}' — direct agent messages
  // - 'dashboard' — dashboard broadcasts
  // - 'system' — system-wide events
}
```

For this phase, implement using the existing `EventEmitter` from `eventemitter3`. The interface must be designed so that Session 02 can swap in a Redis pub/sub provider without changing any callers.

### 1E. Create Tool Runner Skeleton (`openclaw/tool-runner.ts`)

Create a `ToolRunner` class skeleton that defines the tool execution contract:

- `registerTool(def: OpenClawToolDef)` — register a tool definition
- `listTools()` — return all registered tools
- `executeTool(name, input, context)` — execute a tool (returns `Promise<OpenClawToolResult>`)
- `getToolSchema(name)` — return the JSON schema for a tool's input

For this phase, the `executeTool` method should log the invocation and return a placeholder result with `{ status: 'not-implemented', message: 'Tool execution will be connected in Phase 6' }`. The important thing is the interface contract, not the implementation.

### 1F. Create barrel export (`openclaw/index.ts`)

Re-export all OpenClaw types and classes from a single entry point:

```typescript
export * from './types';
export { OpenClawSession } from './session';
export { OpenClawAgentRegistry } from './agent-registry';
export { MessageBus } from './message-bus';
export { ToolRunner } from './tool-runner';
```

---

## WORKSTREAM 2: Integrate OpenClaw Layer into Existing Gateway

**Files to modify:**
- `/forge-team/gateway/src/index.ts`
- `/forge-team/gateway/src/server.ts`

### 2A. Instantiate OpenClaw components in `index.ts`

After the existing manager instantiations (SessionManager, AgentManager, etc.), add instantiation of the OpenClaw components:

```typescript
// After existing managers (around line 50-60 of index.ts):
import { OpenClawAgentRegistry, MessageBus, ToolRunner } from './openclaw';

const messageBus = new MessageBus();
const agentRegistry = new OpenClawAgentRegistry(agentManager);
const toolRunner = new ToolRunner();
```

Pass the `messageBus` to the `GatewayServer` constructor (add it to the deps object). The `GatewayServer` in `server.ts` should use `messageBus.publish()` for broadcasting instead of calling `broadcastToDashboards()` directly — but ONLY for new code paths. Do NOT rewrite existing broadcast calls in this phase; just add the messageBus as an available channel.

### 2B. Add OpenClaw REST endpoints to `index.ts`

Add these new REST API routes after the existing ones:

```typescript
// GET /api/openclaw/agents — list registered agents with capabilities
app.get('/api/openclaw/agents', (_req, res) => {
  const agents = agentRegistry.getAllWithCapabilities();
  res.json({ agents, timestamp: new Date().toISOString() });
});

// GET /api/openclaw/tools — list registered tools
app.get('/api/openclaw/tools', (_req, res) => {
  const tools = toolRunner.listTools();
  res.json({ tools, timestamp: new Date().toISOString() });
});

// POST /api/openclaw/tools/:name/execute — execute a tool (placeholder)
app.post('/api/openclaw/tools/:name/execute', express.json(), async (req, res) => {
  try {
    const result = await toolRunner.executeTool(req.params.name, req.body.input ?? {}, {
      sessionId: req.body.sessionId,
      agentId: req.body.agentId,
    });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'Tool execution failed' });
  }
});
```

### 2C. Wire OpenClaw message types into `server.ts`

In the `handleMessage()` switch statement in `server.ts`, add new cases for OpenClaw-specific message types:

```
case 'openclaw.agent.register':    → call agentRegistry.register()
case 'openclaw.agent.heartbeat':   → call agentRegistry.heartbeat()
case 'openclaw.agent.capabilities': → return agent capabilities
case 'openclaw.tool.list':          → return tool list
case 'openclaw.tool.execute':       → call toolRunner.executeTool()
```

Add these cases AFTER the existing switch cases. Do NOT modify or remove any existing cases.

---

## WORKSTREAM 3: Connect VIADP Package to Gateway

**Files to modify:**
- `/forge-team/gateway/package.json`
- `/forge-team/gateway/src/index.ts`
- `/forge-team/gateway/src/viadp-engine.ts`

**Files to read first:**
- `/forge-team/viadp/src/delegation-engine.ts`
- `/forge-team/viadp/src/trust-manager.ts`
- `/forge-team/viadp/src/resilience.ts`
- `/forge-team/viadp/src/audit-log.ts`
- `/forge-team/viadp/src/verification.ts`

### 3A. Add VIADP package dependency

In `/forge-team/gateway/package.json`, add `@forge-team/viadp` to dependencies:

```json
"@forge-team/viadp": "*"
```

This works because the root `package.json` uses npm workspaces with `"viadp"` already listed.

### 3B. Import and wire VIADP package modules

In `/forge-team/gateway/src/viadp-engine.ts`, import the standalone VIADP package modules and delegate to them instead of using the duplicate inline implementations. The audit report identifies that the gateway has its own VIADP implementation that duplicates and lacks the features of `@forge-team/viadp`:

- The `@forge-team/viadp` package has: circuit breakers, parallel bids, Shannon-entropy diversity scoring, Object.freeze audit log, full Beta(alpha,beta) Bayesian trust
- The gateway `viadp-engine.ts` has: basic delegation request/accept/reject, simple trust tracking

**Strategy**: Keep the gateway `VIADPEngine` class as the facade/adapter, but replace its internal logic to delegate to `@forge-team/viadp` modules:

1. Import `DelegationEngine` from `@forge-team/viadp`
2. Import `TrustManager` from `@forge-team/viadp`
3. Import `AuditLog` from `@forge-team/viadp`
4. Import `ResilienceManager` from `@forge-team/viadp`
5. In the `VIADPEngine` constructor, instantiate these and store them as private members
6. In `createDelegationRequest()`, delegate to `DelegationEngine.delegate()` which includes capability matching, diversity scoring, and parallel bidding
7. In `acceptDelegation()` / `rejectDelegation()`, delegate to the package methods and also call `AuditLog.append()` and `TrustManager.update()`
8. Keep the existing public API surface unchanged so `server.ts` does not need modifications

### 3C. Add VIADP REST endpoints

In `/forge-team/gateway/src/index.ts`, add REST endpoints that expose VIADP data:

```typescript
// GET /api/viadp/delegations — list delegation history
app.get('/api/viadp/delegations', (_req, res) => {
  const delegations = viadpEngine.getDelegationHistory();
  res.json({ delegations, timestamp: new Date().toISOString() });
});

// GET /api/viadp/trust — trust scores for all agents
app.get('/api/viadp/trust', (_req, res) => {
  const trustScores = viadpEngine.getAllTrustScores();
  res.json({ trustScores, timestamp: new Date().toISOString() });
});

// GET /api/viadp/audit — audit log entries
app.get('/api/viadp/audit', (_req, res) => {
  const entries = viadpEngine.getAuditLog();
  res.json({ entries, timestamp: new Date().toISOString() });
});
```

These endpoints may already partially exist — check the existing routes in `index.ts` and only add what is missing.

---

## WORKSTREAM 4: Update Infrastructure and Dependencies

**Files to modify:**
- `/forge-team/gateway/package.json`
- `/forge-team/docker/docker-compose.yml`
- `/forge-team/docker/gateway.Dockerfile`
- `/forge-team/package.json` (root)

### 4A. Update gateway `package.json` dependencies

Add the following dependency (if not already present):
```json
{
  "@forge-team/viadp": "*"
}
```

No other new npm packages are needed for Phase 0. LangGraph and Redis wiring come in Session 02.

### 4B. Update Docker Compose port mapping

In `/forge-team/docker/docker-compose.yml`:

1. Change the gateway service port mapping from `"${PORT:-3001}:3001"` to `"${PORT:-18789}:18789"`
2. Change the gateway environment `PORT=3001` to `PORT=18789`
3. Update the healthcheck URL from `http://localhost:3001/health` to `http://localhost:18789/health`
4. Update the dashboard environment variables:
   - `NEXT_PUBLIC_GATEWAY_URL=http://localhost:18789`
   - `NEXT_PUBLIC_WS_URL=http://localhost:18789`

### 4C. Update gateway port default in `index.ts`

In `/forge-team/gateway/src/index.ts` line 39:
```typescript
// Change from:
const PORT = parseInt(process.env.GATEWAY_PORT ?? '3001', 10);
// To:
const PORT = parseInt(process.env.GATEWAY_PORT ?? '18789', 10);
```

Also update the Express `app.listen` log message and any hardcoded port references in the file.

### 4D. Update gateway Dockerfile

In `/forge-team/docker/gateway.Dockerfile`:
1. Change any `EXPOSE 3001` to `EXPOSE 18789`
2. If `NODE_ENV` or `PORT` are set, update to `18789`

### 4E. Verify workspace setup

Ensure the root `/forge-team/package.json` workspaces array includes all packages:
```json
"workspaces": ["shared", "gateway", "dashboard", "memory", "viadp"]
```

If it already has this (it should), no change needed. Verify with `npm ls --workspaces` after changes.

---

## WORKSTREAM 5: Security Quick Fixes (From Audit Report)

**Files to modify:**
- `/forge-team/.env.example`
- `/forge-team/.env` (if it exists)
- `/forge-team/docker/docker-compose.yml`

### 5A. Sanitize `.env.example`

Read `/forge-team/.env.example`. If it contains real API keys (the audit report says it does), replace ALL key values with placeholder strings:

```
ANTHROPIC_API_KEY=sk-ant-REPLACE_ME
GOOGLE_AI_API_KEY=REPLACE_ME
ELEVENLABS_API_KEY=REPLACE_ME
WHISPER_API_KEY=REPLACE_ME
POSTGRES_PASSWORD=CHANGE_ME_IN_PRODUCTION
```

### 5B. Check and sanitize `.env`

If `/forge-team/.env` exists, check if it contains real API keys. If so, replace them with the same placeholder format. If `.env` is gitignored (check `.gitignore`), note that but still sanitize.

### 5C. Bind Postgres and Redis to localhost only

In `/forge-team/docker/docker-compose.yml`:

Change Postgres port from:
```yaml
ports:
  - "5432:5432"
```
To:
```yaml
ports:
  - "127.0.0.1:5432:5432"
```

Change Redis port from:
```yaml
ports:
  - "6379:6379"
```
To:
```yaml
ports:
  - "127.0.0.1:6379:6379"
```

This prevents external access to the database and cache from outside the host machine.

---

## TEAM STRUCTURE SUGGESTION

Create a team with these agents working in parallel:

1. **openclaw-architect** — Handles WORKSTREAM 1 (create OpenClaw framework layer) — this is the largest workstream
2. **gateway-integrator** — Handles WORKSTREAM 2 (integrate OpenClaw into existing gateway) — depends on WORKSTREAM 1 completing first, OR can work in parallel by reading the types from WORKSTREAM 1's type definitions
3. **viadp-connector** — Handles WORKSTREAM 3 (connect VIADP package to gateway)
4. **infra-updater** — Handles WORKSTREAM 4 (infrastructure and dependencies) + WORKSTREAM 5 (security fixes) — these are small and can be done by one agent

**Dependency order**: WORKSTREAM 1 should start first. WORKSTREAM 2 depends on WORKSTREAM 1's type definitions. WORKSTREAMS 3, 4, and 5 are independent and can run in parallel with everything else.

---

## FINAL CHECKLIST (Every Agent Must Verify)

After all work is complete, verify:

- [x] `/forge-team/gateway/src/openclaw/` directory exists with all 6 files: `index.ts`, `types.ts`, `session.ts`, `agent-registry.ts`, `message-bus.ts`, `tool-runner.ts`
- [x] All OpenClaw types extend or reference `@forge-team/shared` types (no duplication)
- [x] `OpenClawAgentRegistry` wraps `AgentManager` (does not replace it)
- [x] `MessageBus` uses `EventEmitter` internally but exposes a Redis-compatible interface (publish/subscribe with channel strings)
- [x] `ToolRunner.executeTool()` returns a placeholder result (not a crash)
- [x] Gateway `index.ts` instantiates OpenClaw components and passes `messageBus` to `GatewayServer`
- [x] OpenClaw REST endpoints respond: `GET /api/openclaw/agents`, `GET /api/openclaw/tools`, `POST /api/openclaw/tools/:name/execute`
- [x] OpenClaw WS message types are handled in `server.ts`: `openclaw.agent.register`, `openclaw.agent.heartbeat`, `openclaw.agent.capabilities`, `openclaw.tool.list`, `openclaw.tool.execute`
- [x] `@forge-team/viadp` is in gateway's `package.json` dependencies
- [x] `viadp-engine.ts` imports and delegates to `@forge-team/viadp` modules (DelegationEngine, TrustManager, AuditLog, ResilienceEngine)
- [x] VIADP REST endpoints respond: `GET /api/viadp/delegations`, `GET /api/viadp/trust`, `GET /api/viadp/audit`
- [x] Default gateway port is `18789` in `index.ts`, `docker-compose.yml`, and `gateway.Dockerfile`
- [x] Docker Compose dashboard environment uses `http://localhost:18789`
- [x] Postgres and Redis ports are bound to `127.0.0.1` only in `docker-compose.yml`
- [x] `.env.example` contains NO real API keys (only placeholders)
- [x] `npx tsc --noEmit` in `/forge-team/gateway/` succeeds with zero errors (or only pre-existing errors)
- [x] All existing gateway functionality is preserved — no existing switch cases, routes, or handlers were removed
- [x] No new npm packages were added beyond `@forge-team/viadp` (LangGraph and Redis wiring come in Session 02)
