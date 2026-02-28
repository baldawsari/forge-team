# ForgeTeam API Reference

Base URL: `http://localhost:18789`

All responses include a `timestamp` field (ISO 8601) unless otherwise noted.

---

## Health & System

### GET /health

Returns system health status including all subsystem states.

**Response:**

```json
{
  "status": "healthy",
  "timestamp": "2026-02-28T12:00:00.000Z",
  "uptime": 3600.123,
  "version": "0.1.0",
  "services": {
    "sessions": { "active": 2, "total": 5 },
    "agents": { "total": 12, "idle": 8, "working": 3, "offline": 1 },
    "connections": {
      "total": 5,
      "users": 2,
      "agents": 2,
      "dashboards": 1,
      "connectedAgents": ["backend-dev", "frontend-dev"]
    },
    "voice": { "stt": true, "tts": true },
    "viadp": { /* VIADPEngine summary */ },
    "costs": { "totalCost": 1.23, "totalRequests": 45 }
  }
}
```

### GET /api/health/providers

Checks the health of AI model providers (Anthropic, Google).

**Response (200 or 503):**

```json
{
  "providers": {
    "anthropic": { "available": true, "latencyMs": 120 },
    "google": { "available": true, "latencyMs": 95 }
  }
}
```

### GET /api/system/sovereignty

Returns data sovereignty and compliance configuration.

**Response:**

```json
{
  "deploymentRegion": "riyadh",
  "dataResidency": "sa",
  "externalApiEndpoints": [
    { "service": "Anthropic", "endpoint": "api.anthropic.com", "purpose": "LLM inference (Claude models)", "dataFlow": "outbound-prompts-inbound-completions" },
    { "service": "Google AI", "endpoint": "generativelanguage.googleapis.com", "purpose": "LLM inference (Gemini models)", "dataFlow": "outbound-prompts-inbound-completions" },
    { "service": "ElevenLabs", "endpoint": "api.elevenlabs.io", "purpose": "Text-to-Speech", "dataFlow": "outbound-text-inbound-audio" },
    { "service": "OpenAI Whisper", "endpoint": "api.openai.com", "purpose": "Speech-to-Text", "dataFlow": "outbound-audio-inbound-text" }
  ],
  "internalServices": [
    { "service": "PostgreSQL", "host": "postgres:5432", "dataStored": "All structured data, memory, audit logs" },
    { "service": "Redis", "host": "redis:6379", "dataStored": "Ephemeral cache, pub/sub messages" },
    { "service": "MinIO", "host": "minio:9000", "dataStored": "Task artifacts, documents" }
  ],
  "compliance": {
    "dataAtRest": "Stored in deployment region only",
    "dataInTransit": "TLS 1.3 for all external API calls",
    "llmDataPolicy": "Prompts sent to external LLM APIs; no persistent storage by providers (per API ToS)"
  },
  "timestamp": "2026-02-28T12:00:00.000Z"
}
```

### GET /api/connections

Returns WebSocket connection statistics.

**Response:**

```json
{
  "stats": {
    "total": 5,
    "users": 2,
    "agents": 2,
    "dashboards": 1,
    "connectedAgents": ["backend-dev", "frontend-dev"]
  },
  "timestamp": "2026-02-28T12:00:00.000Z"
}
```

---

## Authentication

### POST /api/auth/token

Generates a JWT authentication token. In non-development environments, requires the `x-admin-secret` header.

**Request Body:**

```json
{
  "role": "admin",
  "agentId": "backend-dev"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `role` | `AuthRole` | Yes | One of: `admin`, `user`, `agent`, `dashboard-viewer` |
| `agentId` | `AgentId` | No | Required when role is `agent` |

**Response:**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "expiresIn": "24h"
}
```

### GET /api/auth/verify

Verifies a JWT token from the `Authorization: Bearer <token>` header.

**Response (200):**

```json
{
  "valid": true,
  "payload": { "sub": "admin", "role": "admin", "agentId": null }
}
```

**Response (401):**

```json
{ "error": "Invalid token" }
```

---

## Agents

### GET /api/agents

Lists all agents with their current status summary.

**Response:**

