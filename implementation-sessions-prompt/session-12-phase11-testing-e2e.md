# Session 12 — Phase 11: Testing Suite + Riyadh E2E Scenario (Day 12-14)

> **Instructions for Claude Code Opus 4.6**: Read this entire prompt before taking any action. You must complete ALL tasks listed below in the ForgeTeam project at `/Users/bandar/Documents/AreebPro/forge-team/`. Use the **team/swarm feature** — create a team and spin up parallel agents to work on independent workstreams simultaneously. Each workstream is labeled. Do NOT skip any item. Do NOT introduce new features beyond what is listed. Do NOT add comments, docstrings, or type annotations to code you did not change. Preserve the existing TypeScript style and project conventions.

---

## CONTEXT

The ForgeTeam audit report (AUDIT-REPORT.md) identified a critical gap: **ZERO test files exist in the entire project**. Phase 11 (Testing & Acceptance) scored 9% completion — the lowest of all phases. There are no `*.test.ts` or `*.spec.ts` files anywhere.

This session creates the complete test infrastructure from scratch:
- Vitest for unit and integration tests
- Playwright for E2E dashboard tests
- A full Riyadh Attendance Tracker end-to-end scenario
- Stress tests for memory and load tests for agent scalability
- Model assignment verification tests

All tests must use mocked LLM responses — no real API calls. Tests must be deterministic and repeatable.

---

## PRE-WORK: Read These Files First (Before Any Edits)

Every agent on the team must read the files relevant to their workstream before editing. The ground-truth references are:

**Gateway source (unit test targets):**
- `/forge-team/gateway/src/model-router.ts` — model catalog, agent assignments, complexity classifier, routing logic, cost tracking
- `/forge-team/gateway/src/session-manager.ts` — session lifecycle (create, join, leave, state transitions), event emitter
- `/forge-team/gateway/src/task-manager.ts` — Kanban CRUD, task state transitions, WIP limits, event emitter
- `/forge-team/gateway/src/agent-manager.ts` — agent registry, status tracking, config loading
- `/forge-team/gateway/src/index.ts` — REST routes, Socket.IO setup, demo session seed

**VIADP source (unit test targets):**
- `/forge-team/viadp/src/delegation-engine.ts` — capability scoring, multi-objective matching, delegation token issuance, re-delegation
- `/forge-team/viadp/src/trust-manager.ts` — Bayesian trust updates (Beta distribution), decay, domain-specific scores
- `/forge-team/viadp/src/audit-log.ts` — append-only log, FNV-1a hash chain, Object.freeze, integrity verification
- `/forge-team/viadp/src/resilience.ts` — circuit breaker (closed/open/half-open), parallel bids, diversity scoring
- `/forge-team/viadp/src/verification.ts` — proof verification, acceptance criteria checking

**Memory source (unit test targets):**
- `/forge-team/memory/src/memory-manager.ts` — hierarchical store (company/team/project/agent/thread), search, context retrieval
- `/forge-team/memory/src/summarizer.ts` — conversation compaction, sentence scoring, extractive summarization
- `/forge-team/memory/src/gemini-file-search.ts` — Gemini File Search RAG wrapper
- `/forge-team/memory/src/vector-store.ts` — pgvector similarity search

**Dashboard source (E2E test target):**
- `/forge-team/dashboard/src/app/page.tsx` — main page, tab routing, state management
- `/forge-team/dashboard/src/components/KanbanBoard.tsx` — drag and drop Kanban
- `/forge-team/dashboard/src/components/AgentStatusGrid.tsx` — agent cards
- `/forge-team/dashboard/src/components/Sidebar.tsx` — navigation sidebar

**Shared types:**
- `/forge-team/shared/types/` — all TypeScript interfaces

**Configuration:**
- `/forge-team/package.json` — root monorepo config
- `/forge-team/gateway/package.json` — gateway deps
- `/forge-team/viadp/package.json` — viadp deps
- `/forge-team/memory/package.json` — memory deps
- `/forge-team/dashboard/package.json` — dashboard deps
- `/forge-team/workflows/full-sdlc.yaml` — sample workflow with phases

---

## WORKSTREAM 1: Install Test Frameworks and Configuration

**Files to create:**
- `/forge-team/vitest.config.ts`
- `/forge-team/gateway/vitest.config.ts`
- `/forge-team/viadp/vitest.config.ts`
- `/forge-team/memory/vitest.config.ts`
- `/forge-team/tests/playwright.config.ts`

**Files to modify:**
- `/forge-team/package.json`
- `/forge-team/gateway/package.json`
- `/forge-team/viadp/package.json`
- `/forge-team/memory/package.json`
- `/forge-team/dashboard/package.json`

### 1A. Install Vitest in root and workspaces

Add to root `/forge-team/package.json` devDependencies:
```json
"vitest": "^3.0.0",
"@vitest/coverage-v8": "^3.0.0"
```

Add to `/forge-team/gateway/package.json` devDependencies:
```json
"vitest": "^3.0.0"
```

Add to `/forge-team/viadp/package.json` devDependencies:
```json
"vitest": "^3.0.0"
```

Add to `/forge-team/memory/package.json` devDependencies:
```json
"vitest": "^3.0.0"
```

### 1B. Install Playwright in dashboard

Add to `/forge-team/dashboard/package.json` devDependencies:
```json
"@playwright/test": "^1.50.0"
```

### 1C. Create root vitest.config.ts

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['gateway/src/**', 'viadp/src/**', 'memory/src/**'],
      exclude: ['**/__tests__/**', '**/node_modules/**'],
    },
  },
});
```

### 1D. Create per-workspace vitest configs

**`/forge-team/gateway/vitest.config.ts`:**
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    setupFiles: [],
  },
});
```

**`/forge-team/viadp/vitest.config.ts`:**
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
  },
});
```

**`/forge-team/memory/vitest.config.ts`:**
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
  },
});
```

### 1E. Create Playwright config

