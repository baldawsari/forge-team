/**
 * Systemic Resilience module for the VIADP protocol.
 *
 * Provides diversity scoring, parallel bidding, consensus voting,
 * circuit breaker pattern, and health checks to ensure robust
 * multi-agent delegation.
 */

import { v4 as uuidv4 } from 'uuid';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentCandidate {
  agentId: string;
  modelFamily: string;
  capabilities: string[];
  trustScore: number;
  status: 'idle' | 'working' | 'reviewing' | 'blocked' | 'offline' | 'error';
}

export interface ParallelBidResult {
  bidId: string;
  agentId: string;
  result: unknown;
  completedAt: Date;
  durationMs: number;
  success: boolean;
  error: string | null;
}

export interface ConsensusResult {
  selectedResult: unknown;
  selectedAgentId: string;
  agreementScore: number;
  method: 'majority' | 'weighted' | 'best_quality';
  votes: ConsensusVote[];
}

export interface ConsensusVote {
  agentId: string;
  resultIndex: number;
  confidence: number;
  reasoning: string;
}

export interface CircuitBreakerState {
  agentId: string;
  state: 'closed' | 'open' | 'half_open';
  failureCount: number;
  successCount: number;
  lastFailure: Date | null;
  lastSuccess: Date | null;
  openedAt: Date | null;
  halfOpenAt: Date | null;
  nextRetryAt: Date | null;
}

export interface HealthCheckResult {
  agentId: string;
  healthy: boolean;
  latencyMs: number;
  checkedAt: Date;
  details: Record<string, unknown>;
}

export interface ResilienceConfig {
  circuitBreakerThreshold: number;
  circuitBreakerResetMs: number;
  circuitBreakerHalfOpenMax: number;
  healthCheckTimeoutMs: number;
  diversityPenaltyWeight: number;
  parallelBidTimeoutMs: number;
}

// ---------------------------------------------------------------------------
// Resilience Engine
// ---------------------------------------------------------------------------

export class ResilienceEngine {
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map();
  private healthHistory: Map<string, HealthCheckResult[]> = new Map();
  private config: ResilienceConfig;

  constructor(config: Partial<ResilienceConfig> = {}) {
    this.config = {
      circuitBreakerThreshold: config.circuitBreakerThreshold ?? 5,
      circuitBreakerResetMs: config.circuitBreakerResetMs ?? 60_000,
      circuitBreakerHalfOpenMax: config.circuitBreakerHalfOpenMax ?? 2,
      healthCheckTimeoutMs: config.healthCheckTimeoutMs ?? 5_000,
      diversityPenaltyWeight: config.diversityPenaltyWeight ?? 0.3,
      parallelBidTimeoutMs: config.parallelBidTimeoutMs ?? 30_000,
    };
  }

  /**
   * Calculate a diversity score for a set of candidates.
   * Penalizes groups where agents share the same model family.
   * Returns a score from 0 (no diversity) to 1 (maximum diversity).
   */
  diversityScore(candidates: AgentCandidate[]): number {
    if (candidates.length <= 1) return 1.0;

    // Count model family distribution
    const familyCounts = new Map<string, number>();
    for (const candidate of candidates) {
      const count = familyCounts.get(candidate.modelFamily) ?? 0;
      familyCounts.set(candidate.modelFamily, count + 1);
    }

    const totalCandidates = candidates.length;
    const uniqueFamilies = familyCounts.size;

    // Shannon entropy-based diversity
    let entropy = 0;
    for (const count of familyCounts.values()) {
      const proportion = count / totalCandidates;
      if (proportion > 0) {
        entropy -= proportion * Math.log2(proportion);
      }
    }

    // Normalize by maximum possible entropy (all unique families)
    const maxEntropy = Math.log2(totalCandidates);
    const normalizedEntropy = maxEntropy > 0 ? entropy / maxEntropy : 1;

    // Also consider the ratio of unique families to total candidates
    const familyRatio = uniqueFamilies / totalCandidates;

    // Weighted combination
    const diversityWeight = this.config.diversityPenaltyWeight;
    const score =
      normalizedEntropy * diversityWeight +
      familyRatio * (1 - diversityWeight);

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Launch parallel delegations for critical tasks.
   * Executes the task function across topK agents concurrently
   * and collects results with timeout handling.
   */
  async parallelBid(
    candidates: AgentCandidate[],
    topK: number,
    taskFn: (agentId: string) => Promise<unknown>,
  ): Promise<ParallelBidResult[]> {
    // Select top-K candidates, preferring diversity
    const selected = this.selectDiverseTopK(candidates, topK);
    const timeout = this.config.parallelBidTimeoutMs;

    // Launch all bids in parallel
    const bidPromises = selected.map(async (candidate) => {
      const bidId = uuidv4();
      const startTime = Date.now();

      try {
        // Race the task against a timeout
        const result = await Promise.race([
          taskFn(candidate.agentId),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Bid timed out')), timeout),
          ),
        ]);

        return {
          bidId,
          agentId: candidate.agentId,
          result,
          completedAt: new Date(),
          durationMs: Date.now() - startTime,
          success: true,
          error: null,
        } satisfies ParallelBidResult;
      } catch (err) {
        return {
          bidId,
          agentId: candidate.agentId,
          result: null,
          completedAt: new Date(),
          durationMs: Date.now() - startTime,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        } satisfies ParallelBidResult;
      }
    });

    return Promise.all(bidPromises);
  }

