"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModelRouter = void 0;
const uuid_1 = require("uuid");
// ---------------------------------------------------------------------------
// Model catalog
// ---------------------------------------------------------------------------
const MODEL_CATALOG = {
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
const AGENT_MODEL_ASSIGNMENTS = {
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
class ModelRouter {
    costRecords = [];
    assignments;
    constructor() {
        this.assignments = { ...AGENT_MODEL_ASSIGNMENTS };
    }
    /**
     * Returns the full model catalog.
     */
    getModelCatalog() {
        return { ...MODEL_CATALOG };
    }
    /**
     * Returns the model assignment for a specific agent.
     */
    getAgentAssignment(agentId) {
        return this.assignments[agentId];
    }
    /**
     * Returns all agent model assignments.
     */
    getAllAssignments() {
        return { ...this.assignments };
    }
    /**
     * Updates the model assignment for a specific agent at runtime.
     */
    updateAssignment(agentId, primary, fallback) {
        this.assignments[agentId] = { agentId, primary, fallback };
    }
    /**
     * Classifies task complexity based on keyword analysis.
     * Returns the most appropriate model tier.
     */
    classifyComplexity(taskContent) {
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
        if (taskContent.length > 2000)
            premiumScore += 1;
        else if (taskContent.length < 200)
            fastScore += 1;
        if (premiumScore > balancedScore && premiumScore > fastScore)
            return 'premium';
        if (fastScore > balancedScore && fastScore > premiumScore)
            return 'fast';
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
    route(request) {
        const assignment = this.assignments[request.agentId];
        if (!assignment) {
            throw new Error(`No model assignment found for agent: ${request.agentId}`);
        }
        const classifiedTier = request.tierOverride ?? this.classifyComplexity(request.taskContent);
        // Helper: check if model meets capability requirements
        const meetsCapabilities = (model) => {
            if (request.requireVision && !model.supportsVision)
                return false;
            if (request.requireTools && !model.supportsTools)
                return false;
            return true;
        };
        // Helper: check cost constraint
        const meetsCost = (model) => {
            if (!request.maxCost)
                return true;
            // Rough estimate: 1000 input + 500 output tokens per request
            const estimatedCost = (1000 / 1_000_000) * model.inputCostPer1M +
                (500 / 1_000_000) * model.outputCostPer1M;
            return estimatedCost <= request.maxCost;
        };
        // Try complexity override first
        if (assignment.complexityOverrides?.[classifiedTier]) {
            const overrideId = assignment.complexityOverrides[classifiedTier];
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
        const tierOrder = classifiedTier === 'premium'
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
        const cheapest = Object.values(MODEL_CATALOG).sort((a, b) => a.inputCostPer1M - b.inputCostPer1M)[0];
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
    recordCost(agentId, sessionId, taskId, model, inputTokens, outputTokens, tier) {
        const modelConfig = MODEL_CATALOG[model];
        const cost = (inputTokens / 1_000_000) * modelConfig.inputCostPer1M +
            (outputTokens / 1_000_000) * modelConfig.outputCostPer1M;
        const record = {
            id: (0, uuid_1.v4)(),
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
        return record;
    }
    /**
     * Returns cost summary for a given time range (or all time if no range specified).
     */
    getCostSummary(from, to) {
        let records = this.costRecords;
        if (from) {
            const fromDate = new Date(from).getTime();
            records = records.filter((r) => new Date(r.timestamp).getTime() >= fromDate);
        }
        if (to) {
            const toDate = new Date(to).getTime();
            records = records.filter((r) => new Date(r.timestamp).getTime() <= toDate);
        }
        const perAgent = {};
        const perModel = {};
        const perProvider = {};
        const perTier = {};
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
            perAgent: perAgent,
            perModel: perModel,
            perProvider: perProvider,
            perTier: perTier,
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
    getCostRecords(filters) {
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
    /**
     * Estimates cost for a single request to a given model.
     * Uses average token counts: 1000 input, 500 output.
     */
    estimateCost(model) {
        return ((1000 / 1_000_000) * model.inputCostPer1M +
            (500 / 1_000_000) * model.outputCostPer1M);
    }
}
exports.ModelRouter = ModelRouter;
//# sourceMappingURL=model-router.js.map