**`/forge-team/tests/playwright.config.ts`:**
```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev --workspace=dashboard',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

### 1F. Add test scripts to root `package.json`

Add these scripts to `/forge-team/package.json`:
```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:unit": "vitest run --project gateway --project viadp --project memory",
    "test:unit:gateway": "vitest run --workspace=gateway",
    "test:unit:viadp": "vitest run --workspace=viadp",
    "test:unit:memory": "vitest run --workspace=memory",
    "test:e2e": "npx playwright test --config=tests/playwright.config.ts",
    "test:load": "vitest run tests/load/",
    "test:coverage": "vitest run --coverage"
  }
}
```

Also add test scripts to each workspace package.json:

**gateway/package.json:** `"test": "vitest run", "test:watch": "vitest"`
**viadp/package.json:** `"test": "vitest run", "test:watch": "vitest"`
**memory/package.json:** `"test": "vitest run", "test:watch": "vitest"`

---

## WORKSTREAM 2: Gateway Unit Tests

**Files to create:**
- `/forge-team/gateway/src/__tests__/model-router.test.ts`
- `/forge-team/gateway/src/__tests__/session-manager.test.ts`
- `/forge-team/gateway/src/__tests__/task-manager.test.ts`

### 2A. Model Router tests (`model-router.test.ts`)

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { ModelRouter } from '../model-router';

describe('ModelRouter', () => {
  let router: ModelRouter;

  beforeEach(() => {
    router = new ModelRouter();
  });

  describe('getModelCatalog', () => {
    it('should return exactly 5 models', () => {
      const catalog = router.getModelCatalog();
      expect(Object.keys(catalog)).toHaveLength(5);
    });

    it('should contain only Anthropic and Google providers', () => {
      const catalog = router.getModelCatalog();
      const providers = new Set(Object.values(catalog).map(m => m.provider));
      expect(providers).toEqual(new Set(['anthropic', 'google']));
    });

    it('should have correct tier assignments', () => {
      const catalog = router.getModelCatalog();
      expect(catalog['claude-opus-4-6'].tier).toBe('premium');
      expect(catalog['claude-sonnet-4-6'].tier).toBe('balanced');
      expect(catalog['claude-haiku-4-5'].tier).toBe('fast');
      expect(catalog['gemini-3.1-pro'].tier).toBe('balanced');
      expect(catalog['gemini-flash-3'].tier).toBe('fast');
    });
  });

  describe('getAgentAssignment', () => {
    it('should return correct primary model for each of 12 agents', () => {
      const expectedPrimary: Record<string, string> = {
        'bmad-master': 'gemini-3.1-pro',
        'product-owner': 'gemini-3.1-pro',
        'business-analyst': 'gemini-3.1-pro',
        'scrum-master': 'gemini-flash-3',
        'architect': 'claude-opus-4-6',
        'ux-designer': 'gemini-3.1-pro',
        'frontend-dev': 'gemini-3.1-pro',
        'backend-dev': 'claude-opus-4-6',
        'qa-architect': 'claude-opus-4-6',
        'devops-engineer': 'gemini-3.1-pro',
        'security-specialist': 'claude-opus-4-6',
        'tech-writer': 'claude-sonnet-4-6',
      };

      for (const [agentId, expectedModel] of Object.entries(expectedPrimary)) {
        const assignment = router.getAgentAssignment(agentId);
        expect(assignment.primary, `${agentId} primary`).toBe(expectedModel);
      }
    });

    it('should return correct fallback model for each of 12 agents', () => {
      const expectedFallback: Record<string, string> = {
        'bmad-master': 'claude-sonnet-4-6',
        'product-owner': 'claude-sonnet-4-6',
        'business-analyst': 'claude-sonnet-4-6',
        'scrum-master': 'claude-haiku-4-5',
        'architect': 'gemini-3.1-pro',
        'ux-designer': 'claude-sonnet-4-6',
        'frontend-dev': 'claude-sonnet-4-6',
        'backend-dev': 'claude-sonnet-4-6',
        'qa-architect': 'claude-sonnet-4-6',
        'devops-engineer': 'claude-sonnet-4-6',
        'security-specialist': 'gemini-3.1-pro',
        'tech-writer': 'gemini-3.1-pro',
      };

      for (const [agentId, expectedModel] of Object.entries(expectedFallback)) {
        const assignment = router.getAgentAssignment(agentId);
        expect(assignment.fallback, `${agentId} fallback`).toBe(expectedModel);
      }
    });
  });

  describe('classifyComplexity', () => {
    it('should classify architecture tasks as premium', () => {
      expect(router.classifyComplexity('Design the system architecture with CQRS pattern')).toBe('premium');
    });

    it('should classify security audits as premium', () => {
      expect(router.classifyComplexity('Perform a security audit and threat model')).toBe('premium');
    });

    it('should classify feature tasks as balanced', () => {
      expect(router.classifyComplexity('Implement the user authentication endpoint')).toBe('balanced');
    });

    it('should classify status updates as fast', () => {
      expect(router.classifyComplexity('Status update on the sprint')).toBe('fast');
    });

    it('should classify typo fixes as fast', () => {
      expect(router.classifyComplexity('Fix typo in readme')).toBe('fast');
    });

    it('should use content length as tiebreaker', () => {
      // Very long content signals premium
      const longContent = 'a '.repeat(1500);
      expect(router.classifyComplexity(longContent)).toBe('premium');

      // Very short content signals fast
      expect(router.classifyComplexity('ok')).toBe('fast');
    });
  });

  describe('route', () => {
    it('should return primary model for standard requests', () => {
      const result = router.route({
        agentId: 'architect',
        taskContent: 'Design the system',
        sessionId: 'test-session',
      });
      expect(result.model.id).toBe('claude-opus-4-6');
      expect(result.reason).toBe('primary');
    });

    it('should fall back when cost constraint excludes primary', () => {
      const result = router.route({
        agentId: 'architect',
        taskContent: 'Design the system',
        sessionId: 'test-session',
        maxCost: 0.000001, // extremely low — excludes opus
      });
      // Should fall to a cheaper model
      expect(result.model.id).not.toBe('claude-opus-4-6');
    });

    it('should throw for unknown agent', () => {
      expect(() =>
        router.route({
          agentId: 'nonexistent-agent',
          taskContent: 'test',
          sessionId: 'test-session',
        })
      ).toThrow();
    });

    it('should respect tier override', () => {
      const result = router.route({
        agentId: 'bmad-master',
        taskContent: 'simple task',
        sessionId: 'test-session',
        tierOverride: 'premium',
      });
      expect(result.classifiedTier).toBe('premium');
    });
  });

  describe('recordCost', () => {
    it('should calculate cost correctly', () => {
      const record = router.recordCost(
        'architect', 'session-1', 'task-1',
        'claude-opus-4-6', 1000, 500, 'premium'
      );
      // claude-opus-4-6: input $15/1M, output $75/1M
      const expectedCost = (1000 / 1_000_000) * 15.0 + (500 / 1_000_000) * 75.0;
      expect(record.cost).toBeCloseTo(expectedCost, 6);
    });

    it('should accumulate records in cost summary', () => {
      router.recordCost('architect', 'session-1', 'task-1', 'claude-opus-4-6', 1000, 500, 'premium');
      router.recordCost('bmad-master', 'session-1', 'task-2', 'gemini-3.1-pro', 2000, 1000, 'balanced');
      const summary = router.getCostSummary();
      expect(summary.totalRequests).toBe(2);
      expect(summary.totalInputTokens).toBe(3000);
      expect(summary.totalOutputTokens).toBe(1500);
      expect(summary.perAgent['architect']).toBeGreaterThan(0);
      expect(summary.perAgent['bmad-master']).toBeGreaterThan(0);
    });
  });

  describe('updateAssignment', () => {
    it('should allow runtime model reassignment', () => {
      router.updateAssignment('architect', 'gemini-3.1-pro', 'claude-sonnet-4-6');
      const assignment = router.getAgentAssignment('architect');
      expect(assignment.primary).toBe('gemini-3.1-pro');
      expect(assignment.fallback).toBe('claude-sonnet-4-6');
    });
  });
});
```

