# Session 05 — Phase 3: Memory RAG Hook + Real Embeddings (Stream B, Day 5-8)

> **Instructions for Claude Code Opus 4.6**: Read this entire prompt before taking any action. You must complete ALL tasks listed below in the ForgeTeam project at `/Users/bandar/Documents/AreebPro/forge-team/`. Use the **team/swarm feature** -- create a team and spin up parallel agents to work on independent workstreams simultaneously. Each workstream is labeled. Do NOT skip any item. Do NOT introduce new features beyond what is listed. Do NOT add comments, docstrings, or type annotations to code you did not change. All changes must pass `npm run build` in both the `memory/` and `gateway/` packages.

---

## PRE-WORK: Read These Files First (Before Any Edits)

Every agent on the team must read the files relevant to their workstream before editing. The ground-truth references are:

- **Memory Manager (scope mismatch source):** `/forge-team/memory/src/memory-manager.ts` -- defines `HierarchicalScope: 'company'|'team'|'project'|'agent'|'thread'`
- **Shared types (conflicting scope):** `/forge-team/shared/types/memory.ts` -- defines `MemoryScope: 'global'|'session'|'agent'|'phase'|'task'`
- **Vector Store (fake embeddings):** `/forge-team/memory/src/vector-store.ts` -- `embed()` at lines 108-133 uses hash-based pseudo-embeddings
- **Gemini File Search:** `/forge-team/memory/src/gemini-file-search.ts` -- wraps `/v1beta/corpora` API, has `createStore()`, `uploadDocument()`, `search()`
- **Summarizer (persistence bug):** `/forge-team/memory/src/summarizer.ts` -- `checkAndCompact()` at lines 290-329 computes summary but never persists it
- **Memory index:** `/forge-team/memory/src/index.ts` -- exports all memory modules
- **Memory package.json:** `/forge-team/memory/package.json` -- current deps: `pg`, `ioredis`, `pgvector`, `uuid`
- **Agent Runner (no RAG hook):** `/forge-team/gateway/src/agent-runner.ts` -- `processUserMessage()` at lines 100-197 never calls memory before LLM call
- **Agent Manager:** `/forge-team/gateway/src/agent-manager.ts` -- agent lifecycle, `completeTask()` at lines 314-331
- **Gateway index:** `/forge-team/gateway/src/index.ts` -- REST routes + WebSocket server
- **All 12 agent config.json:** `/forge-team/agents/*/config.json` -- none have `fileSearchStoreId`
- **DB schema:** `/forge-team/infrastructure/postgres/init.sql` -- `memory_entries` table, `vector_entries` table
- **Dashboard Memory Explorer:** `/forge-team/dashboard/src/components/MemoryExplorer.tsx` -- uses mock data, no API calls
- **Dashboard API client:** `/forge-team/dashboard/src/lib/api.ts` -- no memory endpoints

---

## TASK 1: Fix Scope Mismatch Between shared/types and MemoryManager

**Problem**: `shared/types/memory.ts` defines `MemoryScope = 'global'|'session'|'agent'|'phase'|'task'` while `memory/src/memory-manager.ts` defines `HierarchicalScope = 'company'|'team'|'project'|'agent'|'thread'`. The two types are incompatible and never reconciled.

**Decision**: Adopt the MemoryManager's hierarchy (`company|team|project|agent|thread`) as the canonical taxonomy because it represents the actual storage hierarchy. Update the shared types to match.

**Files to modify:**
- `/forge-team/shared/types/memory.ts`
- `/forge-team/memory/src/memory-manager.ts`

### 1A. Update shared/types/memory.ts MemoryScope

Replace the `MemoryScope` type (line 9-14) with:

```typescript
export type MemoryScope =
  | 'company'     // Available to all agents across all projects (was 'global')
  | 'team'        // Scoped to a team of agents
  | 'project'     // Scoped to a specific project
  | 'agent'       // Private to a specific agent
  | 'thread';     // Scoped to a specific conversation thread (was 'session')
```

