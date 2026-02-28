# Session 15 — VIADP Hardening: Anomaly Detection, RFQ Bidding & DB Immutability

> **Instructions for Claude Code Opus 4.6**: Read this entire prompt before taking any action. You must complete ALL tasks listed below in the ForgeTeam project at `/Users/bandar/Documents/AreebPro/forge-team/`. Use the **team/swarm feature** — create a team and spin up parallel agents to work on independent workstreams simultaneously. Each workstream is labeled. Do NOT skip any item. Do NOT introduce new features beyond what is listed. Do NOT add comments, docstrings, or type annotations to code you did not change. Preserve the existing TypeScript style and project conventions.

---

## CONTEXT

The re-audit (AUDIT-REPORT.md) shows VIADP Phase 5 at 75% completion. Three gaps remain:

| # | Gap | Audit Reference |
|---|-----|-----------------|
| 1 | **No statistical anomaly detection** — `execution-monitor.ts` is a 43-line stub that returns a hardcoded `0.95` health score and uses a simple `< 0.8` threshold. No real metric collection, no Z-score or statistical detection, no adaptive thresholds | Phase 5, "Adaptive Execution (monitoring, anomaly, re-delegation)" (PARTIAL) |
| 2 | **No formal RFQ bidding protocol** — `DelegationEngine.matchDelegates()` scores and ranks candidates internally, but there is no formal Request-For-Quote flow where agents can submit bids. The audit notes "Still no formal RFQ bidding protocol" | Phase 5, "Dynamic Assessment (optimizer, diversity, RFQ)" (PARTIAL) |
| 3 | **No DB-level INSERT-only enforcement on `audit_log` table** — `viadp_audit_log` has INSERT-only rules (init.sql lines 544-548), but the general `audit_log` table (used by `audit-middleware.ts`) has NO such protection. Updates and deletes are allowed | Phase 9, "Immutable VIADP provenance ledger" (PARTIAL) |

---

## PRE-WORK: Read These Files First (Before Any Edits)

Every agent on the team must read the files relevant to their workstream before editing.

**VIADP source (all agents should skim):**
- `/forge-team/viadp/src/execution-monitor.ts` — **THE 43-LINE STUB** to be rewritten (lines 1-43)
- `/forge-team/viadp/src/delegation-engine.ts` — `DelegationEngine` class, `matchDelegates()` (lines 264-362), `delegate()` (lines 367-434), `monitorExecution()` (lines 440-460), `updateExecutionStatus()` (lines 465-483)
- `/forge-team/viadp/src/index.ts` — exports for all VIADP modules
- `/forge-team/viadp/src/trust-manager.ts` — Bayesian trust model
- `/forge-team/viadp/src/resilience.ts` — circuit breakers, parallel bids
- `/forge-team/viadp/src/audit-log.ts` — FNV-1a hash chain

**Infrastructure:**
- `/forge-team/infrastructure/init.sql` — `audit_log` table (lines 255-272), `viadp_audit_log` INSERT-only rules (lines 544-548), sequence enforcement trigger (lines 587-615)

**Gateway audit middleware:**
- `/forge-team/gateway/src/audit-middleware.ts` — `AuditMiddleware` class, `logMessage()` method with fire-and-forget DB persistence (lines 67-77)

**Existing tests:**
- `/forge-team/viadp/src/__tests__/delegation-engine.test.ts`

---

## WORKSTREAM 1: Statistical Anomaly Detection

**Files to modify:**
- `/forge-team/viadp/src/execution-monitor.ts` (full rewrite)
- `/forge-team/viadp/src/delegation-engine.ts` (update monitoring integration)
- `/forge-team/viadp/src/index.ts` (update exports if new types are added)

### 1A. Rewrite `execution-monitor.ts` with real anomaly detection

Replace the entire contents of `/forge-team/viadp/src/execution-monitor.ts` with a proper implementation. The new module must provide:

**Metric recording:**
```typescript
interface MetricSample {
  delegationId: string;
  agentId: string;
  metric: string; // e.g., 'response_time_ms', 'token_usage', 'error_rate', 'progress_rate'
  value: number;
  timestamp: Date;
}
```

A `MetricStore` (in-memory Map keyed by `agentId:metric`) that stores a sliding window of the last 100 samples per metric per agent.

**Z-score anomaly detection:**
```typescript
interface AnomalyResult {
  isAnomaly: boolean;
  metric: string;
  value: number;
  zScore: number;
  mean: number;
  stdDev: number;
  threshold: number;
}
```

The `detectAnomaly(agentId: string, metric: string, value: number): AnomalyResult` function should:
1. Look up the sliding window for `agentId:metric`
2. Compute mean and standard deviation of the window
3. Calculate Z-score: `z = (value - mean) / stdDev` (handle stdDev === 0 by returning `isAnomaly: false`)
4. Compare `|z|` against an adaptive threshold (default: 2.5)
5. Return the `AnomalyResult`

**Adaptive thresholds:**
The threshold starts at 2.5 and adjusts based on recent anomaly rate:
- If anomaly rate in last 20 checks > 30%, widen threshold to 3.0 (reduce sensitivity)
- If anomaly rate in last 20 checks < 5%, tighten threshold to 2.0 (increase sensitivity)

Store a rolling window of the last 20 anomaly checks per agent.

**Health scoring:**
Replace the hardcoded `return 0.95` in `checkAgentHealth()` with a real composite health score:
```typescript
export async function checkAgentHealth(agentId: string): Promise<number> {
  const metrics = ['response_time_ms', 'error_rate', 'progress_rate'];
  let totalScore = 0;
  let metricCount = 0;

  for (const metric of metrics) {
    const window = metricStore.get(`${agentId}:${metric}`);
    if (!window || window.length === 0) continue;

    const recent = window.slice(-10);
    const avgRecent = recent.reduce((s, v) => s + v.value, 0) / recent.length;

    // Normalize to 0-1 score
    let score: number;
    if (metric === 'error_rate') {
      score = Math.max(0, 1 - avgRecent); // Lower error rate = higher health
    } else if (metric === 'response_time_ms') {
      score = Math.max(0, 1 - avgRecent / 60000); // Under 60s is healthy
    } else {
      score = Math.min(1, avgRecent); // progress_rate: higher is better
    }

    totalScore += score;
    metricCount++;
  }

  return metricCount > 0 ? totalScore / metricCount : 0.5; // 0.5 = unknown
}
```

**Monitoring loop:**
Update `startMonitoring()` to:
1. Record a `progress_rate` metric every polling interval (30s)
2. Call `detectAnomaly()` on the recorded metrics
3. If anomaly detected, call `triggerReDelegation()` (as before) but also emit a log

Keep the existing `MonitoringContext` interface and `activeMonitors` map. Add `recordMetric()` to the exports.

### 1B. Update delegation-engine.ts monitoring integration

In `DelegationEngine.delegate()` (line 422-431), the `startMonitoring()` call currently passes a basic context. Update it to also record an initial metric:

After calling `startMonitoring()`, also call:
```typescript
recordMetric({
  delegationId: tokenId,
  agentId: selectedAgentId,
  metric: 'progress_rate',
  value: 0,
  timestamp: new Date(),
});
```

Import `recordMetric` from `./execution-monitor` alongside `startMonitoring`.

### 1C. Update viadp/src/index.ts exports

Add any new exported types and functions to the barrel file. Ensure `recordMetric`, `detectAnomaly`, `MetricSample`, `AnomalyResult` are all exported from `./execution-monitor`.

---

## WORKSTREAM 2: RFQ Bidding Protocol

**Files to modify:**
- `/forge-team/viadp/src/delegation-engine.ts`
- `/forge-team/viadp/src/index.ts`

### 2A. Add RFQ types to delegation-engine.ts

Add these types after the existing type definitions (after line ~118):

