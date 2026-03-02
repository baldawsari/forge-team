# Database Schema vs Code Audit Report

**Project:** ForgeTeam (BMAD-Claw Edition with VIADP)
**Audit Date:** 2026-03-01
**Schema File:** `/Users/bandar/Documents/AreebPro/forge-team/infrastructure/init.sql`
**Scope:** All SQL queries in `gateway/src/`, `memory/src/`, and `viadp/src/` compared against `init.sql`

---

## 1. Complete Schema Catalog from init.sql

### 1.1 Table: `agents`
| Column | Type | Constraints |
|--------|------|-------------|
| id | TEXT | PRIMARY KEY |
| name | TEXT | NOT NULL |
| role | TEXT | NOT NULL |
| description | TEXT | DEFAULT '' |
| capabilities | JSONB | DEFAULT '[]' |
| config | JSONB | DEFAULT '{}' |
| status | TEXT | NOT NULL DEFAULT 'idle', CHECK IN ('idle','working','reviewing','blocked','offline','error') |
| trust_score | DOUBLE PRECISION | NOT NULL DEFAULT 0.5, CHECK 0.0-1.0 |
| current_load | INTEGER | NOT NULL DEFAULT 0 |
| max_concurrent | INTEGER | NOT NULL DEFAULT 3 |
| model_family | TEXT | DEFAULT '' |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |

**Indexes:** `idx_agents_status(status)`, `idx_agents_trust(trust_score DESC)`

---

### 1.2 Table: `tasks`
| Column | Type | Constraints |
|--------|------|-------------|
| id | TEXT | PRIMARY KEY DEFAULT uuid_generate_v4()::text |
| title | TEXT | NOT NULL |
| description | TEXT | DEFAULT '' |
| status | TEXT | NOT NULL DEFAULT 'backlog', CHECK IN ('backlog','todo','in-progress','review','done','cancelled') |
| assigned_agent | TEXT | REFERENCES agents(id) ON DELETE SET NULL |
| workflow_id | TEXT | |
| session_id | TEXT | |
| kanban_column | TEXT | NOT NULL DEFAULT 'backlog' |
| priority | TEXT | NOT NULL DEFAULT 'medium', CHECK IN ('critical','high','medium','low') |
| complexity | TEXT | NOT NULL DEFAULT 'moderate', CHECK IN ('trivial','simple','moderate','complex','critical') |
| parent_task_id | TEXT | REFERENCES tasks(id) ON DELETE SET NULL |
| depends_on | JSONB | DEFAULT '[]' |
| tags | JSONB | DEFAULT '[]' |
| phase | TEXT | DEFAULT '' |
| story_points | INTEGER | |
| artifacts | JSONB | DEFAULT '[]' |
| delegation_chain | JSONB | DEFAULT '[]' |
| metadata | JSONB | DEFAULT '{}' |
| created_by | TEXT | DEFAULT 'system' |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |
| started_at | TIMESTAMPTZ | |
| completed_at | TIMESTAMPTZ | |
| due_at | TIMESTAMPTZ | |

**Indexes:** `idx_tasks_status`, `idx_tasks_assigned`, `idx_tasks_priority`, `idx_tasks_session`, `idx_tasks_workflow`, `idx_tasks_kanban`, `idx_tasks_parent`, `idx_tasks_created`

---

### 1.3 Table: `messages`
| Column | Type | Constraints |
|--------|------|-------------|
| id | TEXT | PRIMARY KEY DEFAULT uuid_generate_v4()::text |
| from_agent | TEXT | NOT NULL |
| to_agent | TEXT | NOT NULL |
| content | TEXT | NOT NULL |
| type | TEXT | NOT NULL DEFAULT 'chat.message', CHECK IN (16 values) |
| session_id | TEXT | NOT NULL |
| correlation_id | TEXT | |
| metadata | JSONB | DEFAULT '{}' |
| timestamp | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |

**Indexes:** `idx_messages_session`, `idx_messages_from`, `idx_messages_to`, `idx_messages_type`, `idx_messages_timestamp`, `idx_messages_correlation`

---

### 1.4 Table: `workflows`
| Column | Type | Constraints |
|--------|------|-------------|
| id | TEXT | PRIMARY KEY DEFAULT uuid_generate_v4()::text |
| name | TEXT | NOT NULL |
| description | TEXT | DEFAULT '' |
| yaml_content | TEXT | NOT NULL DEFAULT '' |
| phases | JSONB | DEFAULT '[]' |
| config | JSONB | DEFAULT '{}' |
| created_by | TEXT | DEFAULT 'system' |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |

**Indexes:** `idx_workflows_name`

---