### 1B. Update MemoryEntry in shared/types/memory.ts

Update the `MemoryEntry` interface (lines 31-66) to add the missing hierarchical fields:

- Add `projectId: string | null;` field
- Add `teamId: string | null;` field
- Rename `sessionId` to `threadId` (search-and-replace across the file)
- Remove the `phase` field (phases are tracked via tags or metadata, not a scope level)
- Remove the `taskId` field (tasks are tracked via metadata)

### 1C. Update related interfaces

- `CreateMemoryInput` (lines 69-82): rename `sessionId` to `threadId`, remove `phase`, remove `taskId`, add `projectId` and `teamId`
- `MemorySearchQuery` (lines 94-119): rename `sessionId` to `threadId`, remove `phase`, remove `taskId`, add `projectId` and `teamId`
- `AgentContext` (lines 122-135): rename `sessionContext` to `threadContext`, remove `phaseContext`, rename `taskContext` to `projectContext`, add `teamContext` and `companyContext`

### 1D. Remove the duplicate HierarchicalScope from memory-manager.ts

In `/forge-team/memory/src/memory-manager.ts`, replace the local `HierarchicalScope` type definition (lines 18-23) with an import from shared types:

```typescript
import type { MemoryScope } from '@forge-team/shared';
```

Then replace all references to `HierarchicalScope` with `MemoryScope` throughout the file. Update the `MemoryEntry` in memory-manager.ts to use `scope: MemoryScope`.

### 1E. Update memory/src/index.ts exports

Remove the `type HierarchicalScope` export from `memory/src/index.ts` (line 8). It will now come from `@forge-team/shared`.

**Test**: Run `npx tsc --noEmit` in both `shared/` and `memory/` to verify type consistency.

---

## TASK 2: Replace Fake Embeddings with Real Vector Embeddings

**Problem**: `VectorStore.embed()` (vector-store.ts:108-133) uses a hash-based character-code arithmetic approach that produces meaningless vectors. Semantic similarity search returns nonsensical results.

**Solution**: Use the Google `text-embedding-004` model via the `@google/generative-ai` package (already a dependency of the gateway) to generate real 768-dimensional embeddings.

**Files to modify:**
- `/forge-team/memory/src/vector-store.ts`
- `/forge-team/memory/package.json`

### 2A. Add @google/generative-ai dependency

Add to `memory/package.json` dependencies:

```json
"@google/generative-ai": "^0.21.0"
```

### 2B. Replace the embed() method

In `vector-store.ts`, update the constructor and `embed()` method:

1. Change `VectorStoreConfig` interface (lines 36-40) to add `apiKey?: string` and `embeddingModel?: string` fields
2. Add a private field `private genAI: GoogleGenerativeAI | null` initialized from `config.apiKey`
3. Change `dimensions` default from `1536` to `768` (the output dimension of `text-embedding-004`)
4. Replace the `embed()` method (lines 108-133) to call the Google Generative AI embedding API:

```typescript
async embed(text: string): Promise<number[]> {
  if (!this.genAI) {
    // Fallback: deterministic hash-based embedding when no API key
    return this.hashEmbed(text);
  }

  const model = this.genAI.getGenerativeModel({ model: this.embeddingModel });
  const result = await model.embedContent(text);
  return result.embedding.values;
}
```

5. Rename the old `embed()` body to a private `hashEmbed()` method as a graceful fallback when `GOOGLE_AI_API_KEY` is not set
6. Make `embed()` async -- this is a breaking change; update all callers:
   - `embedAndUpsert()` (line 190): add `await` before `this.embed(content)`
   - `similaritySearch()` (line 202): add `await` before `this.embed(query)`
   - `update()` (line 336): add `await` before `this.embed(content)`

### 2C. Update the VectorStore constructor

