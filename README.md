# ForgeTeam

> Autonomous 12-agent SDLC platform powered by BMAD-METHOD + VIADP protocol

Orchestrates the full software development lifecycle — from discovery through deployment — using AI agents coordinated through the Verified Inter-Agent Delegation Protocol (VIADP).

## Architecture

```mermaid
graph TB
    User([User / Product Owner])
    Dashboard[Dashboard<br/>Next.js 15 + Tailwind<br/>Arabic RTL]
    Gateway[Gateway<br/>Node.js + Express + WebSocket<br/>Port 18789]

    subgraph Agents["12 BMAD Agents"]
        BM[BMad Master<br/>gemini-3.1-pro]
        PO[Product Owner<br/>gemini-3.1-pro]
        BA[Business Analyst<br/>gemini-3.1-pro]
        SM[Scrum Master<br/>gemini-flash-3]
        AR[Architect<br/>claude-opus-4-6]
        UX[UX Designer<br/>gemini-3.1-pro]
        FE[Frontend Dev<br/>gemini-3.1-pro]
        BE[Backend Dev<br/>claude-opus-4-6]
        QA[QA Architect<br/>claude-opus-4-6]
        DO[DevOps<br/>gemini-3.1-pro]
        SE[Security<br/>claude-opus-4-6]
        TW[Tech Writer<br/>claude-sonnet-4-6]
    end

    subgraph Services["Supporting Services"]
        Memory[Memory Layer<br/>pgvector + Gemini RAG<br/>+ Redis Cache]
        VIADP[VIADP Protocol<br/>Delegation + Trust<br/>+ Audit Log]
        Workflow[Workflow Engine<br/>YAML State Machine]
        Voice[Voice Pipeline<br/>Whisper STT<br/>ElevenLabs TTS]
        ModelRouter[Model Router<br/>Complexity-based<br/>Fallback Chains]
    end

    subgraph Storage["Data Layer"]
        PG[(PostgreSQL 16<br/>+ pgvector)]
        Redis[(Redis 7<br/>Cache + Pub/Sub)]
        MinIO[(MinIO<br/>Object Storage)]
    end

    User --> Dashboard
    Dashboard <-->|WebSocket + REST| Gateway
    Gateway --> Agents
    Gateway --> Services
    Memory --> PG
    Memory --> Redis
    VIADP --> PG
    Gateway --> Storage
```

## Agent Model Assignments

| # | Agent | Role | Primary Model | Fallback Model | Tier |
|---|-------|------|---------------|----------------|------|
| 1 | bmad-master | Orchestrator / Team Lead | gemini-3.1-pro | claude-sonnet-4-6 | Balanced |
| 2 | product-owner | Requirements & Prioritization | gemini-3.1-pro | claude-sonnet-4-6 | Balanced |
| 3 | business-analyst | Research & Analysis | gemini-3.1-pro | claude-sonnet-4-6 | Balanced |
| 4 | scrum-master | Agile Coordination | gemini-flash-3 | claude-haiku-4-5 | Fast |
| 5 | architect | System Design | claude-opus-4-6 | gemini-3.1-pro | Premium |
| 6 | ux-designer | User Experience | gemini-3.1-pro | claude-sonnet-4-6 | Balanced |
| 7 | frontend-dev | Frontend Code | gemini-3.1-pro | claude-sonnet-4-6 | Balanced |
| 8 | backend-dev | Backend & APIs | claude-opus-4-6 | claude-sonnet-4-6 | Premium |
| 9 | qa-architect | Testing & QA | claude-opus-4-6 | claude-sonnet-4-6 | Premium |
| 10 | devops-engineer | CI/CD & Infrastructure | gemini-3.1-pro | claude-sonnet-4-6 | Balanced |
| 11 | security-specialist | Security & Compliance | claude-opus-4-6 | gemini-3.1-pro | Premium |
| 12 | tech-writer | Documentation | claude-sonnet-4-6 | gemini-3.1-pro | Balanced |

> Only Anthropic and Google models are used. No GPT or Grok models.

## Key Modules

- **Gateway** (`gateway/`) -- Central API server (Node.js + Express + WebSocket on port 18789). Coordinates all agents, manages sessions and tasks, routes AI model requests with complexity-based selection and fallback chains, integrates the VIADP delegation engine, runs the LangGraph-backed workflow engine, and serves the REST + WebSocket API consumed by the dashboard. Includes voice pipeline (Whisper STT / ElevenLabs TTS), audit middleware, RBAC, and party mode.

