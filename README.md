# ForgeTeam

Autonomous SDLC agent team powered by a 12-agent pipeline. ForgeTeam orchestrates the full software development lifecycle -- from discovery through deployment -- using AI agents coordinated through the VIADP (Verified Inter-Agent Delegation Protocol).

## Architecture

```
dashboard (Next.js)  <-->  gateway (Node.js API + WebSocket)
                              |
              +---------------+---------------+
              |               |               |
          memory/         viadp/          agents/
     (pgvector + Gemini  (delegation,    (12 SDLC
      RAG + Redis cache)  trust, audit)   agent configs)
              |               |
         PostgreSQL        Redis
         + pgvector        (cache + pub/sub)
```

### Agents

| Agent | Role | Model |
|-------|------|-------|
| bmad-master | Orchestrator / Team Lead | gemini-3.1-pro |
| product-owner | Product Strategy & Prioritization | gemini-3.1-pro |
| business-analyst | Analysis & Documentation | gemini-3.1-pro |
| scrum-master | Process Facilitation | gemini-2.0-flash |
| architect | System Architecture & Design | gemini-3.1-pro |
| ux-designer | User Experience Design | gemini-2.0-flash |
| frontend-dev | Frontend Implementation | claude-sonnet-4.6 |
| backend-dev | Backend Implementation | claude-sonnet-4.6 |
| qa-architect | Quality Assurance & Testing | gemini-2.0-flash |
| devops-engineer | Infrastructure & Deployment | gemini-2.0-flash |
| security-specialist | Security & Compliance | gemini-3.1-pro |
| tech-writer | Technical Documentation | gemini-2.0-flash |

### Key Modules

- **Memory Layer** (`memory/`): Hierarchical memory with Company > Team > Project > Agent > Thread scoping. Backed by pgvector for semantic search, Gemini File Search for RAG, and Redis for caching. Includes auto-summarization and conversation compaction.

- **VIADP Protocol** (`viadp/`): Verified Inter-Agent Delegation Protocol. Handles capability-based delegate matching (multi-objective optimization), Bayesian trust calibration, proof-based verification, circuit breakers for resilience, parallel bidding for critical tasks, and an immutable hash-chain audit log.

- **Dashboard** (`dashboard/`): Next.js web interface with real-time Kanban board, agent status monitoring, workflow visualization, and cost tracking.

- **Gateway** (`gateway/`): Central API server that coordinates agents, manages WebSocket connections, routes tasks, and integrates all modules.

## Quick Start

### Prerequisites

- Docker and Docker Compose
- Node.js 20+
- An API key for Anthropic and/or Google AI

### 1. Environment Setup

```bash
cp .env.example .env
# Edit .env with your API keys
```

### 2. Start with Docker Compose

```bash
cd docker
docker compose up -d
```

This starts:
- **PostgreSQL** (pgvector) on port 5432
- **Redis** on port 6379
- **Qdrant** on port 6333
- **Gateway API** on port 3001
- **Dashboard** on port 3000

### 3. Local Development (without Docker)

Start infrastructure services:

```bash
cd docker
docker compose up -d postgres redis qdrant
```

Then run the gateway and dashboard locally:

```bash
# Terminal 1: Gateway
cd gateway
npm install
npm run dev

# Terminal 2: Dashboard
cd dashboard
npm install
npm run dev
```

### 4. Build Modules

```bash
# Memory module
cd memory && npm install && npm run build

# VIADP module
cd viadp && npm install && npm run build
```

## Project Structure

```
forge-team/
  agents/              # Agent configurations and SOUL prompts
    bmad-master/
    product-owner/
    business-analyst/
    ...
  dashboard/           # Next.js web interface
  docker/              # Docker Compose and Dockerfiles
  gateway/             # API server
  infrastructure/      # SQL schemas and init scripts
  memory/              # Memory layer (pgvector, Gemini RAG, Redis)
    src/
      index.ts
      memory-manager.ts
      gemini-file-search.ts
      vector-store.ts
      summarizer.ts
  shared/              # Shared TypeScript types
    types/
      agent.ts
      task.ts
      memory.ts
      viadp.ts
      workflow.ts
  tools/               # Shared tooling
  viadp/               # VIADP delegation protocol
    src/
      index.ts
      delegation-engine.ts
      trust-manager.ts
      verification.ts
      resilience.ts
      audit-log.ts
  workflows/           # YAML workflow definitions
```

## Database Schema

The PostgreSQL database includes the following tables (auto-initialized via `infrastructure/init.sql`):

- `agents` -- Agent registry with capabilities, status, and trust scores
- `tasks` -- Kanban task board with full lifecycle tracking
- `messages` -- Inter-agent message history
- `workflows` / `workflow_instances` -- SDLC pipeline definitions and execution state
- `memory_entries` -- Hierarchical memory with pgvector embeddings
- `viadp_delegations` -- Delegation tokens and status tracking
- `viadp_audit_log` -- Immutable hash-chain audit trail
- `model_configs` -- Per-agent model configuration
- `cost_tracking` -- Token usage and cost monitoring
- `sessions` -- Session management
- `trust_scores` -- Persistent Bayesian trust state
- `vector_entries` -- Standalone pgvector store

## VIADP Protocol Overview

The delegation flow:

1. **Request** -- An agent identifies a task it cannot handle alone
2. **Match** -- The delegation engine scores all available agents on capability, cost, risk, and diversity
3. **Delegate** -- A scoped delegation token is issued with resource limits and expiry
4. **Monitor** -- Execution is tracked through checkpoints with real-time status updates
5. **Verify** -- Completion is verified through proofs (self-report, peer review, consensus, or proof-based)
6. **Trust Update** -- Bayesian trust scores are updated based on the outcome
7. **Audit** -- Every action is recorded in an immutable hash-chain log

Circuit breakers automatically exclude agents that fail repeatedly. Critical tasks can be run in parallel across multiple agents with consensus-based result selection.

## License

Private -- all rights reserved.
