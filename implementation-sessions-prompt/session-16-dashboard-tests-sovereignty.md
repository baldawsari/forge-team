# Session 16 — Dashboard Polish, Integration Tests & Data Sovereignty Hardening

> **Instructions for Claude Code Opus 4.6**: Read this entire prompt before taking any action. You must complete ALL tasks listed below in the ForgeTeam project at `/Users/bandar/Documents/AreebPro/forge-team/`. Use the **team/swarm feature** — create a team and spin up parallel agents to work on independent workstreams simultaneously. Each workstream is labeled. Do NOT skip any item. Do NOT introduce new features beyond what is listed. Do NOT add comments, docstrings, or type annotations to code you did not change. Preserve the existing TypeScript style and project conventions.

---

## CONTEXT

The re-audit (AUDIT-REPORT.md) shows ForgeTeam at ~82% completion. After Sessions 14 and 15, this final session closes the last 6 gaps to reach ~95%+ completion:

| # | Gap | Audit Reference |
|---|-----|-----------------|
| 1 | **Memory Explorer still uses mock data** — `MemoryExplorer.tsx` initializes with `mockSearchResults` and `mockMemoryData`. The API call exists but falls back to mock on any error | Phase 7, "Memory Explorer" (PARTIAL) |
| 2 | **Physical CSS properties in shadcn/ui components** — `select.tsx` uses `pl-8`, `pr-2` (physical left/right) instead of `ps-8`, `pe-2` (logical start/end). `table.tsx` uses `text-left` and `pr-0` instead of `text-start` and `pe-0`. These break in Arabic RTL mode | Phase 7, "Logical CSS only" (PARTIAL) |
| 3 | **No interrupt/resume integration test** — LangGraph `interrupt()` exists but no test exercises the full interrupt → human response → resume cycle | Phase 11, "Human intervention at any stage" (PARTIAL) |
| 4 | **No budget enforcement verification test** — Cost caps exist but no automated test verifies they block agents at budget limits | Phase 11, "Cost dashboard realistic spend" (PARTIAL) |
| 5 | **No data sovereignty compliance test** — Only Anthropic/Google providers used, but no formal test asserts this constraint and region configuration | Phase 11, "100% data sovereignty" (PARTIAL) |
| 6 | **VPC hardening gaps** — Network policies exist for ingress but dashboard, redis, and minio pods have unrestricted egress. No region-binding config validation | Phase 9, "Data sovereignty (Riyadh VPC)" (PARTIAL) |

---

## PRE-WORK: Read These Files First (Before Any Edits)

Every agent on the team must read the files relevant to their workstream before editing.

**Dashboard (WORKSTREAM 1):**
- `/forge-team/dashboard/src/components/MemoryExplorer.tsx` — lines 24-55 (mock data), lines 62 and 88-90 (fallback to mock), lines 107-109 (mockMemoryData usage)
- `/forge-team/dashboard/src/components/ui/select.tsx` — lines 108 (`pl-8 pr-2`), lines 121 (`pl-8 pr-2`), line 126 (`left-2`)
- `/forge-team/dashboard/src/components/ui/table.tsx` — line 76 (`text-left`), line 77 (`pr-0`), line 90 (`pr-0`)
- `/forge-team/dashboard/src/lib/api.ts` — `searchMemory` and `fetchMemoryStats` functions
- `/forge-team/dashboard/src/lib/mock-data.ts` — `mockMemoryData` and `mockSearchResults` definitions

**Tests (WORKSTREAM 2):**
- `/forge-team/gateway/src/model-router.ts` — cost caps, `route()`, model catalog
- `/forge-team/gateway/src/index.ts` — REST endpoints, task handlers
- `/forge-team/gateway/src/workflow-engine.ts` — `WorkflowExecutor`, pause/resume
- `/forge-team/viadp/src/delegation-engine.ts` — delegation lifecycle
- `/forge-team/tests/integration/model-assignments.test.ts` — existing integration test pattern (use same style)
- `/forge-team/shared/types/models.ts` — model types

**Infrastructure (WORKSTREAM 3):**
- `/forge-team/infrastructure/k8s/network-policies.yaml` — current policies (ingress-focused, limited egress)
- `/forge-team/infrastructure/k8s/configmap.yaml` — `DEPLOYMENT_REGION: "riyadh"`
- `/forge-team/docker/docker-compose.yml` — `DEPLOYMENT_REGION` env var