  /**
   * Determine the best result from parallel execution using consensus.
   * Supports majority voting, weighted voting, and best-quality selection.
   */
  consensusVote(
    results: ParallelBidResult[],
    qualityScorer?: (result: unknown) => number,
  ): ConsensusResult {
    const successfulResults = results.filter((r) => r.success);

    if (successfulResults.length === 0) {
      return {
        selectedResult: null,
        selectedAgentId: '',
        agreementScore: 0,
        method: 'best_quality',
        votes: [],
      };
    }

    if (successfulResults.length === 1) {
      return {
        selectedResult: successfulResults[0].result,
        selectedAgentId: successfulResults[0].agentId,
        agreementScore: 1.0,
        method: 'best_quality',
        votes: [
          {
            agentId: successfulResults[0].agentId,
            resultIndex: 0,
            confidence: 1.0,
            reasoning: 'Only successful result',
          },
        ],
      };
    }

    // If a quality scorer is provided, use quality-based selection
    if (qualityScorer) {
      return this.qualityBasedConsensus(successfulResults, qualityScorer);
    }

    // Otherwise, use similarity-based voting
    return this.similarityBasedConsensus(successfulResults);
  }

  /**
   * Track a failure for circuit breaker purposes.
   * When threshold is exceeded, the circuit opens and the agent
   * is temporarily excluded from delegation.
   */
  recordFailure(agentId: string): CircuitBreakerState {
    let cb = this.circuitBreakers.get(agentId);
    if (!cb) {
      cb = this.initCircuitBreaker(agentId);
    }

    cb.failureCount += 1;
    cb.lastFailure = new Date();

    // Check if we should trip the breaker
    if (
      cb.state === 'closed' &&
      cb.failureCount >= this.config.circuitBreakerThreshold
    ) {
      cb.state = 'open';
      cb.openedAt = new Date();
      cb.nextRetryAt = new Date(
        Date.now() + this.config.circuitBreakerResetMs,
      );
    }

    // In half-open state, any failure re-opens
    if (cb.state === 'half_open') {
      cb.state = 'open';
      cb.openedAt = new Date();
      cb.failureCount = this.config.circuitBreakerThreshold; // Reset to threshold
      cb.nextRetryAt = new Date(
        Date.now() + this.config.circuitBreakerResetMs * 2, // Double backoff
      );
    }

    this.circuitBreakers.set(agentId, cb);
    return cb;
  }

  /**
   * Record a success for circuit breaker.
   * In half-open state, successes gradually close the circuit.
   */
  recordSuccess(agentId: string): CircuitBreakerState {
    let cb = this.circuitBreakers.get(agentId);
    if (!cb) {
      cb = this.initCircuitBreaker(agentId);
    }

    cb.successCount += 1;
    cb.lastSuccess = new Date();

    if (cb.state === 'half_open') {
      cb.successCount += 1;
      if (cb.successCount >= this.config.circuitBreakerHalfOpenMax) {
        // Close the circuit
        cb.state = 'closed';
        cb.failureCount = 0;
        cb.successCount = 0;
        cb.openedAt = null;
        cb.halfOpenAt = null;
        cb.nextRetryAt = null;
      }
    } else if (cb.state === 'closed') {
      // Decay failure count on success
      cb.failureCount = Math.max(0, cb.failureCount - 1);
    }

    this.circuitBreakers.set(agentId, cb);
    return cb;
  }

