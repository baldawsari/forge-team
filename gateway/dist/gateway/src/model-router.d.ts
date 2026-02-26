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
import type { AgentId, ModelTier, ModelId, ModelConfig, AgentModelAssignment, ModelRoutingRequest, ModelRoutingResult, CostRecord, CostSummary } from '@forge-team/shared';
export declare class ModelRouter {
    private costRecords;
    private assignments;
    constructor();
    /**
     * Returns the full model catalog.
     */
    getModelCatalog(): Record<ModelId, ModelConfig>;
    /**
     * Returns the model assignment for a specific agent.
     */
    getAgentAssignment(agentId: AgentId): AgentModelAssignment;
    /**
     * Returns all agent model assignments.
     */
    getAllAssignments(): Record<AgentId, AgentModelAssignment>;
    /**
     * Updates the model assignment for a specific agent at runtime.
     */
    updateAssignment(agentId: AgentId, primary: ModelId, fallback: ModelId): void;
    /**
     * Classifies task complexity based on keyword analysis.
     * Returns the most appropriate model tier.
     */
    classifyComplexity(taskContent: string): ModelTier;
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
    route(request: ModelRoutingRequest): ModelRoutingResult;
    /**
     * Records a cost entry after a model call completes.
     */
    recordCost(agentId: AgentId, sessionId: string, taskId: string | null, model: ModelId, inputTokens: number, outputTokens: number, tier: ModelTier): CostRecord;
    /**
     * Returns cost summary for a given time range (or all time if no range specified).
     */
    getCostSummary(from?: string, to?: string): CostSummary;
    /**
     * Returns all cost records (optionally filtered).
     */
    getCostRecords(filters?: {
        agentId?: AgentId;
        sessionId?: string;
        model?: ModelId;
    }): CostRecord[];
    /**
     * Estimates cost for a single request to a given model.
     * Uses average token counts: 1000 input, 500 output.
     */
    private estimateCost;
}
//# sourceMappingURL=model-router.d.ts.map