- **Dashboard** (`dashboard/`) -- Next.js 15 web interface with Tailwind CSS. Features real-time Kanban board, agent status monitoring, workflow visualization, cost tracking, and message feed. Defaults to Arabic RTL layout with language toggle.

- **Memory** (`memory/`) -- Hierarchical memory layer with five scopes: Company > Team > Project > Agent > Thread. Backed by pgvector for semantic similarity search, Gemini File Search for RAG, and Redis for caching. Includes auto-summarization and conversation compaction to keep context windows efficient.

- **VIADP** (`viadp/`) -- Verified Inter-Agent Delegation Protocol. Handles capability-based delegate matching (multi-objective optimization), Bayesian trust calibration, proof-based verification, circuit breakers for resilience, parallel bidding for critical tasks, execution monitoring, and an immutable hash-chain audit log.

- **Workflows** (`workflows/`) -- 35 YAML workflow blueprints defining SDLC pipelines as state machines. Core workflows include full-sdlc, bug-fix, feature-sprint, security-review, code-review, incident-response, and more. Each workflow defines phases, steps, agent assignments, approval gates, and transitions. Executed by the LangGraph-backed WorkflowExecutor with Postgres checkpoint persistence.

- **Shared** (`shared/`) -- Common TypeScript type definitions used across all modules: agent, task, memory, VIADP, workflow, and model types.

## Installation and Quick Start

### Prerequisites

- Docker and Docker Compose
- Node.js 22+
- API keys for Anthropic (`ANTHROPIC_API_KEY`) and Google AI (`GOOGLE_AI_API_KEY`)

### Docker Compose Quick Start

```bash
# 1. Clone and configure
cp .env.example .env
# Edit .env with your API keys

# 2. Start all services
cd docker
docker compose up -d
```

This starts:

- **Gateway API** on port 18789
- **Dashboard** on port 3000
- **PostgreSQL 16** (pgvector) on port 5432
- **Redis 7** on port 6379
- **Qdrant** on ports 6333/6334
- **MinIO** on ports 9000 (API) / 9001 (Console)

### Local Development (without Docker)

Start only infrastructure services via Docker:

```bash
cd docker
docker compose up -d postgres redis qdrant minio
```

Then build and run the application locally:

```bash
# Install all workspace dependencies from the project root
npm install

# Build shared types
cd shared && npm run build && cd ..

# Build memory module
cd memory && npm run build && cd ..

# Build VIADP module
cd viadp && npm run build && cd ..

# Terminal 1: Start the Gateway
cd gateway
npm run dev

# Terminal 2: Start the Dashboard
cd dashboard
npm run dev
```

## Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `GATEWAY_PORT` | `18789` | Gateway HTTP + WebSocket port |
| `GATEWAY_HOST` | `0.0.0.0` | Gateway bind address |
| `DATABASE_URL` | `postgresql://forgeteam:forgeteam_secret@localhost:5432/forgeteam` | PostgreSQL connection string |
| `REDIS_URL` | `redis://:forgeteam_redis_secret@localhost:6379` | Redis connection string |
| `ANTHROPIC_API_KEY` | -- | Anthropic API key (required) |
| `GOOGLE_AI_API_KEY` | -- | Google AI API key (required) |
| `ELEVENLABS_API_KEY` | -- | ElevenLabs TTS API key (optional, for voice) |
| `WHISPER_API_KEY` | -- | Whisper STT API key (optional, for voice) |
| `MINIO_ENDPOINT` | `minio:9000` | MinIO S3-compatible object storage endpoint |
| `MINIO_ACCESS_KEY` | `forgeteam-admin` | MinIO access key |
| `MINIO_SECRET_KEY` | `forgeteam-secret` | MinIO secret key |
| `MINIO_BUCKET` | `forgeteam-artifacts` | MinIO bucket for artifacts |
| `DEPLOYMENT_REGION` | `riyadh` | Deployment region identifier |
| `NODE_ENV` | `development` | Node.js environment |

## Project Structure