  /**
   * Get the circuit breaker state for an agent.
   * Automatically transitions from open to half-open when the reset period elapses.
   */
  circuitBreaker(agentId: string): CircuitBreakerState {
    let cb = this.circuitBreakers.get(agentId);
    if (!cb) {
      cb = this.initCircuitBreaker(agentId);
      this.circuitBreakers.set(agentId, cb);
      return cb;
    }

    // Check if open circuit should transition to half-open
    if (cb.state === 'open' && cb.nextRetryAt) {
      if (new Date() >= cb.nextRetryAt) {
        cb.state = 'half_open';
        cb.halfOpenAt = new Date();
        cb.successCount = 0; // Reset success count for half-open evaluation
      }
    }

    return cb;
  }

  /**
   * Check if an agent is available (circuit not open).
   */
  isAgentAvailable(agentId: string): boolean {
    const cb = this.circuitBreaker(agentId);
    return cb.state !== 'open';
  }

  /**
   * Perform a health check on an agent.
   * Uses a provided health check function or returns a basic check.
   */
  async healthCheck(
    agentId: string,
    checkFn?: (agentId: string) => Promise<Record<string, unknown>>,
  ): Promise<HealthCheckResult> {
    const startTime = Date.now();

    try {
      let details: Record<string, unknown>;

      if (checkFn) {
        // Race the check against a timeout
        details = await Promise.race([
          checkFn(agentId),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error('Health check timed out')),
              this.config.healthCheckTimeoutMs,
            ),
          ),
        ]);
      } else {
        // Basic check: just verify circuit breaker state
        const cb = this.circuitBreaker(agentId);
        details = {
          circuitState: cb.state,
          failureCount: cb.failureCount,
          lastFailure: cb.lastFailure?.toISOString() ?? null,
          lastSuccess: cb.lastSuccess?.toISOString() ?? null,
        };
      }

      const latencyMs = Date.now() - startTime;
      const result: HealthCheckResult = {
        agentId,
        healthy: true,
        latencyMs,
        checkedAt: new Date(),
        details,
      };

      this.recordHealthCheck(agentId, result);
      return result;
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      const result: HealthCheckResult = {
        agentId,
        healthy: false,
        latencyMs,
        checkedAt: new Date(),
        details: {
          error: err instanceof Error ? err.message : String(err),
        },
      };

      this.recordHealthCheck(agentId, result);
      return result;
    }
  }

  /**
   * Get health check history for an agent.
   */
  getHealthHistory(agentId: string): HealthCheckResult[] {
    return this.healthHistory.get(agentId) ?? [];
  }

  /**
   * Get all circuit breaker states.
   */
  getAllCircuitBreakers(): CircuitBreakerState[] {
    // Refresh states before returning
    for (const agentId of this.circuitBreakers.keys()) {
      this.circuitBreaker(agentId);
    }
    return Array.from(this.circuitBreakers.values());
  }

  /**
   * Force-reset a circuit breaker (admin action).
   */
  resetCircuitBreaker(agentId: string): CircuitBreakerState {
    const cb = this.initCircuitBreaker(agentId);
    this.circuitBreakers.set(agentId, cb);
    return cb;
  }

  applyEconomicSelfRegulation(agentId: string, taskComplexity: number): { adjustedCost: number; throttle: boolean } {
    const cb = this.circuitBreaker(agentId);
    const heatMultiplier = 1 + (cb.failureCount * 0.1);
    const costMultiplier = 1 + (heatMultiplier - 1) * 0.5;
    return { adjustedCost: taskComplexity * costMultiplier, throttle: heatMultiplier > 1.5 };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private initCircuitBreaker(agentId: string): CircuitBreakerState {
    return {
      agentId,
      state: 'closed',
      failureCount: 0,
      successCount: 0,
      lastFailure: null,
      lastSuccess: null,
      openedAt: null,
      halfOpenAt: null,
      nextRetryAt: null,
    };
  }

  private selectDiverseTopK(
    candidates: AgentCandidate[],
    topK: number,
  ): AgentCandidate[] {
    if (candidates.length <= topK) return [...candidates];

    // Greedy selection that maximizes diversity
    const selected: AgentCandidate[] = [];
    const remaining = [...candidates];
    const selectedFamilies = new Map<string, number>();

    while (selected.length < topK && remaining.length > 0) {
      let bestIdx = 0;
      let bestScore = -Infinity;

      for (let i = 0; i < remaining.length; i++) {
        const candidate = remaining[i];
        const familyCount = selectedFamilies.get(candidate.modelFamily) ?? 0;

        // Score: trust * diversity bonus
        const diversityBonus = 1 / (1 + familyCount);
        const score = candidate.trustScore * diversityBonus;

        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }

      const chosen = remaining.splice(bestIdx, 1)[0];
      selected.push(chosen);
      selectedFamilies.set(
        chosen.modelFamily,
        (selectedFamilies.get(chosen.modelFamily) ?? 0) + 1,
      );
    }

    return selected;
  }

  private qualityBasedConsensus(
    results: ParallelBidResult[],
    qualityScorer: (result: unknown) => number,
  ): ConsensusResult {
    const scored = results.map((r, idx) => ({
      result: r,
      index: idx,
      quality: qualityScorer(r.result),
    }));

    scored.sort((a, b) => b.quality - a.quality);
    const best = scored[0];

    // Calculate agreement: how many results agree with the best one
    const votes: ConsensusVote[] = scored.map((s) => ({
      agentId: s.result.agentId,
      resultIndex: s.index,
      confidence: s.quality,
      reasoning: `Quality score: ${s.quality.toFixed(3)}`,
    }));

    // Agreement score: ratio of quality scores that are close to the best
    const threshold = best.quality * 0.8;
    const agreeing = scored.filter((s) => s.quality >= threshold);
    const agreementScore = agreeing.length / scored.length;

    return {
      selectedResult: best.result.result,
      selectedAgentId: best.result.agentId,
      agreementScore,
      method: 'best_quality',
      votes,
    };
  }

  private similarityBasedConsensus(
    results: ParallelBidResult[],
  ): ConsensusResult {
    // Simple approach: serialize results and compare by string similarity
    const serialized = results.map((r) => JSON.stringify(r.result));

    // Count how many results are similar to each result
    const similarityCounts = results.map((_, idx) => {
      let count = 0;
      for (let j = 0; j < results.length; j++) {
        if (j === idx) continue;
        if (this.stringSimilarity(serialized[idx], serialized[j]) > 0.7) {
          count++;
        }
      }
      return count;
    });

    // The result with the most similar counterparts is the consensus
    let bestIdx = 0;
    let maxSimilar = -1;

    for (let i = 0; i < similarityCounts.length; i++) {
      if (similarityCounts[i] > maxSimilar) {
        maxSimilar = similarityCounts[i];
        bestIdx = i;
      }
    }

    const agreementScore =
      results.length > 1 ? (maxSimilar + 1) / results.length : 1;

    const votes: ConsensusVote[] = results.map((r, idx) => ({
      agentId: r.agentId,
      resultIndex: idx,
      confidence:
        this.stringSimilarity(serialized[idx], serialized[bestIdx]),
      reasoning:
        idx === bestIdx
          ? 'Selected as consensus result'
          : `Similarity to consensus: ${this.stringSimilarity(serialized[idx], serialized[bestIdx]).toFixed(3)}`,
    }));

    return {
      selectedResult: results[bestIdx].result,
      selectedAgentId: results[bestIdx].agentId,
      agreementScore,
      method: 'majority',
      votes,
    };
  }

  private stringSimilarity(a: string, b: string): number {
    if (a === b) return 1.0;
    if (a.length === 0 || b.length === 0) return 0;

    // Jaccard similarity on character trigrams
    const trigramsA = this.trigrams(a);
    const trigramsB = this.trigrams(b);

    let intersection = 0;
    for (const t of trigramsA) {
      if (trigramsB.has(t)) intersection++;
    }

    const union = trigramsA.size + trigramsB.size - intersection;
    return union > 0 ? intersection / union : 0;
  }

  private trigrams(s: string): Set<string> {
    const result = new Set<string>();
    for (let i = 0; i <= s.length - 3; i++) {
      result.add(s.slice(i, i + 3));
    }
    return result;
  }

  private recordHealthCheck(
    agentId: string,
    result: HealthCheckResult,
  ): void {
    const history = this.healthHistory.get(agentId) ?? [];
    history.push(result);
    // Keep last 100 checks
    if (history.length > 100) {
      history.splice(0, history.length - 100);
    }
    this.healthHistory.set(agentId, history);
  }
}

export function applyEconomicSelfRegulation(agentId: string, taskComplexity: number): { adjustedCost: number; throttle: boolean } {
  const heatMultiplier = 1.0;
  const costMultiplier = 1 + (heatMultiplier - 1) * 0.5;
  return { adjustedCost: taskComplexity * costMultiplier, throttle: heatMultiplier > 1.5 };
}

export async function enforceParallelBidsForCritical(req: { criticality: string }): Promise<unknown[]> {
  if (req.criticality === 'critical') {
    // Would call runDynamicAssessment and take top 3
    return [];
  }
  return [];
}