### 1.5 Table: `workflow_instances`
| Column | Type | Constraints |
|--------|------|-------------|
| id | TEXT | PRIMARY KEY DEFAULT uuid_generate_v4()::text |
| workflow_id | TEXT | NOT NULL REFERENCES workflows(id) ON DELETE CASCADE |
| session_id | TEXT | NOT NULL |
| status | TEXT | NOT NULL DEFAULT 'not-started', CHECK IN ('not-started','in-progress','completed','failed','paused') |
| current_phase | TEXT | DEFAULT '' |
| current_phase_index | INTEGER | DEFAULT 0 |
| state_json | JSONB | DEFAULT '{}' |
| project_name | TEXT | DEFAULT '' |
| project_description | TEXT | DEFAULT '' |
| started_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |
| completed_at | TIMESTAMPTZ | |

**Indexes:** `idx_wf_instances_workflow`, `idx_wf_instances_session`, `idx_wf_instances_status`

---

### 1.6 Table: `memory_entries`
| Column | Type | Constraints |
|--------|------|-------------|
| id | TEXT | PRIMARY KEY DEFAULT uuid_generate_v4()::text |
| scope | TEXT | NOT NULL DEFAULT 'agent', CHECK IN ('company','team','project','agent','thread','global','session','phase','task') |
| agent_id | TEXT | |
| project_id | TEXT | |
| team_id | TEXT | |
| thread_id | TEXT | |
| content | TEXT | NOT NULL |
| embedding | vector(1536) | |
| metadata | JSONB | DEFAULT '{}' |
| tags | JSONB | DEFAULT '[]' |
| importance | DOUBLE PRECISION | NOT NULL DEFAULT 0.5, CHECK 0.0-1.0 |
| access_count | INTEGER | NOT NULL DEFAULT 0 |
| content_type | TEXT | DEFAULT 'conversation' |
| created_by | TEXT | DEFAULT 'system' |
| session_id | TEXT | |
| task_id | TEXT | |
| phase | TEXT | |
| superseded_by | TEXT | REFERENCES memory_entries(id) ON DELETE SET NULL |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |
| expires_at | TIMESTAMPTZ | |

**Indexes:** `idx_memory_scope`, `idx_memory_agent`, `idx_memory_project`, `idx_memory_team`, `idx_memory_thread`, `idx_memory_importance`, `idx_memory_created`, `idx_memory_superseded`, `idx_memory_content_type`, `idx_memory_session`, `idx_memory_tags (GIN)`, `idx_memory_metadata (GIN)`

---

### 1.7 Table: `viadp_delegations`
| Column | Type | Constraints |
|--------|------|-------------|
| id | TEXT | PRIMARY KEY DEFAULT uuid_generate_v4()::text |
| delegator | TEXT | NOT NULL |
| delegatee | TEXT | NOT NULL |
| task_id | TEXT | REFERENCES tasks(id) ON DELETE CASCADE |
| session_id | TEXT | |
| status | TEXT | NOT NULL DEFAULT 'pending', CHECK IN ('pending','accepted','rejected','in-progress','completed','failed','revoked','escalated') |
| trust_score_at_delegation | DOUBLE PRECISION | DEFAULT 0.5 |
| risk_level | TEXT | DEFAULT 'medium', CHECK IN ('low','medium','high','critical') |
| scope | JSONB | DEFAULT '{}' |
| chain | JSONB | DEFAULT '[]' |
| verification_status | TEXT | DEFAULT 'pending', CHECK IN ('pending','in_review','verified','rejected','not_required') |
| verification_policy | JSONB | DEFAULT '{}' |
| token_signature | TEXT | DEFAULT '' |
| expires_at | TIMESTAMPTZ | |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |
| completed_at | TIMESTAMPTZ | |

**Indexes:** `idx_delegations_delegator`, `idx_delegations_delegatee`, `idx_delegations_task`, `idx_delegations_status`, `idx_delegations_session`, `idx_delegations_created`, `idx_delegations_status_created` (composite)

---

### 1.8 Table: `viadp_audit_log`
| Column | Type | Constraints |
|--------|------|-------------|
| id | TEXT | PRIMARY KEY DEFAULT uuid_generate_v4()::text |
| delegation_id | TEXT | REFERENCES viadp_delegations(id) ON DELETE CASCADE |
| action | TEXT | NOT NULL |
| actor | TEXT | NOT NULL DEFAULT 'system' |
| from_agent | TEXT | DEFAULT '' |
| to_agent | TEXT | DEFAULT '' |
| data | JSONB | DEFAULT '{}' |
| hash | TEXT | NOT NULL DEFAULT '' |
| previous_hash | TEXT | NOT NULL DEFAULT '' |
| sequence_number | INTEGER | NOT NULL DEFAULT 0 |
| timestamp | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |

**Indexes:** `idx_audit_delegation`, `idx_audit_action`, `idx_audit_actor`, `idx_audit_timestamp`, `idx_audit_sequence`, `idx_audit_delegation_timestamp` (composite)
**Rules:** INSERT-only (UPDATE/DELETE blocked), auto-sequence trigger