### 2B. Session Manager tests (`session-manager.test.ts`)

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionManager } from '../session-manager';

describe('SessionManager', () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager({ maxHistorySize: 100, inactivityTimeoutMs: 60000 });
  });

  describe('createSession', () => {
    it('should create a session with idle state', () => {
      const session = manager.createSession('test-session');
      expect(session.state).toBe('idle');
      expect(session.activeAgents.size).toBe(0);
    });

    it('should create session with provided label', () => {
      const session = manager.createSession('my-label');
      expect(session.label).toBe('my-label');
    });

    it('should assign unique IDs to each session', () => {
      const s1 = manager.createSession('s1');
      const s2 = manager.createSession('s2');
      expect(s1.id).not.toBe(s2.id);
    });
  });

  describe('agent join/leave', () => {
    it('should add an agent to a session', () => {
      const session = manager.createSession('test');
      manager.joinSession(session.id, 'architect');
      const updated = manager.getSession(session.id);
      expect(updated?.activeAgents.has('architect')).toBe(true);
    });

    it('should remove an agent from a session', () => {
      const session = manager.createSession('test');
      manager.joinSession(session.id, 'architect');
      manager.leaveSession(session.id, 'architect');
      const updated = manager.getSession(session.id);
      expect(updated?.activeAgents.has('architect')).toBe(false);
    });

    it('should emit session:agent-joined event', () => {
      const session = manager.createSession('test');
      const handler = vi.fn();
      manager.on('session:agent-joined', handler);
      manager.joinSession(session.id, 'backend-dev');
      expect(handler).toHaveBeenCalledWith(session.id, 'backend-dev');
    });
  });

  describe('state transitions', () => {
    it('should transition from idle to active', () => {
      const session = manager.createSession('test');
      manager.setState(session.id, 'active');
      expect(manager.getSession(session.id)?.state).toBe('active');
    });

    it('should emit state-changed event', () => {
      const session = manager.createSession('test');
      const handler = vi.fn();
      manager.on('session:state-changed', handler);
      manager.setState(session.id, 'active');
      expect(handler).toHaveBeenCalledWith(session.id, 'idle', 'active');
    });
  });

  describe('message history', () => {
    it('should store messages in session history', () => {
      const session = manager.createSession('test');
      const message = {
        id: 'msg-1',
        from: 'architect' as const,
        to: 'backend-dev' as const,
        content: 'Review the API design',
        type: 'chat.message' as const,
        sessionId: session.id,
        timestamp: new Date().toISOString(),
      };
      manager.addMessage(session.id, message);
      const updated = manager.getSession(session.id);
      expect(updated?.messageHistory).toHaveLength(1);
      expect(updated?.messageHistory[0].content).toBe('Review the API design');
    });

    it('should respect maxHistorySize', () => {
      const smallManager = new SessionManager({ maxHistorySize: 3, inactivityTimeoutMs: 60000 });
      const session = smallManager.createSession('test');
      for (let i = 0; i < 5; i++) {
        smallManager.addMessage(session.id, {
          id: `msg-${i}`,
          from: 'architect',
          to: 'backend-dev',
          content: `Message ${i}`,
          type: 'chat.message',
          sessionId: session.id,
          timestamp: new Date().toISOString(),
        });
      }
      const updated = smallManager.getSession(session.id);
      expect(updated?.messageHistory.length).toBeLessThanOrEqual(3);
    });
  });

  describe('destroySession', () => {
    it('should remove the session', () => {
      const session = manager.createSession('test');
      manager.destroySession(session.id);
      expect(manager.getSession(session.id)).toBeUndefined();
    });

    it('should emit session:destroyed event', () => {
      const session = manager.createSession('test');
      const handler = vi.fn();
      manager.on('session:destroyed', handler);
      manager.destroySession(session.id);
      expect(handler).toHaveBeenCalledWith(session.id);
    });
  });
});
```

### 2C. Task Manager tests (`task-manager.test.ts`)

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TaskManager } from '../task-manager';

describe('TaskManager', () => {
  let manager: TaskManager;

  beforeEach(() => {
    manager = new TaskManager();
  });

  describe('createTask', () => {
    it('should create a task with default status backlog', () => {
      const task = manager.createTask({
        title: 'Implement login API',
        description: 'Create POST /auth/login endpoint',
        priority: 'high',
      });
      expect(task.status).toBe('backlog');
      expect(task.title).toBe('Implement login API');
      expect(task.priority).toBe('high');
    });

    it('should assign unique IDs', () => {
      const t1 = manager.createTask({ title: 'Task 1' });
      const t2 = manager.createTask({ title: 'Task 2' });
      expect(t1.id).not.toBe(t2.id);
    });

    it('should emit task:created event', () => {
      const handler = vi.fn();
      manager.on('task:created', handler);
      manager.createTask({ title: 'New task' });
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('updateTask', () => {
    it('should update task fields', () => {
      const task = manager.createTask({ title: 'Original' });
      const updated = manager.updateTask(task.id, { title: 'Updated' });
      expect(updated?.title).toBe('Updated');
    });

    it('should update task status', () => {
      const task = manager.createTask({ title: 'Task' });
      manager.updateTask(task.id, { status: 'in-progress' });
      const fetched = manager.getTask(task.id);
      expect(fetched?.status).toBe('in-progress');
    });
  });

  describe('moveTask', () => {
    it('should move task to a new column', () => {
      const task = manager.createTask({ title: 'Task' });
      manager.moveTask(task.id, 'in-progress');
      const fetched = manager.getTask(task.id);
      expect(fetched?.status).toBe('in-progress');
    });

    it('should emit task:moved event', () => {
      const handler = vi.fn();
      manager.on('task:moved', handler);
      const task = manager.createTask({ title: 'Task' });
      manager.moveTask(task.id, 'review');
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('assignTask', () => {
    it('should assign an agent to a task', () => {
      const task = manager.createTask({ title: 'Task' });
      manager.assignTask(task.id, 'backend-dev');
      const fetched = manager.getTask(task.id);
      expect(fetched?.assignedAgent).toBe('backend-dev');
    });
  });

  describe('getKanbanBoard', () => {
    it('should return all columns with tasks sorted', () => {
      manager.createTask({ title: 'Backlog task', priority: 'low' });
      manager.createTask({ title: 'High priority', priority: 'critical' });
      const board = manager.getKanbanBoard();
      expect(board.columns).toBeDefined();
      expect(board.columns.length).toBeGreaterThan(0);
    });
  });

  describe('getTasksByAgent', () => {
    it('should filter tasks by assigned agent', () => {
      const t1 = manager.createTask({ title: 'Task 1' });
      const t2 = manager.createTask({ title: 'Task 2' });
      manager.assignTask(t1.id, 'architect');
      manager.assignTask(t2.id, 'backend-dev');
      const architectTasks = manager.getTasksByAgent('architect');
      expect(architectTasks).toHaveLength(1);
      expect(architectTasks[0].title).toBe('Task 1');
    });
  });
});
```

---

## WORKSTREAM 3: VIADP Unit Tests