```json
{
  "agents": [
    {
      "id": "backend-dev",
      "name": "Backend Developer",
      "role": "backend-dev",
      "status": "working",
      "currentTaskId": "task-123",
      "capabilities": ["backend-development", "api-design"],
      "defaultModelTier": "balanced"
    }
  ],
  "timestamp": "2026-02-28T12:00:00.000Z"
}
```

### GET /api/agents/:agentId

Returns full configuration and runtime state for a specific agent.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `agentId` | `AgentId` | Agent identifier (e.g., `backend-dev`, `architect`) |

**Response (200):**

```json
{
  "config": {
    "id": "backend-dev",
    "name": "Backend Developer",
    "role": "backend-dev",
    "description": "Full-stack backend engineer...",
    "capabilities": ["backend-development", "api-design"],
    "phases": ["implementation"],
    "systemPrompt": "...",
    "maxConcurrentTasks": 3,
    "canDelegateTo": ["qa-architect"],
    "receivesFrom": ["architect"],
    "defaultModelTier": "balanced"
  },
  "state": {
    "agentId": "backend-dev",
    "status": "working",
    "currentTaskId": "task-123",
    "sessionId": "session-abc",
    "lastActiveAt": "2026-02-28T12:00:00.000Z",
    "tasksCompleted": 5,
    "tasksFailed": 0
  },
  "timestamp": "2026-02-28T12:00:00.000Z"
}
```

**Response (404):**

```json
{ "error": "Agent not found" }
```

### POST /api/agents/:agentId/takeover

Takes over an agent for human-in-the-loop control.

**Response:**

```json
{ "success": true, "agentId": "backend-dev" }
```

### POST /api/agents/:agentId/release

Releases a previously taken-over agent back to autonomous mode.

**Response:**

```json
{ "success": true, "agentId": "backend-dev" }
```

### POST /api/agents/:agentId/human-message

Sends a message as a human proxy through a taken-over agent.

**Request Body:**

```json
{
  "content": "The API design looks good, proceed with implementation",
  "taskId": "task-123"
}
```

**Response:**

```json
{ "success": true, "messageId": "msg-uuid-123" }
```

---

## Sessions

### GET /api/sessions

Lists all sessions.

**Response:**

```json
{
  "sessions": [
    {
      "id": "session-abc",
      "label": "riyadh-attendance-tracker",
      "state": "active",
      "agents": ["backend-dev", "frontend-dev"],
      "messageCount": 24,
      "createdAt": "2026-02-28T10:00:00.000Z"
    }
  ],
  "timestamp": "2026-02-28T12:00:00.000Z"
}
```

### GET /api/sessions/:sessionId

Returns details for a specific session.

**Response (200):**

```json
{
  "session": {
    "id": "session-abc",
    "label": "riyadh-attendance-tracker",
    "state": "active",
    "agents": ["backend-dev", "frontend-dev"],
    "messageCount": 24,
    "createdAt": "2026-02-28T10:00:00.000Z"
  },
  "timestamp": "2026-02-28T12:00:00.000Z"
}
```

**Response (404):**

```json
{ "error": "Session not found" }
```

### POST /api/sessions

Creates a new session.

**Request Body:**

```json
{
  "label": "my-project",
  "userId": "user-123",
  "metadata": { "project": "My Project", "description": "..." }
}
```

All fields are optional.

**Response (201):**

```json
{
  "session": {
    "id": "session-new-uuid",
    "label": "my-project",
    "state": "active",
    "agents": [],
    "messageCount": 0,
    "createdAt": "2026-02-28T12:00:00.000Z"
  },
  "timestamp": "2026-02-28T12:00:00.000Z"
}
```

---

## Tasks

### GET /api/tasks

Lists tasks, optionally filtered by query parameters.

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `sessionId` | `string` | Filter by session |
| `status` | `TaskStatus` | Filter by status: `backlog`, `todo`, `in-progress`, `review`, `done`, `cancelled` |
| `assignedTo` | `AgentId` | Filter by assigned agent |

**Response:**