---

## WORKSTREAM 1: Dashboard Polish

**Files to modify:**
- `/forge-team/dashboard/src/components/MemoryExplorer.tsx`
- `/forge-team/dashboard/src/components/ui/select.tsx`
- `/forge-team/dashboard/src/components/ui/table.tsx`

### 1A. Remove mock data from MemoryExplorer.tsx

The current `MemoryExplorer.tsx` has several mock data dependencies that should be replaced with proper loading/error states:

1. **Remove mock search results initialization** (line 62): Change `useState(mockSearchResults)` to `useState<typeof mockSearchResults>([])`. The search results should start empty and only populate from the API.

2. **Remove the mock fallback in `performSearch`** (lines 88-90): Instead of silently falling back to mock data in the catch block, set an error state:
   ```typescript
   const [searchError, setSearchError] = useState<string | null>(null);
   const [isSearching, setIsSearching] = useState(false);
   ```

   Update `performSearch`:
   ```typescript
   const performSearch = useCallback(async (q: string) => {
     if (!q.trim()) {
       setSearchResults([]);
       setSearchError(null);
       return;
     }
     setIsSearching(true);
     setSearchError(null);
     try {
       const data = await searchMemory(q, scope);
       setSearchResults(data.results.map((r: any) => ({
         id: r.id,
         title: r.content?.slice(0, 50) ?? 'Memory Entry',
         titleAr: r.content?.slice(0, 50) ?? 'سجل ذاكرة',
         snippet: r.content ?? '',
         snippetAr: r.content ?? '',
         source: r.agentId ?? 'system',
         sourceAr: r.agentId ?? 'النظام',
         score: r.importance ?? 0.5,
       })));
     } catch {
       setSearchError(isAr ? 'فشل البحث في الذاكرة' : 'Memory search failed');
     } finally {
       setIsSearching(false);
     }
   }, [scope, isAr]);
   ```

3. **Add loading and error UI**: In the search results rendering section (after `{query.trim() && (`), add:
   - A loading spinner when `isSearching` is true
   - An error message when `searchError` is non-null
   - An empty state when search returns no results

   ```tsx
   {query.trim() && (
     <div className="space-y-2 mb-4">
       <h3 className="text-xs font-semibold text-text-secondary">
         {t("memory.results")}
       </h3>
       {isSearching && (
         <p className="text-xs text-text-muted animate-pulse">
           {isAr ? 'جاري البحث...' : 'Searching...'}
         </p>
       )}
       {searchError && (
         <p className="text-xs text-red-400">{searchError}</p>
       )}
       {!isSearching && !searchError && searchResults.length === 0 && (
         <p className="text-xs text-text-muted">
           {isAr ? 'لا توجد نتائج' : 'No results found'}
         </p>
       )}
       {searchResults.map((result) => (
         // ... existing result rendering (keep as-is)
       ))}
     </div>
   )}
   ```

4. **Replace mock agent memory stats** (lines 107-109): The agent memory grid at the bottom uses `mockMemoryData` from `mock-data.ts`. Replace this with data from the `stats` state (fetched from `fetchMemoryStats()` on mount). Map the stats array to agent cards. If stats are empty/loading, show a placeholder:

   Remove:
   ```typescript
   const memoryMap = new Map<string, AgentMemoryData>();
   for (const m of mockMemoryData) {
     memoryMap.set(m.agentId, m);
   }
   ```

   Replace with data from the `stats` state variable that's already fetched in the `useEffect`. Map `stats` to a format that provides `shortTermTokens`, `longTermEntries`, etc. per agent. If `stats` is empty, show a loading placeholder in each agent card.

5. **Clean up imports**: Remove the `mockMemoryData` and `mockSearchResults` imports from `@/lib/mock-data` if they are no longer used anywhere in the file. Keep the `Agent` type import if still needed.

### 1B. Fix physical CSS in select.tsx

In `/forge-team/dashboard/src/components/ui/select.tsx`, replace physical CSS properties with logical equivalents:

| Line | Current | Replace With |
|------|---------|--------------|
| 108 | `pl-8 pr-2` | `ps-8 pe-2` |
| 121 | `pl-8 pr-2` | `ps-8 pe-2` |
| 126 | `absolute left-2` | `absolute start-2` |