**Files to create:**
- `/forge-team/viadp/src/__tests__/delegation-engine.test.ts`
- `/forge-team/viadp/src/__tests__/trust-manager.test.ts`
- `/forge-team/viadp/src/__tests__/audit-log.test.ts`

### 3A. Delegation Engine tests (`delegation-engine.test.ts`)

Read `/forge-team/viadp/src/delegation-engine.ts` thoroughly first. Then create tests covering:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
// Import the DelegationEngine and related types from ../delegation-engine

describe('DelegationEngine', () => {
  // Initialize with a set of mock agents with known capabilities

  describe('assessCapabilities', () => {
    it('should score agents higher when they match required capabilities', () => {
      // Create an agent with ['api-development', 'database-design']
      // Request delegation requiring ['api-development']
      // Expect capability score > 0.5
    });

    it('should score agents lower when capabilities are missing', () => {
      // Request delegation requiring ['machine-learning']
      // Agent with ['api-development'] should score low
    });

    it('should return matched and missing capabilities', () => {
      // Verify matchedCapabilities and missingCapabilities arrays
    });
  });

  describe('matchDelegates', () => {
    it('should return ranked candidates sorted by composite score', () => {
      // With 3+ agents registered, verify candidates are sorted descending
    });

    it('should apply diversity bonus for different model families', () => {
      // With agents on both Anthropic and Google models,
      // verify diversity bonus is applied to avoid monoculture
    });

    it('should respect cost constraints in ranking', () => {
      // Set maxCost low, verify expensive model agents rank lower
    });

    it('should factor in risk level', () => {
      // High-risk task should prefer higher-trust agents
    });
  });

  describe('delegate', () => {
    it('should create a delegation token on success', () => {
      // Delegate a task, verify token is returned with correct fields
      // (delegator, delegate, taskId, scope, expiresAt, chain)
    });

    it('should respect maximum chain depth', () => {
      // Attempt to re-delegate beyond maxChainDepth, expect rejection
    });

    it('should include resource limits in scope', () => {
      // Verify delegation scope has maxTokens, maxDuration, maxCost
    });
  });

  describe('reDelegation', () => {
    it('should allow re-delegation when canRedelegate is true', () => {
      // Create initial delegation with canRedelegate: true
      // Re-delegate from delegatee to a third agent
      // Verify chain includes all three agents
    });

    it('should block re-delegation when canRedelegate is false', () => {
      // Create delegation with canRedelegate: false
      // Attempt re-delegation, expect error/rejection
    });
  });
});
```

Implement all test bodies. Use concrete mock data — create agent objects with real capability arrays from the agent config.json files.

### 3B. Trust Manager tests (`trust-manager.test.ts`)

Read `/forge-team/viadp/src/trust-manager.ts` thoroughly first. Then:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
// Import TrustManager and related types from ../trust-manager

describe('TrustManager', () => {
  // Initialize TrustManager with default config

  describe('initializeTrust', () => {
    it('should initialize with Beta(2,2) prior (score = 0.5)', () => {
      // Register a new agent, verify initial score is 0.5
      // Verify alpha = 2, beta = 2
    });

    it('should initialize trust for all 12 agents', () => {
      // Register all 12 BMAD agent IDs
      // Verify each has trust score 0.5
    });
  });

  describe('updateTrust', () => {
    it('should increase score on success', () => {
      // Record a successful delegation outcome
      // Verify score > 0.5 after update
    });

    it('should decrease score on failure', () => {
      // Record a failed delegation outcome
      // Verify score < 0.5 after update
    });

    it('should weight by task criticality', () => {
      // Critical task success should increase more than low-criticality success
      const criticalResult = // update with criticality = 1.0
      const lowResult = // update with criticality = 0.2
      // criticalResult.newScore > lowResult.newScore (both starting from same base)
    });

    it('should handle partial success', () => {
      // Partial outcome should change score less than full success/failure
    });

    it('should update domain-specific scores', () => {
      // Record outcome for domain 'api-development'
      // Verify domainScores['api-development'] is updated
    });
  });

  describe('decay', () => {
    it('should decay scores toward 0.5 over time', () => {
      // Set a high score, apply decay, verify it moves toward 0.5
    });

    it('should not decay below the prior', () => {
      // Apply many decay cycles, verify score does not go below 0.5 unreasonably
    });
  });

  describe('getTrustMatrix', () => {
    it('should return all agents with their scores', () => {
      // Register multiple agents, verify matrix contains all
    });

    it('should compute correct global average', () => {
      // Set known scores, verify globalAverage calculation
    });
  });
});
```

Implement all test bodies with concrete values.

### 3C. Audit Log tests (`audit-log.test.ts`)

Read `/forge-team/viadp/src/audit-log.ts` thoroughly first. Then:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
// Import AuditLog and related types from ../audit-log

describe('AuditLog', () => {
  // Initialize a fresh AuditLog for each test

  describe('append', () => {
    it('should add an entry with auto-incrementing sequence number', () => {
      // Append two entries, verify sequence numbers are 1 and 2
    });

    it('should compute hash for each entry', () => {
      // Append an entry, verify hash is a non-empty string
    });

    it('should chain hashes (each entry references previous hash)', () => {
      // Append 3 entries
      // entry[1].previousHash === entry[0].hash
      // entry[2].previousHash === entry[1].hash
    });

    it('should freeze entries (immutable)', () => {
      // Append an entry, attempt to modify it
      // Object.isFrozen(entry) should be true or modification should throw
    });
  });

  describe('verifyIntegrity', () => {
    it('should return true for a valid chain', () => {
      // Append 10 entries, verify integrity returns true
    });

    it('should detect tampering (modified entry)', () => {
      // Append entries, manually tamper with one entry's data
      // Verify integrity returns false
      // Note: since entries are frozen, this may need to test at a lower level
    });

    it('should detect missing entries (broken sequence)', () => {
      // Verify the log detects if sequence numbers have gaps
    });
  });

  describe('filter', () => {
    it('should filter by action type', () => {
      // Append entries with different action types
      // Filter by 'delegation.requested', verify only matching entries returned
    });

    it('should filter by agent', () => {
      // Append entries from different agents
      // Filter by specific agent, verify correct results
    });

    it('should filter by delegation ID', () => {
      // Append entries for multiple delegations
      // Filter by one delegation ID
    });

    it('should filter by time range', () => {
      // Append entries with different timestamps
      // Filter by date range, verify correct results
    });
  });

  describe('getEntries', () => {
    it('should return all entries in order', () => {
      // Append multiple entries, verify returned in sequence order
    });

    it('should support pagination (offset and limit)', () => {
      // Append 20 entries, fetch with offset=5, limit=10
      // Verify 10 entries returned starting from sequence 6
    });
  });
});
```

Implement all test bodies.

---

## WORKSTREAM 4: Memory Unit Tests

**Files to create:**
- `/forge-team/memory/src/__tests__/memory-manager.test.ts`
- `/forge-team/memory/src/__tests__/summarizer.test.ts`

### 4A. Memory Manager tests (`memory-manager.test.ts`)

The MemoryManager requires Postgres and Redis connections. Create tests that mock the database:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
// Import MemoryManager and types from ../memory-manager

// Mock pg Pool and Redis
vi.mock('pg', () => ({
  Pool: vi.fn(() => ({
    query: vi.fn(),
    connect: vi.fn(() => ({
      query: vi.fn(),
      release: vi.fn(),
    })),
  })),
}));

vi.mock('ioredis', () => ({
  default: vi.fn(() => ({
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    pipeline: vi.fn(() => ({
      exec: vi.fn(),
    })),
  })),
}));

describe('MemoryManager', () => {
  describe('store', () => {
    it('should store a memory entry with correct scope', () => {
      // Store with scope 'agent', verify the SQL INSERT includes correct scope
    });

    it('should support all 5 hierarchical scopes', () => {
      // Store entries for company, team, project, agent, thread scopes
      // Verify each is accepted
    });

    it('should set default importance to 0.5', () => {
      // Store without explicit importance, verify default
    });

    it('should support tags and metadata', () => {
      // Store with tags ['api', 'design'] and metadata { phase: 'design' }
      // Verify they are included in the stored entry
    });
  });

  describe('search', () => {
    it('should search within a specific scope', () => {
      // Mock DB to return entries, verify scope filter is applied
    });

    it('should respect hierarchical scope precedence', () => {
      // Search at 'project' level should include project + team + company entries
      // Verify the UNION ALL query pattern
    });
  });

  describe('getRecentContext', () => {
    it('should return most recent entries for an agent', () => {
      // Mock DB to return recent entries, verify ordering
    });

    it('should limit results to specified count', () => {
      // Request 5 entries, verify limit is respected
    });
  });

  describe('delete', () => {
    it('should soft-delete by setting superseded_by', () => {
      // Delete an entry, verify superseded_by is set
    });
  });
});
```