```json
{
  "tasks": [
    {
      "id": "task-123",
      "title": "Build employee check-in/out with geofencing",
      "description": "...",
      "status": "in-progress",
      "priority": "critical",
      "complexity": "complex",
      "assignedTo": "backend-dev",
      "createdBy": "user",
      "parentTaskId": null,
      "subtaskIds": [],
      "dependsOn": [],
      "blocks": [],
      "tags": ["geofencing", "check-in", "gps"],
      "phase": "implementation",
      "sessionId": "session-abc",
      "storyPoints": 8,
      "artifacts": [],
      "delegationChain": [],
      "createdAt": "2026-02-28T10:00:00.000Z",
      "updatedAt": "2026-02-28T11:30:00.000Z",
      "startedAt": "2026-02-28T10:30:00.000Z",
      "completedAt": null,
      "dueAt": null,
      "metadata": {}
    }
  ],
  "timestamp": "2026-02-28T12:00:00.000Z"
}
```

### POST /api/tasks

Creates a new task.

**Request Body:**

```json
{
  "sessionId": "session-abc",
  "title": "Implement geofencing API",
  "description": "Build GPS-based geofencing for employee check-in",
  "priority": "high",
  "complexity": "complex",
  "assignedTo": "backend-dev",
  "parentTaskId": null,
  "dependsOn": [],
  "tags": ["geofencing", "api"],
  "phase": "implementation",
  "storyPoints": 8,
  "dueAt": null,
  "metadata": {}
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionId` | `string` | **Yes** | Session to create the task in |
| `title` | `string` | **Yes** | Task title |
| `description` | `string` | **Yes** | Task description |
| `priority` | `TaskPriority` | No | `critical`, `high`, `medium`, `low` |
| `complexity` | `TaskComplexity` | No | `trivial`, `simple`, `moderate`, `complex`, `critical` |
| `assignedTo` | `AgentId` | No | Agent to assign |
| `parentTaskId` | `string` | No | Parent task for subtasks |
| `dependsOn` | `string[]` | No | Task IDs this depends on |
| `tags` | `string[]` | No | Tags for categorization |
| `phase` | `string` | No | SDLC phase |
| `storyPoints` | `number` | No | Estimated effort |
| `dueAt` | `string` | No | ISO 8601 deadline |
| `metadata` | `object` | No | Free-form metadata |

**Response (201):**

```json
{
  "task": { /* Task object */ },
  "timestamp": "2026-02-28T12:00:00.000Z"
}
```

### GET /api/tasks/stats/:sessionId

Returns task statistics for a session.

**Response:**

```json
{
  "stats": { /* task count breakdowns by status, priority, etc. */ },
  "timestamp": "2026-02-28T12:00:00.000Z"
}
```

### POST /api/tasks/:taskId/start

Starts a task: auto-assigns an agent if needed, moves it to `in-progress`, sends the task to the agent for processing, and moves it to `review` when done.

**Response:**

```json
{
  "task": { /* updated Task object */ },
  "agentId": "backend-dev",
  "response": "Here is my implementation plan...",
  "model": "gemini-3.1-pro",
  "timestamp": "2026-02-28T12:00:00.000Z"
}
```

### POST /api/tasks/:taskId/approve

Approves a task in `review` status, moving it to `done`.

**Response:**

```json
{
  "task": { /* updated Task object */ },
  "status": "done",
  "timestamp": "2026-02-28T12:00:00.000Z"
}
```

### POST /api/tasks/:taskId/reject

Rejects a task in `review` status. Sends feedback to the agent and gets a revised response.

**Request Body:**

```json
{
  "feedback": "Please add error handling for edge cases"
}
```

**Response:**

```json
{
  "task": { /* updated Task object */ },
  "feedback": "Please add error handling for edge cases",
  "response": "I have revised my work...",
  "timestamp": "2026-02-28T12:00:00.000Z"
}
```

### POST /api/tasks/:taskId/assign

Assigns a task to a specific agent.

**Request Body:**

```json
{
  "agentId": "backend-dev"
}
```

**Response:**

```json
{
  "task": { /* updated Task object */ },
  "assignedTo": "backend-dev",
  "timestamp": "2026-02-28T12:00:00.000Z"
}
```

### GET /api/kanban/:sessionId

Returns the full Kanban board for a session, organized by columns.

**Response:**