```typescript
export interface RFQ {
  id: string;
  taskId: string;
  delegator: string;
  capabilityRequirements: string[];
  riskLevel: RiskLevel;
  deadline: Date;
  maxCost?: number;
  description: string;
  createdAt: Date;
  status: 'open' | 'evaluating' | 'awarded' | 'cancelled';
  bids: RFQBid[];
}

export interface RFQBid {
  id: string;
  rfqId: string;
  agentId: string;
  proposedCost: number;
  estimatedDuration: number; // minutes
  confidence: number; // 0-1, agent's self-assessed confidence
  approach: string; // brief description of how the agent would tackle the task
  submittedAt: Date;
}

export interface RFQResult {
  rfqId: string;
  winner: string | null;
  bids: Array<RFQBid & { compositeScore: number; reasoning: string }>;
  awardedAt: Date | null;
}
```

### 2B. Add RFQ methods to DelegationEngine

Add three new methods to the `DelegationEngine` class:

**`createRFQ()`**: Creates an open RFQ that agents can bid on.
```typescript
createRFQ(request: DelegationRequest, description: string): RFQ {
  const rfq: RFQ = {
    id: uuidv4(),
    taskId: request.taskId,
    delegator: request.delegator,
    capabilityRequirements: request.capabilityRequirements,
    riskLevel: request.riskLevel,
    deadline: request.deadline,
    maxCost: request.maxCost,
    description,
    createdAt: new Date(),
    status: 'open',
    bids: [],
  };
  this.activeRFQs.set(rfq.id, rfq);
  return rfq;
}
```

Add `private activeRFQs: Map<string, RFQ> = new Map();` to the class fields.

**`submitBid()`**: An agent submits a bid to an open RFQ.
```typescript
submitBid(rfqId: string, bid: Omit<RFQBid, 'id' | 'rfqId' | 'submittedAt'>): RFQBid {
  const rfq = this.activeRFQs.get(rfqId);
  if (!rfq) throw new Error(`RFQ ${rfqId} not found`);
  if (rfq.status !== 'open') throw new Error(`RFQ ${rfqId} is not open for bids`);

  // Validate agent exists and is available
  const agent = this.agents.get(bid.agentId);
  if (!agent) throw new Error(`Agent ${bid.agentId} not found`);
  if (agent.status === 'offline' || agent.status === 'error') {
    throw new Error(`Agent ${bid.agentId} is not available`);
  }

  // Validate cost does not exceed RFQ max
  if (rfq.maxCost && bid.proposedCost > rfq.maxCost) {
    throw new Error(`Bid cost $${bid.proposedCost} exceeds RFQ max $${rfq.maxCost}`);
  }

  const fullBid: RFQBid = {
    id: uuidv4(),
    rfqId,
    ...bid,
    submittedAt: new Date(),
  };
  rfq.bids.push(fullBid);
  return fullBid;
}
```