---

### 1.9 Table: `audit_log`
| Column | Type | Constraints |
|--------|------|-------------|
| id | TEXT | PRIMARY KEY DEFAULT uuid_generate_v4()::text |
| sequence_number | INTEGER | NOT NULL |
| hash | TEXT | NOT NULL |
| previous_hash | TEXT | NOT NULL |
| client_id | TEXT | NOT NULL |
| client_type | TEXT | NOT NULL |
| message_type | TEXT | NOT NULL |
| direction | TEXT | NOT NULL, CHECK IN ('inbound','outbound') |
| session_id | TEXT | DEFAULT '' |
| agent_id | TEXT | DEFAULT '' |
| timestamp | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |

**Indexes:** `idx_general_audit_seq`, `idx_general_audit_type`, `idx_general_audit_client`, `idx_general_audit_timestamp`
**Rules:** INSERT-only (UPDATE/DELETE blocked)

---

### 1.10 Table: `model_configs`
| Column | Type | Constraints |
|--------|------|-------------|
| agent_id | TEXT | PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE |
| primary_model | TEXT | NOT NULL DEFAULT 'gemini-3.1-pro' |
| fallback_models | JSONB | DEFAULT '["claude-sonnet-4.6"]' |
| temperature | DOUBLE PRECISION | NOT NULL DEFAULT 0.3, CHECK 0.0-2.0 |
| max_tokens | INTEGER | NOT NULL DEFAULT 16384 |
| top_p | DOUBLE PRECISION | DEFAULT 0.95 |
| system_prompt | TEXT | DEFAULT '' |
| metadata | JSONB | DEFAULT '{}' |
| daily_cap_usd | DOUBLE PRECISION | NOT NULL DEFAULT 50.0 |
| weekly_cap_usd | DOUBLE PRECISION | NOT NULL DEFAULT 200.0 |
| alert_threshold | DOUBLE PRECISION | NOT NULL DEFAULT 0.8, CHECK 0.0-1.0 |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |

---

### 1.11 Table: `cost_tracking`
| Column | Type | Constraints |
|--------|------|-------------|
| id | TEXT | PRIMARY KEY DEFAULT uuid_generate_v4()::text |
| agent_id | TEXT | NOT NULL |
| session_id | TEXT | |
| task_id | TEXT | |
| model_used | TEXT | NOT NULL |
| provider | TEXT | NOT NULL DEFAULT 'google' |
| tokens_in | INTEGER | NOT NULL DEFAULT 0 |
| tokens_out | INTEGER | NOT NULL DEFAULT 0 |
| cost_usd | DOUBLE PRECISION | NOT NULL DEFAULT 0.0 |
| latency_ms | INTEGER | DEFAULT 0 |
| success | BOOLEAN | NOT NULL DEFAULT true |
| metadata | JSONB | DEFAULT '{}' |
| timestamp | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |

**Indexes:** `idx_cost_agent`, `idx_cost_session`, `idx_cost_model`, `idx_cost_timestamp`, `idx_cost_provider`

---

### 1.12 Table: `sessions`
| Column | Type | Constraints |
|--------|------|-------------|
| id | TEXT | PRIMARY KEY DEFAULT uuid_generate_v4()::text |
| name | TEXT | DEFAULT '' |
| status | TEXT | NOT NULL DEFAULT 'active', CHECK IN ('active','paused','completed','archived') |
| workflow_instance_id | TEXT | REFERENCES workflow_instances(id) ON DELETE SET NULL |
| metadata | JSONB | DEFAULT '{}' |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |
| ended_at | TIMESTAMPTZ | |

**Indexes:** `idx_sessions_status`, `idx_sessions_created`

---

### 1.13 Table: `trust_scores`
| Column | Type | Constraints |
|--------|------|-------------|
| agent_id | TEXT | PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE |
| score | DOUBLE PRECISION | NOT NULL DEFAULT 0.5 |
| alpha | DOUBLE PRECISION | NOT NULL DEFAULT 2.0 |
| beta | DOUBLE PRECISION | NOT NULL DEFAULT 2.0 |
| successes | INTEGER | NOT NULL DEFAULT 0 |
| failures | INTEGER | NOT NULL DEFAULT 0 |
| partials | INTEGER | NOT NULL DEFAULT 0 |
| domain_scores | JSONB | DEFAULT '{}' |
| last_task_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |

---

### 1.14 Table: `vector_entries`
| Column | Type | Constraints |
|--------|------|-------------|
| id | TEXT | PRIMARY KEY |
| content | TEXT | NOT NULL |
| embedding | vector(1536) | |
| metadata | JSONB | DEFAULT '{}' |
| namespace | TEXT | DEFAULT 'default' |
| created_at | TIMESTAMPTZ | DEFAULT NOW() |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() |