```json
{
  "board": {
    "sessionId": "session-abc",
    "columns": [
      { "id": "backlog", "label": "Backlog", "tasks": [ /* Task[] */ ], "wipLimit": null },
      { "id": "todo", "label": "To Do", "tasks": [ /* Task[] */ ], "wipLimit": null },
      { "id": "in-progress", "label": "In Progress", "tasks": [ /* Task[] */ ], "wipLimit": null },
      { "id": "review", "label": "Review", "tasks": [ /* Task[] */ ], "wipLimit": null },
      { "id": "done", "label": "Done", "tasks": [ /* Task[] */ ], "wipLimit": null }
    ],
    "totalTasks": 12,
    "lastUpdated": "2026-02-28T12:00:00.000Z"
  },
  "timestamp": "2026-02-28T12:00:00.000Z"
}
```

---

## Models & Cost

### GET /api/models/assignments

Returns model assignments for all agents and the full model catalog.

**Response:**

```json
{
  "assignments": {
    "architect": { "agentId": "architect", "primary": "claude-opus-4-6", "fallback": "gemini-3.1-pro" },
    "backend-dev": { "agentId": "backend-dev", "primary": "gemini-3.1-pro", "fallback": "gemini-flash-3" }
  },
  "catalog": {
    "claude-opus-4-6": {
      "id": "claude-opus-4-6",
      "provider": "anthropic",
      "tier": "premium",
      "name": "Claude Opus 4.6",
      "maxContextTokens": 200000,
      "maxOutputTokens": 32768,
      "inputCostPer1M": 15.0,
      "outputCostPer1M": 75.0,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "avgLatencyMs": 1500
    }
  },
  "timestamp": "2026-02-28T12:00:00.000Z"
}
```

### GET /api/models/costs

Returns cost summary, optionally filtered by time range.

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `from` | `string` | ISO 8601 start date |
| `to` | `string` | ISO 8601 end date |

**Response:**

```json
{
  "summary": {
    "totalCost": 12.34,
    "perAgent": { "architect": 5.20, "backend-dev": 3.14 },
    "perModel": { "claude-opus-4-6": 8.00, "gemini-3.1-pro": 4.34 },
    "perProvider": { "anthropic": 8.00, "google": 4.34 },
    "perTier": { "premium": 8.00, "balanced": 4.34, "fast": 0 },
    "totalInputTokens": 150000,
    "totalOutputTokens": 45000,
    "totalRequests": 45,
    "from": "2026-02-28T00:00:00.000Z",
    "to": "2026-02-28T12:00:00.000Z"
  },
  "timestamp": "2026-02-28T12:00:00.000Z"
}
```

### POST /api/models/route

Routes a model request based on agent assignment, complexity classification, and constraints.

**Request Body:**

```json
{
  "agentId": "backend-dev",
  "taskContent": "Design a PostgreSQL schema for attendance tracking",
  "tierOverride": null,
  "maxCost": 1.0,
  "requireVision": false,
  "requireTools": true,
  "sessionId": "session-abc"
}
```

**Response:**

```json
{
  "result": {
    "model": { /* ModelConfig object */ },
    "reason": "primary",
    "estimatedCost": 0.05,
    "classifiedTier": "balanced"
  },
  "timestamp": "2026-02-28T12:00:00.000Z"
}
```

### GET /api/costs/summary

Returns the overall cost summary across all agents.

**Response:**

```json
{
  "summary": { /* CostSummary object */ },
  "timestamp": "2026-02-28T12:00:00.000Z"
}
```

### GET /api/costs/agent/:agentId

Returns cost cap status and recent cost records for a specific agent.

**Response:**

```json
{
  "agentId": "backend-dev",
  "capStatus": { "withinCap": true, "dailyUsed": 2.50, "dailyCap": 50 },
  "recentRecords": [ /* last 20 CostRecord objects */ ],
  "timestamp": "2026-02-28T12:00:00.000Z"
}
```

### PUT /api/costs/caps/:agentId

Sets cost caps for a specific agent.

**Request Body:**

```json
{
  "dailyCapUsd": 50,
  "weeklyCapUsd": 200,
  "alertThreshold": 0.8
}
```

**Response:**

```json
{
  "agentId": "backend-dev",
  "cap": { "dailyCapUsd": 50, "weeklyCapUsd": 200, "alertThreshold": 0.8 },
  "timestamp": "2026-02-28T12:00:00.000Z"
}
```

### GET /api/costs/caps

Returns cost caps for all agents.

**Response:**

