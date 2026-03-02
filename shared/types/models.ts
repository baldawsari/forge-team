/**
 * AI Model configuration types for the ForgeTeam system.
 * Defines model providers, tiers, and per-agent model assignments.
 * ONLY Anthropic and Google models are supported.
 */

import type { AgentId } from './agent';

/** Supported AI model providers */
export type ModelProvider = 'anthropic' | 'google';

/** Model tier based on capability and cost */
export type ModelTier = 'premium' | 'balanced' | 'fast';

/** Specific model identifiers */
export type AnthropicModel =
  | 'claude-opus-4-6'
  | 'claude-sonnet-4-6'
  | 'claude-haiku-4-5';

export type GoogleModel =
  | 'gemini-3.1-pro'
  | 'gemini-flash-3';

export type ModelId = AnthropicModel | GoogleModel;

/** Configuration for a specific model */
export interface ModelConfig {
  id: ModelId;
  provider: ModelProvider;
  tier: ModelTier;
  /** Display name */
  name: string;
  /** Maximum context window in tokens */
  maxContextTokens: number;
  /** Maximum output tokens */
  maxOutputTokens: number;
  /** Cost per 1M input tokens in USD */
  inputCostPer1M: number;
  /** Cost per 1M output tokens in USD */
  outputCostPer1M: number;
  /** Whether this model supports vision/multimodal */
  supportsVision: boolean;
  /** Whether this model supports tool/function calling */
  supportsTools: boolean;
  /** Whether this model supports streaming */
  supportsStreaming: boolean;
  /** Average latency estimate in ms for first token */
  avgLatencyMs: number;
}

/** Model assignment for a specific agent */
export interface AgentModelAssignment {
  agentId: AgentId;
  /** Primary model used for standard tasks */
  primary: ModelId;
  /** Fallback model if primary is unavailable or over budget */
  fallback: ModelId;
  /** Override model for specific task complexities */
  complexityOverrides?: Partial<Record<ModelTier, ModelId>>;
}

/** Request to route a model call */
export interface ModelRoutingRequest {
  agentId: AgentId;
  /** Task content for complexity classification */
  taskContent: string;
  /** Explicit tier override (bypasses complexity classification) */
  tierOverride?: ModelTier;
  /** Maximum allowed cost for this request */
  maxCost?: number;
  /** Required capabilities */
  requireVision?: boolean;
  requireTools?: boolean;
  /** Session context for tracking */
  sessionId: string;
}

/** Result of model routing */
export interface ModelRoutingResult {
  /** Selected model */
  model: ModelConfig;
  /** Why this model was selected */
  reason: 'primary' | 'fallback' | 'complexity-override' | 'cost-constraint' | 'capability-requirement' | 'hard-cap-blocked';
  /** Estimated cost for this request */
  estimatedCost: number;
  /** Classified complexity tier */
  classifiedTier: ModelTier;
}

/** Cost tracking record */
export interface CostRecord {
  id: string;
  agentId: AgentId;
  sessionId: string;
  taskId: string | null;
  model: ModelId;
  provider: ModelProvider;
  /** Tokens used */
  inputTokens: number;
  outputTokens: number;
  /** Calculated cost in USD */
  cost: number;
  /** Timestamp */
  timestamp: string;
  /** Classification that led to this model selection */
  tier: ModelTier;
}

/** Aggregated cost summary */
export interface CostSummary {
  /** Total cost in USD */
  totalCost: number;
  /** Cost per agent */
  perAgent: Record<AgentId, number>;
  /** Cost per model */
  perModel: Record<ModelId, number>;
  /** Cost per provider */
  perProvider: Record<ModelProvider, number>;
  /** Cost per tier */
  perTier: Record<ModelTier, number>;
  /** Total tokens used */
  totalInputTokens: number;
  totalOutputTokens: number;
  /** Number of requests */
  totalRequests: number;
  /** Time range */
  from: string;
  to: string;
}