```
forge-team/
  agents/                        # Agent configurations and SOUL.md prompts
    bmad-master/                 #   SOUL.md + config.json per agent
    product-owner/
    business-analyst/
    scrum-master/
    architect/
    ux-designer/
    frontend-dev/
    backend-dev/
    qa-architect/
    devops-engineer/
    security-specialist/
    tech-writer/
    index.ts                     #   Agent registry loader
    communication.ts             #   Inter-agent communication patterns
  dashboard/                     # Next.js 15 web interface
    src/                         #   App router, components, hooks
    public/                      #   Static assets
    next.config.ts
  docker/                        # Docker infrastructure
    docker-compose.yml           #   All services (Gateway, Dashboard, PG, Redis, Qdrant, MinIO)
    gateway.Dockerfile
    dashboard.Dockerfile
  docs/                          # Extended documentation
  gateway/                       # Central API server
    src/
      index.ts                   #   Express + WebSocket entry point
      server.ts                  #   GatewayServer class
      agent-manager.ts           #   Agent lifecycle management
      agent-runner.ts            #   Agent execution runtime
      model-router.ts            #   AI model selection + cost tracking
      session-manager.ts         #   Session lifecycle
      task-manager.ts            #   Kanban task CRUD
      viadp-engine.ts            #   VIADP delegation integration
      workflow-engine.ts         #   LangGraph-backed workflow executor
      voice-handler.ts           #   Whisper STT + ElevenLabs TTS
      party-mode.ts              #   Party mode engine
      storage.ts                 #   MinIO object storage client
      audit-middleware.ts        #   Request audit logging
      auth.ts                    #   Authentication
      rbac.ts                    #   Role-based access control
      db.ts                      #   Database connection pool
      openclaw/                  #   OpenClaw agent registry + message bus
      langgraph/                 #   LangGraph state graph + checkpoint saver
      langgraph-nodes/           #   LangGraph node implementations
      tools/                     #   Agent tool definitions
      __tests__/                 #   Unit tests
  infrastructure/                # Database initialization
    init.sql                     #   Full PostgreSQL schema + seed data
  memory/                        # Memory layer module
    src/
      index.ts                   #   Module exports
      memory-manager.ts          #   Hierarchical memory CRUD + compaction
      gemini-file-search.ts      #   Gemini File Search RAG integration
      vector-store.ts            #   pgvector similarity search
      summarizer.ts              #   Content summarization
      __tests__/                 #   Unit tests
  shared/                        # Shared TypeScript types
    types/
      index.ts
      agent.ts                   #   AgentId, AgentConfig, AgentStatus
      task.ts                    #   Task, CreateTaskInput, KanbanColumn
      memory.ts                  #   MemoryScope, MemoryEntry
      models.ts                  #   ModelId, ModelConfig, ModelTier
      viadp.ts                   #   Delegation, TrustScore, AuditEntry
      workflow.ts                #   WorkflowDefinition, WorkflowInstance
  tools/                         # Shared tooling
    src/
  viadp/                         # VIADP delegation protocol module
    src/
      index.ts                   #   Module exports
      delegation-engine.ts       #   Multi-objective delegate matching
      trust-manager.ts           #   Trust score management
      trust-calibration.ts       #   Bayesian trust calibration
      verification.ts            #   Proof-based result verification
      resilience.ts              #   Circuit breakers + retry logic
      execution-monitor.ts       #   Real-time execution tracking
      assessment.ts              #   Delegation assessment
      audit-log.ts               #   Immutable hash-chain audit log
      __tests__/                 #   Unit tests
  workflows/                     # YAML workflow definitions (35 blueprints)
    full-sdlc.yaml               #   Complete SDLC pipeline
    bug-fix.yaml                 #   Bug fix workflow
    feature-sprint.yaml          #   Feature sprint workflow
    security-review.yaml         #   Security review workflow
    code-review.yaml             #   Code review workflow
    incident-response.yaml       #   Incident response workflow
    ...                          #   + 29 more specialized workflows
  tests/                         # Integration, E2E, load, and stress tests
    e2e/
    integration/
    load/
    stress/
    playwright.config.ts
  package.json                   #   npm workspaces root
  vitest.config.ts               #   Vitest test configuration
```

## Database Schema

The PostgreSQL 16 database (with pgvector extension) is auto-initialized via `infrastructure/init.sql`. Artifacts are stored in MinIO (S3-compatible object storage).

