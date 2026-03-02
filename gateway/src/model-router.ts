/**
 * AI Model Router for the ForgeTeam Gateway.
 *
 * Routes AI model requests to the appropriate provider and model based on:
 * - Agent identity (each agent has a primary + fallback model)
 * - Task complexity (classified via keyword analysis)
 * - Cost constraints
 * - Capability requirements (vision, tools, streaming)
 *
 * ONLY Anthropic and Google models are supported.
 */

import { v4 as uuid } from 'uuid';
import { EventEmitter } from 'eventemitter3';
import type {
  AgentId,
  ModelProvider,
  ModelTier,
  ModelId,
  ModelConfig,
  AgentModelAssignment,
  ModelRoutingRequest,
  ModelRoutingResult,
  CostRecord,
  CostSummary,
  AnthropicModel,
  GoogleModel,
} from '@forge-team/shared';

interface CostCap {
  dailyCapUsd: number;
  weeklyCapUsd: number;
  alertThreshold: number;
}

interface CostCapStatus {
  allowed: boolean;
  severity: 'ok' | 'warning' | 'downgrade' | 'blocked';
  dailyUsed: number;
  dailyCap: number;
  weeklyUsed: number;
  weeklyCap: number;
  alertTriggered: boolean;
}

// ---------------------------------------------------------------------------
// Model catalog
// ---------------------------------------------------------------------------

const MODEL_CATALOG: Record<ModelId, ModelConfig> = {
  'claude-opus-4-6': {
    id: 'claude-opus-4-6',
    provider: 'anthropic',
    tier: 'premium',
    name: 'Claude Opus 4.6',
    maxContextTokens: 200_000,
    maxOutputTokens: 32_000,
    inputCostPer1M: 15.0,
    outputCostPer1M: 75.0,
    supportsVision: true,
    supportsTools: true,
    supportsStreaming: true,
    avgLatencyMs: 1200,
  },
  'claude-sonnet-4-6': {
    id: 'claude-sonnet-4-6',
    provider: 'anthropic',
    tier: 'balanced',
    name: 'Claude Sonnet 4.6',
    maxContextTokens: 200_000,
    maxOutputTokens: 16_000,
    inputCostPer1M: 3.0,
    outputCostPer1M: 15.0,
    supportsVision: true,
    supportsTools: true,
    supportsStreaming: true,
    avgLatencyMs: 600,
  },
  'claude-haiku-4-5': {
    id: 'claude-haiku-4-5',
    provider: 'anthropic',
    tier: 'fast',
    name: 'Claude Haiku 4.5',
    maxContextTokens: 200_000,
    maxOutputTokens: 8_192,
    inputCostPer1M: 0.8,
    outputCostPer1M: 4.0,
    supportsVision: true,
    supportsTools: true,
    supportsStreaming: true,
    avgLatencyMs: 300,
  },
  'gemini-3.1-pro': {
    id: 'gemini-3.1-pro',
    provider: 'google',
    tier: 'balanced',
    name: 'Gemini 3.1 Pro',
    maxContextTokens: 2_000_000,
    maxOutputTokens: 65_536,
    inputCostPer1M: 1.25,
    outputCostPer1M: 5.0,
    supportsVision: true,
    supportsTools: true,
    supportsStreaming: true,
    avgLatencyMs: 500,
  },
  'gemini-flash-3': {
    id: 'gemini-flash-3',
    provider: 'google',
    tier: 'fast',
    name: 'Gemini Flash 3',
    maxContextTokens: 1_000_000,
    maxOutputTokens: 32_768,
    inputCostPer1M: 0.1,
    outputCostPer1M: 0.4,
    supportsVision: true,
    supportsTools: true,
    supportsStreaming: true,
    avgLatencyMs: 200,
  },
};

// ---------------------------------------------------------------------------
// Per-agent model assignments (primary -> fallback)
// ---------------------------------------------------------------------------

