# ForgeTeam WebSocket Events

Connection URL: `ws://localhost:18789`

The gateway supports both raw WebSocket and Socket.IO connections.

- **Raw WebSocket**: Connect to `ws://localhost:18789` (any path except `/socket.io`)
- **Socket.IO**: Connect to `http://localhost:18789` with path `/socket.io`

## Message Envelope

All raw WebSocket messages use this JSON envelope:

```json
{
  "type": "string",
  "payload": {},
  "timestamp": "2026-02-28T12:00:00.000Z",
  "sessionId": "session-abc"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `string` | **Yes** | Message type identifier |
| `payload` | `any` | **Yes** | Message-specific data |
| `timestamp` | `string` | No | ISO 8601 timestamp (auto-set by server if omitted) |
| `sessionId` | `string` | No | Session context for the message |

## Connection Parameters

Raw WebSocket connections accept these query parameters on the URL:

| Parameter | Type | Description |
|-----------|------|-------------|
| `type` | `"user" \| "agent" \| "dashboard"` | Client type (default: `user`) |
| `agentId` | `AgentId` | Required for agent connections |
| `sessionId` | `string` | Auto-joins this session on connect |
| `token` | `string` | JWT token for authentication (when auth is enabled) |

**Example:** `ws://localhost:18789?type=agent&agentId=backend-dev&sessionId=sess-123`

## Authentication

In non-development environments (or when `FORCE_AUTH=true`), clients must authenticate:

1. **On connect**: Pass `token` as a query parameter, or
2. **After connect**: Send an `auth.token` message within 10 seconds

If authentication fails or times out, the connection is closed.

---

## Client -> Server Events (Raw WebSocket)

### auth.token

Authenticates the connection with a JWT token (deferred auth).

```json
{
  "type": "auth.token",
  "payload": { "token": "eyJhbGciOiJIUzI1NiIs..." }
}
```

### ping

Heartbeat ping. Server responds with `pong`.

```json
{
  "type": "ping",
  "payload": {}
}
```

---

### Session Management

#### session.create

Creates a new session.

```json
{
  "type": "session.create",
  "payload": {
    "label": "my-project",
    "userId": "user-123",
    "metadata": { "project": "My Project" }
  }
}
```

#### session.join

Joins an existing session.

```json
{
  "type": "session.join",
  "payload": { "sessionId": "session-abc" },
  "sessionId": "session-abc"
}
```

#### session.leave

Leaves a session.

```json
{
  "type": "session.leave",
  "payload": { "sessionId": "session-abc" },
  "sessionId": "session-abc"
}
```

#### session.list

Requests a list of all sessions.

```json
{
  "type": "session.list",
  "payload": {}
}
```

#### session.destroy

Destroys a session.

```json
{
  "type": "session.destroy",
  "payload": { "sessionId": "session-abc" },
  "sessionId": "session-abc"
}
```

---

### Chat Messages

#### chat.message

Sends a chat message. Can target a specific agent, `broadcast`, or `dashboard`.