| Table | Description |
|-------|-------------|
| `agents` | Agent registry with capabilities, status, trust scores, and model family |
| `tasks` | Kanban task board with full lifecycle tracking, delegation chains, and artifact references (MinIO) |
| `messages` | Inter-agent message history with correlation IDs |
| `workflows` | SDLC pipeline definitions (YAML content stored) |
| `workflow_instances` | Workflow execution state, current phase, and project metadata |
| `workflow_checkpoints` | LangGraph checkpoint persistence for pause/resume |
| `memory_entries` | Hierarchical memory with pgvector embeddings (1536-dim) and scope filtering |
| `viadp_delegations` | Delegation tokens with trust scores, risk levels, scope, and verification status |
| `viadp_audit_log` | Immutable hash-chain audit trail (INSERT-only, UPDATE/DELETE blocked by PostgreSQL rules) |
| `audit_log` | General WebSocket message audit log with hash chain |
| `model_configs` | Per-agent model configuration with cost caps and temperature settings |
| `cost_tracking` | Token usage and cost monitoring per agent/session/task |
| `sessions` | Session management with workflow instance linking |
| `trust_scores` | Persistent Bayesian trust state (alpha/beta parameters, domain scores) |
| `vector_entries` | Standalone pgvector store for VectorStore module |
| `viadp_reputation` | Economic self-regulation: reputation scores, bonds, and heat penalties |

## VIADP Protocol Overview

The Verified Inter-Agent Delegation Protocol (VIADP) governs how agents delegate tasks to each other with trust, verification, and auditability.

**Delegation Flow:**

1. **Request** -- An agent identifies a task it cannot handle alone
2. **Match** -- The delegation engine scores all available agents on capability, cost, risk, and diversity (multi-objective optimization)
3. **Delegate** -- A scoped delegation token is issued with resource limits and expiry
4. **Monitor** -- Execution is tracked through checkpoints with real-time status updates
5. **Verify** -- Completion is verified through proofs (self-report, peer review, consensus, or proof-based)
6. **Trust Update** -- Bayesian trust scores are updated based on the outcome
7. **Audit** -- Every action is recorded in an immutable hash-chain log

Circuit breakers automatically exclude agents that fail repeatedly. Critical tasks can be run in parallel across multiple agents with consensus-based result selection.

See [docs/VIADP-SPEC.md](docs/VIADP-SPEC.md) for the full specification.

## Architecture Diagrams

### Workflow State Machine

```mermaid
stateDiagram-v2
    [*] --> Requirements
    Requirements --> Design: auto (after approval)
    Design --> Development: requires_approval
    Development --> Testing: auto
    Testing --> Deployment: requires_approval
    Deployment --> Documentation: auto
    Documentation --> [*]

    state Requirements {
        [*] --> gather_requirements
        gather_requirements --> market_analysis: parallel
        market_analysis --> [*]: checkpoint
    }

    state Design {
        [*] --> system_architecture
        system_architecture --> ui_design: parallel
        ui_design --> [*]: checkpoint
    }

    state Development {
        [*] --> frontend_implementation
        [*] --> backend_implementation
        frontend_implementation --> integration
        backend_implementation --> integration
        integration --> [*]: checkpoint
    }
```

### Memory Hierarchy

```mermaid
graph TB
    Company[Company KB<br/>Shared across all teams] --> Team[Team Memory<br/>Per-team context]
    Team --> Project[Project Memory<br/>Per-project decisions]
    Project --> Agent[Agent Memory<br/>Per-agent experience]
    Agent --> Thread[Thread Memory<br/>Per-conversation context]

    style Company fill:#1a365d
    style Team fill:#2a4365
    style Project fill:#2c5282
    style Agent fill:#2b6cb0
    style Thread fill:#3182ce
```

### Agent Communication Patterns

```mermaid
graph LR
    User([User]) -->|text/voice| Gateway
    Gateway -->|dispatch| BM[BMad Master]
    BM -->|delegate| AR[Architect]
    BM -->|delegate| PO[Product Owner]
    AR -->|sub-delegate| BE[Backend Dev]
    AR -->|sub-delegate| FE[Frontend Dev]
    BE -->|review request| QA[QA Architect]
    QA -->|security review| SE[Security]
    SE -->|report| BM
    BM -->|status update| SM[Scrum Master]
    BM -->|documentation| TW[Tech Writer]
```

## Development Workflow

```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Run integration tests
npm run test:integration

# Run E2E tests
npm run test:e2e

# Build all modules
npm run build

# Lint
npm run lint

# Type check
npm run typecheck
```

## License

Private -- all rights reserved.