const AGENT_MODEL_ASSIGNMENTS: Record<AgentId, AgentModelAssignment> = {
  'bmad-master': {
    agentId: 'bmad-master',
    primary: 'gemini-3.1-pro',
    fallback: 'claude-sonnet-4-6',
  },
  'product-owner': {
    agentId: 'product-owner',
    primary: 'gemini-3.1-pro',
    fallback: 'claude-sonnet-4-6',
  },
  'business-analyst': {
    agentId: 'business-analyst',
    primary: 'gemini-3.1-pro',
    fallback: 'claude-sonnet-4-6',
  },
  'scrum-master': {
    agentId: 'scrum-master',
    primary: 'gemini-flash-3',
    fallback: 'claude-haiku-4-5',
  },
  'architect': {
    agentId: 'architect',
    primary: 'claude-opus-4-6',
    fallback: 'gemini-3.1-pro',
  },
  'ux-designer': {
    agentId: 'ux-designer',
    primary: 'gemini-3.1-pro',
    fallback: 'claude-sonnet-4-6',
  },
  'frontend-dev': {
    agentId: 'frontend-dev',
    primary: 'gemini-3.1-pro',
    fallback: 'claude-sonnet-4-6',
  },
  'backend-dev': {
    agentId: 'backend-dev',
    primary: 'claude-opus-4-6',
    fallback: 'claude-sonnet-4-6',
  },
  'qa-architect': {
    agentId: 'qa-architect',
    primary: 'claude-opus-4-6',
    fallback: 'claude-sonnet-4-6',
  },
  'devops-engineer': {
    agentId: 'devops-engineer',
    primary: 'gemini-3.1-pro',
    fallback: 'claude-sonnet-4-6',
  },
  'security-specialist': {
    agentId: 'security-specialist',
    primary: 'claude-opus-4-6',
    fallback: 'gemini-3.1-pro',
  },
  'tech-writer': {
    agentId: 'tech-writer',
    primary: 'claude-sonnet-4-6',
    fallback: 'gemini-3.1-pro',
  },
};

// ---------------------------------------------------------------------------
// Complexity classification keywords
// ---------------------------------------------------------------------------

/** Keywords that bump complexity toward Premium tier */
const PREMIUM_KEYWORDS = [
  'architect', 'design system', 'security audit', 'threat model',
  'database schema', 'migration strategy', 'performance optimization',
  'distributed system', 'consensus', 'CQRS', 'event sourcing',
  'microservice', 'zero-trust', 'cryptograph', 'formal verification',
  'complex algorithm', 'concurrency', 'race condition', 'deadlock',
  'scalability', 'system design', 'trade-off analysis', 'critical path',
  'incident response', 'disaster recovery', 'compliance', 'GDPR', 'SOC2',
  'penetration test', 'vulnerability assessment', 'code review complex',
  'refactor legacy', 'breaking change',
];

/** Keywords that keep tasks at Balanced tier */
const BALANCED_KEYWORDS = [
  'implement', 'feature', 'component', 'endpoint', 'API',
  'test suite', 'integration test', 'user story', 'acceptance criteria',
  'wireframe', 'prototype', 'deploy', 'CI/CD', 'pipeline',
  'documentation', 'specification', 'requirements', 'backlog',
  'sprint planning', 'retrospective', 'code review', 'pull request',
  'configuration', 'environment', 'monitoring', 'logging',
  'authentication', 'authorization', 'validation', 'error handling',
];

/** Keywords indicating Fast tier tasks */
const FAST_KEYWORDS = [
  'status update', 'quick fix', 'typo', 'rename', 'format',
  'lint', 'comment', 'log message', 'bump version', 'update dependency',
  'simple', 'trivial', 'minor', 'small change', 'hotfix',
  'health check', 'ping', 'heartbeat', 'summary', 'list',
  'notification', 'route', 'assign', 'move task', 'label',
];

// ---------------------------------------------------------------------------
// ModelRouter class
// ---------------------------------------------------------------------------

export class ModelRouter extends EventEmitter {
  private costRecords: CostRecord[] = [];
  private assignments: Record<AgentId, AgentModelAssignment>;
  private costCaps: Map<string, CostCap> = new Map();