**Indexes:** `idx_vector_namespace`, `idx_vector_metadata (GIN)`

---

### 1.15 Table: `workflow_checkpoints`
| Column | Type | Constraints |
|--------|------|-------------|
| id | TEXT | PRIMARY KEY DEFAULT uuid_generate_v4()::text |
| instance_id | TEXT | NOT NULL |
| thread_id | TEXT | NOT NULL |
| checkpoint_data | JSONB | NOT NULL DEFAULT '{}' |
| metadata | JSONB | DEFAULT '{}' |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |

**Indexes:** `idx_wf_checkpoints_instance`, `idx_wf_checkpoints_thread`

---

### 1.16 Table: `viadp_reputation`
| Column | Type | Constraints |
|--------|------|-------------|
| agent_id | TEXT | PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE |
| score | DOUBLE PRECISION | NOT NULL DEFAULT 0.5, CHECK 0.0-1.0 |
| bonds | DECIMAL | NOT NULL DEFAULT 0 |
| heat_penalty | DOUBLE PRECISION | NOT NULL DEFAULT 1.0 |
| delegations_total | INTEGER | NOT NULL DEFAULT 0 |
| delegations_success | INTEGER | NOT NULL DEFAULT 0 |
| delegations_failed | INTEGER | NOT NULL DEFAULT 0 |
| last_updated | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |

---

## 2. All SQL Queries Found in Code

### 2.1 gateway/src/model-router.ts

**Query M1 (line 479-482) -- INSERT cost_tracking**
```sql
INSERT INTO cost_tracking (id, agent_id, session_id, task_id, model_used, provider, tokens_in, tokens_out, cost_usd, timestamp)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
```
Columns used: `id, agent_id, session_id, task_id, model_used, provider, tokens_in, tokens_out, cost_usd, timestamp`
Missing from INSERT: `latency_ms, success, metadata`

**Query M2 (line 643-646) -- SELECT cost_tracking**
```sql
SELECT id, agent_id, session_id, task_id, model_used, provider, tokens_in, tokens_out, cost_usd, timestamp
FROM cost_tracking WHERE timestamp >= $1 ORDER BY timestamp ASC
```
Columns read: `id, agent_id, session_id, task_id, model_used, provider, tokens_in, tokens_out, cost_usd, timestamp`

---

### 2.2 gateway/src/audit-middleware.ts

**Query A1 (line 71-74) -- INSERT audit_log**
```sql
INSERT INTO audit_log (id, sequence_number, hash, previous_hash, client_id, client_type, message_type, direction, session_id, agent_id, timestamp)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
```
Columns used: All 11 columns in schema -- MATCH

---

### 2.3 gateway/src/index.ts

**Query I1 (line 392-401) -- UPDATE model_configs**
```sql
UPDATE model_configs
SET primary_model = $1, fallback_models = $2, temperature = $3, daily_cap_usd = $4, weekly_cap_usd = $5, updated_at = NOW()
WHERE agent_id = $6
```
Columns used: `primary_model, fallback_models, temperature, daily_cap_usd, weekly_cap_usd, updated_at, agent_id`

**Query I2 (line 854-865) -- SELECT memory_entries stats**
```sql
SELECT agent_id, scope, COUNT(*) as entry_count, SUM(LENGTH(content)) as total_chars, MAX(updated_at) as last_updated
FROM memory_entries
WHERE superseded_by IS NULL
GROUP BY agent_id, scope
ORDER BY agent_id, scope
```
Columns used: `agent_id, scope, content, updated_at, superseded_by`

---

### 2.4 gateway/src/langgraph/checkpointer.ts

**Query C1 (line 26-39) -- CREATE TABLE workflow_checkpoints (ensureTable)**
```sql
CREATE TABLE IF NOT EXISTS workflow_checkpoints (
  id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  instance_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  checkpoint_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Query C2 (line 53-58) -- SELECT workflow_checkpoints by thread+checkpoint**
```sql
SELECT id, thread_id, checkpoint_data, metadata
FROM workflow_checkpoints
WHERE thread_id = $1 AND id = $2
ORDER BY created_at DESC LIMIT 1
```

**Query C3 (line 61-65) -- SELECT workflow_checkpoints by thread**
```sql
SELECT id, thread_id, checkpoint_data, metadata
FROM workflow_checkpoints
WHERE thread_id = $1
ORDER BY created_at DESC LIMIT 1
```

**Query C4 (line 99-103) -- INSERT workflow_checkpoints**
```sql
INSERT INTO workflow_checkpoints (instance_id, thread_id, checkpoint_data, metadata)
VALUES ($1, $2, $3, $4) RETURNING id
```

**Query C5 (line 132-148) -- SELECT workflow_checkpoints (list)**
```sql
SELECT id, thread_id, checkpoint_data, metadata, created_at
FROM workflow_checkpoints
WHERE thread_id = $1 [AND created_at < ...]
ORDER BY created_at DESC LIMIT $N
```

**Query C6 (line 180-181) -- DELETE workflow_checkpoints**
```sql
DELETE FROM workflow_checkpoints WHERE thread_id = $1
```

---

### 2.5 memory/src/memory-manager.ts

**Query MM1 (line 118-139) -- INSERT memory_entries**
```sql
INSERT INTO memory_entries
  (id, scope, agent_id, project_id, team_id, thread_id, content, embedding, metadata, tags, importance, access_count, created_at, updated_at, expires_at, superseded_by)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