```typescript
constructor(pool: Pool, config: VectorStoreConfig = {}) {
  this.pool = pool;
  this.tableName = config.tableName ?? 'vector_entries';
  this.dimensions = config.dimensions ?? 768;
  this.distanceMetric = config.distanceMetric ?? 'cosine';
  this.embeddingModel = config.embeddingModel ?? 'text-embedding-004';

  const apiKey = config.apiKey ?? process.env.GOOGLE_AI_API_KEY;
  this.genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

  if (!this.genAI) {
    console.warn('[VectorStore] No GOOGLE_AI_API_KEY — using fallback hash embeddings');
  }
}
```

### 2D. Update the pgvector table dimensions

In `initialize()` (line 62-98), the `CREATE TABLE` uses `vector(${this.dimensions})`. Since we changed the default to 768, new tables will use 768-dimensional vectors. Add a migration note comment at the top of `initialize()` noting that existing 1536-dimension tables need a migration.

**Test**: Instantiate VectorStore with a valid API key, call `embed("hello world")`, verify it returns a 768-element float array with non-trivial values.

---

## TASK 3: Wire RAG Hook Into Agent Pipeline

**Problem**: Memory is never injected into agent context. The `AgentRunner.processUserMessage()` method (agent-runner.ts:100-197) calls the LLM directly without first retrieving relevant memories. This means agents have no project context, no learned knowledge, and no continuity between sessions.

**Solution**: Create a RAG middleware in agent-runner.ts that calls `MemoryManager.getRecentContext()` + `GeminiFileSearch.search()` before every agent turn, and injects the results into the system prompt.

**Files to modify:**
- `/forge-team/gateway/src/agent-runner.ts`
- `/forge-team/gateway/src/index.ts` (to wire up MemoryManager and GeminiFileSearch as dependencies)

### 3A. Add memory dependencies to AgentRunner

Update the `AgentRunnerDeps` interface (agent-runner.ts:68-72) to add:

```typescript
interface AgentRunnerDeps {
  modelRouter: ModelRouter;
  agentManager: AgentManager;
  sessionManager: SessionManager;
  memoryManager?: MemoryManager;       // NEW
  geminiFileSearch?: GeminiFileSearch;  // NEW
}
```

Add corresponding private fields and assign them in the constructor:

```typescript
private memoryManager: MemoryManager | null;
private geminiFileSearch: GeminiFileSearch | null;
```

### 3B. Create the retrieveContext() private method

Add a new private method after `buildSystemPrompt()`:

```typescript
private async retrieveContext(
  agentId: AgentId,
  userMessage: string,
  sessionId: string,
): Promise<string> {
  const contextParts: string[] = [];

  // 1. Get hierarchical memory context from MemoryManager
  if (this.memoryManager) {
    try {
      const recentEntries = await this.memoryManager.getRecentContext(agentId, 15);
      if (recentEntries.length > 0) {
        const memoryText = recentEntries
          .map(e => `[${e.scope}] ${e.content}`)
          .join('\n');
        contextParts.push(`## Relevant Memories\n${memoryText}`);
      }
    } catch (err: any) {
      console.warn(`[AgentRunner] Memory retrieval failed for ${agentId}:`, err?.message);
    }
  }

  // 2. Search Gemini File Search for project knowledge
  if (this.geminiFileSearch) {
    try {
      const agentConfig = this.agentManager.getConfig(agentId);
      const storeId = (agentConfig as any)?.fileSearchStoreId;
      if (storeId) {
        const searchResult = await this.geminiFileSearch.search(storeId, userMessage, 3);
        if (searchResult.results.length > 0) {
          const fileText = searchResult.results
            .map(r => r.content)
            .join('\n---\n');
          contextParts.push(`## Project Knowledge Base\n${fileText}`);
        }
      }
    } catch (err: any) {
      console.warn(`[AgentRunner] File search failed for ${agentId}:`, err?.message);
    }
  }

  return contextParts.join('\n\n');
}
```

### 3C. Inject RAG context into processUserMessage()

In `processUserMessage()`, between step 2 (build system prompt, line 128) and step 4 (get history, line 132), add a new step 3:

```typescript
// 3. Retrieve memory context via RAG
const ragContext = await this.retrieveContext(agentId, userMessage, sessionId);
if (ragContext.length > 0) {
  systemPrompt += '\n\n---\n\n' + ragContext;
}
```

### 3D. Store agent responses back to memory

After step 8 (record cost, line 184), add a new step 9 that stores the user message and agent response into memory:

```typescript
// 9. Store exchange in memory for future RAG retrieval
if (this.memoryManager) {
  try {
    await this.memoryManager.store('thread', userMessage, {
      role: 'user',
      agentId,
      sessionId,
    }, {
      agentId,
      threadId: sessionId,
      importance: 0.5,
    });

    await this.memoryManager.store('thread', result.content, {
      role: 'agent',
      agentId,
      model: modelId,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    }, {
      agentId,
      threadId: sessionId,
      importance: 0.6,
    });
  } catch (err: any) {
    console.warn(`[AgentRunner] Failed to store memory for ${agentId}:`, err?.message);
  }
}
```

### 3E. Wire dependencies in gateway/src/index.ts

In the gateway's main `index.ts`, where `AgentRunner` is instantiated, create `MemoryManager` and `GeminiFileSearch` instances and pass them as deps:

```typescript
import { MemoryManager } from '@forge-team/memory';
import { GeminiFileSearch } from '@forge-team/memory';