  constructor() {
    super();
    this.assignments = { ...AGENT_MODEL_ASSIGNMENTS };

    const defaultCaps: Record<string, CostCap> = {
      'bmad-master': { dailyCapUsd: 30, weeklyCapUsd: 150, alertThreshold: 0.8 },
      'product-owner': { dailyCapUsd: 20, weeklyCapUsd: 100, alertThreshold: 0.8 },
      'business-analyst': { dailyCapUsd: 20, weeklyCapUsd: 100, alertThreshold: 0.8 },
      'scrum-master': { dailyCapUsd: 5, weeklyCapUsd: 25, alertThreshold: 0.8 },
      'architect': { dailyCapUsd: 50, weeklyCapUsd: 250, alertThreshold: 0.8 },
      'ux-designer': { dailyCapUsd: 15, weeklyCapUsd: 75, alertThreshold: 0.8 },
      'frontend-dev': { dailyCapUsd: 30, weeklyCapUsd: 150, alertThreshold: 0.8 },
      'backend-dev': { dailyCapUsd: 50, weeklyCapUsd: 250, alertThreshold: 0.8 },
      'qa-architect': { dailyCapUsd: 40, weeklyCapUsd: 200, alertThreshold: 0.8 },
      'devops-engineer': { dailyCapUsd: 20, weeklyCapUsd: 100, alertThreshold: 0.8 },
      'security-specialist': { dailyCapUsd: 40, weeklyCapUsd: 200, alertThreshold: 0.8 },
      'tech-writer': { dailyCapUsd: 15, weeklyCapUsd: 75, alertThreshold: 0.8 },
    };
    for (const [agentId, cap] of Object.entries(defaultCaps)) {
      this.costCaps.set(agentId, cap);
    }
  }

  /**
   * Returns the full model catalog.
   */
  getModelCatalog(): Record<ModelId, ModelConfig> {
    return { ...MODEL_CATALOG };
  }

  /**
   * Returns the model assignment for a specific agent.
   */
  getAgentAssignment(agentId: AgentId): AgentModelAssignment {
    return this.assignments[agentId];
  }

  /**
   * Returns all agent model assignments.
   */
  getAllAssignments(): Record<AgentId, AgentModelAssignment> {
    return { ...this.assignments };
  }

  /**
   * Updates the model assignment for a specific agent at runtime.
   */
  updateAssignment(agentId: AgentId, primary: ModelId, fallback: ModelId): void {
    this.assignments[agentId] = { agentId, primary, fallback };
  }

  /**
   * Classifies task complexity based on keyword analysis.
   * Returns the most appropriate model tier.
   */
  classifyComplexity(taskContent: string): ModelTier {
    const lower = taskContent.toLowerCase();

    let premiumScore = 0;
    let balancedScore = 0;
    let fastScore = 0;

    for (const keyword of PREMIUM_KEYWORDS) {
      if (lower.includes(keyword.toLowerCase())) {
        premiumScore += 2;
      }
    }
    for (const keyword of BALANCED_KEYWORDS) {
      if (lower.includes(keyword.toLowerCase())) {
        balancedScore += 1;
      }
    }
    for (const keyword of FAST_KEYWORDS) {
      if (lower.includes(keyword.toLowerCase())) {
        fastScore += 1.5;
      }
    }

    // Content length also signals complexity
    if (taskContent.length > 2000) premiumScore += 1;
    else if (taskContent.length < 200) fastScore += 1;

    if (premiumScore > balancedScore && premiumScore > fastScore) return 'premium';
    if (fastScore > balancedScore && fastScore > premiumScore) return 'fast';
    return 'balanced';
  }

