/**
 * Core Delegation Engine for the VIADP protocol.
 *
 * Handles capability assessment, multi-objective delegate matching,
 * delegation token issuance, execution monitoring, verification,
 * and re-delegation on failure.
 */

import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface VerificationPolicy {
  type: 'self_report' | 'peer_review' | 'consensus' | 'proof';
  requiredConfidence: number;
}

export interface DelegationRequest {
  taskId: string;
  delegator: string;
  capabilityRequirements: string[];
  riskLevel: RiskLevel;
  deadline: Date;
  verificationPolicy: VerificationPolicy;
  context?: Record<string, unknown>;
  maxCost?: number;
  preferredModels?: string[];
}

export interface CapabilityScore {
  agentId: string;
  overallScore: number;
  domainScores: Record<string, number>;
  matchedCapabilities: string[];
  missingCapabilities: string[];
  confidence: number;
}

export interface RankedCandidate {
  agentId: string;
  capabilityScore: number;
  costEstimate: number;
  riskScore: number;
  diversityBonus: number;
  compositeScore: number;
  reasoning: string;
}

export interface DelegationToken {
  id: string;
  taskId: string;
  delegator: string;
  delegate: string;
  issuedAt: Date;
  expiresAt: Date;
  scope: DelegationScope;
  revoked: boolean;
  chain: string[];
  maxChainDepth: number;
  signature: string;
}

export interface DelegationScope {
  allowedActions: string[];
  resourceLimits: {
    maxTokens?: number;
    maxDuration?: number;
    maxCost?: number;
  };
  canRedelegate: boolean;
  allowedArtifactTypes: string[];
}

export interface ExecutionStatus {
  delegationId: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'timed_out';
  progress: number;
  lastUpdate: Date;
  checkpoints: CheckpointStatus[];
  currentStep: string;
  estimatedCompletion: Date | null;
}

export interface CheckpointStatus {
  name: string;
  reached: boolean;
  reachedAt: Date | null;
  metrics: Record<string, number>;
}

export interface VerificationResult {
  delegationId: string;
  verified: boolean;
  confidence: number;
  verifier: string;
  method: VerificationPolicy['type'];
  details: string;
  timestamp: Date;
}

export interface AgentProfile {
  id: string;
  capabilities: string[];
  modelFamily: string;
  costPerToken: number;
  avgResponseTime: number;
  trustScore: number;
  currentLoad: number;
  maxConcurrentTasks: number;
  status: 'idle' | 'working' | 'reviewing' | 'blocked' | 'offline' | 'error';
}

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

export const DelegationRequestSchema = z.object({
  taskId: z.string().min(1),
  delegator: z.string().min(1),
  capabilityRequirements: z.array(z.string()).min(1),
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']),
  deadline: z.date(),
  verificationPolicy: z.object({
    type: z.enum(['self_report', 'peer_review', 'consensus', 'proof']),
    requiredConfidence: z.number().min(0).max(1),
  }),
  context: z.record(z.unknown()).optional(),
  maxCost: z.number().positive().optional(),
  preferredModels: z.array(z.string()).optional(),
});

// ---------------------------------------------------------------------------
// Delegation Engine
// ---------------------------------------------------------------------------

export class DelegationEngine {
  private agents: Map<string, AgentProfile> = new Map();
  private activeDelegations: Map<string, DelegationToken> = new Map();
  private executionStatuses: Map<string, ExecutionStatus> = new Map();
  private statusListeners: Map<string, Array<(status: ExecutionStatus) => void>> = new Map();

  /**
   * Register an agent profile for capability matching.
   */
  registerAgent(profile: AgentProfile): void {
    this.agents.set(profile.id, profile);
  }

  /**
   * Unregister an agent.
   */
  unregisterAgent(agentId: string): void {
    this.agents.delete(agentId);
  }

  /**
   * Update an agent's profile (e.g., load, status).
   */
  updateAgentProfile(agentId: string, updates: Partial<AgentProfile>): void {
    const profile = this.agents.get(agentId);
    if (profile) {
      Object.assign(profile, updates);
    }
  }