```
Columns used: 16 columns
Missing from INSERT: `content_type, created_by, session_id, task_id, phase`

**Query MM2 (line 232-237) -- SELECT memory_entries (search)**
```sql
SELECT * FROM memory_entries
[WHERE conditions]
ORDER BY importance DESC, updated_at DESC
LIMIT N
```

**Query MM3 (line 309-340) -- SELECT memory_entries (getRecentContext)**
```sql
(SELECT *, 1 as scope_priority FROM memory_entries WHERE agent_id = $1 AND scope = 'agent' AND superseded_by IS NULL ...)
UNION ALL
(SELECT *, 2 as scope_priority FROM memory_entries WHERE scope = 'thread' AND agent_id = $1 AND superseded_by IS NULL ...)
UNION ALL
(SELECT *, 3 as scope_priority FROM memory_entries WHERE scope = 'project' AND superseded_by IS NULL ...)
UNION ALL
(SELECT *, 4 as scope_priority FROM memory_entries WHERE scope IN ('team','company') AND superseded_by IS NULL ...)
ORDER BY scope_priority, importance DESC, updated_at DESC
LIMIT $3
```

**Query MM4 (line 363-367) -- SELECT memory_entries (compact)**
```sql
SELECT * FROM memory_entries
WHERE thread_id = $1 AND superseded_by IS NULL
  AND (expires_at IS NULL OR expires_at > NOW())
ORDER BY created_at ASC
```

**Query MM5 (line 403-432) -- INSERT memory_entries (compact summary)**
Same columns as MM1.

**Query MM6 (line 436-439) -- UPDATE memory_entries (mark superseded)**
```sql
UPDATE memory_entries SET superseded_by = $1, updated_at = $2
WHERE id = ANY($3)
```

**Query MM7 (line 469-470) -- DELETE memory_entries**
```sql
DELETE FROM memory_entries WHERE id = $1
```

**Query MM8 (line 485-490) -- UPDATE memory_entries (update content)**
```sql
UPDATE memory_entries
SET content = $1, metadata = COALESCE($2, metadata), updated_at = $3
WHERE id = $4 RETURNING *
```

**Query MM9 (line 501-502) -- SELECT memory_entries (getById)**
```sql
SELECT * FROM memory_entries WHERE id = $1
```

**Query MM10 (line 509-510) -- UPDATE memory_entries (access count single)**
```sql
UPDATE memory_entries SET access_count = access_count + 1 WHERE id = $1
```

**Query MM11 (line 577-578) -- UPDATE memory_entries (access count batch)**
```sql
UPDATE memory_entries SET access_count = access_count + 1 WHERE id = ANY($1)
```

---

### 2.6 memory/src/summarizer.ts

**Query S1 (line 144-152) -- SELECT memory_entries (summarizeProject)**
```sql
SELECT content, metadata, tags, importance, created_at
FROM memory_entries
WHERE project_id = $1 AND superseded_by IS NULL
  AND (expires_at IS NULL OR expires_at > NOW())
ORDER BY importance DESC, created_at DESC
LIMIT 500
```

**Query S2 (line 295-298) -- SELECT memory_entries (count for compaction)**
```sql
SELECT COUNT(*) FROM memory_entries
WHERE thread_id = $1 AND superseded_by IS NULL
```

**Query S3 (line 308-314) -- SELECT memory_entries (entries for compaction)**
```sql
SELECT content, metadata, importance, created_at
FROM memory_entries
WHERE thread_id = $1 AND superseded_by IS NULL
  AND (expires_at IS NULL OR expires_at > NOW())
ORDER BY created_at ASC
LIMIT $2
```

---

### 2.7 memory/src/vector-store.ts

**Query V1 (line 81-91) -- CREATE TABLE vector_entries (initialize)**
```sql
CREATE TABLE IF NOT EXISTS vector_entries (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  embedding vector(N),
  metadata JSONB DEFAULT '{}',
  namespace TEXT DEFAULT 'default',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
)
```

**Query V2 (line 172-180) -- INSERT/UPSERT vector_entries**
```sql
INSERT INTO vector_entries (id, content, embedding, metadata, namespace, created_at, updated_at)
VALUES ($1, $2, $3::vector, $4, $5, $6, $7)
ON CONFLICT (id) DO UPDATE SET
  content = EXCLUDED.content,
  embedding = EXCLUDED.embedding,
  metadata = EXCLUDED.metadata,
  namespace = EXCLUDED.namespace,
  updated_at = EXCLUDED.updated_at