```json
{
  "caps": {
    "architect": { "dailyCapUsd": 50, "weeklyCapUsd": 200, "alertThreshold": 0.8 },
    "backend-dev": { "dailyCapUsd": 50, "weeklyCapUsd": 200, "alertThreshold": 0.8 }
  },
  "timestamp": "2026-02-28T12:00:00.000Z"
}
```

---

## VIADP (Delegation Protocol)

### GET /api/viadp/summary

Returns a summary of the VIADP delegation engine state.

**Response:**

```json
{
  "summary": { /* VIADPEngine summary object */ },
  "timestamp": "2026-02-28T12:00:00.000Z"
}
```

### GET /api/viadp/delegations

Lists delegation requests, optionally filtered.

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | `DelegationStatus` | Filter by status: `pending`, `accepted`, `rejected`, `in-progress`, `completed`, `failed`, `revoked`, `escalated` |
| `from` | `AgentId` | Filter by delegator |
| `to` | `AgentId` | Filter by delegate |

**Response:**

```json
{
  "delegations": [
    {
      "id": "del-123",
      "from": "architect",
      "to": "backend-dev",
      "taskId": "task-456",
      "sessionId": "session-abc",
      "status": "in-progress",
      "reason": "Backend implementation needed",
      "capabilityScore": 0.92,
      "riskLevel": "low",
      "riskFactors": [],
      "proposedScope": {
        "allowedActions": ["implement", "test"],
        "resourceLimits": { "maxTokens": 100000 },
        "canRedelegate": false,
        "allowedArtifactTypes": ["code", "test"]
      },
      "createdAt": "2026-02-28T10:00:00.000Z"
    }
  ],
  "timestamp": "2026-02-28T12:00:00.000Z"
}
```

### GET /api/viadp/trust

Returns global trust scores for all agents.

**Response:**

```json
{
  "trustScores": {
    "backend-dev": { "agentId": "backend-dev", "evaluator": "system", "score": 0.95, "successes": 12, "failures": 1 }
  },
  "timestamp": "2026-02-28T12:00:00.000Z"
}
```

### GET /api/viadp/trust/:agentId

Returns all trust scores for a specific agent.

**Response:**

```json
{
  "agentId": "backend-dev",
  "scores": [ /* TrustScore[] */ ],
  "timestamp": "2026-02-28T12:00:00.000Z"
}
```

### GET /api/viadp/audit

Returns the VIADP audit trail, optionally filtered.

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `actor` | `AgentId` | Filter by actor |
| `action` | `DelegationAuditAction` | Filter by action type |
| `since` | `string` | ISO 8601 timestamp to filter from |

**Response:**

```json
{
  "entries": [
    {
      "id": "audit-789",
      "timestamp": "2026-02-28T11:00:00.000Z",
      "delegationId": "del-123",
      "action": "request.created",
      "actor": "architect",
      "details": "Delegation requested from architect to backend-dev",
      "metadata": {}
    }
  ],
  "total": 1,
  "timestamp": "2026-02-28T12:00:00.000Z"
}
```

---

## Voice

### GET /api/voice/status

Returns voice service status (STT/TTS availability).

**Response:**

```json
{
  "status": { "stt": true, "tts": true },
  "timestamp": "2026-02-28T12:00:00.000Z"
}
```

### POST /api/voice/transcribe

Transcribes audio to text (Speech-to-Text).

**Request Body:**

