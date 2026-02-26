-- =============================================================================
-- ForgeTeam Database Initialization
-- PostgreSQL 16 with pgvector extension
-- =============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- =============================================================================
-- Agents
-- =============================================================================
CREATE TABLE IF NOT EXISTS agents (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    role            TEXT NOT NULL,
    description     TEXT DEFAULT '',
    capabilities    JSONB DEFAULT '[]'::jsonb,
    config          JSONB DEFAULT '{}'::jsonb,
    status          TEXT NOT NULL DEFAULT 'idle'
                    CHECK (status IN ('idle', 'working', 'reviewing', 'blocked', 'offline', 'error')),
    trust_score     DOUBLE PRECISION NOT NULL DEFAULT 0.5
                    CHECK (trust_score >= 0.0 AND trust_score <= 1.0),
    current_load    INTEGER NOT NULL DEFAULT 0,
    max_concurrent  INTEGER NOT NULL DEFAULT 3,
    model_family    TEXT DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agents_status ON agents (status);
CREATE INDEX IF NOT EXISTS idx_agents_trust ON agents (trust_score DESC);

-- =============================================================================
-- Tasks
-- =============================================================================
CREATE TABLE IF NOT EXISTS tasks (
    id              TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    title           TEXT NOT NULL,
    description     TEXT DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'backlog'
                    CHECK (status IN ('backlog', 'todo', 'in-progress', 'review', 'done', 'cancelled')),
    assigned_agent  TEXT REFERENCES agents(id) ON DELETE SET NULL,
    workflow_id     TEXT,
    session_id      TEXT,
    kanban_column   TEXT NOT NULL DEFAULT 'backlog',
    priority        TEXT NOT NULL DEFAULT 'medium'
                    CHECK (priority IN ('critical', 'high', 'medium', 'low')),
    complexity      TEXT NOT NULL DEFAULT 'moderate'
                    CHECK (complexity IN ('trivial', 'simple', 'moderate', 'complex', 'critical')),
    parent_task_id  TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    depends_on      JSONB DEFAULT '[]'::jsonb,
    tags            JSONB DEFAULT '[]'::jsonb,
    phase           TEXT DEFAULT '',
    story_points    INTEGER,
    artifacts       JSONB DEFAULT '[]'::jsonb,
    delegation_chain JSONB DEFAULT '[]'::jsonb,
    metadata        JSONB DEFAULT '{}'::jsonb,
    created_by      TEXT DEFAULT 'system',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    due_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks (assigned_agent);
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks (priority);
CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks (session_id);
CREATE INDEX IF NOT EXISTS idx_tasks_workflow ON tasks (workflow_id);
CREATE INDEX IF NOT EXISTS idx_tasks_kanban ON tasks (kanban_column);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks (parent_task_id);
CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks (created_at DESC);

-- =============================================================================
-- Messages
-- =============================================================================
CREATE TABLE IF NOT EXISTS messages (
    id              TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    from_agent      TEXT NOT NULL,
    to_agent        TEXT NOT NULL,
    content         TEXT NOT NULL,
    type            TEXT NOT NULL DEFAULT 'chat.message'
                    CHECK (type IN (
                        'task.assign', 'task.complete', 'task.fail', 'task.progress',
                        'delegation.request', 'delegation.response', 'delegation.revoke',
                        'agent.status', 'agent.heartbeat',
                        'chat.message', 'chat.response',
                        'system.notification', 'system.error',
                        'workflow.step', 'workflow.complete',
                        'review.request', 'review.response'
                    )),
    session_id      TEXT NOT NULL,
    correlation_id  TEXT,
    metadata        JSONB DEFAULT '{}'::jsonb,
    timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages (session_id);
CREATE INDEX IF NOT EXISTS idx_messages_from ON messages (from_agent);
CREATE INDEX IF NOT EXISTS idx_messages_to ON messages (to_agent);
CREATE INDEX IF NOT EXISTS idx_messages_type ON messages (type);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_messages_correlation ON messages (correlation_id);

-- =============================================================================
-- Workflows
-- =============================================================================
CREATE TABLE IF NOT EXISTS workflows (
    id              TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    name            TEXT NOT NULL,
    description     TEXT DEFAULT '',
    yaml_content    TEXT NOT NULL DEFAULT '',
    phases          JSONB DEFAULT '[]'::jsonb,
    config          JSONB DEFAULT '{}'::jsonb,
    created_by      TEXT DEFAULT 'system',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflows_name ON workflows (name);

-- =============================================================================
-- Workflow Instances
-- =============================================================================
CREATE TABLE IF NOT EXISTS workflow_instances (
    id              TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    workflow_id     TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    session_id      TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'not-started'
                    CHECK (status IN ('not-started', 'in-progress', 'completed', 'failed', 'paused')),
    current_phase   TEXT DEFAULT '',
    current_phase_index INTEGER DEFAULT 0,
    state_json      JSONB DEFAULT '{}'::jsonb,
    project_name    TEXT DEFAULT '',
    project_description TEXT DEFAULT '',
    started_at      TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_wf_instances_workflow ON workflow_instances (workflow_id);
CREATE INDEX IF NOT EXISTS idx_wf_instances_session ON workflow_instances (session_id);
CREATE INDEX IF NOT EXISTS idx_wf_instances_status ON workflow_instances (status);

-- =============================================================================
-- Memory Entries
-- =============================================================================
CREATE TABLE IF NOT EXISTS memory_entries (
    id              TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    scope           TEXT NOT NULL DEFAULT 'agent'
                    CHECK (scope IN ('company', 'team', 'project', 'agent', 'thread',
                                      'global', 'session', 'phase', 'task')),
    agent_id        TEXT,
    project_id      TEXT,
    team_id         TEXT,
    thread_id       TEXT,
    content         TEXT NOT NULL,
    embedding       vector(1536),
    metadata        JSONB DEFAULT '{}'::jsonb,
    tags            JSONB DEFAULT '[]'::jsonb,
    importance      DOUBLE PRECISION NOT NULL DEFAULT 0.5
                    CHECK (importance >= 0.0 AND importance <= 1.0),
    access_count    INTEGER NOT NULL DEFAULT 0,
    content_type    TEXT DEFAULT 'conversation',
    created_by      TEXT DEFAULT 'system',
    session_id      TEXT,
    task_id         TEXT,
    phase           TEXT,
    superseded_by   TEXT REFERENCES memory_entries(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_memory_scope ON memory_entries (scope);
CREATE INDEX IF NOT EXISTS idx_memory_agent ON memory_entries (agent_id);
CREATE INDEX IF NOT EXISTS idx_memory_project ON memory_entries (project_id);
CREATE INDEX IF NOT EXISTS idx_memory_team ON memory_entries (team_id);
CREATE INDEX IF NOT EXISTS idx_memory_thread ON memory_entries (thread_id);
CREATE INDEX IF NOT EXISTS idx_memory_importance ON memory_entries (importance DESC);
CREATE INDEX IF NOT EXISTS idx_memory_created ON memory_entries (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_superseded ON memory_entries (superseded_by);
CREATE INDEX IF NOT EXISTS idx_memory_content_type ON memory_entries (content_type);
CREATE INDEX IF NOT EXISTS idx_memory_session ON memory_entries (session_id);
CREATE INDEX IF NOT EXISTS idx_memory_tags ON memory_entries USING gin (tags);
CREATE INDEX IF NOT EXISTS idx_memory_metadata ON memory_entries USING gin (metadata);

-- Vector similarity index (IVFFlat for approximate nearest neighbor)
-- Only create if there are enough rows; otherwise it will be created on first use
-- CREATE INDEX IF NOT EXISTS idx_memory_embedding ON memory_entries USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- =============================================================================
-- VIADP Delegations
-- =============================================================================
CREATE TABLE IF NOT EXISTS viadp_delegations (
    id                  TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    delegator           TEXT NOT NULL,
    delegatee           TEXT NOT NULL,
    task_id             TEXT REFERENCES tasks(id) ON DELETE CASCADE,
    session_id          TEXT,
    status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'accepted', 'rejected', 'in-progress',
                                          'completed', 'failed', 'revoked', 'escalated')),
    trust_score_at_delegation DOUBLE PRECISION DEFAULT 0.5,
    risk_level          TEXT DEFAULT 'medium'
                        CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
    scope               JSONB DEFAULT '{}'::jsonb,
    chain               JSONB DEFAULT '[]'::jsonb,
    verification_status TEXT DEFAULT 'pending'
                        CHECK (verification_status IN ('pending', 'in_review', 'verified',
                                                        'rejected', 'not_required')),
    verification_policy JSONB DEFAULT '{}'::jsonb,
    token_signature     TEXT DEFAULT '',
    expires_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_delegations_delegator ON viadp_delegations (delegator);
CREATE INDEX IF NOT EXISTS idx_delegations_delegatee ON viadp_delegations (delegatee);
CREATE INDEX IF NOT EXISTS idx_delegations_task ON viadp_delegations (task_id);
CREATE INDEX IF NOT EXISTS idx_delegations_status ON viadp_delegations (status);
CREATE INDEX IF NOT EXISTS idx_delegations_session ON viadp_delegations (session_id);
CREATE INDEX IF NOT EXISTS idx_delegations_created ON viadp_delegations (created_at DESC);

-- =============================================================================
-- VIADP Audit Log
-- =============================================================================
CREATE TABLE IF NOT EXISTS viadp_audit_log (
    id              TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    delegation_id   TEXT REFERENCES viadp_delegations(id) ON DELETE CASCADE,
    action          TEXT NOT NULL,
    actor           TEXT NOT NULL DEFAULT 'system',
    from_agent      TEXT DEFAULT '',
    to_agent        TEXT DEFAULT '',
    data            JSONB DEFAULT '{}'::jsonb,
    hash            TEXT NOT NULL DEFAULT '',
    previous_hash   TEXT NOT NULL DEFAULT '',
    sequence_number INTEGER NOT NULL DEFAULT 0,
    timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_delegation ON viadp_audit_log (delegation_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON viadp_audit_log (action);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON viadp_audit_log (actor);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON viadp_audit_log (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_sequence ON viadp_audit_log (sequence_number);

-- =============================================================================
-- Model Configurations
-- =============================================================================
CREATE TABLE IF NOT EXISTS model_configs (
    agent_id        TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
    primary_model   TEXT NOT NULL DEFAULT 'gemini-3.1-pro',
    fallback_models JSONB DEFAULT '["claude-sonnet-4.6"]'::jsonb,
    temperature     DOUBLE PRECISION NOT NULL DEFAULT 0.3
                    CHECK (temperature >= 0.0 AND temperature <= 2.0),
    max_tokens      INTEGER NOT NULL DEFAULT 16384,
    top_p           DOUBLE PRECISION DEFAULT 0.95,
    system_prompt   TEXT DEFAULT '',
    metadata        JSONB DEFAULT '{}'::jsonb,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- Cost Tracking
-- =============================================================================
CREATE TABLE IF NOT EXISTS cost_tracking (
    id              TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    agent_id        TEXT NOT NULL,
    session_id      TEXT,
    task_id         TEXT,
    model_used      TEXT NOT NULL,
    provider        TEXT NOT NULL DEFAULT 'google',
    tokens_in       INTEGER NOT NULL DEFAULT 0,
    tokens_out      INTEGER NOT NULL DEFAULT 0,
    cost_usd        DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    latency_ms      INTEGER DEFAULT 0,
    success         BOOLEAN NOT NULL DEFAULT true,
    metadata        JSONB DEFAULT '{}'::jsonb,
    timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cost_agent ON cost_tracking (agent_id);
CREATE INDEX IF NOT EXISTS idx_cost_session ON cost_tracking (session_id);
CREATE INDEX IF NOT EXISTS idx_cost_model ON cost_tracking (model_used);
CREATE INDEX IF NOT EXISTS idx_cost_timestamp ON cost_tracking (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_cost_provider ON cost_tracking (provider);

-- =============================================================================
-- Sessions
-- =============================================================================
CREATE TABLE IF NOT EXISTS sessions (
    id              TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    name            TEXT DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'paused', 'completed', 'archived')),
    workflow_instance_id TEXT REFERENCES workflow_instances(id) ON DELETE SET NULL,
    metadata        JSONB DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions (status);
CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions (created_at DESC);

-- =============================================================================
-- Trust Scores (persistent Bayesian trust state)
-- =============================================================================
CREATE TABLE IF NOT EXISTS trust_scores (
    agent_id        TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
    score           DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    alpha           DOUBLE PRECISION NOT NULL DEFAULT 2.0,
    beta            DOUBLE PRECISION NOT NULL DEFAULT 2.0,
    successes       INTEGER NOT NULL DEFAULT 0,
    failures        INTEGER NOT NULL DEFAULT 0,
    partials        INTEGER NOT NULL DEFAULT 0,
    domain_scores   JSONB DEFAULT '{}'::jsonb,
    last_task_at    TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- Vector entries (standalone pgvector table for VectorStore)
-- =============================================================================
CREATE TABLE IF NOT EXISTS vector_entries (
    id              TEXT PRIMARY KEY,
    content         TEXT NOT NULL,
    embedding       vector(1536),
    metadata        JSONB DEFAULT '{}'::jsonb,
    namespace       TEXT DEFAULT 'default',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vector_namespace ON vector_entries (namespace);
CREATE INDEX IF NOT EXISTS idx_vector_metadata ON vector_entries USING gin (metadata);

-- =============================================================================
-- Utility functions
-- =============================================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all tables with updated_at
DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOR tbl IN
        SELECT table_name FROM information_schema.columns
        WHERE column_name = 'updated_at'
          AND table_schema = 'public'
    LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS trigger_update_%I ON %I; CREATE TRIGGER trigger_update_%I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()',
            tbl, tbl, tbl, tbl
        );
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- Seed data: Register the 12 ForgeTeam agents
-- =============================================================================
INSERT INTO agents (id, name, role, capabilities, config, status, trust_score) VALUES
    ('bmad-master', 'BMad Master', 'Orchestrator / Team Lead',
     '["task-delegation","sprint-planning","progress-tracking","conflict-resolution","workflow-orchestration"]'::jsonb,
     '{"model":"gemini-3.1-pro","canDelegate":true,"canSpawnSubAgents":true}'::jsonb,
     'idle', 0.5),
    ('product-owner', 'Product Owner', 'Product Strategy & Prioritization',
     '["requirements-gathering","prioritization","user-story-writing","backlog-management","stakeholder-alignment"]'::jsonb,
     '{"model":"gemini-3.1-pro","canDelegate":false}'::jsonb,
     'idle', 0.5),
    ('business-analyst', 'Business Analyst', 'Analysis & Documentation',
     '["requirements-analysis","process-modeling","data-analysis","documentation","gap-analysis"]'::jsonb,
     '{"model":"gemini-3.1-pro","canDelegate":false}'::jsonb,
     'idle', 0.5),
    ('scrum-master', 'Scrum Master', 'Process Facilitation',
     '["sprint-management","impediment-removal","retrospectives","velocity-tracking","ceremony-facilitation"]'::jsonb,
     '{"model":"gemini-2.0-flash","canDelegate":false}'::jsonb,
     'idle', 0.5),
    ('architect', 'Architect', 'System Architecture & Design',
     '["system-design","architecture-review","tech-selection","scalability-planning","api-design"]'::jsonb,
     '{"model":"gemini-3.1-pro","canDelegate":true}'::jsonb,
     'idle', 0.5),
    ('ux-designer', 'UX Designer', 'User Experience Design',
     '["wireframing","prototyping","user-research","accessibility","design-systems"]'::jsonb,
     '{"model":"gemini-2.0-flash","canDelegate":false}'::jsonb,
     'idle', 0.5),
    ('frontend-dev', 'Frontend Developer', 'Frontend Implementation',
     '["react","typescript","css","component-development","state-management","testing"]'::jsonb,
     '{"model":"claude-sonnet-4.6","canDelegate":false}'::jsonb,
     'idle', 0.5),
    ('backend-dev', 'Backend Developer', 'Backend Implementation',
     '["node.js","api-development","database-design","microservices","performance-optimization"]'::jsonb,
     '{"model":"claude-sonnet-4.6","canDelegate":false}'::jsonb,
     'idle', 0.5),
    ('qa-architect', 'QA Architect', 'Quality Assurance & Testing',
     '["test-planning","automation","integration-testing","performance-testing","test-architecture"]'::jsonb,
     '{"model":"gemini-2.0-flash","canDelegate":false}'::jsonb,
     'idle', 0.5),
    ('devops-engineer', 'DevOps Engineer', 'Infrastructure & Deployment',
     '["ci-cd","docker","kubernetes","monitoring","infrastructure-as-code","cloud-deployment"]'::jsonb,
     '{"model":"gemini-2.0-flash","canDelegate":false}'::jsonb,
     'idle', 0.5),
    ('security-specialist', 'Security Specialist', 'Security & Compliance',
     '["security-audit","vulnerability-assessment","compliance","threat-modeling","penetration-testing"]'::jsonb,
     '{"model":"gemini-3.1-pro","canDelegate":false}'::jsonb,
     'idle', 0.5),
    ('tech-writer', 'Tech Writer', 'Technical Documentation',
     '["api-documentation","user-guides","architecture-docs","runbooks","changelog-management"]'::jsonb,
     '{"model":"gemini-2.0-flash","canDelegate":false}'::jsonb,
     'idle', 0.5)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    role = EXCLUDED.role,
    capabilities = EXCLUDED.capabilities,
    config = EXCLUDED.config;

-- Seed model configs for all agents
INSERT INTO model_configs (agent_id, primary_model, fallback_models, temperature, max_tokens) VALUES
    ('bmad-master', 'gemini-3.1-pro', '["claude-sonnet-4.6"]'::jsonb, 0.3, 16384),
    ('product-owner', 'gemini-3.1-pro', '["claude-sonnet-4.6"]'::jsonb, 0.4, 8192),
    ('business-analyst', 'gemini-3.1-pro', '["claude-sonnet-4.6"]'::jsonb, 0.3, 8192),
    ('scrum-master', 'gemini-2.0-flash', '["gemini-3.1-pro"]'::jsonb, 0.3, 4096),
    ('architect', 'gemini-3.1-pro', '["claude-sonnet-4.6"]'::jsonb, 0.2, 16384),
    ('ux-designer', 'gemini-2.0-flash', '["gemini-3.1-pro"]'::jsonb, 0.5, 8192),
    ('frontend-dev', 'claude-sonnet-4.6', '["gemini-3.1-pro"]'::jsonb, 0.2, 16384),
    ('backend-dev', 'claude-sonnet-4.6', '["gemini-3.1-pro"]'::jsonb, 0.2, 16384),
    ('qa-architect', 'gemini-2.0-flash', '["gemini-3.1-pro"]'::jsonb, 0.2, 8192),
    ('devops-engineer', 'gemini-2.0-flash', '["gemini-3.1-pro"]'::jsonb, 0.2, 8192),
    ('security-specialist', 'gemini-3.1-pro', '["claude-sonnet-4.6"]'::jsonb, 0.1, 16384),
    ('tech-writer', 'gemini-2.0-flash', '["gemini-3.1-pro"]'::jsonb, 0.4, 8192)
ON CONFLICT (agent_id) DO UPDATE SET
    primary_model = EXCLUDED.primary_model,
    fallback_models = EXCLUDED.fallback_models,
    temperature = EXCLUDED.temperature,
    max_tokens = EXCLUDED.max_tokens;

-- Initialize trust scores for all agents
INSERT INTO trust_scores (agent_id, score, alpha, beta) VALUES
    ('bmad-master', 0.5, 2.0, 2.0),
    ('product-owner', 0.5, 2.0, 2.0),
    ('business-analyst', 0.5, 2.0, 2.0),
    ('scrum-master', 0.5, 2.0, 2.0),
    ('architect', 0.5, 2.0, 2.0),
    ('ux-designer', 0.5, 2.0, 2.0),
    ('frontend-dev', 0.5, 2.0, 2.0),
    ('backend-dev', 0.5, 2.0, 2.0),
    ('qa-architect', 0.5, 2.0, 2.0),
    ('devops-engineer', 0.5, 2.0, 2.0),
    ('security-specialist', 0.5, 2.0, 2.0),
    ('tech-writer', 0.5, 2.0, 2.0)
ON CONFLICT (agent_id) DO NOTHING;