These are in the `SelectLabel`, `SelectItem`, and the item indicator `<span>`. Use find-and-replace carefully — do NOT change the Radix `data-[side=left]` or `data-[side=right]` animation classes in `SelectContent` (line 78) as those are directional animations that should remain physical.

### 1C. Fix physical CSS in table.tsx

In `/forge-team/dashboard/src/components/ui/table.tsx`, replace physical CSS properties with logical equivalents:

| Line | Current | Replace With |
|------|---------|--------------|
| 76 | `text-left` | `text-start` |
| 77 | `pr-0` | `pe-0` |
| 90 | `pr-0` | `pe-0` |

These are in the `TableHead` and `TableCell` components. The `text-left` on `TableHead` must become `text-start` so table headers align correctly in RTL mode.

---

## WORKSTREAM 2: Missing Integration Tests

**Files to create:**
- `/forge-team/tests/integration/interrupt-resume.test.ts`
- `/forge-team/tests/integration/budget-verification.test.ts`
- `/forge-team/tests/integration/data-sovereignty.test.ts`

Read `/forge-team/tests/integration/model-assignments.test.ts` first to understand the testing conventions (Vitest, import style, mock patterns).

### 2A. Interrupt/Resume Integration Test

Create `/forge-team/tests/integration/interrupt-resume.test.ts`:

This test verifies the full LangGraph interrupt → human response → resume cycle. Since we cannot run a real LangGraph server in tests, we mock the core components:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Test the interrupt/resume lifecycle
// 1. A workflow step triggers interrupt() for human approval
// 2. The system pauses and emits an event
// 3. A human approval is received
// 4. The workflow resumes from the checkpoint