  /**
   * Assess how well an agent matches the required capabilities.
   */
  assessCapability(
    agentId: string,
    requirements: string[],
  ): CapabilityScore {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return {
        agentId,
        overallScore: 0,
        domainScores: {},
        matchedCapabilities: [],
        missingCapabilities: requirements,
        confidence: 0,
      };
    }

    const agentCaps = new Set(agent.capabilities.map((c) => c.toLowerCase()));
    const matched: string[] = [];
    const missing: string[] = [];
    const domainScores: Record<string, number> = {};

    for (const req of requirements) {
      const reqLower = req.toLowerCase();

      // Exact match
      if (agentCaps.has(reqLower)) {
        matched.push(req);
        domainScores[req] = 1.0;
        continue;
      }

      // Partial/fuzzy match: check if any capability contains the requirement or vice versa
      let bestPartialScore = 0;
      for (const cap of agent.capabilities) {
        const capLower = cap.toLowerCase();
        if (capLower.includes(reqLower) || reqLower.includes(capLower)) {
          const overlap =
            Math.min(capLower.length, reqLower.length) /
            Math.max(capLower.length, reqLower.length);
          bestPartialScore = Math.max(bestPartialScore, overlap);
        }

        // Word-level overlap
        const reqWords = new Set(reqLower.split(/[-_\s]+/));
        const capWords = new Set(capLower.split(/[-_\s]+/));
        let commonWords = 0;
        for (const w of reqWords) {
          if (capWords.has(w)) commonWords++;
        }
        const wordOverlap =
          commonWords / Math.max(reqWords.size, capWords.size);
        bestPartialScore = Math.max(bestPartialScore, wordOverlap);
      }

      if (bestPartialScore >= 0.5) {
        matched.push(req);
        domainScores[req] = bestPartialScore;
      } else {
        missing.push(req);
        domainScores[req] = bestPartialScore;
      }
    }

    const overallScore =
      requirements.length > 0
        ? Object.values(domainScores).reduce((a, b) => a + b, 0) /
          requirements.length
        : 0;

    // Confidence based on how many requirements we have data for
    const confidence =
      requirements.length > 0 ? matched.length / requirements.length : 0;