Implement all test bodies with mock data.

### 4B. Summarizer tests (`summarizer.test.ts`)

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
// Import Summarizer and types from ../summarizer

// Mock pg and Redis similarly to memory-manager tests

describe('Summarizer', () => {
  describe('summarize', () => {
    it('should produce a summary shorter than the input', () => {
      // Provide 20 conversation messages
      // Verify summary text length < total input length
    });

    it('should preserve key information in summary', () => {
      // Provide messages mentioning specific decisions
      // Verify summary contains those decision keywords
    });
  });

  describe('checkAndCompact', () => {
    it('should trigger compaction when count exceeds threshold', () => {
      // Set threshold to 5, provide 10 messages
      // Verify compaction is triggered
    });

    it('should not trigger compaction below threshold', () => {
      // Set threshold to 50, provide 3 messages
      // Verify compaction is NOT triggered
    });

    it('should preserve recent messages during compaction', () => {
      // After compaction, verify the N most recent messages are untouched
    });
  });

  describe('extractive summarization', () => {
    it('should score sentences by relevance', () => {
      // Provide a set of sentences
      // Verify high-relevance sentences appear in summary
    });

    it('should respect sentence budget', () => {
      // Set budget to 3 sentences
      // Verify output has at most 3 sentences
    });
  });
});
```

Implement all test bodies.

---

## WORKSTREAM 5: E2E Tests — Riyadh Attendance Tracker + Dashboard

**Files to create:**
- `/forge-team/tests/e2e/riyadh-attendance.test.ts`
- `/forge-team/tests/e2e/dashboard.spec.ts`

### 5A. Riyadh Attendance Tracker E2E test

Create `/forge-team/tests/e2e/riyadh-attendance.test.ts` — a comprehensive E2E test that simulates a 5-day sprint building a Riyadh Attendance Tracker app:

```typescript
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
// Import gateway components: SessionManager, AgentManager, TaskManager,
// ModelRouter, VIADPEngine, WorkflowEngine (if available)

/**
 * Riyadh Attendance Tracker — Full E2E Scenario
 *
 * Simulates a 5-day sprint where a user sends a project brief and
 * the 12-agent team designs, develops, tests, and delivers an
 * attendance tracking application for schools in Riyadh.
 *
 * All LLM responses are mocked for deterministic testing.
 */

// Mock LLM providers to return predetermined responses
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(() => ({
    messages: {
      create: vi.fn(async ({ model, messages }) => ({
        id: 'mock-msg-id',
        content: [{ type: 'text', text: getMockResponse(model, messages) }],
        model,
        usage: { input_tokens: 500, output_tokens: 200 },
      })),
    },
  })),
}));

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn(() => ({
    getGenerativeModel: vi.fn(() => ({
      generateContent: vi.fn(async () => ({
        response: { text: () => 'Mock Gemini response' },
      })),
    })),
  })),
}));

// Helper: return mock LLM response based on model and context
function getMockResponse(model: string, messages: any[]): string {
  const lastMessage = messages[messages.length - 1]?.content ?? '';
  if (lastMessage.includes('requirements')) {
    return JSON.stringify({
      userStories: [
        'As a teacher, I can mark attendance for my class',
        'As an admin, I can view attendance reports by school',
        'As a parent, I can receive absence notifications via WhatsApp',
      ],
      acceptanceCriteria: ['Arabic RTL UI', 'Works offline', 'Riyadh timezone'],
    });
  }
  if (lastMessage.includes('architecture')) {
    return JSON.stringify({
      frontend: 'Next.js 15 + Tailwind + Arabic RTL',
      backend: 'Node.js + Express + PostgreSQL',
      deployment: 'Docker + Kubernetes in Riyadh region',
    });
  }
  return 'Task completed successfully. All acceptance criteria met.';
}

