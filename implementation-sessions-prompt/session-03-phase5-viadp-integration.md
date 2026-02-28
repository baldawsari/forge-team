# Session 03 — Phase 5: VIADP Integration Fix — Unify Dual Implementation

**Stream A, Day 5-7 | Depends on: Session 02 (LangGraph installed)**

> **Instructions for Claude Code Opus 4.6**: Read this entire prompt before taking any action. You must fix ALL issues listed below in the ForgeTeam project at `/Users/bandar/Documents/AreebPro/forge-team/`. Use the **team/swarm feature** — create a team and spin up parallel agents to work on independent workstreams simultaneously. Each workstream is labeled. Do NOT skip any item. Do NOT introduce new features beyond what is listed. Do NOT add comments, docstrings, or type annotations to code you did not change.

---

## PRE-WORK: Read These Files First (Before Any Edits)

> **VIADP Implementation Guide**: Read the complete implementation guide at `/Users/bandar/Documents/AreebPro/forge-team/Phase-5-VIADP.md` before starting. This file contains the exact folder structure, database extensions, core types, module code, LangGraph integration, and test scripts. Follow it as the primary reference.

Every agent on the team must read the files relevant to their workstream before editing. The ground-truth references are:

**VIADP Package (the library — currently dead code):**
- `/forge-team/viadp/src/delegation-engine.ts` — 740 lines, full DelegationEngine class with matchDelegates, delegate, verifyCompletion, redelegate
- `/forge-team/viadp/src/trust-manager.ts` — 372 lines, TrustManager with Bayesian Beta updates, decay, domain scores
- `/forge-team/viadp/src/verification.ts` — 721 lines, VerificationEngine with proof submission, review, consensus, audit trail
- `/forge-team/viadp/src/resilience.ts` — 616 lines, ResilienceEngine with circuit breakers, parallel bids, diversity scoring, consensus voting
- `/forge-team/viadp/src/audit-log.ts` — 481 lines, AuditLog with FNV-1a hash chain, Object.freeze, integrity verification, export

**Gateway Duplicate (the actually-used code — missing features):**
- `/forge-team/gateway/src/viadp-engine.ts` — 827 lines, VIADPEngine class with assessment, tokens, monitoring, trust, escalation. Uses EventEmitter. Does NOT import @forge-team/viadp

**Shared Types:**
- `/forge-team/shared/types/viadp.ts` — DelegationToken, DelegationScope, TrustScore, VerificationProof, DelegationRequest, EscalationConfig, DelegationAuditEntry

**Infrastructure:**
- `/forge-team/infrastructure/init.sql` — existing tables: viadp_delegations, viadp_audit_log, trust_scores (already present but missing viadp_reputation)

**Dashboard:**
- `/forge-team/dashboard/src/components/ViadpAuditLog.tsx` — 227 lines, renders delegation timeline with filters, expandable proof chains, trust color-coding. Uses mock data

**Gateway Core:**
- `/forge-team/gateway/src/workflow-engine.ts` — WorkflowLoader + WorkflowExecutor (custom state machine, not LangGraph)
- `/forge-team/gateway/src/agent-manager.ts` — AgentManager class used by the gateway VIADPEngine

**Phase 5 Implementation Guide:**
- `/forge-team/Phase-5-VIADP.md` — THE canonical reference for all new VIADP code

---

## CRITICAL PROBLEM