**`evaluateRFQ()`**: Closes the RFQ, scores all bids, selects a winner using the existing multi-objective scoring.
```typescript
evaluateRFQ(rfqId: string): RFQResult {
  const rfq = this.activeRFQs.get(rfqId);
  if (!rfq) throw new Error(`RFQ ${rfqId} not found`);

  rfq.status = 'evaluating';

  if (rfq.bids.length === 0) {
    rfq.status = 'cancelled';
    return { rfqId, winner: null, bids: [], awardedAt: null };
  }

  // Score each bid using capability assessment + bid-specific factors
  const scoredBids = rfq.bids.map((bid) => {
    const capability = this.assessCapability(bid.agentId, rfq.capabilityRequirements);
    const agent = this.agents.get(bid.agentId)!;

    // Cost score: lower proposed cost relative to max = better
    const maxCost = rfq.maxCost ?? Math.max(...rfq.bids.map(b => b.proposedCost));
    const costScore = 1 - (bid.proposedCost / (maxCost || 1));

    // Time score: faster estimated duration = better
    const maxDuration = Math.max(...rfq.bids.map(b => b.estimatedDuration));
    const timeScore = 1 - (bid.estimatedDuration / (maxDuration || 1));

    // Confidence from the bidding agent
    const confidenceScore = bid.confidence;

    // Trust from the trust system
    const trustScore = agent.trustScore;

    // Weighted composite
    const weights = this.getWeights(rfq.riskLevel);
    const compositeScore =
      capability.overallScore * weights.capability +
      costScore * weights.cost +
      ((trustScore * 0.5 + confidenceScore * 0.5) / this.riskMultiplier(rfq.riskLevel)) * weights.risk +
      timeScore * weights.diversity; // reuse diversity weight for time factor

    const reasoning = [
      `Capability: ${(capability.overallScore * 100).toFixed(0)}%`,
      `Bid: $${bid.proposedCost.toFixed(2)} / ${bid.estimatedDuration}min`,
      `Confidence: ${(bid.confidence * 100).toFixed(0)}%`,
      `Trust: ${trustScore.toFixed(2)}`,
    ].join(' | ');

    return { ...bid, compositeScore, reasoning };
  });

  // Sort by composite score descending
  scoredBids.sort((a, b) => b.compositeScore - a.compositeScore);

  const winner = scoredBids[0]?.agentId ?? null;
  rfq.status = winner ? 'awarded' : 'cancelled';

  return {
    rfqId,
    winner,
    bids: scoredBids,
    awardedAt: winner ? new Date() : null,
  };
}
```

### 2C. Add convenience `delegateWithRFQ()` method

Add a method that combines the full RFQ lifecycle:

```typescript
delegateWithRFQ(
  request: DelegationRequest,
  description: string,
  autoCollectBids: boolean = true,
): { rfqResult: RFQResult; token: DelegationToken | null } {
  const rfq = this.createRFQ(request, description);

  if (autoCollectBids) {
    // Auto-generate bids from all eligible agents (simulating agent responses)
    for (const [, profile] of this.agents) {
      if (profile.id === request.delegator) continue;
      if (profile.status === 'offline' || profile.status === 'error') continue;
      if (profile.currentLoad >= profile.maxConcurrentTasks) continue;

      const capability = this.assessCapability(profile.id, request.capabilityRequirements);
      if (capability.overallScore < 0.1) continue;

      this.submitBid(rfq.id, {
        agentId: profile.id,
        proposedCost: profile.costPerToken * (request.maxCost ?? 1000) * (1 - capability.overallScore * 0.3),
        estimatedDuration: Math.round(30 / (capability.overallScore || 0.1)),
        confidence: capability.confidence,
        approach: `${capability.matchedCapabilities.join(', ')} — ${profile.modelFamily}`,
      });
    }
  }

  const rfqResult = this.evaluateRFQ(rfq.id);

  let token: DelegationToken | null = null;
  if (rfqResult.winner) {
    token = this.delegate(request, rfqResult.winner);
  }

  return { rfqResult, token };
}
```

### 2D. Update viadp/src/index.ts exports

Add `RFQ`, `RFQBid`, and `RFQResult` types to the exports from `./delegation-engine`.

---

## WORKSTREAM 3: DB Immutability for `audit_log` Table

**Files to modify:**
- `/forge-team/infrastructure/init.sql`
- `/forge-team/gateway/src/audit-middleware.ts`

### 3A. Add INSERT-only rules to `audit_log` table

In `/forge-team/infrastructure/init.sql`, after the `audit_log` table definition and its indexes (around line 272), add the same pattern used for `viadp_audit_log`:

```sql
-- Enforce INSERT-only on audit_log (no UPDATE, no DELETE)
CREATE OR REPLACE RULE audit_log_no_update AS
    ON UPDATE TO audit_log DO INSTEAD NOTHING;

CREATE OR REPLACE RULE audit_log_no_delete AS
    ON DELETE TO audit_log DO INSTEAD NOTHING;

COMMENT ON TABLE audit_log IS
  'Immutable append-only audit log for all WebSocket messages. '
  'UPDATE and DELETE operations are blocked by PostgreSQL rules. '
  'Hash chain integrity: each entry''s hash covers all prior entries via SHA-256.';
```

