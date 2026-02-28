"use strict";
/**
 * ForgeTeam Workflow Engine
 *
 * Core workflow engine that:
 * 1. Loads BMAD YAML workflow files
 * 2. Uses LangGraph StateGraph for execution
 * 3. Manages workflow execution with Postgres checkpoints
 * 4. Handles phase transitions, approvals via LangGraph interrupt
 * 5. Emits real-time progress updates
 * 6. Supports pause/resume/restart from any checkpoint
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkflowExecutor = exports.WorkflowLoader = exports.WorkflowValidationError = void 0;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_crypto_1 = require("node:crypto");
const yaml_1 = require("yaml");
const eventemitter3_1 = __importDefault(require("eventemitter3"));
const langgraph_1 = require("./langgraph");
const viadp_delegation_node_1 = require("./langgraph-nodes/viadp-delegation-node");
// ============================================================================
// WorkflowLoader - Parse YAML files, validate structure
// ============================================================================
/** Validation error thrown when a YAML workflow file is malformed */
class WorkflowValidationError extends Error {
    filePath;
    details;
    constructor(message, filePath, details) {
        super(`Workflow validation failed for ${filePath}: ${message}`);
        this.filePath = filePath;
        this.details = details;
        this.name = 'WorkflowValidationError';
    }
}
exports.WorkflowValidationError = WorkflowValidationError;
/** Loads and validates YAML workflow definitions from the filesystem */
class WorkflowLoader {
    workflowsDir;
    cache = new Map();
    constructor(workflowsDir) {
        this.workflowsDir = (0, node_path_1.resolve)(workflowsDir);
    }
    /**
     * Load a single workflow definition from a YAML file.
     * Results are cached by file path.
     */
    loadWorkflow(filePath) {
        const resolvedPath = (0, node_path_1.resolve)(this.workflowsDir, filePath);
        const cached = this.cache.get(resolvedPath);
        if (cached) {
            return cached;
        }
        if (!(0, node_fs_1.existsSync)(resolvedPath)) {
            throw new Error(`Workflow file not found: ${resolvedPath}`);
        }
        const raw = (0, node_fs_1.readFileSync)(resolvedPath, 'utf-8');
        const parsed = (0, yaml_1.parse)(raw);
        const definition = this.parseDefinition(parsed, resolvedPath);
        this.validate(definition, resolvedPath);
        this.cache.set(resolvedPath, definition);
        return definition;
    }
    /**
     * Load all workflow definitions from the workflows directory.
     */
    loadAllWorkflows() {
        const results = new Map();
        if (!(0, node_fs_1.existsSync)(this.workflowsDir)) {
            throw new Error(`Workflows directory not found: ${this.workflowsDir}`);
        }
        const files = (0, node_fs_1.readdirSync)(this.workflowsDir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
        for (const file of files) {
            const key = (0, node_path_1.basename)(file, file.endsWith('.yaml') ? '.yaml' : '.yml');
            results.set(key, this.loadWorkflow(file));
        }
        return results;
    }
    /**
     * List available workflow files without loading them.
     */
    listWorkflows() {
        if (!(0, node_fs_1.existsSync)(this.workflowsDir)) {
            return [];
        }
        return (0, node_fs_1.readdirSync)(this.workflowsDir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
    }
    /**
     * Clear the definition cache, forcing reload on next access.
     */
    clearCache() {
        this.cache.clear();
    }
    /**
     * Parse a raw YAML object into a WorkflowDefinition.
     */
    parseDefinition(raw, filePath) {
        const transitions = {};
        if (raw.transitions && typeof raw.transitions === 'object') {
            const rawTransitions = raw.transitions;
            for (const [key, value] of Object.entries(rawTransitions)) {
                const normalizedKey = key.replace(/\s+/g, ' ').trim();
                const normalizedValue = value.trim();
                if (normalizedValue !== 'auto' && normalizedValue !== 'requires_approval') {
                    throw new WorkflowValidationError(`Invalid transition type: "${normalizedValue}"`, filePath, [`Transition "${normalizedKey}" has invalid type. Expected "auto" or "requires_approval".`]);
                }
                transitions[normalizedKey] = normalizedValue;
            }
        }
        const phases = [];
        if (Array.isArray(raw.phases)) {
            for (const rawPhase of raw.phases) {
                const steps = [];
                if (Array.isArray(rawPhase.steps)) {
                    for (const rawStep of rawPhase.steps) {
                        steps.push({
                            name: String(rawStep.name || ''),
                            agent: String(rawStep.agent || ''),
                            action: String(rawStep.action || ''),
                            model_override: rawStep.model_override != null
                                ? String(rawStep.model_override)
                                : undefined,
                            inputs: Array.isArray(rawStep.inputs)
                                ? rawStep.inputs
                                : undefined,
                            outputs: Array.isArray(rawStep.outputs)
                                ? rawStep.outputs
                                : undefined,
                            depends_on: Array.isArray(rawStep.depends_on)
                                ? rawStep.depends_on
                                : undefined,
                            parallel: typeof rawStep.parallel === 'boolean'
                                ? rawStep.parallel
                                : undefined,
                            approval_required: typeof rawStep.approval_required === 'boolean'
                                ? rawStep.approval_required
                                : undefined,
                        });
                    }
                }
                phases.push({
                    name: String(rawPhase.name || ''),
                    display_name: String(rawPhase.display_name || rawPhase.name || ''),
                    display_name_ar: String(rawPhase.display_name_ar || ''),
                    agents: Array.isArray(rawPhase.agents)
                        ? rawPhase.agents
                        : [],
                    model_override: rawPhase.model_override != null
                        ? String(rawPhase.model_override)
                        : undefined,
                    steps,
                    checkpoint: rawPhase.checkpoint === true,
                });
            }
        }
        return {
            name: String(raw.name || ''),
            version: String(raw.version || '1.0'),
            description: String(raw.description || ''),
            phases,
            transitions,
        };
    }
    /**
     * Validate a parsed workflow definition for structural correctness.
     */
    validate(definition, filePath) {
        const errors = [];
        if (!definition.name) {
            errors.push('Workflow must have a "name" field.');
        }
        if (definition.phases.length === 0) {
            errors.push('Workflow must have at least one phase.');
        }
        const phaseNames = new Set();
        for (const phase of definition.phases) {
            if (!phase.name) {
                errors.push('Every phase must have a "name" field.');
                continue;
            }
            if (phaseNames.has(phase.name)) {
                errors.push(`Duplicate phase name: "${phase.name}".`);
            }
            phaseNames.add(phase.name);
            if (phase.steps.length === 0) {
                errors.push(`Phase "${phase.name}" must have at least one step.`);
            }
            const stepNames = new Set();
            for (const step of phase.steps) {
                if (!step.name) {
                    errors.push(`Phase "${phase.name}" has a step without a name.`);
                    continue;
                }
                if (stepNames.has(step.name)) {
                    errors.push(`Phase "${phase.name}" has duplicate step name: "${step.name}".`);
                }
                stepNames.add(step.name);
                if (!step.agent) {
                    errors.push(`Step "${step.name}" in phase "${phase.name}" must have an "agent" field.`);
                }
                if (!step.action) {
                    errors.push(`Step "${step.name}" in phase "${phase.name}" must have an "action" field.`);
                }
                // Validate depends_on references exist within the same phase
                if (step.depends_on) {
                    for (const dep of step.depends_on) {
                        if (!stepNames.has(dep) && !phase.steps.some((s) => s.name === dep)) {
                            errors.push(`Step "${step.name}" in phase "${phase.name}" depends on ` +
                                `unknown step "${dep}". Dependencies must reference steps within the same phase.`);
                        }
                    }
                }
            }
        }
        // Validate transitions reference existing phases
        for (const transitionKey of Object.keys(definition.transitions)) {
            const match = transitionKey.match(/^(.+?)\s*->\s*(.+)$/);
            if (!match) {
                errors.push(`Invalid transition key format: "${transitionKey}". Expected "phaseA -> phaseB".`);
                continue;
            }
            const [, fromPhase, toPhase] = match;
            if (!phaseNames.has(fromPhase.trim())) {
                errors.push(`Transition references unknown source phase: "${fromPhase.trim()}".`);
            }
            if (!phaseNames.has(toPhase.trim())) {
                errors.push(`Transition references unknown target phase: "${toPhase.trim()}".`);
            }
        }
        if (errors.length > 0) {
            throw new WorkflowValidationError(`Found ${errors.length} validation error(s)`, filePath, errors);
        }
    }
}
exports.WorkflowLoader = WorkflowLoader;
/**
 * LangGraph-backed workflow engine.
 *
 * Uses LangGraph StateGraph internally for state machine execution and
 * PostgresCheckpointSaver for durable checkpoint persistence.
 */
class WorkflowExecutor extends eventemitter3_1.default {
    loader;
    checkpointer;
    instances = new Map();
    agentManager;
    modelRouter;
    viadpEngine;
    compiledGraph = null;
    viadpNode = null;
    constructor(deps) {
        super();
        this.loader = new WorkflowLoader(deps.workflowsDir);
        this.checkpointer = new langgraph_1.PostgresCheckpointSaver(deps.databaseUrl);
        this.agentManager = deps.agentManager;
        this.modelRouter = deps.modelRouter;
        this.viadpEngine = deps.viadpEngine;
        this.viadpNode = (0, viadp_delegation_node_1.createViadpDelegationNode)(this.viadpEngine);
    }
    // --------------------------------------------------------------------------
    // Graph compilation (lazy)
    // --------------------------------------------------------------------------
    getCompiledGraph() {
        if (!this.compiledGraph) {
            this.compiledGraph = (0, langgraph_1.buildWorkflowGraph)({
                agentManager: this.agentManager,
                modelRouter: this.modelRouter,
                viadpEngine: this.viadpEngine,
            }, this.checkpointer);
        }
        return this.compiledGraph;
    }
    // --------------------------------------------------------------------------
    // Public API
    // --------------------------------------------------------------------------
    /**
     * Start a new workflow from a definition name, returning the instance.
     */
    async startWorkflow(definitionName, sessionId) {
        // Load definition (tries with .yaml extension if needed)
        const fileName = definitionName.endsWith('.yaml') || definitionName.endsWith('.yml')
            ? definitionName
            : `${definitionName}.yaml`;
        const definition = this.loader.loadWorkflow(fileName);
        const instanceId = (0, node_crypto_1.randomUUID)();
        const now = new Date().toISOString();
        // Build runtime phases for the WorkflowInstance
        const phases = this.buildPhases(definition);
        const state = {
            currentPhaseIndex: 0,
            phaseStatuses: {},
            stepStatuses: {},
            outputs: {},
            history: [],
            pendingApprovals: [],
        };
        for (const phase of phases) {
            state.phaseStatuses[phase.name] = 'pending';
            for (const step of phase.steps) {
                state.stepStatuses[`${phase.name}.${step.name}`] = 'pending';
            }
        }
        const defaultConfig = {
            autoAdvance: true,
            allowParallelPhases: false,
            phaseTimeout: null,
            requireHumanGates: false,
            skipPhases: [],
            phaseOrder: null,
        };
        const instance = {
            id: instanceId,
            workflowName: definition.name,
            workflowFile: fileName,
            sessionId,
            status: 'in-progress',
            projectName: '',
            projectDescription: '',
            phases,
            currentPhaseIndex: 0,
            state,
            checkpoints: [],
            progress: this.calculateProgress(phases, state),
            createdAt: now,
            updatedAt: now,
            startedAt: now,
            completedAt: null,
            config: defaultConfig,
        };
        this.instances.set(instanceId, instance);
        // Emit started event
        this.emit('workflow:started', instance);
        // Build initial LangGraph state
        const initialState = {
            workflowId: instanceId,
            instanceId,
            sessionId,
            definitionName: definition.name,
            currentPhaseIndex: 0,
            currentStepIndex: 0,
            status: 'in-progress',
            phaseResults: {},
            stepResults: {},
            waitingForApproval: false,
            approvalRequest: null,
            lastError: null,
            retryCount: 0,
            startedAt: now,
            updatedAt: now,
            completedAt: null,
            definition,
        };
        const graph = this.getCompiledGraph();
        try {
            const result = await graph.invoke(initialState, {
                configurable: {
                    thread_id: instanceId,
                    instance_id: instanceId,
                },
            });
            // Sync LangGraph result back to WorkflowInstance
            this.syncStateToInstance(instance, result);
        }
        catch (err) {
            // LangGraph may throw on interrupt() for approval - this is expected
            const error = err;
            if (error && typeof error === 'object' && error['__interrupt']) {
                // Workflow paused for approval
                const graphState = await this.getGraphState(instanceId);
                if (graphState) {
                    this.syncStateToInstance(instance, graphState);
                }
            }
            else {
                const errorMsg = err instanceof Error ? err.message : String(err);
                instance.status = 'failed';
                instance.completedAt = new Date().toISOString();
                instance.updatedAt = instance.completedAt;
                this.emit('workflow:failed', instance, errorMsg);
            }
        }
        return instance;
    }
    /**
     * Pause a running workflow instance.
     */
    async pauseWorkflow(instanceId) {
        const instance = this.requireInstance(instanceId);
        if (instance.status !== 'in-progress' && instance.status !== 'waiting_approval') {
            throw new Error(`Cannot pause workflow ${instanceId} in status "${instance.status}".`);
        }
        instance.status = 'paused';
        instance.updatedAt = new Date().toISOString();
        // LangGraph state is already persisted via checkpointer; just update local instance
    }
    /**
     * Resume a paused or approval-waiting workflow instance.
     */
    async resumeWorkflow(instanceId, approvalData) {
        const instance = this.requireInstance(instanceId);
        if (instance.status !== 'paused' && instance.status !== 'waiting_approval') {
            throw new Error(`Cannot resume workflow ${instanceId} in status "${instance.status}".`);
        }
        instance.status = 'in-progress';
        instance.updatedAt = new Date().toISOString();
        const graph = this.getCompiledGraph();
        const threadConfig = {
            configurable: {
                thread_id: instanceId,
                instance_id: instanceId,
            },
        };
        try {
            // If we have approval data, update the graph state to clear the interrupt
            if (approvalData !== undefined) {
                await graph.updateState(threadConfig, {
                    waitingForApproval: false,
                    approvalRequest: null,
                    status: 'in-progress',
                    updatedAt: new Date().toISOString(),
                });
            }
            // Continue the graph from the last checkpoint
            const result = await graph.invoke(null, threadConfig);
            this.syncStateToInstance(instance, result);
        }
        catch (err) {
            const error = err;
            if (error && typeof error === 'object' && error['__interrupt']) {
                const graphState = await this.getGraphState(instanceId);
                if (graphState) {
                    this.syncStateToInstance(instance, graphState);
                }
            }
            else {
                const errorMsg = err instanceof Error ? err.message : String(err);
                instance.status = 'failed';
                instance.completedAt = new Date().toISOString();
                instance.updatedAt = instance.completedAt;
                this.emit('workflow:failed', instance, errorMsg);
            }
        }
    }
    /**
     * Get the current progress of a workflow instance.
     */
    async getProgress(instanceId) {
        const instance = this.requireInstance(instanceId);
        return instance.progress;
    }
    /**
     * Cancel a workflow instance.
     */
    async cancelWorkflow(instanceId) {
        const instance = this.requireInstance(instanceId);
        if (instance.status === 'completed' || instance.status === 'cancelled') {
            throw new Error(`Workflow ${instanceId} is already ${instance.status}.`);
        }
        instance.status = 'cancelled';
        instance.updatedAt = new Date().toISOString();
        instance.completedAt = new Date().toISOString();
        // Update LangGraph state to cancelled
        const graph = this.getCompiledGraph();
        try {
            await graph.updateState({ configurable: { thread_id: instanceId, instance_id: instanceId } }, { status: 'cancelled', updatedAt: instance.updatedAt });
        }
        catch {
            // Best effort - instance may not have been started in LangGraph yet
        }
    }
    /**
     * List available workflow definition names.
     */
    listDefinitions() {
        return this.loader.listWorkflows().map((f) => {
            if (f.endsWith('.yaml'))
                return f.slice(0, -5);
            if (f.endsWith('.yml'))
                return f.slice(0, -4);
            return f;
        });
    }
    /**
     * Get the workflow loader for direct definition access.
     */
    getLoader() {
        return this.loader;
    }
    /**
     * Get a workflow instance by ID.
     */
    getInstance(instanceId) {
        return this.instances.get(instanceId) ?? null;
    }
    /**
     * Get all workflow instances, optionally filtered by session.
     */
    getAllInstances(sessionId) {
        const all = Array.from(this.instances.values());
        if (sessionId) {
            return all.filter((i) => i.sessionId === sessionId);
        }
        return all;
    }
    // --------------------------------------------------------------------------
    // Internal: sync LangGraph state -> WorkflowInstance
    // --------------------------------------------------------------------------
    syncStateToInstance(instance, graphState) {
        const prevPhaseIndex = instance.currentPhaseIndex;
        instance.currentPhaseIndex = graphState.currentPhaseIndex;
        instance.status = graphState.status;
        instance.updatedAt = graphState.updatedAt;
        instance.completedAt = graphState.completedAt;
        // Sync step results into instance phases
        for (const phase of instance.phases) {
            for (const step of phase.steps) {
                const key = `${phase.name}.${step.name}`;
                const sr = graphState.stepResults[key];
                if (sr) {
                    step.result = sr;
                    step.status = sr.success ? 'completed' : 'failed';
                    instance.state.stepStatuses[key] = step.status;
                    // Emit step-completed event
                    if (sr.success) {
                        this.emit('workflow:step-completed', instance, {
                            phaseName: phase.name,
                            stepName: step.name,
                            result: sr,
                        });
                    }
                }
            }
            // Update phase status based on steps
            const allDone = phase.steps.every((s) => s.status === 'completed' || s.status === 'skipped');
            const anyFailed = phase.steps.some((s) => s.status === 'failed' || s.status === 'blocked');
            if (allDone) {
                phase.status = 'completed';
                instance.state.phaseStatuses[phase.name] = 'completed';
            }
            else if (anyFailed) {
                phase.status = 'failed';
                instance.state.phaseStatuses[phase.name] = 'failed';
            }
        }
        // Sync phase results
        for (const [phaseName, pr] of Object.entries(graphState.phaseResults)) {
            const phase = instance.phases.find((p) => p.name === phaseName);
            if (phase) {
                phase.result = pr;
                Object.assign(instance.state.outputs, pr.outputs);
            }
        }
        // Emit phase-changed if phase index changed
        if (prevPhaseIndex !== graphState.currentPhaseIndex) {
            const newPhase = instance.phases[graphState.currentPhaseIndex];
            if (newPhase) {
                this.emit('workflow:phase-changed', instance, newPhase);
            }
        }
        // Handle approval waiting
        if (graphState.waitingForApproval && graphState.approvalRequest) {
            instance.status = 'waiting_approval';
            this.emit('workflow:waiting-approval', instance, graphState.approvalRequest);
        }
        // Recalculate progress
        instance.progress = this.calculateProgress(instance.phases, instance.state);
        this.emit('workflow:progress', instance.id, instance.progress);
        // Terminal states
        if (graphState.status === 'completed') {
            this.emit('workflow:completed', instance);
        }
        else if (graphState.status === 'failed') {
            this.emit('workflow:failed', instance, graphState.lastError ?? 'Unknown error');
        }
    }
    async getGraphState(instanceId) {
        try {
            const graph = this.getCompiledGraph();
            const state = await graph.getState({
                configurable: { thread_id: instanceId },
            });
            return (state?.values ?? null);
        }
        catch {
            return null;
        }
    }
    // --------------------------------------------------------------------------
    // Phase/Step Building from YAML
    // --------------------------------------------------------------------------
    buildPhases(definition) {
        return definition.phases.map((yamlPhase, index) => {
            const steps = this.buildSteps(yamlPhase);
            let transitionToNext = 'auto';
            if (index < definition.phases.length - 1) {
                const nextPhase = definition.phases[index + 1];
                const key = `${yamlPhase.name} -> ${nextPhase.name}`;
                transitionToNext = definition.transitions[key] ?? 'auto';
            }
            return {
                id: `phase-${yamlPhase.name}-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`,
                name: yamlPhase.name,
                displayName: yamlPhase.display_name,
                displayNameAr: yamlPhase.display_name_ar,
                description: `${yamlPhase.display_name} phase`,
                steps,
                status: 'pending',
                hasCheckpoint: yamlPhase.checkpoint,
                gateCondition: 'all-pass',
                involvedAgents: yamlPhase.agents,
                entryCriteria: [],
                exitCriteria: [],
                transitionToNext,
                order: index,
                result: null,
                startedAt: null,
                completedAt: null,
            };
        });
    }
    buildSteps(yamlPhase) {
        return yamlPhase.steps.map((yamlStep) => ({
            id: `step-${yamlStep.name}-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`,
            name: yamlStep.name,
            description: `${yamlStep.action} by ${yamlStep.agent}`,
            status: 'pending',
            assignedAgent: yamlStep.agent,
            action: yamlStep.action,
            modelOverride: yamlStep.model_override ?? yamlPhase.model_override ?? null,
            reviewers: [],
            dependencies: yamlStep.depends_on ?? [],
            parallel: yamlStep.parallel ?? false,
            approvalRequired: yamlStep.approval_required ?? false,
            inputArtifacts: yamlStep.inputs ?? [],
            outputArtifacts: yamlStep.outputs ?? [],
            acceptanceCriteria: [],
            estimatedDuration: null,
            actualDuration: null,
            startedAt: null,
            completedAt: null,
            retryCount: 0,
            maxRetries: 2,
            error: null,
            result: null,
            metadata: {},
        }));
    }
    // --------------------------------------------------------------------------
    // Progress Calculation
    // --------------------------------------------------------------------------
    calculateProgress(phases, state) {
        let totalSteps = 0;
        let completedSteps = 0;
        let failedSteps = 0;
        const activeSteps = [];
        const waitingApproval = [];
        const phaseProgress = {};
        for (const phase of phases) {
            const phaseTotal = phase.steps.length;
            let phaseCompleted = 0;
            for (const step of phase.steps) {
                totalSteps++;
                const stepKey = `${phase.name}.${step.name}`;
                const status = state.stepStatuses[stepKey] ?? step.status;
                if (status === 'completed' || status === 'skipped') {
                    completedSteps++;
                    phaseCompleted++;
                }
                else if (status === 'failed' || status === 'blocked') {
                    failedSteps++;
                }
                else if (status === 'active') {
                    activeSteps.push(stepKey);
                }
                else if (status === 'waiting_approval') {
                    waitingApproval.push(stepKey);
                }
            }
            const phaseStatus = state.phaseStatuses[phase.name] ?? phase.status;
            phaseProgress[phase.name] = {
                percentage: phaseTotal > 0 ? Math.round((phaseCompleted / phaseTotal) * 100) : 0,
                completedSteps: phaseCompleted,
                totalSteps: phaseTotal,
                status: phaseStatus,
            };
        }
        const overall = totalSteps > 0
            ? Math.round((completedSteps / totalSteps) * 100)
            : 0;
        return {
            overall,
            phases: phaseProgress,
            totalSteps,
            completedSteps,
            failedSteps,
            activeSteps,
            waitingApproval,
        };
    }
    // --------------------------------------------------------------------------
    // Internal Helpers
    // --------------------------------------------------------------------------
    requireInstance(instanceId) {
        const instance = this.instances.get(instanceId);
        if (!instance) {
            throw new Error(`Workflow instance not found: ${instanceId}`);
        }
        return instance;
    }
}
exports.WorkflowExecutor = WorkflowExecutor;
//# sourceMappingURL=workflow-engine.js.map