  /**
   * Routes a model request to the best available model.
   *
   * Resolution order:
   * 1. Capability requirements (vision, tools) filter out incompatible models
   * 2. Tier override or complexity classification selects the tier
   * 3. Agent's primary model is preferred if it matches the tier
   * 4. Fallback to agent's fallback model
   * 5. Global fallback chain: premium -> balanced -> fast
   */
  route(request: ModelRoutingRequest): ModelRoutingResult {
    let assignment = this.assignments[request.agentId];
    if (!assignment) {
      throw new Error(`No model assignment found for agent: ${request.agentId}`);
    }

    const capStatus = this.checkCostCap(request.agentId);
    if (capStatus.severity === 'blocked') {
      return {
        model: null,
        reason: 'hard-cap-blocked',
        estimatedCost: 0,
        classifiedTier: 'fast',
        alertTriggered: true,
        capStatus,
      } as any;
    }

    if (capStatus.severity === 'downgrade') {
      const downgraded = this.getDowngradeModel(assignment.primary);
      assignment = { ...assignment, primary: downgraded };
    }

    const classifiedTier = request.tierOverride ?? this.classifyComplexity(request.taskContent);

    // Helper: check if model meets capability requirements
    const meetsCapabilities = (model: ModelConfig): boolean => {
      if (request.requireVision && !model.supportsVision) return false;
      if (request.requireTools && !model.supportsTools) return false;
      return true;
    };

    // Helper: check cost constraint
    const meetsCost = (model: ModelConfig): boolean => {
      if (!request.maxCost) return true;
      // Rough estimate: 1000 input + 500 output tokens per request
      const estimatedCost =
        (1000 / 1_000_000) * model.inputCostPer1M +
        (500 / 1_000_000) * model.outputCostPer1M;
      return estimatedCost <= request.maxCost;
    };

    // Try complexity override first
    if (assignment.complexityOverrides?.[classifiedTier]) {
      const overrideId = assignment.complexityOverrides[classifiedTier]!;
      const overrideModel = MODEL_CATALOG[overrideId];
      if (overrideModel && meetsCapabilities(overrideModel) && meetsCost(overrideModel)) {
        return {
          model: overrideModel,
          reason: 'complexity-override',
          estimatedCost: this.estimateCost(overrideModel),
          classifiedTier,
        };
      }
    }

    // Try primary model
    const primaryModel = MODEL_CATALOG[assignment.primary];
    if (primaryModel && meetsCapabilities(primaryModel) && meetsCost(primaryModel)) {
      return {
        model: primaryModel,
        reason: 'primary',
        estimatedCost: this.estimateCost(primaryModel),
        classifiedTier,
      };
    }

    // Try fallback model
    const fallbackModel = MODEL_CATALOG[assignment.fallback];
    if (fallbackModel && meetsCapabilities(fallbackModel) && meetsCost(fallbackModel)) {
      return {
        model: fallbackModel,
        reason: 'fallback',
        estimatedCost: this.estimateCost(fallbackModel),
        classifiedTier,
      };
    }

    // Global fallback chain by tier preference
    const tierOrder: ModelTier[] =
      classifiedTier === 'premium'
        ? ['premium', 'balanced', 'fast']
        : classifiedTier === 'fast'
          ? ['fast', 'balanced', 'premium']
          : ['balanced', 'premium', 'fast'];

    for (const tier of tierOrder) {
      for (const model of Object.values(MODEL_CATALOG)) {
        if (model.tier === tier && meetsCapabilities(model) && meetsCost(model)) {
          return {
            model,
            reason: request.maxCost ? 'cost-constraint' : 'capability-requirement',
            estimatedCost: this.estimateCost(model),
            classifiedTier,
          };
        }
      }
    }

    // Absolute last resort - return the cheapest model regardless of constraints
    const cheapest = Object.values(MODEL_CATALOG).sort(
      (a, b) => a.inputCostPer1M - b.inputCostPer1M
    )[0];
    return {
      model: cheapest,
      reason: 'fallback',
      estimatedCost: this.estimateCost(cheapest),
      classifiedTier,
    };
  }