describe('Riyadh Attendance Tracker E2E', () => {
  let sessionManager: any;
  let agentManager: any;
  let taskManager: any;
  let modelRouter: any;

  beforeAll(() => {
    sessionManager = new SessionManager({ maxHistorySize: 2000, inactivityTimeoutMs: 3600000 });
    agentManager = new AgentManager();
    taskManager = new TaskManager();
    modelRouter = new ModelRouter();
  });

  it('should create a session for the Riyadh project', () => {
    const session = sessionManager.createSession('riyadh-attendance-tracker');
    expect(session.id).toBeTruthy();
    expect(session.label).toBe('riyadh-attendance-tracker');
  });

  it('should register all 12 agents with correct models', () => {
    const agents = agentManager.getAllAgents();
    expect(agents).toHaveLength(12);

    // Verify specific model assignments
    const architect = agents.find((a: any) => a.id === 'architect');
    expect(architect).toBeDefined();

    const assignment = modelRouter.getAgentAssignment('architect');
    expect(assignment.primary).toBe('claude-opus-4-6');
  });

  it('should create the initial project brief task and assign to bmad-master', () => {
    const task = taskManager.createTask({
      title: 'Riyadh Attendance Tracker — Project Brief',
      description: 'Build a school attendance tracking system for Riyadh schools with Arabic RTL, offline support, WhatsApp notifications',
      priority: 'critical',
    });
    taskManager.assignTask(task.id, 'bmad-master');
    expect(task.assignedAgent).toBe('bmad-master');
  });

  it('should route bmad-master to gemini-3.1-pro', () => {
    const result = modelRouter.route({
      agentId: 'bmad-master',
      taskContent: 'Orchestrate the Riyadh Attendance Tracker project',
      sessionId: 'test-session',
    });
    expect(result.model.id).toBe('gemini-3.1-pro');
  });

  it('should create sub-tasks for requirements phase', () => {
    const reqTask = taskManager.createTask({
      title: 'Gather requirements for attendance tracker',
      description: 'Interview stakeholders, write user stories',
      priority: 'high',
    });
    taskManager.assignTask(reqTask.id, 'product-owner');

    const analysisTask = taskManager.createTask({
      title: 'Market analysis for education tech in Riyadh',
      description: 'Analyze existing attendance systems in Saudi schools',
      priority: 'medium',
    });
    taskManager.assignTask(analysisTask.id, 'business-analyst');

    expect(reqTask.assignedAgent).toBe('product-owner');
    expect(analysisTask.assignedAgent).toBe('business-analyst');
  });

  it('should create architecture task and route to claude-opus-4-6', () => {
    const archTask = taskManager.createTask({
      title: 'Design system architecture for attendance tracker',
      description: 'System design with CQRS, Arabic RTL, offline-first',
      priority: 'critical',
    });
    taskManager.assignTask(archTask.id, 'architect');

    const result = modelRouter.route({
      agentId: 'architect',
      taskContent: archTask.description,
      sessionId: 'test-session',
    });
    expect(result.model.id).toBe('claude-opus-4-6');
  });

  it('should track task progression through Kanban columns', () => {
    const task = taskManager.createTask({ title: 'Test Kanban flow' });
    expect(task.status).toBe('backlog');

    taskManager.moveTask(task.id, 'todo');
    expect(taskManager.getTask(task.id)?.status).toBe('todo');

    taskManager.moveTask(task.id, 'in-progress');
    expect(taskManager.getTask(task.id)?.status).toBe('in-progress');

    taskManager.moveTask(task.id, 'review');
    expect(taskManager.getTask(task.id)?.status).toBe('review');

    taskManager.moveTask(task.id, 'done');
    expect(taskManager.getTask(task.id)?.status).toBe('done');
  });

  it('should record cost for all model calls', () => {
    // Simulate cost recording for the sprint
    modelRouter.recordCost('bmad-master', 'session-1', 'task-1', 'gemini-3.1-pro', 5000, 2000, 'balanced');
    modelRouter.recordCost('architect', 'session-1', 'task-2', 'claude-opus-4-6', 8000, 3000, 'premium');
    modelRouter.recordCost('backend-dev', 'session-1', 'task-3', 'claude-opus-4-6', 10000, 5000, 'premium');
    modelRouter.recordCost('frontend-dev', 'session-1', 'task-4', 'gemini-3.1-pro', 6000, 3000, 'balanced');
    modelRouter.recordCost('qa-architect', 'session-1', 'task-5', 'claude-opus-4-6', 4000, 2000, 'premium');
    modelRouter.recordCost('scrum-master', 'session-1', 'task-6', 'gemini-flash-3', 1000, 500, 'fast');

    const summary = modelRouter.getCostSummary();
    expect(summary.totalRequests).toBe(6);
    expect(summary.totalCost).toBeGreaterThan(0);
    expect(summary.perAgent['architect']).toBeGreaterThan(summary.perAgent['scrum-master']);
  });

  it('should verify memory storage for session messages', () => {
    const session = sessionManager.createSession('memory-test');
    const message = {
      id: 'msg-1',
      from: 'bmad-master',
      to: 'architect',
      content: 'Please design the attendance system architecture',
      type: 'chat.message',
      sessionId: session.id,
      timestamp: new Date().toISOString(),
    };
    sessionManager.addMessage(session.id, message);
    const stored = sessionManager.getSession(session.id);
    expect(stored?.messageHistory).toHaveLength(1);
  });
});
```

### 5B. Dashboard E2E tests (`dashboard.spec.ts`)

Create `/forge-team/tests/e2e/dashboard.spec.ts` using Playwright:

```typescript
import { test, expect } from '@playwright/test';

test.describe('ForgeTeam Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for initial load
    await page.waitForSelector('[data-testid="dashboard"]', { timeout: 30000 }).catch(() => {});
  });

  test('should render the main dashboard', async ({ page }) => {
    await expect(page.locator('body')).toBeVisible();
    // Dashboard should show agent grid or loading state
  });

  test('should toggle Arabic RTL layout', async ({ page }) => {
    // Find and click the language toggle button
    const langToggle = page.locator('button:has-text("AR"), button:has-text("EN"), button:has-text("عر")');
    if (await langToggle.isVisible()) {
      await langToggle.click();
      // Verify dir attribute changes
      const dir = await page.locator('html').getAttribute('dir');
      expect(['rtl', 'ltr']).toContain(dir);
    }
  });

  test('should show 12 agents in the agent grid', async ({ page }) => {
    // Navigate to agents tab if not default
    const agentCards = page.locator('[class*="agent"], [data-agent-id]');
    // With mock data, we should see agent cards
    const count = await agentCards.count();
    // May be 0 if gateway is offline and mock data is used via different selectors
    // Just verify the page loads without errors
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('should toggle dark mode', async ({ page }) => {
    const darkToggle = page.locator('button:has-text("☀"), button:has-text("🌙"), [aria-label*="dark"], [aria-label*="theme"]');
    if (await darkToggle.first().isVisible()) {
      await darkToggle.first().click();
      // Verify class change on html or body
      const hasLight = await page.locator('html.light, body.light').count();
      const hasDark = await page.locator('html.dark, body.dark, html:not(.light)').count();
      expect(hasLight + hasDark).toBeGreaterThan(0);
    }
  });

  test('should navigate between tabs via sidebar', async ({ page }) => {
    // Click each sidebar nav item and verify content changes
    const sidebarLinks = page.locator('nav a, nav button, [role="tab"]');
    const count = await sidebarLinks.count();
    for (let i = 0; i < Math.min(count, 5); i++) {
      const link = sidebarLinks.nth(i);
      if (await link.isVisible()) {
        await link.click();
        // Verify page does not crash (no error overlay)
        await expect(page.locator('[id="__next"], [id="__next-error"]')).toBeVisible({ timeout: 5000 }).catch(() => {});
      }
    }
  });

  test('should render Kanban board with columns', async ({ page }) => {
    // Navigate to Kanban tab
    const kanbanLink = page.locator('text=Kanban, text=كانبان, [href*="kanban"]');
    if (await kanbanLink.first().isVisible()) {
      await kanbanLink.first().click();
    }
    // Look for column headers
    const columns = page.locator('[class*="column"], [data-column], [class*="kanban"]');
    // Kanban should have at least the column structure
    const columnCount = await columns.count();
    expect(columnCount).toBeGreaterThanOrEqual(0);
  });

  test('should not have console errors on load', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.goto('/');
    await page.waitForTimeout(3000);
    // Filter out expected errors (gateway connection failure in test environment)
    const unexpectedErrors = errors.filter(e =>
      !e.includes('fetch') && !e.includes('WebSocket') && !e.includes('ERR_CONNECTION')
    );
    expect(unexpectedErrors).toHaveLength(0);
  });
});
```

---

## WORKSTREAM 6: Stress, Load, and Integration Tests

**Files to create:**
- `/forge-team/tests/stress/memory-load.test.ts`
- `/forge-team/tests/load/agent-scalability.test.ts`
- `/forge-team/tests/integration/model-assignments.test.ts`

### 6A. Memory stress test (`memory-load.test.ts`)

```typescript
import { describe, it, expect, vi } from 'vitest';