```json
{
  "audioBase64": "UklGRiQA...",
  "language": "ar"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `audioBase64` | `string` | **Yes** | Base64-encoded audio data |
| `language` | `string` | No | Language code (default: `en`). Supports: `en`, `ar`, `en-US`, `ar-SA` |

**Response:**

```json
{
  "result": { "text": "Transcribed text...", "language": "ar", "confidence": 0.95 },
  "timestamp": "2026-02-28T12:00:00.000Z"
}
```

### POST /api/voice/synthesize

Synthesizes text to audio (Text-to-Speech).

**Request Body:**

```json
{
  "text": "Hello, this is a test",
  "language": "en"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `text` | `string` | **Yes** | Text to synthesize |
| `language` | `string` | No | Language code (default: `en`) |

**Response:**

```json
{
  "result": { "audioBase64": "UklGRiQA...", "durationMs": 2500 },
  "timestamp": "2026-02-28T12:00:00.000Z"
}
```

---

## Workflows

### GET /api/workflows

Lists all available workflow definitions (loaded from YAML files).

**Response:**

```json
{
  "workflows": [
    { "name": "Full SDLC Pipeline", "version": "1.0", "description": "Complete software development lifecycle" },
    { "name": "Bug Fix Sprint", "version": "1.0", "description": "Rapid bug diagnosis and fix workflow" }
  ],
  "timestamp": "2026-02-28T12:00:00.000Z"
}
```

### GET /api/workflows/:name

Returns a specific workflow definition by name. The `:name` parameter maps to the YAML filename without extension.

**Response (200):**

```json
{
  "workflow": {
    "name": "Full SDLC Pipeline",
    "version": "1.0",
    "description": "Complete software development lifecycle",
    "phases": [ /* YAMLPhaseDefinition[] */ ],
    "transitions": { "discovery->requirements": "auto", "requirements->architecture": "requires_approval" }
  },
  "timestamp": "2026-02-28T12:00:00.000Z"
}
```

**Response (404):**

```json
{ "error": "Workflow not found" }
```

### GET /api/workflows/status

Returns the status of all active workflow instances.

**Response:**

```json
{
  "workflows": [ /* array of workflow instance status summaries */ ]
}
```

### POST /api/workflows/start

Starts a new workflow instance.

**Request Body:**

```json
{
  "definitionName": "full-sdlc",
  "sessionId": "session-abc"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `definitionName` | `string` | **Yes** | Name of the workflow definition |
| `sessionId` | `string` | **Yes** | Session to run the workflow in |

**Response:**

```json
{
  "instance": { /* WorkflowInstance object */ },
  "timestamp": "2026-02-28T12:00:00.000Z"
}
```

### POST /api/workflows/:instanceId/pause

Pauses a running workflow instance.

**Response:**

```json
{
  "status": "paused",
  "timestamp": "2026-02-28T12:00:00.000Z"
}
```

### POST /api/workflows/:instanceId/resume

Resumes a paused workflow instance. Optionally pass approval data.

**Request Body (optional):**

```json
{
  "approvalData": { "approved": true, "comment": "Looks good" }
}
```

**Response:**

```json
{
  "status": "resumed",
  "timestamp": "2026-02-28T12:00:00.000Z"
}
```

### POST /api/workflows/:instanceId/cancel

Cancels a running workflow instance.

**Response:**

```json
{
  "status": "cancelled",
  "timestamp": "2026-02-28T12:00:00.000Z"
}
```

### GET /api/workflows/:instanceId/progress

Returns progress tracking for a workflow instance.

**Response:**

```json
{
  "progress": {
    "overall": 45,
    "phases": {
      "discovery": { "percentage": 100, "completedSteps": 3, "totalSteps": 3, "status": "completed" },
      "requirements": { "percentage": 50, "completedSteps": 1, "totalSteps": 2, "status": "active" }
    },
    "totalSteps": 20,
    "completedSteps": 4,
    "failedSteps": 0,
    "activeSteps": ["requirements.gather-user-stories"],
    "waitingApproval": []
  },
  "timestamp": "2026-02-28T12:00:00.000Z"
}
```

### POST /api/workflows/pause-all

Pauses all running workflow instances.

**Response:**

```json
{
  "success": true,
  "paused": ["instance-1", "instance-2"]
}
```

### POST /api/workflows/resume-all

Resumes all paused workflow instances.

**Response:**

```json
{
  "success": true,
  "resumed": ["instance-1", "instance-2"]
}
```

### GET /api/workflow-instances

Lists all workflow instances, optionally filtered by session.

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `sessionId` | `string` | Filter by session |

**Response:**

```json
{
  "instances": [ /* WorkflowInstance[] */ ],
  "timestamp": "2026-02-28T12:00:00.000Z"
}
```

### GET /api/workflow-instances/:id

Returns a specific workflow instance by ID.

**Response (200):**

```json
{
  "instance": { /* WorkflowInstance object */ },
  "timestamp": "2026-02-28T12:00:00.000Z"
}
```

**Response (404):**

```json
{ "error": "Workflow instance not found" }
```

---

## Human-in-the-Loop

### GET /api/interrupts

Returns all pending interrupt requests (awaiting human input).

**Response:**

```json
{
  "interrupts": [
    {
      "id": "int-123",
      "instanceId": "session-abc",
      "agentId": "qa-architect",
      "agentName": "QA Architect",
      "stepId": "direct-message",
      "type": "human_mention",
      "question": "@human - Need approval on test strategy",
      "context": "Agent QA Architect requested human attention via @human mention",
      "createdAt": "2026-02-28T11:00:00.000Z"
    }
  ]
}
```

### GET /api/interrupts/all

Returns all interrupts (including resolved ones).

**Response:**

```json
{
  "interrupts": [ /* all interrupt records */ ]
}
```

### POST /api/interrupts/:id/resolve

Resolves an interrupt by approving or rejecting it.

**Request Body:**

```json
{
  "approved": true,
  "feedback": "Proceed with the proposed test strategy"
}
```

**Response:**

```json
{ "success": true }
```

### GET /api/escalations

Lists agent escalation requests.

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | `string` | Filter by status |

**Response:**

```json
{
  "escalations": [ /* escalation records */ ]
}
```

### POST /api/escalations/:id/review

Reviews an escalation with feedback.

**Request Body:**

```json
{
  "feedback": "Use retry logic instead of failing"
}
```

**Response:**

```json
{ "success": true }
```

### POST /api/escalations/:id/dismiss

Dismisses an escalation.

**Response:**

```json
{ "success": true }
```

---

## Artifacts

### POST /api/artifacts/upload

Uploads an artifact file to object storage (MinIO).

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sessionId` | `string` | **Yes** | Session ID |
| `taskId` | `string` | **Yes** | Task ID |
| `filename` | `string` | **Yes** | Filename for the artifact |

**Headers:**

- `Content-Type`: MIME type of the file (default: `application/octet-stream`)

**Body:** Raw file bytes (limit: 50MB)

**Response:**

```json
{ "key": "session-abc/task-123/report.pdf", "size": 102400 }
```

### GET /api/artifacts/download

Downloads an artifact from object storage.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `key` | `string` | **Yes** | Object key (e.g., `session-abc/task-123/report.pdf`) |

**Response:** Raw file bytes with appropriate `Content-Type` header.

### GET /api/artifacts/list

Lists artifacts, filtered by session and/or task.

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `sessionId` | `string` | Filter by session |
| `taskId` | `string` | Filter by task |

**Response:**

```json
{
  "objects": [
    { "key": "session-abc/task-123/report.pdf", "size": 102400, "lastModified": "2026-02-28T12:00:00.000Z" }
  ],
  "timestamp": "2026-02-28T12:00:00.000Z"
}
```

---

## Memory

### GET /api/memory/search

Searches the memory system using semantic search.

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `q` | `string` | Search query text |
| `scope` | `MemoryScope` | Filter by scope: `company`, `team`, `project`, `agent`, `thread` |
| `agentId` | `string` | Filter by agent |
| `limit` | `number` | Max results (default: 20) |

**Response:**

```json
{
  "results": [
    {
      "entry": {
        "id": "mem-123",
        "content": "Architecture decision: use Supabase for auth",
        "scope": "project",
        "contentType": "decision",
        "createdBy": "architect",
        "tags": ["architecture", "auth"],
        "importance": 0.9,
        "createdAt": "2026-02-28T10:00:00.000Z"
      },
      "relevanceScore": 0.87,
      "matchedOn": ["semantic", "tag"]
    }
  ],
  "total": 1
}
```

### POST /api/memory/store

Stores a new memory entry.

**Request Body:**

```json
{
  "scope": "project",
  "content": "Decision: use PostgreSQL with pgvector for embeddings",
  "metadata": { "category": "tech-stack" },
  "agentId": "architect",
  "projectId": "proj-123",
  "tags": ["database", "embeddings"],
  "importance": 0.8
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `scope` | `MemoryScope` | **Yes** | `company`, `team`, `project`, `agent`, `thread` |
| `content` | `string` | **Yes** | Memory content |
| `metadata` | `object` | No | Structured metadata |
| `agentId` | `string` | No | Associated agent |
| `projectId` | `string` | No | Associated project |
| `teamId` | `string` | No | Associated team |
| `threadId` | `string` | No | Associated thread |
| `tags` | `string[]` | No | Tags for filtering |
| `importance` | `number` | No | Importance score 0.0-1.0 |

**Response:**

```json
{
  "entry": { /* MemoryEntry object */ }
}
```

### GET /api/memory/stats

Returns memory system statistics grouped by agent and scope.

**Response:**

```json
{
  "stats": [
    { "agent_id": "architect", "scope": "project", "entry_count": 15, "total_chars": 12345, "last_updated": "2026-02-28T12:00:00.000Z" }
  ]
}
```

---

## Tools & Sandboxes

### GET /api/tools

Lists all registered SDK tools.

**Response:**

```json
{
  "tools": [
    { "name": "code-executor", "description": "Execute code in a sandboxed environment", "category": "execution", "agentWhitelist": ["backend-dev", "frontend-dev"] }
  ]
}
```

### GET /api/tools/:agentId

Lists tools available to a specific agent.

**Response:**

```json
{
  "agentId": "backend-dev",
  "tools": [
    { "name": "code-executor", "description": "Execute code in a sandboxed environment", "category": "execution" }
  ]
}
```

### GET /api/sandboxes

Lists all active sandboxes.

**Response:**

```json
{
  "sandboxes": [ /* active sandbox records */ ]
}
```

---

## OpenClaw

### GET /api/openclaw/agents

Lists all agents registered in the OpenClaw registry with their capabilities.

**Response:**

```json
{
  "agents": [ /* agent capability records */ ],
  "timestamp": "2026-02-28T12:00:00.000Z"
}
```

### GET /api/openclaw/tools

Lists all OpenClaw tools.

**Response:**

```json
{
  "tools": [ /* tool records */ ],
  "timestamp": "2026-02-28T12:00:00.000Z"
}
```

### POST /api/openclaw/tools/:name/execute

Executes an OpenClaw tool by name.

**Request Body:**

```json
{
  "input": { "code": "console.log('hello')" },
  "sessionId": "session-abc",
  "agentId": "backend-dev"
}
```

**Response:**

```json
{ "success": true, "output": "hello\n", "duration": 150 }
```

---

## Audit

### GET /api/audit

Returns audit log entries with pagination and filtering.

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `from` | `string` | ISO 8601 start date |
| `to` | `string` | ISO 8601 end date |
| `type` | `string` | Filter by message type |
| `clientId` | `string` | Filter by client ID |
| `limit` | `number` | Page size (default: 100) |
| `offset` | `number` | Page offset (default: 0) |

**Response:**

```json
{
  "entries": [ /* audit log entries */ ],
  "total": 500
}
```

### GET /api/audit/verify

Verifies the integrity of the audit log chain.

**Response:**

```json
{ "valid": true, "entriesChecked": 500, "errors": [] }
```

---

## Seed / Demo

### POST /api/seed

Creates realistic demo data (session, tasks, agent statuses, messages) for dashboard testing. Can be called multiple times (creates additional data each time).

**Response (201):**

```json
{
  "success": true,
  "created": { "session": "session-uuid", "tasks": 12, "messages": 8 },
  "timestamp": "2026-02-28T12:00:00.000Z"
}
```

---

## Type Reference

### AgentId

```
"bmad-master" | "product-owner" | "business-analyst" | "scrum-master" |
"architect" | "ux-designer" | "frontend-dev" | "backend-dev" |
"qa-architect" | "devops-engineer" | "security-specialist" | "tech-writer"
```

### TaskStatus

```
"backlog" | "todo" | "in-progress" | "review" | "done" | "cancelled"
```

### TaskPriority

```
"critical" | "high" | "medium" | "low"
```

### TaskComplexity

```
"trivial" | "simple" | "moderate" | "complex" | "critical"
```

### ModelProvider

```
"anthropic" | "google"
```

### ModelTier

```
"premium" | "balanced" | "fast"
```

### ModelId

```
"claude-opus-4-6" | "claude-sonnet-4-6" | "claude-haiku-4-5" |
"gemini-3.1-pro" | "gemini-flash-3"
```

### DelegationStatus

```
"pending" | "accepted" | "rejected" | "in-progress" | "completed" |
"failed" | "revoked" | "escalated"
```

### MemoryScope

```
"company" | "team" | "project" | "agent" | "thread"
```