The AUDIT-REPORT (Gap #4) identified: `@forge-team/viadp` package and `gateway/src/viadp-engine.ts` are **parallel, independent implementations** of the same protocol. The gateway does NOT import or use `@forge-team/viadp` modules. This means circuit breakers, parallel bids, diversity scoring, Object.freeze audit log, FNV-1a hash chain — all **dead code** sitting in the viadp package while the gateway runs its own simplified version.

The goal of this session is to:
1. Unify both implementations into one canonical VIADP package
2. Make the gateway import and delegate to the unified package
3. Follow Phase-5-VIADP.md for the new module structure
4. Wire VIADP into the workflow execution pipeline via a LangGraph node

---

## WORKSTREAM 1: Rebuild the VIADP Package Core Types

**Files to create/modify:**
- `/forge-team/viadp/types.ts` (NEW — top-level, not in src/)
- `/forge-team/viadp/index.ts` (NEW — main export barrel)
- `/forge-team/shared/types/viadp.ts` (MODIFY — reconcile with new types)

### 1A. Create `viadp/types.ts`

Follow Phase-5-VIADP.md Section 3 exactly. This file defines the canonical interfaces used across the entire system. Must include:

```typescript
export interface DelegationRequest {
  taskId: string;
  fromAgent: string;
  goal: string;
  requirements: Record<string, unknown>;
  criticality: 'low' | 'medium' | 'high' | 'critical';
}

export interface Bid {
  agentId: string;
  estCost: number;
  durationHours: number;
  reputationBond: number;
  verificationPolicy: { zkRequired: boolean; teeRequired: boolean };
  diversityScore: number;
}

export interface DelegationToken {
  token: string;
  caveats: string[];
  signature: string;
}

export interface VIADPContext {
  delegationId: string;
  token: DelegationToken;
  trustScore: number;
  riskScore: number;
}
```

Also add these additional types needed by the existing codebase (merge from `shared/types/viadp.ts` and `viadp/src/delegation-engine.ts`):

- `DelegationScope` (from shared/types/viadp.ts — keep as-is)
- `TrustScore` (from shared/types/viadp.ts — keep as-is)
- `VerificationProof` (from shared/types/viadp.ts — keep as-is)
- `EscalationConfig` (from shared/types/viadp.ts — keep as-is)
- `DelegationAuditEntry` (from shared/types/viadp.ts — keep as-is)
- `RiskLevel` = 'low' | 'medium' | 'high' | 'critical'
- `DelegationStatus` (from shared/types/viadp.ts — keep as-is)
- `AgentProfile` (from viadp/src/delegation-engine.ts lines 106-116)
- `CircuitBreakerState` (from viadp/src/resilience.ts lines 48-58)

### 1B. Update `shared/types/viadp.ts`

Make `shared/types/viadp.ts` re-export from `@forge-team/viadp/types` so both packages use the same interfaces. Keep backward compatibility — any type that was in shared/types should still be importable from there.

### 1C. Create `viadp/index.ts`

Barrel export that re-exports everything:
```typescript
export * from './types';
export { VIADPEngine } from './src/delegation-engine';
export { TrustManager } from './src/trust-manager';
export { VerificationEngine } from './src/verification';
export { ResilienceEngine } from './src/resilience';
export { AuditLog } from './src/audit-log';
export { runDynamicAssessment } from './src/assessment';
export { startMonitoring } from './src/execution-monitor';
export { issueDelegationToken, updateTrustBayesian } from './src/trust-calibration';
export { applyEconomicSelfRegulation, enforceParallelBidsForCritical } from './src/resilience';
```

### Verification
- `grep -r "from.*@forge-team/viadp" forge-team/shared/` should show re-exports working
- TypeScript should compile without errors across the viadp package

---

## WORKSTREAM 2: Implement New VIADP Modules from Phase-5 Guide

**Files to create:**
- `/forge-team/viadp/src/assessment.ts` (NEW)
- `/forge-team/viadp/src/execution-monitor.ts` (NEW)
- `/forge-team/viadp/src/trust-calibration.ts` (NEW)

**Files to modify:**
- `/forge-team/viadp/src/delegation-engine.ts` (MODIFY — integrate new modules)
- `/forge-team/viadp/src/resilience.ts` (MODIFY — add economic self-regulation)
- `/forge-team/viadp/src/audit-log.ts` (MODIFY — ensure immutable provenance)
- `/forge-team/viadp/src/verification.ts` (MODIFY — add ZK proof stubs)

### 2A. Create `viadp/src/assessment.ts` — Dynamic Assessment Layer

Follow Phase-5-VIADP.md Section 4 ("assessment.ts"). Implement:

- `runDynamicAssessment(req: DelegationRequest): Promise<Bid[]>` — Multi-objective Pareto optimizer
- `getAvailableAgents()` — Query from Postgres (or from in-memory registry as fallback)
- `calculateCost(agent, req)` — Estimate cost based on agent model pricing and task criticality
- `calculateDiversityScore(modelFamily: string)` — Shannon entropy penalty for same-model families
- `estimateDuration(agent, req)` — Duration estimate based on agent load and task complexity
- Sort candidates by `(reputationBond * diversityScore)` descending

Must integrate with the existing `DelegationEngine.matchDelegates()` — either replace it or call this as the underlying implementation.

### 2B. Create `viadp/src/execution-monitor.ts` — Adaptive Execution

Follow Phase-5-VIADP.md Section 4 ("execution-monitor.ts"). Implement:

- `startMonitoring(delegationId: string, context: VIADPContext): void` — Set up monitoring
- Use `setInterval` (30s) to check agent health
- `checkAgentHealth(agentId: string): Promise<number>` — Returns health score [0, 1]
- `triggerReDelegation(delegationId: string): Promise<void>` — When health < 0.8, trigger re-delegation
- For now, use in-process monitoring (not Redis streams) since Redis pub/sub is not yet wired. Add a TODO comment for Redis stream upgrade.

Must integrate with the existing `DelegationEngine.monitorExecution()` — extend it, don't replace.

### 2C. Create `viadp/src/trust-calibration.ts` — Trust + DCTs

Follow Phase-5-VIADP.md Section 4 ("trust-calibration.ts"). Implement:

- `issueDelegationToken(req: DelegationRequest, chosenBid: Bid): Promise<DelegationToken>` — Create Macaroon-style token with caveats
- `updateTrustBayesian(agentId: string, outcome: 'success' | 'failure', criticality: number): Promise<void>` — Bayesian update with heat penalty
- `getReputation(agentId: string)` — Query from trust_scores table or in-memory TrustManager
- `createMacaroonStyleToken(req, bid)` — Generate token string with caveats like `["max-duration:2h", "read-only"]` and HMAC-SHA256 signature

Must interoperate with the existing `TrustManager` class (not replace it). The existing TrustManager has the Bayesian math — this module adds the heat penalty and DCT token issuance on top.

### 2D. Modify `viadp/src/resilience.ts` — Add Economic Self-Regulation

Add these functions to the existing ResilienceEngine (DO NOT replace existing code):

- `applyEconomicSelfRegulation(agentId: string, taskComplexity: number): { adjustedCost: number; throttle: boolean }` — V_AI-inspired cost throttle using heat penalty
- `enforceParallelBidsForCritical(req: DelegationRequest): Promise<Bid[]>` — For critical tasks, run top-3 candidates in parallel

### 2E. Modify `viadp/src/verification.ts` — Add ZK Proof Stubs

Add a `generateZKProof(result: unknown): Promise<{ proof: string; verified: boolean }>` stub function that:
- Returns a placeholder proof string with `proof_stub_` prefix
- Logs a TODO comment about snarkjs integration
- Returns `verified: true` for now (stub)

### 2F. Modify `viadp/src/audit-log.ts` — Immutable Provenance

The existing audit log is strong (FNV-1a hash chain, Object.freeze). Ensure:
- Add `toJSON()` method for serialization to DB
- Add `fromDB(rows: any[])` static method to restore from Postgres rows
- Verify that `verifyIntegrity()` works correctly after DB round-trip

### 2G. Modify `viadp/src/delegation-engine.ts` — Wire New Modules

Update the `DelegationEngine` class to:
1. Import and use `runDynamicAssessment` in `matchDelegates()` as an alternative path
2. Import and use `issueDelegationToken` in `delegate()` to create Macaroon-style DCTs
3. Import and use `startMonitoring` in `delegate()` after token issuance
4. Import and use `applyEconomicSelfRegulation` before cost estimation
5. Keep the existing implementation as fallback (if new modules throw, fall back to existing behavior)

### Verification
- All new files compile with `npx tsc --noEmit` from the viadp directory
- The DelegationEngine still passes its existing behavior (matchDelegates returns ranked candidates, delegate issues tokens)
- New functions are exported from `viadp/index.ts`

---

## WORKSTREAM 3: Replace Gateway Duplicate with Thin Wrapper

**Files to modify:**
- `/forge-team/gateway/src/viadp-engine.ts` (MAJOR REWRITE)
- `/forge-team/gateway/package.json` (ADD dependency)

### 3A. Add `@forge-team/viadp` dependency to gateway

In `/forge-team/gateway/package.json`, add the workspace dependency:
```json
"dependencies": {
  "@forge-team/viadp": "workspace:*"
}
```

Verify the viadp package has a proper `package.json` with `"name": "@forge-team/viadp"` and appropriate `main`/`types` fields.

### 3B. Rewrite `gateway/src/viadp-engine.ts` as thin wrapper

The current file is 827 lines reimplementing everything. Replace it with a thin wrapper (~150-200 lines) that:

1. **Imports** from `@forge-team/viadp`:
   ```typescript
   import { DelegationEngine, TrustManager, VerificationEngine, ResilienceEngine, AuditLog } from '@forge-team/viadp';
   import type { DelegationRequest, VIADPContext, Bid } from '@forge-team/viadp';
   ```

2. **Keeps** the EventEmitter interface (VIADPEvents) — the gateway needs events for WebSocket broadcasting
3. **Keeps** the constructor that takes `AgentManager` — translate AgentManager data into VIADP `AgentProfile` registrations
4. **Delegates** all core logic to the imported modules:
   - `assessDelegation()` calls `delegationEngine.assessCapability()` + `delegationEngine.matchDelegates()`
   - `createDelegationRequest()` calls `delegationEngine.delegate()` + `trustCalibration.issueDelegationToken()`
   - `acceptDelegation()` calls `delegationEngine.delegate()` + emits events
   - `submitVerification()` / `verifyProof()` calls `verificationEngine.submitProof()` / `verifyProof()`
   - Trust updates delegate to `trustManager.updateTrust()`
   - Resilience checks delegate to `resilienceEngine.circuitBreaker()`, `isAgentAvailable()`
5. **Keeps** the `monitorActiveDelegations()` timer but uses the new `execution-monitor.ts`
6. **Keeps** the `getAuditTrail()` / `getFullAuditTrail()` methods but reads from `auditLog`
7. **Keeps** `getSummary()` for the dashboard

Key points:
- The gateway VIADPEngine should be ~150-200 lines (adapter + event emitter), not 827
- All the actual VIADP logic lives in `@forge-team/viadp`
- The EventEmitter events are still emitted so WebSocket handlers keep working
- The `AgentManager` integration (translating agent configs to VIADP AgentProfiles) stays in the gateway

### 3C. Update gateway imports

Search all files in `gateway/src/` that import from `./viadp-engine` and verify they still work with the new thin wrapper. The key consumers are:
- `gateway/src/index.ts` — instantiates VIADPEngine, calls methods, subscribes to events
- Any WebSocket handlers that call viadp methods

### Verification
- Gateway compiles with `npx tsc --noEmit` from gateway directory
- The VIADPEngine constructor still accepts AgentManager
- All event subscriptions in index.ts still work
- `getSummary()` returns the same shape
- `grep -r "circuit" gateway/src/viadp-engine.ts` should show calls to ResilienceEngine, not inline implementations

---

## WORKSTREAM 4: Create LangGraph VIADP Delegation Node

**Files to create:**
- `/forge-team/gateway/src/langgraph-nodes/viadp-delegation-node.ts` (NEW)

**Files to modify:**
- `/forge-team/gateway/src/workflow-engine.ts` (MODIFY — inject VIADP node)

### 4A. Create `gateway/src/langgraph-nodes/` directory

Create the `langgraph-nodes/` directory inside `gateway/src/`.

### 4B. Create `viadp-delegation-node.ts`

Follow Phase-5-VIADP.md Section 5 exactly. This node runs before every agent execution step in a workflow:

```typescript
import { VIADPEngine } from '../viadp-engine';

// State interface for the VIADP node
interface VIADPNodeState {
  taskId: string;
  currentAgent: string;
  delegationRequest?: {
    fromAgent: string;
    goal: string;
    requirements: Record<string, unknown>;
    criticality: 'low' | 'medium' | 'high' | 'critical';
  };
  needsDelegation: boolean;
  viadpContext?: {
    delegationId: string;
    token: { token: string; caveats: string[]; signature: string };
    trustScore: number;
    riskScore: number;
  };
  // ... rest of workflow state
  [key: string]: unknown;
}

export function createViadpDelegationNode(engine: VIADPEngine) {
  return async (state: VIADPNodeState): Promise<Partial<VIADPNodeState>> => {
    if (!state.needsDelegation) {
      return {};
    }

    const request = state.delegationRequest;
    if (!request) {
      return { needsDelegation: false };
    }

    // Run assessment
    const assessment = engine.assessDelegation(
      request.fromAgent,
      state.currentAgent,
      request.goal,
      Object.keys(request.requirements)
    );

    // Create delegation request through the engine
    const delegationReq = engine.createDelegationRequest({
      from: request.fromAgent,
      to: state.currentAgent,
      taskId: state.taskId,
      sessionId: 'workflow', // will be set by workflow executor
      reason: request.goal,
      requiredCapabilities: Object.keys(request.requirements),
      scope: {
        allowedActions: Object.keys(request.requirements),
        resourceLimits: { maxDuration: 30 },
        canRedelegate: request.criticality !== 'critical',
        allowedArtifactTypes: ['code', 'document', 'config', 'test'],
      },
    });

    // Auto-accept for workflow-driven delegations
    const result = engine.acceptDelegation(delegationReq.id);

    if (result) {
      return {
        needsDelegation: false,
        viadpContext: {
          delegationId: delegationReq.id,
          token: {
            token: result.token.id,
            caveats: result.token.scope.allowedActions,
            signature: result.token.signature,
          },
          trustScore: assessment.capabilityScore,
          riskScore: assessment.riskLevel === 'critical' ? 1.0
            : assessment.riskLevel === 'high' ? 0.7
            : assessment.riskLevel === 'medium' ? 0.4 : 0.1,
        },
      };
    }

    return { needsDelegation: false };
  };
}
```

### 4C. Wire VIADP node into WorkflowExecutor

In `/forge-team/gateway/src/workflow-engine.ts`, find the `WorkflowExecutor.executeStep()` method. Before it dispatches a step to an agent, inject a VIADP pre-check:

1. Import the VIADP delegation node: `import { createViadpDelegationNode } from './langgraph-nodes/viadp-delegation-node';`
2. In `WorkflowExecutor` constructor, accept a `VIADPEngine` parameter and store it
3. In `executeStep()`, before the agent execution:
   - Create a VIADP delegation request for the step
   - Run the delegation node
   - If delegation is rejected or risk is critical, pause the step and emit an approval request
   - If delegation succeeds, proceed with the agent execution using the VIADP context
4. After step completion, call `engine.submitVerification()` and `engine.verifyProof()` to close the loop
5. Emit trust updates based on step success/failure

### Verification
- `gateway/src/langgraph-nodes/viadp-delegation-node.ts` exists and compiles
- WorkflowExecutor constructor accepts optional VIADPEngine
- A step execution in WorkflowExecutor now goes through: VIADP assess -> delegate -> execute -> verify -> trust update

---

## WORKSTREAM 5: Database Extensions + Hash-Chain Integrity

**Files to modify:**
- `/forge-team/infrastructure/init.sql`

### 5A. Add `viadp_reputation` table

The existing `init.sql` has `trust_scores` but not `viadp_reputation` (from Phase-5-VIADP.md). Add:

```sql
-- =============================================================================
-- VIADP Reputation (economic self-regulation)
-- =============================================================================
CREATE TABLE IF NOT EXISTS viadp_reputation (
    agent_id        TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
    score           DOUBLE PRECISION NOT NULL DEFAULT 0.5
                    CHECK (score >= 0.0 AND score <= 1.0),
    bonds           DECIMAL NOT NULL DEFAULT 0,
    heat_penalty    DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    delegations_total   INTEGER NOT NULL DEFAULT 0,
    delegations_success INTEGER NOT NULL DEFAULT 0,
    delegations_failed  INTEGER NOT NULL DEFAULT 0,
    last_updated    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Seed it with all 12 agents (similar to trust_scores seeding).

### 5B. Add INSERT-only policy on `viadp_audit_log`

Add a rule/trigger to enforce immutability:

```sql
-- Enforce INSERT-only on viadp_audit_log (no UPDATE, no DELETE)
CREATE OR REPLACE RULE viadp_audit_no_update AS
    ON UPDATE TO viadp_audit_log DO INSTEAD NOTHING;

CREATE OR REPLACE RULE viadp_audit_no_delete AS
    ON DELETE TO viadp_audit_log DO INSTEAD NOTHING;
```

### 5C. Add hash-chain verification function

```sql
-- Function to verify audit log hash chain integrity
CREATE OR REPLACE FUNCTION verify_audit_hash_chain()
RETURNS TABLE(valid BOOLEAN, broken_at INTEGER, total_entries BIGINT) AS $$
DECLARE
    prev_hash TEXT := 'genesis_000000000000';
    entry RECORD;
    seq INTEGER := 0;
    is_valid BOOLEAN := TRUE;
    broken INTEGER := NULL;
BEGIN
    FOR entry IN SELECT * FROM viadp_audit_log ORDER BY sequence_number ASC LOOP
        IF entry.previous_hash != prev_hash THEN
            is_valid := FALSE;
            IF broken IS NULL THEN
                broken := entry.sequence_number;
            END IF;
        END IF;
        prev_hash := entry.hash;
        seq := seq + 1;
    END LOOP;

    RETURN QUERY SELECT is_valid, broken, seq::BIGINT;
END;
$$ LANGUAGE plpgsql;
```

### 5D. Add VIADP delegation indexes for performance

```sql
-- Composite indexes for common VIADP queries
CREATE INDEX IF NOT EXISTS idx_delegations_status_created
    ON viadp_delegations (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_delegation_timestamp
    ON viadp_audit_log (delegation_id, timestamp DESC);
```

### Verification
- `init.sql` is valid SQL (no syntax errors)
- `viadp_reputation` table is created with 12 agent seeds
- `viadp_audit_log` has INSERT-only rules
- `verify_audit_hash_chain()` function exists

---

## WORKSTREAM 6: Connect Dashboard VIADP Audit Log to Real Data

**Files to modify:**
- `/forge-team/dashboard/src/components/ViadpAuditLog.tsx`
- `/forge-team/dashboard/src/lib/api.ts` (if needed)
- `/forge-team/dashboard/src/lib/socket.ts` (if needed)

### 6A. Add WebSocket subscription for VIADP events

In `ViadpAuditLog.tsx`, add a `useEffect` that subscribes to the `viadp_update` WebSocket event (this event is already defined in `socket.ts`). When a new delegation event arrives via WebSocket, prepend it to the local delegations list.

```typescript
useEffect(() => {
  // Subscribe to real-time VIADP events via WebSocket
  const socket = getSocket(); // from socket.ts
  if (socket) {
    const handler = (event: DelegationEntry) => {
      setDelegations(prev => [event, ...prev]);
    };
    socket.on('viadp_update', handler);
    return () => { socket.off('viadp_update', handler); };
  }
}, []);
```

### 6B. Add REST API polling fallback

If the WebSocket is not connected, poll `/api/viadp/delegations` every 10 seconds using the existing pattern from other dashboard components. The gateway already has this endpoint in `index.ts`.

### 6C. Keep mock data as initial fallback

The component should still accept `delegations` as a prop (mock data). If the REST/WS provides data, replace the mock data. If not, keep using the props.

### Verification
- `ViadpAuditLog.tsx` subscribes to `viadp_update` events
- Mock data is used as fallback when gateway is offline
- Component still renders correctly with the existing glass-card styling

---

## TEAM STRUCTURE SUGGESTION

Create a team with these agents working in parallel:

1. **types-architect** — Handles WORKSTREAM 1 (types unification, barrel exports)
2. **viadp-builder** — Handles WORKSTREAM 2 (new assessment, execution-monitor, trust-calibration modules + modifications to existing modules)
3. **gateway-integrator** — Handles WORKSTREAM 3 (rewrite gateway viadp-engine as thin wrapper) — depends on WORKSTREAM 1 + 2 completing
4. **langgraph-wirer** — Handles WORKSTREAM 4 (LangGraph VIADP node + workflow injection) — depends on WORKSTREAM 3
5. **db-engineer** — Handles WORKSTREAM 5 (SQL extensions) — independent, can run in parallel
6. **dashboard-connector** — Handles WORKSTREAM 6 (WebSocket VIADP audit) — independent, can run in parallel

Dependency chain: WS1 + WS2 (parallel) -> WS3 -> WS4
Independent: WS5, WS6 (can start immediately)

---

## FINAL CHECKLIST

After all workstreams complete, verify:

- [x] `npx tsc --noEmit` succeeds in `/forge-team/viadp/` with zero errors
- [x] `npx tsc --noEmit` succeeds in `/forge-team/gateway/` with zero errors
- [x] `grep -r "import.*from.*@forge-team/viadp" forge-team/gateway/src/viadp-engine.ts` returns results (gateway uses the package)
- [x] `wc -l forge-team/gateway/src/viadp-engine.ts` returns < 250 lines (thin wrapper, not 827)
- [x] `viadp/types.ts` exists with DelegationRequest, Bid, DelegationToken, VIADPContext
- [x] `viadp/src/assessment.ts` exists with `runDynamicAssessment()`
- [x] `viadp/src/execution-monitor.ts` exists with `startMonitoring()`
- [x] `viadp/src/trust-calibration.ts` exists with `issueDelegationToken()` and `updateTrustBayesian()`
- [x] `viadp/src/resilience.ts` has `applyEconomicSelfRegulation()` (economic throttle function)
- [x] `viadp/src/verification.ts` has `generateZKProof()` stub
- [x] `gateway/src/langgraph-nodes/viadp-delegation-node.ts` exists
- [x] `workflow-engine.ts` WorkflowExecutor constructor accepts optional VIADPEngine
- [x] `init.sql` has `viadp_reputation` table with 12 agent seeds
- [x] `init.sql` has INSERT-only rules on `viadp_audit_log`
- [x] `ViadpAuditLog.tsx` subscribes to `viadp_update` WebSocket event
- [x] No duplicate VIADP logic remains in gateway — all core logic is in `@forge-team/viadp`
- [x] Circuit breakers, parallel bids, diversity scoring are now LIVE code (used by gateway), not dead code