  /**
   * Records a cost entry after a model call completes.
   */
  recordCost(
    agentId: AgentId,
    sessionId: string,
    taskId: string | null,
    model: ModelId,
    inputTokens: number,
    outputTokens: number,
    tier: ModelTier,
    latencyMs?: number,
  ): CostRecord {
    const modelConfig = MODEL_CATALOG[model];
    const cost =
      (inputTokens / 1_000_000) * modelConfig.inputCostPer1M +
      (outputTokens / 1_000_000) * modelConfig.outputCostPer1M;

    const record: CostRecord = {
      id: uuid(),
      agentId,
      sessionId,
      taskId,
      model,
      provider: modelConfig.provider,
      inputTokens,
      outputTokens,
      cost,
      timestamp: new Date().toISOString(),
      tier,
    };

    this.costRecords.push(record);

    // Fire-and-forget DB persistence
    import('./db.js').then(({ query }) => {
      query(
        `INSERT INTO cost_tracking (id, agent_id, session_id, task_id, model_used, provider, tokens_in, tokens_out, cost_usd, latency_ms, success, metadata, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [record.id, agentId, sessionId, taskId, model, modelConfig.provider, inputTokens, outputTokens, cost, latencyMs ?? 0, true, JSON.stringify({}), record.timestamp]
      ).catch((err: any) => {
        console.warn('[ModelRouter] Failed to persist cost record:', err?.message);
      });
    }).catch(() => {});

    const capCheck = this.checkCostCap(agentId);
    if (capCheck.alertTriggered) {
      this.emit('cost:alert', {
        agentId,
        alertType: capCheck.allowed ? 'threshold' : 'exceeded',
        message: capCheck.allowed
          ? `Agent ${agentId} has used ${Math.round((capCheck.dailyUsed / capCheck.dailyCap) * 100)}% of daily budget ($${capCheck.dailyUsed.toFixed(2)} / $${capCheck.dailyCap.toFixed(2)})`
          : `Agent ${agentId} daily budget exceeded ($${capCheck.dailyUsed.toFixed(2)} / $${capCheck.dailyCap.toFixed(2)})`,
        dailyUsed: capCheck.dailyUsed,
        dailyCap: capCheck.dailyCap,
        weeklyUsed: capCheck.weeklyUsed,
        weeklyCap: capCheck.weeklyCap,
      });
    }

    return record;
  }

  /**
   * Returns cost summary for a given time range (or all time if no range specified).
   */
  getCostSummary(from?: string, to?: string, agentId?: string): CostSummary {
    let records = this.costRecords;

    if (from) {
      const fromDate = new Date(from).getTime();
      records = records.filter((r) => new Date(r.timestamp).getTime() >= fromDate);
    }
    if (to) {
      const toDate = new Date(to).getTime();
      records = records.filter((r) => new Date(r.timestamp).getTime() <= toDate);
    }
    if (agentId) {
      records = records.filter((r) => r.agentId === agentId);
    }

    const perAgent = {} as Record<string, number>;
    const perModel = {} as Record<string, number>;
    const perProvider = {} as Record<string, number>;
    const perTier = {} as Record<string, number>;
    let totalCost = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (const record of records) {
      totalCost += record.cost;
      totalInputTokens += record.inputTokens;
      totalOutputTokens += record.outputTokens;

      perAgent[record.agentId] = (perAgent[record.agentId] || 0) + record.cost;
      perModel[record.model] = (perModel[record.model] || 0) + record.cost;
      perProvider[record.provider] = (perProvider[record.provider] || 0) + record.cost;
      perTier[record.tier] = (perTier[record.tier] || 0) + record.cost;
    }

    return {
      totalCost,
      perAgent: perAgent as Record<AgentId, number>,
      perModel: perModel as Record<ModelId, number>,
      perProvider: perProvider as Record<ModelProvider, number>,
      perTier: perTier as Record<ModelTier, number>,
      totalInputTokens,
      totalOutputTokens,
      totalRequests: records.length,
      from: from || (records[0]?.timestamp ?? new Date().toISOString()),
      to: to || new Date().toISOString(),
    };
  }

  /**
   * Returns all cost records (optionally filtered).
   */
  getCostRecords(filters?: {
    agentId?: AgentId;
    sessionId?: string;
    model?: ModelId;
  }): CostRecord[] {
    let records = this.costRecords;
    if (filters?.agentId) {
      records = records.filter((r) => r.agentId === filters.agentId);
    }
    if (filters?.sessionId) {
      records = records.filter((r) => r.sessionId === filters.sessionId);
    }
    if (filters?.model) {
      records = records.filter((r) => r.model === filters.model);
    }
    return records;
  }

  setCostCap(agentId: string, cap: CostCap): void {
    this.costCaps.set(agentId, cap);
  }

  getCostCap(agentId: string): CostCap | undefined {
    return this.costCaps.get(agentId);
  }

  getAgentDailyCost(agentId: string): number {
    const now = new Date();
    const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    return this.costRecords
      .filter((r) => r.agentId === agentId && new Date(r.timestamp).getTime() >= startOfDay.getTime())
      .reduce((sum, r) => sum + r.cost, 0);
  }

  getAgentWeeklyCost(agentId: string): number {
    const now = new Date();
    const dayOfWeek = now.getUTCDay();
    const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const startOfWeek = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday));
    return this.costRecords
      .filter((r) => r.agentId === agentId && new Date(r.timestamp).getTime() >= startOfWeek.getTime())
      .reduce((sum, r) => sum + r.cost, 0);
  }

  checkCostCap(agentId: string): CostCapStatus {
    const cap = this.costCaps.get(agentId);
    if (!cap) {
      return { allowed: true, severity: 'ok', dailyUsed: 0, dailyCap: 50, weeklyUsed: 0, weeklyCap: 200, alertTriggered: false };
    }
    const dailyUsed = this.getAgentDailyCost(agentId);
    const weeklyUsed = this.getAgentWeeklyCost(agentId);
    const dailyRatio = dailyUsed / cap.dailyCapUsd;
    const weeklyRatio = weeklyUsed / cap.weeklyCapUsd;
    const ratio = Math.max(dailyRatio, weeklyRatio);
    const alertTriggered = ratio >= cap.alertThreshold;

    let severity: CostCapStatus['severity'];
    if (ratio >= 1.2) {
      severity = 'blocked';
    } else if (ratio >= 1.0) {
      severity = 'downgrade';
    } else if (ratio >= cap.alertThreshold) {
      severity = 'warning';
    } else {
      severity = 'ok';
    }

    const allowed = severity !== 'blocked';
    return {
      allowed,
      severity,
      dailyUsed,
      dailyCap: cap.dailyCapUsd,
      weeklyUsed,
      weeklyCap: cap.weeklyCapUsd,
      alertTriggered,
    };
  }

  async loadRecentCosts(): Promise<void> {
    try {
      const { query } = await import('./db.js');
      const now = new Date();
      const dayOfWeek = now.getUTCDay();
      const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const startOfWeek = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday));
      const result = await query(
        `SELECT id, agent_id, session_id, task_id, model_used, provider, tokens_in, tokens_out, cost_usd, timestamp
         FROM cost_tracking WHERE timestamp >= $1 ORDER BY timestamp ASC`,
        [startOfWeek.toISOString()]
      );
      for (const row of result.rows) {
        this.costRecords.push({
          id: row.id,
          agentId: row.agent_id,
          sessionId: row.session_id,
          taskId: row.task_id,
          model: row.model_used,
          provider: row.provider,
          inputTokens: row.tokens_in,
          outputTokens: row.tokens_out,
          cost: row.cost_usd,
          timestamp: new Date(row.timestamp).toISOString(),
          tier: 'balanced',
        });
      }
      console.log(`[ModelRouter] Loaded ${result.rows.length} recent cost records from DB`);
    } catch (err: any) {
      console.warn('[ModelRouter] Failed to load recent costs from DB:', err?.message);
    }
  }

  private getDowngradeModel(currentModelId: ModelId): ModelId {
    const downgradeChain: Partial<Record<ModelId, ModelId>> = {
      'claude-opus-4-6': 'claude-sonnet-4-6',
      'claude-sonnet-4-6': 'claude-haiku-4-5',
      'gemini-3.1-pro': 'gemini-flash-3',
    };
    return downgradeChain[currentModelId] ?? currentModelId;
  }

  private estimateCost(model: ModelConfig): number {
    return (
      (1000 / 1_000_000) * model.inputCostPer1M +
      (500 / 1_000_000) * model.outputCostPer1M
    );
  }
}