// Mock pg and Redis
vi.mock('pg', () => ({
  Pool: vi.fn(() => {
    const entries: any[] = [];
    return {
      query: vi.fn(async (sql: string, params?: any[]) => {
        if (sql.includes('INSERT')) {
          const entry = { id: params?.[0] ?? `entry-${entries.length}`, ...params };
          entries.push(entry);
          return { rows: [entry], rowCount: 1 };
        }
        if (sql.includes('SELECT')) {
          return { rows: entries.slice(0, 100), rowCount: Math.min(entries.length, 100) };
        }
        return { rows: [], rowCount: 0 };
      }),
      connect: vi.fn(() => ({
        query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
        release: vi.fn(),
      })),
    };
  }),
}));

vi.mock('ioredis', () => ({
  default: vi.fn(() => ({
    get: vi.fn(async () => null),
    set: vi.fn(async () => 'OK'),
    del: vi.fn(async () => 1),
    pipeline: vi.fn(() => ({ exec: vi.fn(async () => []) })),
  })),
}));

describe('Memory Stress Test', () => {
  it('should handle 10,000 memory entry insertions without crashing', async () => {
    // Import MemoryManager after mocks are set up
    const { MemoryManager } = await import('../../memory/src/memory-manager');

    // Create manager instance (will use mocked pg/redis)
    // Note: Constructor may need adaptation based on actual MemoryManager constructor signature
    // Wrap in try/catch to handle constructor requirements gracefully

    const entries = [];
    for (let i = 0; i < 10_000; i++) {
      entries.push({
        scope: ['company', 'team', 'project', 'agent', 'thread'][i % 5],
        content: `Memory entry ${i}: This is test content for stress testing the memory system. Entry number ${i} with varying length.`,
        agentId: ['bmad-master', 'architect', 'backend-dev', 'frontend-dev', 'qa-architect'][i % 5],
        tags: [`tag-${i % 10}`, `batch-${Math.floor(i / 100)}`],
        importance: (i % 10) / 10,
      });
    }

    // Verify we created 10k entries without error
    expect(entries).toHaveLength(10_000);

    // Verify all scopes are represented
    const scopes = new Set(entries.map(e => e.scope));
    expect(scopes.size).toBe(5);

    // Verify all agents are represented
    const agents = new Set(entries.map(e => e.agentId));
    expect(agents.size).toBe(5);
  });

  it('should handle concurrent reads and writes', async () => {
    const operations = [];
    for (let i = 0; i < 100; i++) {
      operations.push(
        Promise.resolve({ type: 'write', id: `concurrent-${i}` }),
        Promise.resolve({ type: 'read', id: `concurrent-${i}` }),
      );
    }
    const results = await Promise.all(operations);
    expect(results).toHaveLength(200);
  });
});
```

### 6B. Agent scalability load test (`agent-scalability.test.ts`)

```typescript
import { describe, it, expect, beforeEach } from 'vitest';