```json
{
  "type": "chat.message",
  "payload": {
    "content": "Design the database schema for attendance",
    "to": "backend-dev",
    "data": {},
    "correlationId": "corr-123"
  },
  "sessionId": "session-abc"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `payload.content` | `string` | **Yes** | Message text |
| `payload.to` | `string` | No | Target: `AgentId`, `"broadcast"`, or `"dashboard"` (default: `"broadcast"`) |
| `payload.data` | `object` | No | Structured data |
| `payload.correlationId` | `string` | No | For request/response tracking |

---

### Agent Operations

#### agent.status

Updates an agent's status (agent connections only).

```json
{
  "type": "agent.status",
  "payload": { "status": "working" },
  "sessionId": "session-abc"
}
```

#### agent.list

Requests a list of all agents and their statuses.

```json
{
  "type": "agent.list",
  "payload": {}
}
```

#### agent.send

Sends a direct message to a specific agent.

```json
{
  "type": "agent.send",
  "payload": {
    "to": "backend-dev",
    "content": "Please implement the check-in API",
    "messageType": "task.assign",
    "data": {},
    "artifacts": [],
    "correlationId": "corr-456"
  },
  "sessionId": "session-abc"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `payload.to` | `AgentId` | **Yes** | Target agent |
| `payload.content` | `string` | No | Message text |
| `payload.messageType` | `AgentMessageType` | No | Message type (default: `chat.message`) |
| `payload.data` | `object` | No | Structured data |
| `payload.artifacts` | `ArtifactReference[]` | No | Attached artifacts |
| `payload.correlationId` | `string` | No | Correlation ID |

---

### Task Management

#### task.create

Creates a new task.

```json
{
  "type": "task.create",
  "payload": {
    "title": "Build check-in API",
    "description": "Implement GPS-based geofencing",
    "priority": "critical",
    "complexity": "complex",
    "assignedTo": "backend-dev",
    "tags": ["geofencing", "api"],
    "phase": "implementation",
    "storyPoints": 8
  },
  "sessionId": "session-abc"
}
```

#### task.update

Updates an existing task.

```json
{
  "type": "task.update",
  "payload": {
    "taskId": "task-123",
    "title": "Updated title",
    "priority": "high",
    "tags": ["geofencing", "api", "urgent"]
  },
  "sessionId": "session-abc"
}
```

#### task.move

Moves a task to a different Kanban column.

```json
{
  "type": "task.move",
  "payload": {
    "taskId": "task-123",
    "status": "in-progress"
  },
  "sessionId": "session-abc"
}
```

#### task.assign

Assigns a task to an agent.

```json
{
  "type": "task.assign",
  "payload": {
    "taskId": "task-123",
    "agentId": "backend-dev"
  },
  "sessionId": "session-abc"
}
```

#### task.list

Requests a filtered list of tasks.

```json
{
  "type": "task.list",
  "payload": {
    "status": "in-progress",
    "assignedTo": "backend-dev"
  },
  "sessionId": "session-abc"
}
```

#### kanban.board

Requests the full Kanban board for a session.

```json
{
  "type": "kanban.board",
  "payload": { "sessionId": "session-abc" },
  "sessionId": "session-abc"
}
```

---

### Delegation (VIADP)

#### delegation.request

Creates a delegation request from one agent to another.

```json
{
  "type": "delegation.request",
  "payload": {
    "from": "architect",
    "to": "backend-dev",
    "taskId": "task-123",
    "reason": "Backend implementation needed",
    "requiredCapabilities": ["backend-development"],
    "scope": {
      "allowedActions": ["implement", "test"],
      "resourceLimits": { "maxTokens": 100000 },
      "canRedelegate": false,
      "allowedArtifactTypes": ["code", "test"]
    },
    "escalation": {
      "timeoutMinutes": 60,
      "minTrustScore": 0.5,
      "maxFailures": 3,
      "escalateTo": "bmad-master",
      "autoEscalate": true
    }
  },
  "sessionId": "session-abc"
}
```

#### delegation.accept

Accepts a pending delegation request.

```json
{
  "type": "delegation.accept",
  "payload": { "requestId": "del-123" },
  "sessionId": "session-abc"
}
```

#### delegation.reject

Rejects a pending delegation request.

```json
{
  "type": "delegation.reject",
  "payload": {
    "requestId": "del-123",
    "reason": "Currently at capacity"
  },
  "sessionId": "session-abc"
}
```

---

### Model Routing

#### model.route

Routes a model request based on agent assignment and complexity.

```json
{
  "type": "model.route",
  "payload": {
    "agentId": "backend-dev",
    "taskContent": "Design a PostgreSQL schema",
    "tierOverride": null,
    "maxCost": 1.0,
    "requireVision": false,
    "requireTools": true
  },
  "sessionId": "session-abc"
}
```

#### model.assignments

Requests all agent-to-model assignments.

```json
{
  "type": "model.assignments",
  "payload": {}
}
```

#### model.costs

Requests cost summary.

```json
{
  "type": "model.costs",
  "payload": { "from": "2026-02-28T00:00:00Z", "to": "2026-02-28T23:59:59Z" }
}
```

---

### Voice

#### voice.status

Requests voice service status.

```json
{
  "type": "voice.status",
  "payload": {}
}
```

#### voice.transcribe

Sends audio for speech-to-text transcription.

```json
{
  "type": "voice.transcribe",
  "payload": {
    "audio": "UklGRiQA...",
    "language": "ar"
  },
  "sessionId": "session-abc"
}
```

#### voice.synthesize

Requests text-to-speech synthesis.

```json
{
  "type": "voice.synthesize",
  "payload": {
    "text": "Hello, this is a test",
    "language": "en",
    "voiceId": "voice-123"
  },
  "sessionId": "session-abc"
}
```

#### voice.languages

Requests supported voice languages.

```json
{
  "type": "voice.languages",
  "payload": {}
}
```

---

### Workflow Control

#### workflow.list

Requests available workflow definitions.

```json
{
  "type": "workflow.list",
  "payload": {}
}
```

#### workflow.start

Starts a new workflow instance.

```json
{
  "type": "workflow.start",
  "payload": {
    "definitionName": "full-sdlc",
    "sessionId": "session-abc"
  }
}
```

#### workflow.pause

Pauses a running workflow instance.

```json
{
  "type": "workflow.pause",
  "payload": { "instanceId": "wf-instance-123" },
  "sessionId": "session-abc"
}
```

#### workflow.resume

Resumes a paused workflow instance with optional approval data.

```json
{
  "type": "workflow.resume",
  "payload": {
    "instanceId": "wf-instance-123",
    "approvalData": { "approved": true, "comment": "Approved" }
  },
  "sessionId": "session-abc"
}
```

#### workflow.progress

Requests progress for a workflow instance.

```json
{
  "type": "workflow.progress",
  "payload": { "instanceId": "wf-instance-123" },
  "sessionId": "session-abc"
}
```

#### workflow.cancel

Cancels a running workflow instance.

```json
{
  "type": "workflow.cancel",
  "payload": { "instanceId": "wf-instance-123" },
  "sessionId": "session-abc"
}
```

---

### OpenClaw Protocol

#### openclaw.agent.register

Registers an agent with capabilities in the OpenClaw registry.

```json
{
  "type": "openclaw.agent.register",
  "payload": {
    "agentId": "backend-dev",
    "capabilities": ["backend-development", "api-design"]
  }
}
```

#### openclaw.agent.heartbeat

Sends a heartbeat for an OpenClaw agent.

```json
{
  "type": "openclaw.agent.heartbeat",
  "payload": { "agentId": "backend-dev" }
}
```

#### openclaw.agent.capabilities

Requests capabilities for an agent.

```json
{
  "type": "openclaw.agent.capabilities",
  "payload": { "agentId": "backend-dev" }
}
```

#### openclaw.tool.list

Requests available OpenClaw tools.

```json
{
  "type": "openclaw.tool.list",
  "payload": {}
}
```

#### openclaw.tool.execute

Executes an OpenClaw tool.

```json
{
  "type": "openclaw.tool.execute",
  "payload": {
    "name": "code-executor",
    "input": { "code": "console.log('hello')" },
    "agentId": "backend-dev"
  },
  "sessionId": "session-abc"
}
```

---

### SDK Tool Execution

#### tool.list

Requests tools available to an agent (from the SDK ToolRegistry).

```json
{
  "type": "tool.list",
  "payload": { "agentId": "backend-dev" },
  "sessionId": "session-abc"
}
```

#### tool.execute

Executes an SDK tool. Requires agent identity.

```json
{
  "type": "tool.execute",
  "payload": {
    "name": "code-executor",
    "input": { "code": "console.log('hello')", "language": "javascript" },
    "agentId": "backend-dev",
    "taskId": "task-123"
  },
  "sessionId": "session-abc"
}
```

---

## Server -> Client Events (Raw WebSocket)

### System Events

#### system.welcome

Sent immediately upon connection.

```json
{
  "type": "system.welcome",
  "payload": {
    "clientId": "client-uuid",
    "clientType": "user",
    "agentId": null,
    "serverTime": "2026-02-28T12:00:00.000Z",
    "message": "Connected to ForgeTeam Gateway"
  },
  "timestamp": "2026-02-28T12:00:00.000Z",
  "sessionId": "session-abc"
}
```

#### system.error

Sent when a message cannot be processed.

```json
{
  "type": "system.error",
  "payload": {
    "error": {
      "code": "INVALID_MESSAGE",
      "message": "Failed to parse message. Expected JSON with { type, payload, timestamp?, sessionId? }"
    }
  },
  "timestamp": "2026-02-28T12:00:00.000Z",
  "sessionId": ""
}
```

Error codes: `INVALID_MESSAGE`, `UNKNOWN_MESSAGE_TYPE`, `SESSION_ID_REQUIRED`, `SESSION_NOT_FOUND`, `SESSION_REQUIRED`, `NOT_AGENT`, `TARGET_REQUIRED`, `TASK_ID_REQUIRED`, `TASK_NOT_FOUND`, `TASK_MOVE_PARAMS`, `TASK_ASSIGN_PARAMS`, `REQUEST_ID_REQUIRED`, `ACCEPT_FAILED`, `REJECT_FAILED`, `AUDIO_REQUIRED`, `TEXT_REQUIRED`, `TOOL_NAME_REQUIRED`, `TOOL_NOT_FOUND`, `TOOL_NOT_ALLOWED`, `AGENT_ID_REQUIRED`, `WORKFLOW_NOT_AVAILABLE`, `INVALID_PARAMS`, `UNAUTHENTICATED`, `FORBIDDEN`

#### pong

Response to a `ping` message.

```json
{
  "type": "pong",
  "payload": { "serverTime": "2026-02-28T12:00:00.000Z" },
  "timestamp": "2026-02-28T12:00:00.000Z",
  "sessionId": ""
}
```

### Authentication Events

#### auth.success

Sent upon successful authentication.

```json
{
  "type": "auth.success",
  "payload": { "role": "admin", "agentId": null },
  "timestamp": "2026-02-28T12:00:00.000Z",
  "sessionId": ""
}
```

#### auth.failed

Sent when authentication fails. Connection is closed afterward.

```json
{
  "type": "auth.failed",
  "payload": { "error": "Invalid or expired token" },
  "timestamp": "2026-02-28T12:00:00.000Z",
  "sessionId": ""
}
```

---

### Session Events

#### session.created

Broadcast when a session is created.

```json
{
  "type": "session.created",
  "payload": { "id": "session-abc", "label": "my-project", "state": "active", "agents": [] },
  "timestamp": "2026-02-28T12:00:00.000Z",
  "sessionId": "session-abc"
}
```

#### session.joined

Sent to the client that joined a session.

```json
{
  "type": "session.joined",
  "payload": { /* serialized session */ },
  "sessionId": "session-abc"
}
```

#### session.left

Sent to the client that left a session.

```json
{
  "type": "session.left",
  "payload": { "sessionId": "session-abc" },
  "sessionId": "session-abc"
}
```

#### session.list

Response to a `session.list` request.

```json
{
  "type": "session.list",
  "payload": { "sessions": [ /* session summaries */ ] },
  "sessionId": ""
}
```

#### session.destroyed

Broadcast when a session is destroyed.

```json
{
  "type": "session.destroyed",
  "payload": { "sessionId": "session-abc" },
  "sessionId": "session-abc"
}
```

#### session.state-changed

Broadcast to dashboards when session state changes.

```json
{
  "type": "session.state-changed",
  "payload": { "sessionId": "session-abc", "oldState": "active", "newState": "inactive" },
  "sessionId": "session-abc"
}
```

---

### Chat Events

#### chat.message

Broadcast to session members or routed to specific agents.

```json
{
  "type": "chat.message",
  "payload": {
    "id": "msg-uuid",
    "type": "chat.message",
    "from": "user",
    "to": "broadcast",
    "payload": { "content": "Hello team" },
    "sessionId": "session-abc",
    "timestamp": "2026-02-28T12:00:00.000Z"
  },
  "sessionId": "session-abc"
}
```

---

### Agent Events

#### agent.status

Sent in response to `agent.status` request.

```json
{
  "type": "agent.status",
  "payload": {
    "agentId": "backend-dev",
    "status": "working",
    "currentTaskId": "task-123",
    "sessionId": "session-abc",
    "lastActiveAt": "2026-02-28T12:00:00.000Z",
    "tasksCompleted": 5,
    "tasksFailed": 0
  },
  "sessionId": "session-abc"
}
```

#### agent.list

Response to `agent.list` request.

```json
{
  "type": "agent.list",
  "payload": { "agents": [ /* agent summaries */ ] },
  "sessionId": ""
}
```

#### agent.send.ack

Acknowledgment that a direct message was sent.

```json
{
  "type": "agent.send.ack",
  "payload": { "messageId": "msg-uuid", "to": "backend-dev" },
  "sessionId": "session-abc"
}
```

#### agent.status-changed

Broadcast to dashboards when an agent's status changes.

```json
{
  "type": "agent.status-changed",
  "payload": { "agentId": "backend-dev", "oldStatus": "idle", "newStatus": "working" },
  "sessionId": ""
}
```

#### agent.task-assigned

Broadcast to dashboards when a task is assigned to an agent.

```json
{
  "type": "agent.task-assigned",
  "payload": { "agentId": "backend-dev", "taskId": "task-123" },
  "sessionId": "session-abc"
}
```

#### agent.task-completed

Broadcast to dashboards when an agent completes a task.

```json
{
  "type": "agent.task-completed",
  "payload": { "agentId": "backend-dev", "taskId": "task-123" },
  "sessionId": "session-abc"
}
```

---

### Task Events

#### task.created

Broadcast when a task is created.

```json
{
  "type": "task.created",
  "payload": { /* Task object */ },
  "sessionId": "session-abc"
}
```

#### task.updated

Sent when a task is updated.

```json
{
  "type": "task.updated",
  "payload": { /* updated Task object */ },
  "sessionId": "session-abc"
}
```

#### task.moved

Broadcast when a task moves to a different Kanban column.

```json
{
  "type": "task.moved",
  "payload": { /* Task object with new status */ },
  "sessionId": "session-abc"
}
```

#### task.assigned

Broadcast when a task is assigned to an agent.

```json
{
  "type": "task.assigned",
  "payload": { /* Task object */ },
  "sessionId": "session-abc"
}
```

#### task.list

Response to `task.list` request.

```json
{
  "type": "task.list",
  "payload": { "tasks": [ /* Task[] */ ] },
  "sessionId": "session-abc"
}
```

#### kanban.board

Response to `kanban.board` request.

```json
{
  "type": "kanban.board",
  "payload": {
    "sessionId": "session-abc",
    "columns": [ /* KanbanColumn[] */ ],
    "totalTasks": 12,
    "lastUpdated": "2026-02-28T12:00:00.000Z"
  },
  "sessionId": "session-abc"
}
```

---

### Delegation Events

#### delegation.requested

Broadcast when a delegation request is created.

```json
{
  "type": "delegation.requested",
  "payload": { /* DelegationRequest object */ },
  "sessionId": "session-abc"
}
```

#### delegation.accepted

Broadcast when a delegation is accepted.

```json
{
  "type": "delegation.accepted",
  "payload": { "request": { /* DelegationRequest */ }, "token": { /* DelegationToken */ } },
  "sessionId": "session-abc"
}
```

#### delegation.rejected

Broadcast when a delegation is rejected.

```json
{
  "type": "delegation.rejected",
  "payload": { "request": { /* DelegationRequest */ }, "reason": "Currently at capacity" },
  "sessionId": "session-abc"
}
```

#### delegation.completed

Broadcast when a delegated task is completed.

```json
{
  "type": "delegation.completed",
  "payload": { "request": { /* DelegationRequest */ }, "proof": { /* VerificationProof */ } },
  "sessionId": "session-abc"
}
```

#### delegation.escalated

Broadcast when a delegation is escalated.

```json
{
  "type": "delegation.escalated",
  "payload": { "request": { /* DelegationRequest */ }, "escalateTo": "bmad-master" },
  "sessionId": "session-abc"
}
```

---

### Model Events

#### model.routed

Response to `model.route` request.

```json
{
  "type": "model.routed",
  "payload": {
    "model": { /* ModelConfig */ },
    "reason": "primary",
    "estimatedCost": 0.05,
    "classifiedTier": "balanced"
  },
  "sessionId": "session-abc"
}
```

#### model.assignments

Response to `model.assignments` request.

```json
{
  "type": "model.assignments",
  "payload": { "assignments": { /* agent -> assignment map */ }, "catalog": { /* model catalog */ } },
  "sessionId": ""
}
```

#### model.costs

Response to `model.costs` request.

```json
{
  "type": "model.costs",
  "payload": { /* CostSummary object */ },
  "sessionId": ""
}
```

---

### Voice Events

#### voice.status

Response to `voice.status` request.

```json
{
  "type": "voice.status",
  "payload": { "stt": true, "tts": true },
  "sessionId": ""
}
```

#### voice.transcribed

Response to `voice.transcribe` request. Also broadcast to dashboards.

```json
{
  "type": "voice.transcribed",
  "payload": { "text": "Transcribed text...", "language": "ar", "confidence": 0.95 },
  "sessionId": "session-abc"
}
```

#### voice.synthesized

Response to `voice.synthesize` request. Also broadcast to dashboards (without audio data).

```json
{
  "type": "voice.synthesized",
  "payload": {
    "audio": "UklGRiQA...",
    "durationMs": 2500,
    "language": "en"
  },
  "sessionId": "session-abc"
}
```

#### voice.languages

Response to `voice.languages` request.

```json
{
  "type": "voice.languages",
  "payload": {
    "stt": ["en", "ar", "en-US", "ar-SA"],
    "tts": ["en", "ar", "en-US", "ar-SA"],
    "default": "ar"
  },
  "sessionId": ""
}
```

---

### Workflow Events

#### workflow.list

Response to `workflow.list` request.

```json
{
  "type": "workflow.list",
  "payload": { "workflows": [ /* WorkflowDefinition summaries */ ] },
  "sessionId": ""
}
```

#### workflow.started

Response to `workflow.start` request. Also broadcast to dashboards.

```json
{
  "type": "workflow.started",
  "payload": { /* WorkflowInstance object */ },
  "sessionId": "session-abc"
}
```

#### workflow.paused

Response to `workflow.pause` request.

```json
{
  "type": "workflow.paused",
  "payload": { "instanceId": "wf-instance-123" },
  "sessionId": "session-abc"
}
```

#### workflow.resumed

Response to `workflow.resume` request.

```json
{
  "type": "workflow.resumed",
  "payload": { "instanceId": "wf-instance-123" },
  "sessionId": "session-abc"
}
```

#### workflow.progress

Response to `workflow.progress` request.

```json
{
  "type": "workflow.progress",
  "payload": { /* WorkflowProgress object */ },
  "sessionId": "session-abc"
}
```

#### workflow.cancelled

Response to `workflow.cancel` request.

```json
{
  "type": "workflow.cancelled",
  "payload": { "instanceId": "wf-instance-123" },
  "sessionId": "session-abc"
}
```

#### workflow.phase-changed

Broadcast to dashboards when a workflow moves to a new phase.

```json
{
  "type": "workflow.phase-changed",
  "payload": { "instance": { /* WorkflowInstance */ }, "phase": { /* WorkflowPhase */ } },
  "sessionId": "session-abc"
}
```

#### workflow.step-completed

Broadcast to dashboards when a workflow step completes.

```json
{
  "type": "workflow.step-completed",
  "payload": { "instance": { /* WorkflowInstance */ }, "step": { /* WorkflowStep */ } },
  "sessionId": "session-abc"
}
```

#### workflow.waiting-approval

Broadcast to dashboards when a workflow needs human approval.

```json
{
  "type": "workflow.waiting-approval",
  "payload": { "instance": { /* WorkflowInstance */ }, "approval": { /* ApprovalRequest */ } },
  "sessionId": "session-abc"
}
```

#### workflow.completed

Broadcast to dashboards when a workflow completes.

```json
{
  "type": "workflow.completed",
  "payload": { /* WorkflowInstance object */ },
  "sessionId": "session-abc"
}
```

#### workflow.failed

Broadcast to dashboards when a workflow fails.

```json
{
  "type": "workflow.failed",
  "payload": { "instance": { /* WorkflowInstance */ }, "error": "Error message" },
  "sessionId": "session-abc"
}
```

---

### Trust Events

#### trust.updated

Broadcast to dashboards when an agent's trust score changes.

```json
{
  "type": "trust.updated",
  "payload": { "agentId": "backend-dev", "score": { /* TrustScore object */ } },
  "sessionId": ""
}
```

---

### OpenClaw Events

#### openclaw.agent.registered

Response to `openclaw.agent.register`.

```json
{
  "type": "openclaw.agent.registered",
  "payload": { "agentId": "backend-dev", "success": true },
  "sessionId": ""
}
```

#### openclaw.agent.heartbeat.ack

Response to `openclaw.agent.heartbeat`.

```json
{
  "type": "openclaw.agent.heartbeat.ack",
  "payload": { "agentId": "backend-dev", "timestamp": "2026-02-28T12:00:00.000Z" },
  "sessionId": ""
}
```

#### openclaw.agent.capabilities

Response to `openclaw.agent.capabilities` request.

```json
{
  "type": "openclaw.agent.capabilities",
  "payload": { "agentId": "backend-dev", "capabilities": ["backend-development", "api-design"] },
  "sessionId": ""
}
```

#### openclaw.tool.list

Response to `openclaw.tool.list` request.

```json
{
  "type": "openclaw.tool.list",
  "payload": { "tools": [ /* tool list */ ] },
  "sessionId": ""
}
```

#### openclaw.tool.result

Response to `openclaw.tool.execute` on success.

```json
{
  "type": "openclaw.tool.result",
  "payload": { "success": true, "output": "...", "duration": 150 },
  "sessionId": "session-abc"
}
```

#### openclaw.tool.error

Response to `openclaw.tool.execute` on failure.

```json
{
  "type": "openclaw.tool.error",
  "payload": { "error": "Tool execution failed" },
  "sessionId": "session-abc"
}
```

---

### SDK Tool Events

#### tool.list

Response to `tool.list` request.

```json
{
  "type": "tool.list",
  "payload": {
    "tools": [
      { "name": "code-executor", "description": "Execute code", "category": "execution", "agentWhitelist": ["backend-dev"] }
    ]
  },
  "sessionId": ""
}
```

#### tool.result

Response to `tool.execute` on success.

```json
{
  "type": "tool.result",
  "payload": { "name": "code-executor", "result": { "success": true, "output": "hello\n", "duration": 150 } },
  "sessionId": "session-abc"
}
```

#### tool.error

Response to `tool.execute` on failure.

```json
{
  "type": "tool.error",
  "payload": { "name": "code-executor", "error": "Execution timed out" },
  "sessionId": "session-abc"
}
```

#### tool.executed

Broadcast to dashboards after a tool execution.

```json
{
  "type": "tool.executed",
  "payload": { "agentId": "backend-dev", "tool": "code-executor", "success": true, "duration": 150 },
  "sessionId": "session-abc"
}
```

---

## Socket.IO Events (Dashboard)

Socket.IO connects on path `/socket.io` and uses its own event naming convention. Authentication is handled via `socket.handshake.auth.token` or `socket.handshake.query.token`.

### Server -> Client (Socket.IO)

#### initial_state

Sent immediately on connection with a full state snapshot.

```json
{
  "agents": [ /* agent summaries */ ],
  "tasks": [ /* all tasks */ ],
  "sessions": [ /* all sessions */ ],
  "viadp": { /* VIADP summary */ },
  "health": { "uptime": 3600, "connections": { "total": 5, "users": 2, "agents": 2, "dashboards": 1 } }
}
```

#### agent_status

Emitted when an agent's status changes, a task is assigned, completed, or fails.

```json
{ "agentId": "backend-dev", "oldStatus": "idle", "newStatus": "working" }
```

```json
{ "agentId": "backend-dev", "status": "working", "currentTask": "task-123", "sessionId": "session-abc" }
```

```json
{ "agentId": "backend-dev", "status": "idle", "currentTask": null, "sessionId": "session-abc", "error": "timeout" }
```

#### message

Emitted when an agent message is dispatched (chat, task completion, error responses).

```json
{
  "id": "msg-uuid",
  "type": "chat.response",
  "from": "backend-dev",
  "to": "user",
  "payload": { "content": "Here is my implementation..." },
  "sessionId": "session-abc",
  "timestamp": "2026-02-28T12:00:00.000Z"
}
```

#### task_update

Emitted when a task is created, updated, moved, assigned, completed, or cancelled.

```json
{
  "type": "created",
  "event": { "taskId": "task-123", "sessionId": "session-abc", "currentStatus": "backlog", "triggeredBy": "user" }
}
```

```json
{
  "type": "moved",
  "event": { "taskId": "task-123", "sessionId": "session-abc", "currentStatus": "in-progress" }
}
```

#### session_update

Emitted on session lifecycle events.

```json
{ "type": "created", "session": { /* serialized session */ } }
```

```json
{ "type": "destroyed", "sessionId": "session-abc" }
```

```json
{ "type": "state_changed", "sessionId": "session-abc", "oldState": "active", "newState": "inactive" }
```

```json
{ "type": "agent_joined", "sessionId": "session-abc", "agentId": "backend-dev" }
```

```json
{ "type": "agent_left", "sessionId": "session-abc", "agentId": "backend-dev" }
```

#### viadp_update

Emitted for all VIADP delegation protocol events.

```json
{ "type": "delegation_requested", "data": { /* DelegationRequest */ } }
```

```json
{ "type": "delegation_accepted", "data": { "request": { /* ... */ }, "token": { /* ... */ } } }
```

```json
{ "type": "delegation_rejected", "data": { "request": { /* ... */ }, "reason": "..." } }
```

```json
{ "type": "delegation_completed", "data": { "request": { /* ... */ }, "proof": { /* ... */ } } }
```

```json
{ "type": "delegation_failed", "data": { "request": { /* ... */ }, "error": "..." } }
```

```json
{ "type": "delegation_revoked", "data": { "tokenId": "...", "reason": "..." } }
```

```json
{ "type": "delegation_escalated", "data": { "request": { /* ... */ }, "escalateTo": "bmad-master" } }
```

```json
{ "type": "trust_updated", "data": { "agentId": "backend-dev", "score": { /* TrustScore */ } } }
```

```json
{ "type": "verification_submitted", "data": { /* VerificationProof */ } }
```

```json
{ "type": "verification_passed", "data": { /* VerificationProof */ } }
```

```json
{ "type": "verification_failed", "data": { /* VerificationProof */ } }
```

```json
{ "type": "checkpoint_reached", "data": { "delegationId": "...", "checkpoint": { /* ... */ } } }
```

```json
{ "type": "checkpoint_failed", "data": { "delegationId": "...", "checkpoint": { /* ... */ } } }
```

```json
{ "type": "audit_entry", "data": { /* DelegationAuditEntry */ } }
```

#### workflow_update

Emitted for workflow lifecycle events.

```json
{ "type": "started", "instanceId": "wf-123", "workflowName": "Full SDLC Pipeline" }
```

```json
{ "type": "completed", "instanceId": "wf-123", "workflowName": "Full SDLC Pipeline" }
```

```json
{ "type": "failed", "instanceId": "wf-123", "workflowName": "Full SDLC Pipeline", "error": "Step failed" }
```

```json
{ "type": "phase_changed", "instanceId": "wf-123", "phaseName": "implementation", "displayName": "Implementation" }
```

```json
{ "type": "step_completed", "instanceId": "wf-123", "phaseName": "implementation", "stepName": "build-api" }
```

```json
{ "type": "global_pause", "paused": ["wf-123", "wf-456"] }
```

```json
{ "type": "global_resume", "resumed": ["wf-123", "wf-456"] }
```

```json
{ "type": "instance_paused", "instanceId": "wf-123" }
```

```json
{ "type": "instance_resumed", "instanceId": "wf-123" }
```

#### workflow_progress

Emitted when workflow progress updates.

```json
{
  "instanceId": "wf-123",
  "progress": { "overall": 60, "completedSteps": 12, "totalSteps": 20 }
}
```

#### approval_requested

Emitted when a workflow step requires human approval.

```json
{
  "instanceId": "wf-123",
  "approval": { /* ApprovalRequest object */ }
}
```

#### interrupt_update

Emitted when an agent mentions @human or when interrupts are resolved.

```json
{
  "type": "created",
  "interrupt": {
    "id": "int-123",
    "instanceId": "session-abc",
    "agentId": "qa-architect",
    "agentName": "QA Architect",
    "stepId": "direct-message",
    "type": "human_mention",
    "question": "@human - Need approval on test strategy",
    "context": "Agent QA Architect requested human attention via @human mention",
    "createdAt": "2026-02-28T12:00:00.000Z"
  },
  "timestamp": "2026-02-28T12:00:00.000Z"
}
```

```json
{ "type": "approved", "interruptId": "int-123", "feedback": "Proceed", "timestamp": "..." }
```

```json
{ "type": "rejected", "interruptId": "int-123", "feedback": "Revise approach", "timestamp": "..." }
```

#### escalation_update

Emitted when escalations are reviewed or dismissed.

```json
{ "type": "reviewed", "escalationId": "esc-123", "timestamp": "..." }
```

```json
{ "type": "dismissed", "escalationId": "esc-123", "timestamp": "..." }
```

#### cost.alert / cost.cap_exceeded

Emitted when a cost cap threshold is reached or exceeded.

```json
{
  "type": "cost.alert",
  "payload": { "agentId": "architect", "alertType": "warning", "usage": 40, "cap": 50 },
  "timestamp": "2026-02-28T12:00:00.000Z"
}
```

#### party_mode_selection

Emitted when Party Mode selects agents for a broadcast message.

```json
{
  "sessionId": "session-abc",
  "selections": [
    { "agentId": "architect", "reason": "System design expertise" },
    { "agentId": "backend-dev", "reason": "API implementation" }
  ],
  "correlationId": "msg-uuid"
}
```

---

### Client -> Server (Socket.IO)

#### chat.message

Sends a chat message from the dashboard. Triggers agent responses.

```json
{
  "payload": {
    "to": "backend-dev",
    "content": "Design the attendance schema",
    "correlationId": "corr-123"
  },
  "sessionId": "session-abc"
}
```

When `to` is `"broadcast"`, activates Party Mode (multiple agents respond).

#### workflow:list

Requests available workflow definitions.

**Response event:** `workflow:list`

```json
{ "workflows": [ /* definitions */ ] }
```

#### workflow:start

Starts a workflow.

```json
{ "workflowName": "full-sdlc", "sessionId": "session-abc" }
```

**Response event:** `workflow:started`

```json
{ "instanceId": "wf-123", "workflowName": "full-sdlc" }
```

#### workflow:approve

Approves a workflow waiting for human approval.

```json
{ "instanceId": "wf-123", "comment": "Looks good, proceed" }
```

**Response event:** `workflow:approved`

#### workflow:reject

Rejects a workflow step.

```json
{ "instanceId": "wf-123", "comment": "Needs more tests" }
```

**Response event:** `workflow:rejected`

#### workflow:pause

Pauses a workflow instance.

```json
{ "instanceId": "wf-123" }
```

**Response event:** `workflow:paused`

#### workflow:resume

Resumes a paused workflow instance.

```json
{ "instanceId": "wf-123" }
```

**Response event:** `workflow:resumed`

#### workflow:error

Error response for any workflow Socket.IO command.

```json
{ "error": "workflowName and sessionId are required" }
```