// After pool and redis are created:
const memoryManager = new MemoryManager(pool, redis);
const geminiFileSearch = process.env.GOOGLE_AI_API_KEY
  ? new GeminiFileSearch({ apiKey: process.env.GOOGLE_AI_API_KEY })
  : null;

const agentRunner = new AgentRunner({
  modelRouter,
  agentManager,
  sessionManager,
  memoryManager,
  geminiFileSearch: geminiFileSearch ?? undefined,
});
```

**Test**: Send a user message to an agent, verify in logs that `[AgentRunner] Memory retrieval` runs without error. Send a second message, verify the first exchange appears in the RAG context.

---

## TASK 4: Fix Summarizer Persistence Bug

**Problem**: `Summarizer.checkAndCompact()` (summarizer.ts:290-329) computes a summary string but never persists it back to the database. It returns `{ compacted: true, summary: '...' }` but the caller is responsible for persisting -- and nobody does. The computed summary is lost.

**Files to modify:**
- `/forge-team/memory/src/summarizer.ts`

### 4A. Make checkAndCompact() persist the summary

Update `checkAndCompact()` to accept a `MemoryManager` (or Pool) dependency and persist the compacted summary. Modify the method signature and implementation:

```typescript
async checkAndCompact(
  sessionId: string,
  memoryManager?: MemoryManager,
): Promise<{ compacted: boolean; summary?: string; summaryId?: string }> {
```

After computing the summary (line 327), if `memoryManager` is provided, call `memoryManager.compact(sessionId, this.config.compactionThreshold)` which already does the DB persistence:

```typescript
if (memoryManager) {
  const result = await memoryManager.compact(sessionId, this.config.compactionThreshold);
  return {
    compacted: result.compactedCount > 0,
    summary,
    summaryId: result.summaryId,
  };
}

// Fallback: return summary without persistence (legacy behavior)
return { compacted: true, summary };
```

### 4B. Add import for MemoryManager type

Add at the top of summarizer.ts:

```typescript
import type { MemoryManager } from './memory-manager';
```

**Test**: Create 60 memory entries for a session, call `checkAndCompact(sessionId, memoryManager)`, verify the summary entry exists in DB and old entries are marked as superseded.

---

## TASK 5: Add Task-Close Summarization Trigger

**Problem**: When a task moves to 'completed', no auto-summarization occurs. Memory entries from the task's lifetime are never compacted.

**Files to modify:**
- `/forge-team/gateway/src/agent-manager.ts`
- `/forge-team/gateway/src/index.ts`

### 5A. Emit a task-completed event with session context

The `AgentManager.completeTask()` method (agent-manager.ts:314-331) already emits `agent:task-completed` with `(agentId, taskId, sessionId)`. This is sufficient.

### 5B. Add summarization listener in gateway/src/index.ts

In the gateway's main index.ts, after the `agentManager` is created, add a listener:

```typescript
agentManager.on('agent:task-completed', async (agentId, taskId, sessionId) => {
  if (!memoryManager || !summarizer) return;

  console.log(`[Gateway] Task ${taskId} completed by ${agentId} — triggering summarization`);
  try {
    const result = await summarizer.checkAndCompact(sessionId, memoryManager);
    if (result.compacted) {
      console.log(`[Gateway] Compacted session ${sessionId}: summary=${result.summaryId}`);
    }
  } catch (err: any) {
    console.warn(`[Gateway] Task-close summarization failed for ${sessionId}:`, err?.message);
  }
});
```

### 5C. Instantiate the Summarizer in index.ts

Create a `Summarizer` instance alongside the MemoryManager:

```typescript
import { Summarizer } from '@forge-team/memory';

const summarizer = new Summarizer(pool, redis, {
  compactionThreshold: 50,
  preserveRecentCount: 10,
});
```

**Test**: Complete a task via `agentManager.completeTask()`, verify the event handler fires and logs a summarization attempt.

---

## TASK 6: Create Company KB Auto-Provisioning

**Problem**: There is no automatic creation of a shared Gemini File Search corpus for company-wide knowledge. Agents have no shared knowledge base to search against.

**Files to modify:**
- `/forge-team/gateway/src/index.ts`

### 6A. Create a company KB on startup

Add a startup function that creates (or reconnects to) a shared Gemini File Search corpus:

```typescript
async function initCompanyKB(geminiFileSearch: GeminiFileSearch): Promise<string | null> {
  try {
    const stores = await geminiFileSearch.listStores();
    const existing = stores.find(s => s.name === 'forgeteam-company-kb');
    if (existing) {
      console.log(`[Gateway] Found existing company KB: ${existing.id}`);
      return existing.id;
    }

    const store = await geminiFileSearch.createStore('forgeteam-company-kb', 'company');
    console.log(`[Gateway] Created company KB: ${store.id}`);
    return store.id;
  } catch (err: any) {
    console.warn(`[Gateway] Failed to initialize company KB:`, err?.message);
    return null;
  }
}
```

Call this during server startup, after `geminiFileSearch` is created:

```typescript
let companyKBId: string | null = null;
if (geminiFileSearch) {
  companyKBId = await initCompanyKB(geminiFileSearch);
}
```

### 6B. Expose company KB ID to the AgentRunner

Pass the `companyKBId` to the AgentRunner via deps or a setter so the RAG hook can fall back to the company KB when an agent has no private store:

```typescript
// In AgentRunner.retrieveContext(), after the agent-specific store search:
if (!storeId && this.companyKBId) {
  // Fall back to company-wide KB
  const searchResult = await this.geminiFileSearch.search(this.companyKBId, userMessage, 3);
  // ...
}
```

**Test**: Start the gateway with a valid `GOOGLE_AI_API_KEY`, verify logs show "Created company KB" or "Found existing company KB".

---

## TASK 7: Add Per-Agent Gemini File Search Store

**Problem**: Agent config.json files have no `fileSearchStoreId` field. Each agent should be able to have its own private knowledge corpus.

**Files to modify:**
- All 12 `/forge-team/agents/*/config.json`
- `/forge-team/agents/index.ts` (AgentConfig type)
- `/forge-team/gateway/src/agent-runner.ts`

### 7A. Add fileSearchStoreId to the AgentConfig interface

In `/forge-team/agents/index.ts`, update the `AgentConfig` interface (line 24-37) to add:

```typescript
fileSearchStoreId?: string;
```

### 7B. Add fileSearchStoreId field to each config.json

Add `"fileSearchStoreId": null` to each of the 12 agent config.json files. This field will be populated at runtime on first use.

The 12 files:
- `/forge-team/agents/bmad-master/config.json`
- `/forge-team/agents/product-owner/config.json`
- `/forge-team/agents/business-analyst/config.json`
- `/forge-team/agents/scrum-master/config.json`
- `/forge-team/agents/architect/config.json`
- `/forge-team/agents/ux-designer/config.json`
- `/forge-team/agents/frontend-dev/config.json`
- `/forge-team/agents/backend-dev/config.json`
- `/forge-team/agents/qa-architect/config.json`
- `/forge-team/agents/devops-engineer/config.json`
- `/forge-team/agents/security-specialist/config.json`
- `/forge-team/agents/tech-writer/config.json`

### 7C. Auto-create per-agent corpus on first use

In `AgentRunner.retrieveContext()`, when searching for an agent's store and `storeId` is null, auto-create a corpus:

```typescript
if (!storeId && this.geminiFileSearch) {
  try {
    const store = await this.geminiFileSearch.createStore(
      `agent-${agentId}`,
      'agent',
    );
    // Cache the store ID on the config for future use
    (agentConfig as any).fileSearchStoreId = store.id;
    storeId = store.id;
    console.log(`[AgentRunner] Created file search store for ${agentId}: ${store.id}`);
  } catch (err: any) {
    console.warn(`[AgentRunner] Failed to create store for ${agentId}:`, err?.message);
  }
}
```

**Test**: Send a message to an agent with no `fileSearchStoreId`, verify logs show auto-creation of the corpus.

---

## TASK 8: Build Failover Logic (Gemini File Search -> pgvector)

**Problem**: No failover logic exists between Gemini File Search and the VectorStore (pgvector). If the Gemini API is unavailable, search fails silently with no results.

**Files to modify:**
- `/forge-team/gateway/src/agent-runner.ts`
- `/forge-team/memory/src/index.ts` (to export VectorStore)

### 8A. Add VectorStore as a dependency

Update `AgentRunnerDeps` to include `vectorStore?`:

```typescript
interface AgentRunnerDeps {
  modelRouter: ModelRouter;
  agentManager: AgentManager;
  sessionManager: SessionManager;
  memoryManager?: MemoryManager;
  geminiFileSearch?: GeminiFileSearch;
  vectorStore?: VectorStore;            // NEW
  companyKBId?: string;                 // NEW
}
```

### 8B. Implement failover in retrieveContext()

Restructure the file search section of `retrieveContext()` to try Gemini File Search first, then fall back to pgvector:

```typescript
// 2. Search for project knowledge — Gemini File Search with pgvector fallback
let fileSearchResults: string[] = [];

if (this.geminiFileSearch && storeId) {
  try {
    const searchResult = await this.geminiFileSearch.search(storeId, userMessage, 3);
    fileSearchResults = searchResult.results.map(r => r.content);
  } catch (err: any) {
    console.warn(`[AgentRunner] Gemini File Search failed, falling back to pgvector:`, err?.message);
    // FAILOVER: use pgvector
    if (this.vectorStore) {
      try {
        const vectorResults = await this.vectorStore.similaritySearch(userMessage, 3, {
          namespace: agentId,
          minScore: 0.3,
        });
        fileSearchResults = vectorResults.map(r => r.entry.content);
      } catch (vecErr: any) {
        console.warn(`[AgentRunner] pgvector fallback also failed:`, vecErr?.message);
      }
    }
  }
} else if (this.vectorStore) {
  // No Gemini File Search available at all — use pgvector directly
  try {
    const vectorResults = await this.vectorStore.similaritySearch(userMessage, 3, {
      namespace: agentId,
      minScore: 0.3,
    });
    fileSearchResults = vectorResults.map(r => r.entry.content);
  } catch (err: any) {
    console.warn(`[AgentRunner] pgvector search failed:`, err?.message);
  }
}

if (fileSearchResults.length > 0) {
  contextParts.push(`## Project Knowledge Base\n${fileSearchResults.join('\n---\n')}`);
}
```

### 8C. Wire VectorStore in gateway/src/index.ts

```typescript
import { VectorStore } from '@forge-team/memory';

const vectorStore = new VectorStore(pool, {
  dimensions: 768,
  apiKey: process.env.GOOGLE_AI_API_KEY,
});
await vectorStore.initialize();

const agentRunner = new AgentRunner({
  modelRouter,
  agentManager,
  sessionManager,
  memoryManager,
  geminiFileSearch: geminiFileSearch ?? undefined,
  vectorStore,
  companyKBId: companyKBId ?? undefined,
});
```

**Test**: Disable the `GOOGLE_AI_API_KEY`, send a message, verify pgvector fallback is used (check logs for "falling back to pgvector"). Re-enable the key, verify Gemini File Search is used.

---

## TASK 9: Connect Memory Explorer Dashboard to Real API

**Problem**: `MemoryExplorer.tsx` in the dashboard uses mock data. No gateway REST endpoints exist for memory operations.

**Files to modify:**
- `/forge-team/gateway/src/index.ts` (add REST endpoints)
- `/forge-team/dashboard/src/lib/api.ts` (add client functions)
- `/forge-team/dashboard/src/components/MemoryExplorer.tsx` (call real API with mock fallback)

### 9A. Add memory REST endpoints to gateway

In `/forge-team/gateway/src/index.ts`, add these Express routes:

**GET /api/memory/search**

Query params: `q` (search query), `scope` (optional), `agentId` (optional), `limit` (optional, default 20)

```typescript
app.get('/api/memory/search', async (req, res) => {
  try {
    const query = (req.query.q as string) ?? '';
    const scope = req.query.scope as string | undefined;
    const agentId = req.query.agentId as string | undefined;
    const limit = parseInt(req.query.limit as string) || 20;

    const results = await memoryManager.search(query, {
      scope: scope as any,
      agentId,
      limit,
    });

    res.json({ results, total: results.length });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Memory search failed' });
  }
});
```

**GET /api/memory/stats**

Returns per-agent memory statistics:

```typescript
app.get('/api/memory/stats', async (req, res) => {
  try {
    const statsResult = await pool.query(`
      SELECT
        agent_id,
        scope,
        COUNT(*) as entry_count,
        SUM(LENGTH(content)) as total_chars,
        MAX(updated_at) as last_updated
      FROM memory_entries
      WHERE superseded_by IS NULL
      GROUP BY agent_id, scope
      ORDER BY agent_id, scope
    `);

    res.json({ stats: statsResult.rows });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Memory stats failed' });
  }
});
```

**POST /api/memory/store**

Body: `{ scope, content, metadata?, agentId?, projectId?, teamId?, threadId?, tags?, importance? }`

```typescript
app.post('/api/memory/store', async (req, res) => {
  try {
    const { scope, content, metadata, agentId, projectId, teamId, threadId, tags, importance } = req.body;

    if (!scope || !content) {
      return res.status(400).json({ error: 'scope and content are required' });
    }

    const entry = await memoryManager.store(scope, content, metadata ?? {}, {
      agentId,
      projectId,
      teamId,
      threadId,
      tags,
      importance,
    });

    res.json({ entry });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Memory store failed' });
  }
});
```

### 9B. Add client functions to dashboard api.ts

In `/forge-team/dashboard/src/lib/api.ts`, add:

```typescript
export async function searchMemory(
  query: string,
  scope?: string,
  agentId?: string,
  limit?: number,
): Promise<{ results: any[]; total: number }> {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (scope) params.set('scope', scope);
  if (agentId) params.set('agentId', agentId);
  if (limit) params.set('limit', String(limit));

  const response = await fetch(`${API_BASE}/api/memory/search?${params}`);
  if (!response.ok) throw new Error('Memory search failed');
  return response.json();
}

export async function fetchMemoryStats(): Promise<{ stats: any[] }> {
  const response = await fetch(`${API_BASE}/api/memory/stats`);
  if (!response.ok) throw new Error('Memory stats failed');
  return response.json();
}

export async function storeMemory(
  scope: string,
  content: string,
  options?: Record<string, any>,
): Promise<{ entry: any }> {
  const response = await fetch(`${API_BASE}/api/memory/store`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope, content, ...options }),
  });
  if (!response.ok) throw new Error('Memory store failed');
  return response.json();
}
```

### 9C. Update MemoryExplorer to use real API with mock fallback

In `MemoryExplorer.tsx`, update the search handler and stats loading:

1. Import `searchMemory` and `fetchMemoryStats` from `api.ts`
2. On component mount, call `fetchMemoryStats()` to load real stats. If it fails, fall back to existing mock data
3. On search submit, call `searchMemory(query, scope, agentId)` to get real results. If it fails, fall back to mock local filter

**Test**: Start the gateway and dashboard. Open Memory Explorer, verify stats load from the API (or gracefully fall back to mock data). Enter a search query, verify results come from the API.

---

## TASK 10: Also Store Agent Exchanges in VectorStore

**Problem**: Agent responses are stored in `memory_entries` (via Task 3) but not in the `vector_entries` table, so pgvector similarity search has nothing to search against.

**Files to modify:**
- `/forge-team/gateway/src/agent-runner.ts`

### 10A. Dual-write to VectorStore

In the step 9 memory storage code added in Task 3, also write to the VectorStore:

```typescript
// Also index in VectorStore for semantic search
if (this.vectorStore) {
  try {
    await this.vectorStore.embedAndUpsert(
      `[user] ${userMessage}\n[${agentId}] ${result.content}`,
      {
        agentId,
        sessionId,
        model: modelId,
        timestamp: new Date().toISOString(),
      },
      agentId, // namespace = agentId for per-agent search
    );
  } catch (err: any) {
    console.warn(`[AgentRunner] Failed to index in VectorStore:`, err?.message);
  }
}
```

**Test**: Send messages to an agent, then query `vectorStore.similaritySearch()` with related text. Verify results return with meaningful similarity scores > 0.3.

---

## FINAL CHECKLIST (Every Agent Must Verify)

After all fixes, verify:

- [x] `npx tsc --noEmit` passes in `shared/`, `memory/`, and `gateway/` packages
- [x] `MemoryScope` in `shared/types/memory.ts` uses `company|team|project|agent|thread` (no `global|session|phase|task`)
- [x] `HierarchicalScope` type is removed from `memory-manager.ts` (imported from shared instead)
- [x] `VectorStore.embed()` calls Google `text-embedding-004` when API key is available
- [x] `VectorStore.embed()` falls back to hash-based embedding when no API key is set
- [x] `AgentRunner.processUserMessage()` calls `retrieveContext()` before the LLM call
- [x] `AgentRunner.processUserMessage()` stores user+agent messages in memory after the LLM call
- [x] `Summarizer.checkAndCompact()` persists the summary via `memoryManager.compact()`
- [x] Task-completed events trigger summarization in gateway index.ts
- [x] Company KB is auto-provisioned on gateway startup
- [x] Each agent config.json has a `fileSearchStoreId` field (initially null)
- [x] Failover from Gemini File Search to pgvector works in `retrieveContext()`
- [x] Gateway has REST endpoints: GET `/api/memory/search`, GET `/api/memory/stats`, POST `/api/memory/store`
- [x] MemoryExplorer.tsx calls real API endpoints with mock fallback
- [x] No string `gpt-4o` or `gpt-4o-mini` appears anywhere in the modified files

---

## TEAM STRUCTURE SUGGESTION

Create a team with these agents working in parallel:

1. **types-fixer** -- Handles TASK 1 (scope mismatch reconciliation)
2. **embedding-fixer** -- Handles TASK 2 (real embeddings) + TASK 10 (dual-write to VectorStore)
3. **rag-wirer** -- Handles TASK 3 (RAG hook) + TASK 8 (failover logic)
4. **summarizer-fixer** -- Handles TASK 4 (persistence bug) + TASK 5 (task-close trigger)
5. **infra-wirer** -- Handles TASK 6 (company KB) + TASK 7 (per-agent stores) + TASK 9 (REST endpoints + dashboard)

After all agents finish, run `npx tsc --noEmit` in all three packages to verify zero type errors.