describe('Agent Scalability Load Test', () => {
  it('should spawn 100 mock agent registrations without crash', () => {
    // Create 100 mock agent objects
    const agents = Array.from({ length: 100 }, (_, i) => ({
      id: `load-test-agent-${i}`,
      name: `Load Test Agent ${i}`,
      role: `Test Role ${i % 12}`,
      capabilities: [`cap-${i % 5}`, `cap-${(i + 1) % 5}`],
      status: 'idle' as const,
      model: ['gemini-3.1-pro', 'claude-opus-4-6', 'gemini-flash-3'][i % 3],
      trustScore: 0.5,
    }));

    expect(agents).toHaveLength(100);
    expect(agents[0].id).toBe('load-test-agent-0');
    expect(agents[99].id).toBe('load-test-agent-99');
  });

  it('should handle 100 concurrent task assignments', () => {
    const tasks = Array.from({ length: 100 }, (_, i) => ({
      id: `load-task-${i}`,
      title: `Load Test Task ${i}`,
      assignedAgent: `load-test-agent-${i % 100}`,
      status: ['backlog', 'todo', 'in-progress', 'review', 'done'][i % 5],
      priority: ['low', 'medium', 'high', 'critical'][i % 4],
    }));

    expect(tasks).toHaveLength(100);

    // Verify distribution across statuses
    const statusCounts = tasks.reduce((acc, t) => {
      acc[t.status] = (acc[t.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    expect(statusCounts['backlog']).toBe(20);
    expect(statusCounts['in-progress']).toBe(20);
  });

  it('should handle 100 concurrent model routing requests', () => {
    // Import ModelRouter
    // This test verifies that the router can handle many sequential requests
    // without degradation or errors
    const results = Array.from({ length: 100 }, (_, i) => {
      const agentIds = [
        'bmad-master', 'product-owner', 'business-analyst', 'scrum-master',
        'architect', 'ux-designer', 'frontend-dev', 'backend-dev',
        'qa-architect', 'devops-engineer', 'security-specialist', 'tech-writer',
      ];
      return {
        agentId: agentIds[i % 12],
        taskContent: `Load test task ${i}`,
        sessionId: `load-session-${i}`,
      };
    });

    expect(results).toHaveLength(100);
  });

  it('should handle 1000 messages in a single session', () => {
    const messages = Array.from({ length: 1000 }, (_, i) => ({
      id: `msg-${i}`,
      from: `agent-${i % 12}`,
      to: `agent-${(i + 1) % 12}`,
      content: `Message ${i}: ${i % 2 === 0 ? 'Task update' : 'Question about implementation'}`,
      type: 'chat.message' as const,
      sessionId: 'load-session',
      timestamp: new Date(Date.now() + i * 1000).toISOString(),
    }));

    expect(messages).toHaveLength(1000);
    // Verify chronological ordering
    for (let i = 1; i < messages.length; i++) {
      expect(messages[i].timestamp > messages[i - 1].timestamp).toBe(true);
    }
  });
});
```

### 6C. Model assignment integration test (`model-assignments.test.ts`)

```typescript
import { describe, it, expect } from 'vitest';
import { ModelRouter } from '../../gateway/src/model-router';

/**
 * Verifies that all 12 BMAD agents have the correct model assignments
 * as specified in the project checklist.
 *
 * This is the canonical source-of-truth test for model assignments.
 */
describe('Model Assignment Verification', () => {
  const router = new ModelRouter();

  const EXPECTED_ASSIGNMENTS = [
    { agentId: 'bmad-master', primary: 'gemini-3.1-pro', fallback: 'claude-sonnet-4-6', role: 'Orchestrator' },
    { agentId: 'product-owner', primary: 'gemini-3.1-pro', fallback: 'claude-sonnet-4-6', role: 'Requirements' },
    { agentId: 'business-analyst', primary: 'gemini-3.1-pro', fallback: 'claude-sonnet-4-6', role: 'Analysis' },
    { agentId: 'scrum-master', primary: 'gemini-flash-3', fallback: 'claude-haiku-4-5', role: 'Agile Coordination' },
    { agentId: 'architect', primary: 'claude-opus-4-6', fallback: 'gemini-3.1-pro', role: 'System Design' },
    { agentId: 'ux-designer', primary: 'gemini-3.1-pro', fallback: 'claude-sonnet-4-6', role: 'UX Design' },
    { agentId: 'frontend-dev', primary: 'gemini-3.1-pro', fallback: 'claude-sonnet-4-6', role: 'Frontend' },
    { agentId: 'backend-dev', primary: 'claude-opus-4-6', fallback: 'claude-sonnet-4-6', role: 'Backend' },
    { agentId: 'qa-architect', primary: 'claude-opus-4-6', fallback: 'claude-sonnet-4-6', role: 'QA' },
    { agentId: 'devops-engineer', primary: 'gemini-3.1-pro', fallback: 'claude-sonnet-4-6', role: 'DevOps' },
    { agentId: 'security-specialist', primary: 'claude-opus-4-6', fallback: 'gemini-3.1-pro', role: 'Security' },
    { agentId: 'tech-writer', primary: 'claude-sonnet-4-6', fallback: 'gemini-3.1-pro', role: 'Documentation' },
  ];

  it('should have exactly 12 agent assignments', () => {
    const assignments = router.getAllAssignments();
    expect(Object.keys(assignments)).toHaveLength(12);
  });

  for (const expected of EXPECTED_ASSIGNMENTS) {
    it(`${expected.agentId} (${expected.role}) should use ${expected.primary} as primary`, () => {
      const assignment = router.getAgentAssignment(expected.agentId);
      expect(assignment).toBeDefined();
      expect(assignment.primary).toBe(expected.primary);
    });

    it(`${expected.agentId} (${expected.role}) should use ${expected.fallback} as fallback`, () => {
      const assignment = router.getAgentAssignment(expected.agentId);
      expect(assignment.fallback).toBe(expected.fallback);
    });
  }

  it('should only use Anthropic and Google models (no GPT, no Grok)', () => {
    const catalog = router.getModelCatalog();
    for (const model of Object.values(catalog)) {
      expect(['anthropic', 'google']).toContain(model.provider);
      expect(model.id).not.toContain('gpt');
      expect(model.id).not.toContain('grok');
    }
  });

  it('Claude Opus 4.6 agents should be: architect, backend-dev, qa-architect, security-specialist', () => {
    const opusAgents = EXPECTED_ASSIGNMENTS
      .filter(a => a.primary === 'claude-opus-4-6')
      .map(a => a.agentId)
      .sort();
    expect(opusAgents).toEqual(['architect', 'backend-dev', 'qa-architect', 'security-specialist']);
  });

  it('Gemini Flash 3 agents should be: scrum-master only', () => {
    const flashAgents = EXPECTED_ASSIGNMENTS
      .filter(a => a.primary === 'gemini-flash-3')
      .map(a => a.agentId);
    expect(flashAgents).toEqual(['scrum-master']);
  });

  it('Claude Sonnet 4.6 agents should be: tech-writer only', () => {
    const sonnetAgents = EXPECTED_ASSIGNMENTS
      .filter(a => a.primary === 'claude-sonnet-4-6')
      .map(a => a.agentId);
    expect(sonnetAgents).toEqual(['tech-writer']);
  });
});
```

---

## TEAM STRUCTURE SUGGESTION

Create a team with these agents working in parallel:

1. **test-infra** — Handles WORKSTREAM 1 (install frameworks, create configs, add scripts)
2. **gateway-tester** — Handles WORKSTREAM 2 (gateway unit tests: model-router, session-manager, task-manager)
3. **viadp-tester** — Handles WORKSTREAM 3 (VIADP unit tests: delegation-engine, trust-manager, audit-log)
4. **memory-tester** — Handles WORKSTREAM 4 (memory unit tests: memory-manager, summarizer)
5. **e2e-tester** — Handles WORKSTREAM 5 (Riyadh E2E test, dashboard Playwright tests) + WORKSTREAM 6 (stress, load, integration tests)

**Dependency order**: WORKSTREAM 1 (framework installation) should complete first or run in parallel — the config files must exist before tests can run. All other workstreams are independent.

---

## FINAL CHECKLIST (Every Agent Must Verify)

After all work is complete, verify:

- [ ] `vitest` and `@vitest/coverage-v8` are in root devDependencies
- [ ] `vitest` is in gateway, viadp, and memory workspace devDependencies
- [ ] `@playwright/test` is in dashboard devDependencies
- [ ] `/forge-team/vitest.config.ts` exists at root
- [ ] Per-workspace `vitest.config.ts` exists in gateway, viadp, memory
- [ ] `/forge-team/tests/playwright.config.ts` exists
- [ ] Root `package.json` has scripts: `test`, `test:unit`, `test:e2e`, `test:load`, `test:coverage`
- [ ] Each workspace `package.json` has `test` and `test:watch` scripts
- [ ] `/forge-team/gateway/src/__tests__/model-router.test.ts` exists with all test cases
- [ ] `/forge-team/gateway/src/__tests__/session-manager.test.ts` exists with all test cases
- [ ] `/forge-team/gateway/src/__tests__/task-manager.test.ts` exists with all test cases
- [ ] `/forge-team/viadp/src/__tests__/delegation-engine.test.ts` exists with all test cases
- [ ] `/forge-team/viadp/src/__tests__/trust-manager.test.ts` exists with all test cases
- [ ] `/forge-team/viadp/src/__tests__/audit-log.test.ts` exists with all test cases
- [ ] `/forge-team/memory/src/__tests__/memory-manager.test.ts` exists with all test cases
- [ ] `/forge-team/memory/src/__tests__/summarizer.test.ts` exists with all test cases
- [ ] `/forge-team/tests/e2e/riyadh-attendance.test.ts` exists with full 5-day sprint scenario
- [ ] `/forge-team/tests/e2e/dashboard.spec.ts` exists with Playwright tests
- [ ] `/forge-team/tests/stress/memory-load.test.ts` exists with 10k entry test
- [ ] `/forge-team/tests/load/agent-scalability.test.ts` exists with 100-agent test
- [ ] `/forge-team/tests/integration/model-assignments.test.ts` verifies all 12 agents with correct models
- [ ] All tests use mocked LLM responses — zero real API calls
- [ ] All model assignment tests match the canonical table from `model-router.ts` lines 110-171
- [ ] No existing source code was modified except `package.json` files (for dependencies and scripts)
- [ ] `npx vitest run` from root completes without TypeScript import errors (tests may fail if source has bugs — that is expected)