    return {
      agentId,
      overallScore,
      domainScores,
      matchedCapabilities: matched,
      missingCapabilities: missing,
      confidence,
    };
  }

  /**
   * Match and rank delegates using multi-objective optimization:
   * capability, cost, risk, and diversity.
   */
  matchDelegates(request: DelegationRequest): RankedCandidate[] {
    DelegationRequestSchema.parse(request);

    const candidates: RankedCandidate[] = [];
    const modelFamilyCounts = new Map<string, number>();

    // First pass: score all available agents
    const rawScores: Array<{
      profile: AgentProfile;
      capability: CapabilityScore;
    }> = [];

    for (const [, profile] of this.agents) {
      // Skip agents that are offline, errored, or at max capacity
      if (
        profile.status === 'offline' ||
        profile.status === 'error' ||
        profile.currentLoad >= profile.maxConcurrentTasks
      ) {
        continue;
      }

      // Skip the delegator (cannot delegate to self)
      if (profile.id === request.delegator) continue;

      const capability = this.assessCapability(
        profile.id,
        request.capabilityRequirements,
      );

      if (capability.overallScore > 0.1) {
        rawScores.push({ profile, capability });
      }
    }

    if (rawScores.length === 0) return [];

    // Compute normalization bounds
    const maxCost = Math.max(...rawScores.map((r) => r.profile.costPerToken));
    const minCost = Math.min(...rawScores.map((r) => r.profile.costPerToken));
    const costRange = maxCost - minCost || 1;

    // Second pass: compute composite scores
    for (const { profile, capability } of rawScores) {
      // Cost score: lower is better (normalized 0-1)
      const costScore =
        1 - (profile.costPerToken - minCost) / costRange;
      const costEstimate =
        profile.costPerToken * (request.maxCost ?? 1000);

      // Risk score: based on trust, load, and risk level
      const loadFactor = 1 - profile.currentLoad / profile.maxConcurrentTasks;
      const riskMultiplier = this.riskMultiplier(request.riskLevel);
      const riskScore =
        (profile.trustScore * 0.6 + loadFactor * 0.4) / riskMultiplier;

      // Diversity bonus: penalize same model family
      const familyCount = modelFamilyCounts.get(profile.modelFamily) ?? 0;
      modelFamilyCounts.set(profile.modelFamily, familyCount + 1);
      const diversityBonus = 1 / (1 + familyCount * 0.3);

      // Weighted composite score
      const weights = this.getWeights(request.riskLevel);
      const compositeScore =
        capability.overallScore * weights.capability +
        costScore * weights.cost +
        riskScore * weights.risk +
        diversityBonus * weights.diversity;

      // Build reasoning string
      const reasoning = [
        `Capability: ${(capability.overallScore * 100).toFixed(0)}%`,
        `Matched: [${capability.matchedCapabilities.join(', ')}]`,
        capability.missingCapabilities.length > 0
          ? `Missing: [${capability.missingCapabilities.join(', ')}]`
          : null,
        `Trust: ${profile.trustScore.toFixed(2)}`,
        `Load: ${profile.currentLoad}/${profile.maxConcurrentTasks}`,
        `Model: ${profile.modelFamily}`,
      ]
        .filter(Boolean)
        .join(' | ');

      candidates.push({
        agentId: profile.id,
        capabilityScore: capability.overallScore,
        costEstimate,
        riskScore,
        diversityBonus,
        compositeScore,
        reasoning,
      });
    }

    // Sort by composite score descending
    candidates.sort((a, b) => b.compositeScore - a.compositeScore);

    return candidates;
  }

  /**
   * Issue a delegation token to the selected agent.
   */
  delegate(
    request: DelegationRequest,
    selectedAgentId: string,
  ): DelegationToken {
    const agent = this.agents.get(selectedAgentId);
    if (!agent) {
      throw new Error(`Agent ${selectedAgentId} not found`);
    }

    const tokenId = uuidv4();
    const now = new Date();

    // Calculate default scope based on risk level
    const scope = this.buildScope(request);

    // Generate a signature (hash-based token integrity)
    const signature = this.generateSignature(
      tokenId,
      request.taskId,
      request.delegator,
      selectedAgentId,
    );

    const token: DelegationToken = {
      id: tokenId,
      taskId: request.taskId,
      delegator: request.delegator,
      delegate: selectedAgentId,
      issuedAt: now,
      expiresAt: request.deadline,
      scope,
      revoked: false,
      chain: [request.delegator, selectedAgentId],
      maxChainDepth: request.riskLevel === 'critical' ? 1 : 3,
      signature,
    };

    this.activeDelegations.set(tokenId, token);

    // Initialize execution status
    const status: ExecutionStatus = {
      delegationId: tokenId,
      status: 'pending',
      progress: 0,
      lastUpdate: now,
      checkpoints: [],
      currentStep: 'initialized',
      estimatedCompletion: request.deadline,
    };
    this.executionStatuses.set(tokenId, status);

    // Update agent load
    agent.currentLoad += 1;

    return token;
  }

  /**
   * Subscribe to execution status updates for a delegation.
   * Returns an unsubscribe function.
   */
  monitorExecution(
    delegationId: string,
    callback: (status: ExecutionStatus) => void,
  ): () => void {
    const listeners = this.statusListeners.get(delegationId) ?? [];
    listeners.push(callback);
    this.statusListeners.set(delegationId, listeners);

    // Emit current status immediately
    const currentStatus = this.executionStatuses.get(delegationId);
    if (currentStatus) {
      callback(currentStatus);
    }

    // Return unsubscribe function
    return () => {
      const current = this.statusListeners.get(delegationId) ?? [];
      const idx = current.indexOf(callback);
      if (idx !== -1) current.splice(idx, 1);
    };
  }

  /**
   * Update execution status and notify listeners.
   */
  updateExecutionStatus(
    delegationId: string,
    update: Partial<ExecutionStatus>,
  ): void {
    const status = this.executionStatuses.get(delegationId);
    if (!status) return;

    Object.assign(status, update, { lastUpdate: new Date() });

    // Notify listeners
    const listeners = this.statusListeners.get(delegationId) ?? [];
    for (const listener of listeners) {
      try {
        listener(status);
      } catch {
        // Listener errors should not break the engine
      }
    }
  }

  /**
   * Verify the completion of a delegated task.
   */
  verifyCompletion(
    delegationId: string,
    result: { artifacts: string[]; summary: string; metrics: Record<string, number> },
  ): VerificationResult {
    const token = this.activeDelegations.get(delegationId);
    if (!token) {
      throw new Error(`Delegation ${delegationId} not found`);
    }

    if (token.revoked) {
      return {
        delegationId,
        verified: false,
        confidence: 0,
        verifier: 'system',
        method: 'self_report',
        details: 'Delegation token has been revoked',
        timestamp: new Date(),
      };
    }

    // Check if deadline has passed
    const now = new Date();
    if (now > token.expiresAt) {
      this.updateExecutionStatus(delegationId, { status: 'timed_out' });
      return {
        delegationId,
        verified: false,
        confidence: 0,
        verifier: 'system',
        method: 'self_report',
        details: 'Delegation deadline has passed',
        timestamp: now,
      };
    }

    // Basic verification: check that artifacts were produced
    const hasArtifacts = result.artifacts.length > 0;
    const hasSummary = result.summary.length > 0;

    // Compute confidence based on what was provided
    let confidence = 0;
    if (hasArtifacts) confidence += 0.4;
    if (hasSummary) confidence += 0.3;
    if (Object.keys(result.metrics).length > 0) confidence += 0.3;

    const verified = confidence >= 0.5;

    // Update execution status
    this.updateExecutionStatus(delegationId, {
      status: verified ? 'completed' : 'failed',
      progress: verified ? 100 : 0,
    });

    // Release agent load
    const agent = this.agents.get(token.delegate);
    if (agent && agent.currentLoad > 0) {
      agent.currentLoad -= 1;
    }

    return {
      delegationId,
      verified,
      confidence,
      verifier: token.delegator,
      method: 'self_report',
      details: verified
        ? `Task completed with ${result.artifacts.length} artifacts`
        : 'Verification failed: insufficient evidence of completion',
      timestamp: now,
    };
  }

  /**
   * Re-delegate a task to a different agent when the current delegate fails.
   */
  redelegate(
    delegationId: string,
    reason: string,
  ): DelegationToken {
    const oldToken = this.activeDelegations.get(delegationId);
    if (!oldToken) {
      throw new Error(`Delegation ${delegationId} not found`);
    }

    // Revoke old token
    oldToken.revoked = true;

    // Release old agent's load
    const oldAgent = this.agents.get(oldToken.delegate);
    if (oldAgent && oldAgent.currentLoad > 0) {
      oldAgent.currentLoad -= 1;
    }

    // Check chain depth
    if (oldToken.chain.length >= oldToken.maxChainDepth) {
      throw new Error(
        `Maximum re-delegation depth (${oldToken.maxChainDepth}) reached`,
      );
    }

    // Find a new delegate (exclude the failed one and the delegator)
    const excludeSet = new Set([...oldToken.chain, oldToken.delegate]);
    const request: DelegationRequest = {
      taskId: oldToken.taskId,
      delegator: oldToken.delegator,
      capabilityRequirements: oldToken.scope.allowedActions,
      riskLevel: 'high', // Re-delegation implies higher risk
      deadline: oldToken.expiresAt,
      verificationPolicy: { type: 'peer_review', requiredConfidence: 0.7 },
    };

    const candidates = this.matchDelegates(request).filter(
      (c) => !excludeSet.has(c.agentId),
    );

    if (candidates.length === 0) {
      throw new Error(
        `No available delegates for re-delegation (reason: ${reason})`,
      );
    }

    const newDelegate = candidates[0].agentId;
    const newToken = this.delegate(request, newDelegate);

    // Extend the chain
    newToken.chain = [...oldToken.chain, newDelegate];

    return newToken;
  }

  /**
   * Revoke a delegation token.
   */
  revoke(delegationId: string): boolean {
    const token = this.activeDelegations.get(delegationId);
    if (!token) return false;

    token.revoked = true;

    // Release agent load
    const agent = this.agents.get(token.delegate);
    if (agent && agent.currentLoad > 0) {
      agent.currentLoad -= 1;
    }

    this.updateExecutionStatus(delegationId, { status: 'failed' });

    return true;
  }

  /**
   * Get a delegation token by ID.
   */
  getDelegation(delegationId: string): DelegationToken | null {
    return this.activeDelegations.get(delegationId) ?? null;
  }

  /**
   * Get execution status for a delegation.
   */
  getExecutionStatus(delegationId: string): ExecutionStatus | null {
    return this.executionStatuses.get(delegationId) ?? null;
  }

  /**
   * List all active delegations.
   */
  getActiveDelegations(): DelegationToken[] {
    return Array.from(this.activeDelegations.values()).filter(
      (t) => !t.revoked,
    );
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private riskMultiplier(riskLevel: RiskLevel): number {
    switch (riskLevel) {
      case 'low':
        return 1.0;
      case 'medium':
        return 1.2;
      case 'high':
        return 1.5;
      case 'critical':
        return 2.0;
    }
  }

  private getWeights(riskLevel: RiskLevel): {
    capability: number;
    cost: number;
    risk: number;
    diversity: number;
  } {
    switch (riskLevel) {
      case 'low':
        return { capability: 0.4, cost: 0.3, risk: 0.15, diversity: 0.15 };
      case 'medium':
        return { capability: 0.4, cost: 0.2, risk: 0.25, diversity: 0.15 };
      case 'high':
        return { capability: 0.35, cost: 0.1, risk: 0.4, diversity: 0.15 };
      case 'critical':
        return { capability: 0.3, cost: 0.05, risk: 0.5, diversity: 0.15 };
    }
  }

  private buildScope(request: DelegationRequest): DelegationScope {
    const riskBased = {
      low: {
        canRedelegate: true,
        maxTokens: 100_000,
        maxDuration: 60,
        maxCost: request.maxCost ?? 10,
      },
      medium: {
        canRedelegate: true,
        maxTokens: 50_000,
        maxDuration: 30,
        maxCost: request.maxCost ?? 5,
      },
      high: {
        canRedelegate: false,
        maxTokens: 30_000,
        maxDuration: 15,
        maxCost: request.maxCost ?? 3,
      },
      critical: {
        canRedelegate: false,
        maxTokens: 20_000,
        maxDuration: 10,
        maxCost: request.maxCost ?? 2,
      },
    };

    const config = riskBased[request.riskLevel];

    return {
      allowedActions: request.capabilityRequirements,
      resourceLimits: {
        maxTokens: config.maxTokens,
        maxDuration: config.maxDuration,
        maxCost: config.maxCost,
      },
      canRedelegate: config.canRedelegate,
      allowedArtifactTypes: ['document', 'code', 'diagram', 'test', 'config'],
    };
  }

  private generateSignature(
    tokenId: string,
    taskId: string,
    delegator: string,
    delegate: string,
  ): string {
    // Create a deterministic hash-based signature for token integrity.
    // Uses a simple string-hash approach. In production, use HMAC-SHA256.
    const payload = `${tokenId}:${taskId}:${delegator}:${delegate}:${Date.now()}`;
    let hash = 0;
    for (let i = 0; i < payload.length; i++) {
      const char = payload.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0;
    }
    return `sig_${Math.abs(hash).toString(36)}_${tokenId.slice(0, 8)}`;
  }
}