```

**Query V3 (line 282-289) -- SELECT vector_entries (similarity search)**
```sql
SELECT id, content, embedding, metadata, created_at, updated_at, [distance_expr] as distance
FROM vector_entries
[WHERE namespace = $N AND metadata conditions]
ORDER BY distance
LIMIT $N
```

**Query V4 (line 323-324) -- DELETE vector_entries (single)**
```sql
DELETE FROM vector_entries WHERE id = $1
```

**Query V5 (line 335-336) -- DELETE vector_entries (batch)**
```sql
DELETE FROM vector_entries WHERE id = ANY($1)
```

**Query V6 (line 346-347) -- DELETE vector_entries (namespace)**
```sql
DELETE FROM vector_entries WHERE namespace = $1
```

**Query V7 (line 365-371) -- UPDATE vector_entries**
```sql
UPDATE vector_entries
SET content = $1, embedding = $2::vector, metadata = COALESCE($3, metadata), updated_at = $4
WHERE id = $5 RETURNING *
```

**Query V8 (line 387-388) -- SELECT vector_entries (getById)**
```sql
SELECT * FROM vector_entries WHERE id = $1
```

**Query V9 (line 399-401) -- SELECT vector_entries (count)**
```sql
SELECT COUNT(*) FROM vector_entries [WHERE namespace = $1]
```

---

## 3. Mismatch Analysis

### 3.1 CRITICAL: Vector Dimension Mismatch

| Location | Dimension |
|----------|-----------|
| `init.sql` line 160 (`memory_entries.embedding`) | **vector(1536)** |
| `init.sql` line 371 (`vector_entries.embedding`) | **vector(1536)** |
| `gateway/src/index.ts` line 112 (VectorStore config) | **dimensions: 768** |
| `memory/src/vector-store.ts` line 61 (default) | **dimensions: 768** |

**Severity: CRITICAL**
The schema defines `vector(1536)` for both `memory_entries.embedding` and `vector_entries.embedding`, but the VectorStore is initialized with `dimensions: 768`. The VectorStore's `initialize()` method creates the table with `vector(768)` via dynamic SQL, which would succeed on first run if the table doesn't exist yet, but would conflict with `init.sql` if that schema ran first. Inserting 768-dimensional vectors into a `vector(1536)` column will cause a PostgreSQL error at runtime.

**Root cause:** `init.sql` expects OpenAI-style 1536-dimension embeddings, but the code uses Google's `text-embedding-004` model which produces 768-dimension embeddings.

**Fix required:** Change `init.sql` lines 160 and 371 from `vector(1536)` to `vector(768)`, OR change the VectorStore config to use 1536-dimension embeddings.

---

### 3.2 CRITICAL: memory_entries INSERT Missing 5 Columns

The `MemoryManager.store()` method (Query MM1) inserts into these 16 columns:
```
id, scope, agent_id, project_id, team_id, thread_id, content, embedding,
metadata, tags, importance, access_count, created_at, updated_at, expires_at, superseded_by
```

But `init.sql` defines 21 columns for `memory_entries`. The INSERT **omits 5 columns**:
1. `content_type` (TEXT DEFAULT 'conversation')
2. `created_by` (TEXT DEFAULT 'system')
3. `session_id` (TEXT)
4. `task_id` (TEXT)
5. `phase` (TEXT)

**Severity: MEDIUM**
All 5 omitted columns have DEFAULT values or allow NULL, so INSERTs will succeed. However, the `session_id`, `task_id`, and `phase` columns are never populated by the MemoryManager, meaning these indexed columns are always NULL. This wastes index space and means any query filtering by those columns will return no results.

**Impact:** The `idx_memory_session` index on `memory_entries(session_id)` is useless since session_id is never populated. The `content_type` column defaults to `'conversation'` but the `idx_memory_content_type` index is never leveraged by any code query.

---

### 3.3 HIGH: cost_tracking INSERT Missing 3 Columns

The `ModelRouter.recordCost()` method (Query M1) inserts into these 10 columns:
```
id, agent_id, session_id, task_id, model_used, provider, tokens_in, tokens_out, cost_usd, timestamp
```

But `init.sql` defines 13 columns. The INSERT **omits 3 columns**:
1. `latency_ms` (INTEGER DEFAULT 0)
2. `success` (BOOLEAN NOT NULL DEFAULT true)
3. `metadata` (JSONB DEFAULT '{}')

**Severity: MEDIUM**
All omitted columns have DEFAULT values so INSERTs succeed. However, `latency_ms` is easily computable in the `recordCost` method (the `AgentRunner` already measures `Date.now() - startTime`) but is never recorded. The `success` column always defaults to `true` since failures don't call `recordCost`.

---

### 3.4 HIGH: Tables Defined in init.sql But Never Queried by Code

The following 7 tables exist in `init.sql` but have **zero SQL queries referencing them** in the application code:

| Table | Purpose | Status |
|-------|---------|--------|
| `agents` | Agent registry | **Seed data only**. Code uses in-memory `AgentManager` with hardcoded configs; never reads/writes the DB table at runtime. |
| `tasks` | Task management | **Seed data only**. Code uses in-memory `TaskManager` (Map-based); never persists tasks to DB. |
| `messages` | Message history | **Never queried**. Code uses in-memory `SessionManager.messageHistory[]`; messages are never persisted to DB. |
| `workflows` | Workflow definitions | **Never queried**. Code loads YAML files from disk via `WorkflowLoader`; never uses this table. |
| `workflow_instances` | Running workflow state | **Never queried**. Code uses in-memory `WorkflowExecutor.instances` Map. |
| `sessions` | Session management | **Never queried**. Code uses in-memory `SessionManager.sessions` Map. |
| `viadp_delegations` | VIADP delegation records | **Never queried**. Code uses in-memory `VIADPEngine.requests/tokens` Maps. |
| `viadp_audit_log` | VIADP audit trail | **Never queried directly**. Code uses in-memory `AuditLog.entries[]` array. The `fromDB()` static method exists but is never called. |
| `trust_scores` | Bayesian trust state | **Seed data only**. Code uses in-memory `TrustManager.scores` Map; never reads/writes DB. |
| `viadp_reputation` | Economic self-regulation | **Seed data only**. Never queried or updated by any code. |

**Severity: HIGH**
10 of 16 tables are never used at runtime. The application runs entirely in-memory for agents, tasks, messages, sessions, workflows, workflow instances, delegations, VIADP audit logs, trust scores, and reputation. This means:
- **No persistence across restarts** -- all state is lost when the gateway process restarts.
- **The database schema is largely a specification document**, not an active backend.
- Only `cost_tracking`, `audit_log`, `memory_entries`, `vector_entries`, `workflow_checkpoints`, and `model_configs` are actively used.

---

### 3.5 MEDIUM: model_configs UPDATE Missing Columns

The `index.ts` UPDATE (Query I1) only modifies:
```
primary_model, fallback_models, temperature, daily_cap_usd, weekly_cap_usd, updated_at
```

But `model_configs` has 12 columns. The following are never written by any code:
- `max_tokens` -- always stuck at seed value
- `top_p` -- always stuck at seed value
- `system_prompt` -- always empty
- `metadata` -- always empty
- `alert_threshold` -- always stuck at seed value

**Severity: LOW**
These columns are only populated by seed data and never updated or read by application code.

---

### 3.6 MEDIUM: VectorStore Dynamic Table Name Risk

`VectorStore` uses `this.tableName` (defaulting to `'vector_entries'`) for all SQL queries, constructing SQL via template literals:
```typescript
`INSERT INTO ${this.tableName} ...`
`DELETE FROM ${this.tableName} ...`
```

While the current usage always passes the default `'vector_entries'`, the `tableName` is configurable. This is a **SQL injection risk** if untrusted input ever reaches the constructor config. Template-literal table names cannot use parameterized queries.

**Severity: LOW (currently)** -- The value is hardcoded at construction time. But it should be validated or allowlisted.

---

### 3.7 LOW: Scope Aliasing Creates Schema Confusion

The `MemoryManager.normalizeScope()` method maps scope aliases:
```typescript
'global' -> 'company'
'session' -> 'thread'
'phase' -> 'project'
'task' -> 'agent'
```

But `init.sql` defines the `scope` CHECK constraint to accept ALL 9 values:
```sql
CHECK (scope IN ('company', 'team', 'project', 'agent', 'thread', 'global', 'session', 'phase', 'task'))
```

This means the DB allows values that the code normalizes away. The values `'global'`, `'session'`, `'phase'`, and `'task'` will never appear in the database because the code normalizes them before INSERT. The CHECK constraint includes dead values.

**Impact:** Low. No functional bug, but the schema is misleading.

---

### 3.8 LOW: audit_log Missing `data`/`payload` Column

The `audit_log` table stores only structural metadata about WebSocket messages (type, direction, client info). There is no column for the actual **message payload or data content**. The `viadp_audit_log` has a `data JSONB` column, but the general `audit_log` does not.

This means the general audit log can tell you "client X sent a message of type Y" but not what the message contained. For forensic/compliance purposes, this may be insufficient.

---

### 3.9 LOW: cost_tracking.agent_id Has No Foreign Key

In `init.sql`, `cost_tracking.agent_id` is `TEXT NOT NULL` with no REFERENCES constraint, unlike `model_configs.agent_id` which references `agents(id) ON DELETE CASCADE`. This means cost records can reference non-existent agent IDs without any database enforcement.

---

### 3.10 INFO: Unused Indexes

The following indexes exist but the code never issues queries that would benefit from them:

| Index | Table | Reason Unused |
|-------|-------|---------------|
| `idx_agents_status` | agents | Table never queried at runtime |
| `idx_agents_trust` | agents | Table never queried at runtime |
| `idx_tasks_*` (all 8) | tasks | Table never queried at runtime |
| `idx_messages_*` (all 6) | messages | Table never queried at runtime |
| `idx_workflows_name` | workflows | Table never queried at runtime |
| `idx_wf_instances_*` (all 3) | workflow_instances | Table never queried at runtime |
| `idx_sessions_*` (all 2) | sessions | Table never queried at runtime |
| `idx_delegations_*` (all 7) | viadp_delegations | Table never queried at runtime |
| `idx_audit_*` (VIADP, all 7) | viadp_audit_log | Table never queried at runtime |
| `idx_memory_content_type` | memory_entries | Column never filtered in any query |
| `idx_memory_session` | memory_entries | Column never populated by code |

---

## 4. Summary of Findings

### By Severity

| Severity | Count | Description |
|----------|-------|-------------|
| CRITICAL | 1 | Vector dimension mismatch (1536 vs 768) -- will cause runtime errors |
| HIGH | 2 | 10/16 tables never queried (no persistence); cost_tracking missing columns |
| MEDIUM | 2 | memory_entries INSERT skips 5 columns; model_configs partial updates |
| LOW | 4 | SQL injection risk (template table names); scope aliasing confusion; missing payload column; missing FK |
| INFO | 1 | ~35 unused indexes consuming storage and slowing writes |

### Tables Actually Used at Runtime

| Table | Operations | Source Files |
|-------|-----------|-------------|
| `cost_tracking` | INSERT, SELECT | `model-router.ts` |
| `audit_log` | INSERT | `audit-middleware.ts` |
| `memory_entries` | INSERT, SELECT, UPDATE, DELETE | `memory-manager.ts`, `summarizer.ts`, `index.ts` |
| `vector_entries` | CREATE, INSERT/UPSERT, SELECT, UPDATE, DELETE | `vector-store.ts` |
| `workflow_checkpoints` | CREATE, INSERT, SELECT, DELETE | `langgraph/checkpointer.ts` |
| `model_configs` | UPDATE | `index.ts` |

### Tables Never Used at Runtime (Schema-Only)

| Table | Reason |
|-------|--------|
| `agents` | In-memory AgentManager |
| `tasks` | In-memory TaskManager |
| `messages` | In-memory SessionManager |
| `workflows` | YAML file loader |
| `workflow_instances` | In-memory WorkflowExecutor |
| `sessions` | In-memory SessionManager |
| `viadp_delegations` | In-memory VIADPEngine |
| `viadp_audit_log` | In-memory AuditLog class |
| `trust_scores` | In-memory TrustManager |
| `viadp_reputation` | Never queried |

---

## 5. Recommendations

### P0 (Immediate Fix Required)

1. **Fix vector dimension mismatch:** Align `init.sql` `vector(1536)` with the actual embedding dimension (768 from Google `text-embedding-004`). Update both `memory_entries.embedding` and `vector_entries.embedding` columns to `vector(768)`.

### P1 (High Priority)

2. **Implement DB persistence for core entities:** The in-memory-only architecture means all agent state, task state, session history, workflow progress, delegations, and trust scores are lost on restart. Implement read-on-startup + write-through for at least: `agents`, `tasks`, `sessions`, `workflow_instances`.

3. **Populate cost_tracking.latency_ms:** The `AgentRunner` already computes `Date.now() - startTime`. Pass this value to `recordCost()` and include it in the INSERT.

### P2 (Medium Priority)

4. **Populate memory_entries session/task/phase columns:** The MemoryManager INSERT should include `session_id`, `task_id`, and `phase` when available to enable richer queries.

5. **Remove dead CHECK values from memory_entries.scope:** Remove `'global'`, `'session'`, `'phase'`, `'task'` from the CHECK constraint since code normalizes them before INSERT.

6. **Add FK constraint on cost_tracking.agent_id:** Add `REFERENCES agents(id)` for referential integrity.

### P3 (Low Priority)

7. **Sanitize VectorStore table name:** Add validation to ensure the `tableName` config only contains alphanumeric characters and underscores.

8. **Add payload/data column to audit_log:** Store message payloads for forensic analysis.

9. **Clean up unused indexes:** Drop indexes on tables that are never queried to reduce write overhead and storage.