Place this directly after the `idx_general_audit_timestamp` index creation (line 272) and before the Model Configurations section.

### 3B. Add retry logic to audit-middleware DB persistence

In `/forge-team/gateway/src/audit-middleware.ts`, the `logMessage()` method uses fire-and-forget DB persistence (lines 67-77). The current code has a single `catch` that silently swallows errors. Add simple retry logic:

Replace the fire-and-forget block (lines 67-77) with:

```typescript
// Persist to DB with retry
const persistEntry = async (retries = 2) => {
  try {
    const { query } = await import('./db.js');
    await query(
      `INSERT INTO audit_log (id, sequence_number, hash, previous_hash, client_id, client_type, message_type, direction, session_id, agent_id, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [entry.id, entry.sequenceNumber, entry.hash, entry.previousHash, entry.clientId, entry.clientType, entry.messageType, entry.direction, entry.sessionId, entry.agentId, entry.timestamp]
    );
  } catch (err: any) {
    if (retries > 0) {
      setTimeout(() => persistEntry(retries - 1), 1000);
    } else {
      console.error('[AuditMiddleware] Failed to persist audit entry after retries:', err?.message);
    }
  }
};
persistEntry();
```

This provides 2 retry attempts with 1-second delay between retries, and escalates from `console.warn` to `console.error` after all retries are exhausted.

---

## TEAM STRUCTURE SUGGESTION

Create a team with these agents working in parallel:

1. **anomaly-engineer** — Handles WORKSTREAM 1 (rewrite execution-monitor.ts, update delegation-engine integration, update exports)
2. **rfq-engineer** — Handles WORKSTREAM 2 (RFQ types, methods, convenience wrapper, exports)
3. **db-engineer** — Handles WORKSTREAM 3 (INSERT-only rules on audit_log, retry logic in audit-middleware)

All workstreams are fully independent and can run in parallel. WORKSTREAM 3 is the smallest and should finish first.

---

## FINAL CHECKLIST (Every Agent Must Verify)

After all work is complete, verify:

- [ ] `execution-monitor.ts` is fully rewritten (NOT the 43-line stub anymore)
- [ ] `MetricSample` and `AnomalyResult` interfaces exist
- [ ] `detectAnomaly()` computes Z-score from a sliding window of samples
- [ ] Adaptive threshold adjusts between 2.0-3.0 based on recent anomaly rate
- [ ] `checkAgentHealth()` returns a real composite score (not hardcoded `0.95`)
- [ ] `recordMetric()` is exported and called from `DelegationEngine.delegate()`
- [ ] `startMonitoring()` records `progress_rate` metrics and runs anomaly detection
- [ ] `RFQ`, `RFQBid`, `RFQResult` types exist in `delegation-engine.ts`
- [ ] `createRFQ()` creates an open RFQ
- [ ] `submitBid()` validates agent availability and cost limits
- [ ] `evaluateRFQ()` scores bids using capability + cost + trust + time factors
- [ ] `delegateWithRFQ()` combines the full lifecycle: create → bid → evaluate → delegate
- [ ] All new types and functions are exported from `viadp/src/index.ts`
- [ ] `init.sql` has `audit_log_no_update` and `audit_log_no_delete` rules
- [ ] `init.sql` has a COMMENT on `audit_log` table documenting immutability
- [ ] `audit-middleware.ts` `logMessage()` has retry logic (2 retries, 1s delay)
- [ ] Failed persistence after all retries logs `console.error` (not `console.warn`)
- [ ] No `gpt-4o` or `gpt-4o-mini` references introduced
- [ ] Existing VIADP tests in `viadp/src/__tests__/` still pass (no breaking changes to existing APIs)