describe('Interrupt/Resume Cycle', () => {
  // ... setup mocks for WorkflowExecutor, LangGraph checkpoint

  it('should pause workflow when interrupt() is triggered at approval gate', async () => {
    // Arrange: Create a workflow instance with an approval gate step
    // Act: Execute the workflow until the approval gate
    // Assert: Workflow status is 'paused', checkpoint is saved
  });

  it('should resume workflow after human approval', async () => {
    // Arrange: A paused workflow with a saved checkpoint
    // Act: Call resumeWorkflow() with approval data
    // Assert: Workflow continues from the checkpoint, status changes to 'in-progress'
  });

  it('should handle human rejection by stopping the workflow', async () => {
    // Arrange: A paused workflow at approval gate
    // Act: Call resumeWorkflow() with rejection
    // Assert: Workflow status changes to 'failed' or returns to previous step
  });

  it('should persist checkpoint across simulated restart', async () => {
    // Arrange: Pause a workflow, save checkpoint
    // Act: Create a new WorkflowExecutor instance, load checkpoint
    // Assert: Can resume from the saved state
  });
});
```

Read `gateway/src/workflow-engine.ts` to understand the actual `pauseWorkflow()` and `resumeWorkflow()` API. Use those actual methods with mocked dependencies.

The test should import from the gateway source and mock external dependencies (DB, Redis, LLM calls). Use `vi.mock()` for database and API calls.

### 2B. Budget Enforcement Verification Test

Create `/forge-team/tests/integration/budget-verification.test.ts`:

This test verifies that the cost cap system actually blocks agents at budget limits:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { ModelRouter } from '../../gateway/src/model-router';

describe('Budget Enforcement', () => {
  let router: ModelRouter;

  beforeEach(() => {
    router = new ModelRouter();
  });

  it('should allow routing when agent is under daily cap', () => {
    const result = router.route({
      agentId: 'architect',
      taskContent: 'Design the database schema',
      sessionId: 'test-session',
    });
    expect(result.model).toBeDefined();
    expect(result.model.id).toBe('claude-opus-4-6');
  });

  it('should downgrade model when agent exceeds 100% daily cap', () => {
    // Record enough cost to exceed the architect's $50 daily cap
    for (let i = 0; i < 100; i++) {
      router.recordCost('architect', 'test-session', null, 'claude-opus-4-6', 10000, 5000, 'premium');
    }

    const dailyCost = router.getAgentDailyCost('architect');
    expect(dailyCost).toBeGreaterThan(50);

    const result = router.route({
      agentId: 'architect',
      taskContent: 'Design the database schema',
      sessionId: 'test-session',
    });

    // Should be downgraded, not the primary model
    expect(result.reason).not.toBe('primary');
  });

  it('should hard block when agent exceeds 120% daily cap', () => {
    // Record massive cost to exceed 120% ($60 for architect's $50 cap)
    for (let i = 0; i < 200; i++) {
      router.recordCost('architect', 'test-session', null, 'claude-opus-4-6', 10000, 5000, 'premium');
    }

    const dailyCost = router.getAgentDailyCost('architect');
    expect(dailyCost).toBeGreaterThan(60);

    const capStatus = router.checkCostCap('architect');
    expect(capStatus.allowed).toBe(false);
  });

  it('should track cost per agent independently', () => {
    // Record cost for architect only
    router.recordCost('architect', 'test-session', null, 'claude-opus-4-6', 50000, 25000, 'premium');

    const architectCost = router.getAgentDailyCost('architect');
    const frontendCost = router.getAgentDailyCost('frontend-dev');

    expect(architectCost).toBeGreaterThan(0);
    expect(frontendCost).toBe(0);
  });

  it('should enforce weekly caps', () => {
    // Record cost spread over the week approaching the weekly cap
    const weeklyCapArchitect = 250; // $250 weekly cap for architect
    // Record enough to approach the weekly cap
    for (let i = 0; i < 500; i++) {
      router.recordCost('architect', 'test-session', null, 'claude-opus-4-6', 10000, 5000, 'premium');
    }

    const weeklyCost = router.getAgentWeeklyCost('architect');
    const capStatus = router.checkCostCap('architect');

    if (weeklyCost > weeklyCapArchitect) {
      expect(capStatus.allowed).toBe(false);
    }
  });

  it('should calculate monthly projection under $450 with typical usage', () => {
    // Simulate 30 days of moderate usage across all 12 agents
    // Each agent makes ~10 requests per day with average 2000 input + 1000 output tokens
    const agents = [
      'bmad-master', 'product-owner', 'business-analyst', 'scrum-master',
      'architect', 'ux-designer', 'frontend-dev', 'backend-dev',
      'qa-architect', 'devops-engineer', 'security-specialist', 'tech-writer'
    ];

    for (const agentId of agents) {
      for (let day = 0; day < 30; day++) {
        for (let req = 0; req < 10; req++) {
          const assignment = router.getAgentAssignment(agentId);
          if (assignment) {
            router.recordCost(agentId, 'test-session', null, assignment.primary, 2000, 1000, 'balanced');
          }
        }
      }
    }

    const summary = router.getCostSummary();
    // With typical usage (mostly Gemini models at $1.25/$5 per 1M tokens),
    // 12 agents × 10 req/day × 30 days × ~$0.005/req ≈ $18/month
    // Even premium agents: 4 agents × 10 req/day × 30 days × ~$0.05/req ≈ $60/month
    // Total should be well under $450
    expect(summary.totalCost).toBeLessThan(450);
  });
});
```

Adjust the exact cost amounts and assertions based on the actual `MODEL_CATALOG` pricing in `model-router.ts`.

### 2C. Data Sovereignty Compliance Test

Create `/forge-team/tests/integration/data-sovereignty.test.ts`:

This test verifies that ForgeTeam only uses approved model providers (Anthropic + Google) and is configured for the correct deployment region:

```typescript
import { describe, it, expect } from 'vitest';
import { ModelRouter } from '../../gateway/src/model-router';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml'; // or parse YAML manually if js-yaml is not available

describe('Data Sovereignty Compliance', () => {
  const router = new ModelRouter();

  describe('Model Provider Restrictions', () => {
    it('should only contain Anthropic and Google models in catalog', () => {
      const catalog = router.getModelCatalog();
      const providers = new Set(Object.values(catalog).map(m => m.provider));

      expect(providers.size).toBeLessThanOrEqual(2);
      for (const provider of providers) {
        expect(['anthropic', 'google']).toContain(provider);
      }

      // Explicitly verify no GPT or Grok models
      for (const [modelId] of Object.entries(catalog)) {
        expect(modelId).not.toMatch(/gpt/i);
        expect(modelId).not.toMatch(/grok/i);
        expect(modelId).not.toMatch(/openai/i);
      }
    });

    it('should assign every agent to Anthropic or Google models only', () => {
      const assignments = router.getAllAssignments();
      const catalog = router.getModelCatalog();

      for (const [agentId, assignment] of Object.entries(assignments)) {
        const primaryModel = catalog[assignment.primary];
        const fallbackModel = catalog[assignment.fallback];

        expect(primaryModel, `${agentId} primary model ${assignment.primary} not in catalog`).toBeDefined();
        expect(fallbackModel, `${agentId} fallback model ${assignment.fallback} not in catalog`).toBeDefined();

        expect(['anthropic', 'google']).toContain(primaryModel.provider);
        expect(['anthropic', 'google']).toContain(fallbackModel.provider);
      }
    });
  });

  describe('Deployment Region Configuration', () => {
    it('should have DEPLOYMENT_REGION set to riyadh in docker-compose', () => {
      const composePath = path.resolve(__dirname, '../../docker/docker-compose.yml');
      const composeContent = fs.readFileSync(composePath, 'utf-8');
      expect(composeContent).toContain('DEPLOYMENT_REGION');
      expect(composeContent).toMatch(/DEPLOYMENT_REGION.*riyadh/);
    });

    it('should have DEPLOYMENT_REGION set to riyadh in k8s configmap', () => {
      const configmapPath = path.resolve(__dirname, '../../infrastructure/k8s/configmap.yaml');
      const configmapContent = fs.readFileSync(configmapPath, 'utf-8');
      expect(configmapContent).toContain('DEPLOYMENT_REGION');
      expect(configmapContent).toMatch(/DEPLOYMENT_REGION.*riyadh/);
    });
  });

  describe('Network Isolation', () => {
    it('should have default-deny ingress policy in k8s', () => {
      const policiesPath = path.resolve(__dirname, '../../infrastructure/k8s/network-policies.yaml');
      const policiesContent = fs.readFileSync(policiesPath, 'utf-8');
      expect(policiesContent).toContain('default-deny-ingress');
    });

    it('should restrict postgres egress to DNS only', () => {
      const policiesPath = path.resolve(__dirname, '../../infrastructure/k8s/network-policies.yaml');
      const policiesContent = fs.readFileSync(policiesPath, 'utf-8');
      expect(policiesContent).toContain('deny-postgres-egress');
    });

    it('should bind postgres and redis to localhost in docker-compose', () => {
      const composePath = path.resolve(__dirname, '../../docker/docker-compose.yml');
      const composeContent = fs.readFileSync(composePath, 'utf-8');
      // Postgres and Redis should be bound to 127.0.0.1
      expect(composeContent).toMatch(/127\.0\.0\.1:5432:5432/);
      expect(composeContent).toMatch(/127\.0\.0\.1:6379:6379/);
    });
  });

  describe('No External Analytics or Tracking', () => {
    it('should not reference external analytics services in dashboard', () => {
      const dashboardPkgPath = path.resolve(__dirname, '../../dashboard/package.json');
      const dashboardPkg = JSON.parse(fs.readFileSync(dashboardPkgPath, 'utf-8'));
      const allDeps = {
        ...dashboardPkg.dependencies,
        ...dashboardPkg.devDependencies,
      };

      // No Google Analytics, Mixpanel, Segment, Amplitude, etc.
      const analyticsPackages = [
        'react-ga', 'react-ga4', '@segment/analytics-next',
        'mixpanel-browser', '@amplitude/analytics-browser',
        'posthog-js', 'hotjar',
      ];

      for (const pkg of analyticsPackages) {
        expect(allDeps[pkg], `Found analytics package: ${pkg}`).toBeUndefined();
      }
    });
  });
});
```

If `js-yaml` is not available in the project, use simple string matching on the YAML content instead of parsing it.

---

## WORKSTREAM 3: Data Sovereignty Hardening (Kubernetes)

**Files to modify:**
- `/forge-team/infrastructure/k8s/network-policies.yaml`
- `/forge-team/infrastructure/k8s/configmap.yaml`

### 3A. Add egress deny policies for dashboard, redis, and minio

Currently, `network-policies.yaml` has:
- Default deny ingress (policy #1)
- Postgres egress restricted to DNS only (policy #8)
- Gateway egress allowed to port 443 + internal services (policy #9)

But **dashboard, redis, and minio have NO egress restrictions**. Add the following policies at the end of the file:

```yaml
---
# 10. Deny dashboard egress (except DNS and gateway)
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: deny-dashboard-egress
  namespace: forgeteam
spec:
  podSelector:
    matchLabels:
      app: dashboard
  policyTypes:
    - Egress
  egress:
    - ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
    - to:
        - podSelector:
            matchLabels:
              app: gateway
      ports:
        - protocol: TCP
          port: 18789
---
# 11. Deny redis egress (except DNS)
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: deny-redis-egress
  namespace: forgeteam
spec:
  podSelector:
    matchLabels:
      app: redis
  policyTypes:
    - Egress
  egress:
    - ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
---
# 12. Deny minio egress (except DNS)
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: deny-minio-egress
  namespace: forgeteam
spec:
  podSelector:
    matchLabels:
      app: minio
  policyTypes:
    - Egress
  egress:
    - ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
```

### 3B. Add region binding and allowed egress domains to configmap

In `/forge-team/infrastructure/k8s/configmap.yaml`, add sovereignty-related configuration after the existing entries:

```yaml
  # Data sovereignty configuration
  DATA_SOVEREIGNTY_ENABLED: "true"
  DATA_SOVEREIGNTY_REGION: "sa-riyadh-1"
  ALLOWED_EGRESS_DOMAINS: "api.anthropic.com,generativelanguage.googleapis.com,api.elevenlabs.io"
  ENFORCE_REGION_BINDING: "true"
```

These are configuration values that the gateway can read at startup to validate its deployment environment. The `ALLOWED_EGRESS_DOMAINS` list documents exactly which external services the gateway pod is permitted to contact.

---

## TEAM STRUCTURE SUGGESTION

Create a team with these agents working in parallel:

1. **dashboard-polisher** — Handles WORKSTREAM 1 (remove mock data from MemoryExplorer, fix physical CSS in select.tsx and table.tsx)
2. **test-writer** — Handles WORKSTREAM 2 (3 new integration tests: interrupt/resume, budget verification, data sovereignty)
3. **infra-engineer** — Handles WORKSTREAM 3 (egress policies for dashboard/redis/minio, region-binding config)

All workstreams are fully independent and can run in parallel.

---

## FINAL CHECKLIST (Every Agent Must Verify)

After all work is complete, verify:

- [x] `MemoryExplorer.tsx` no longer initializes `searchResults` with `mockSearchResults`
- [x] `MemoryExplorer.tsx` has loading state (`isSearching`) and error state (`searchError`)
- [x] `MemoryExplorer.tsx` shows "No results found" when search returns empty
- [x] `MemoryExplorer.tsx` agent memory grid uses real data from `fetchMemoryStats()`, not `mockMemoryData`
- [x] `mockMemoryData` and `mockSearchResults` imports are removed from `MemoryExplorer.tsx`
- [x] `select.tsx`: `pl-8` → `ps-8`, `pr-2` → `pe-2`, `left-2` → `start-2` (3 replacements)
- [x] `select.tsx`: `data-[side=left]` and `data-[side=right]` animation classes are NOT changed
- [x] `table.tsx`: `text-left` → `text-start`, `pr-0` → `pe-0` (3 replacements)
- [x] `tests/integration/interrupt-resume.test.ts` exists with at least 3 test cases
- [x] `tests/integration/budget-verification.test.ts` exists with at least 5 test cases
- [x] `tests/integration/data-sovereignty.test.ts` exists with at least 6 test cases
- [x] Budget test verifies monthly projection under $450 with typical usage
- [x] Sovereignty test verifies only Anthropic/Google in model catalog
- [x] Sovereignty test verifies DEPLOYMENT_REGION=riyadh in docker-compose and k8s configmap
- [x] Sovereignty test verifies no external analytics packages in dashboard
- [x] `network-policies.yaml` has egress deny policies for: dashboard, redis, minio
- [x] Dashboard egress only allows DNS + gateway:18789
- [x] Redis and minio egress only allows DNS
- [x] `configmap.yaml` has `DATA_SOVEREIGNTY_ENABLED`, `DATA_SOVEREIGNTY_REGION`, `ALLOWED_EGRESS_DOMAINS`, `ENFORCE_REGION_BINDING`
- [x] No `gpt-4o` or `gpt-4o-mini` references introduced
- [x] All new test files use Vitest (`import { describe, it, expect } from 'vitest'`)
- [x] Existing dashboard components still compile (no broken imports)
