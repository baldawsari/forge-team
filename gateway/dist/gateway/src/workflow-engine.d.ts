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
import EventEmitter from 'eventemitter3';
import type { WorkflowDefinition, WorkflowInstance, WorkflowPhase, WorkflowProgress, WorkflowEvent, ApprovalRequest, StepResult } from '@forge-team/shared';
import type { AgentManager } from './agent-manager';
import type { ModelRouter } from './model-router';
import type { VIADPEngine } from './viadp-engine';
/** Validation error thrown when a YAML workflow file is malformed */
export declare class WorkflowValidationError extends Error {
    readonly filePath: string;
    readonly details: string[];
    constructor(message: string, filePath: string, details: string[]);
}
/** Loads and validates YAML workflow definitions from the filesystem */
export declare class WorkflowLoader {
    private readonly workflowsDir;
    private readonly cache;
    constructor(workflowsDir: string);
    /**
     * Load a single workflow definition from a YAML file.
     * Results are cached by file path.
     */
    loadWorkflow(filePath: string): WorkflowDefinition;
    /**
     * Load all workflow definitions from the workflows directory.
     */
    loadAllWorkflows(): Map<string, WorkflowDefinition>;
    /**
     * List available workflow files without loading them.
     */
    listWorkflows(): string[];
    /**
     * Clear the definition cache, forcing reload on next access.
     */
    clearCache(): void;
    /**
     * Parse a raw YAML object into a WorkflowDefinition.
     */
    private parseDefinition;
    /**
     * Validate a parsed workflow definition for structural correctness.
     */
    private validate;
}
/** Event types emitted by the new workflow engine */
export interface WorkflowEngineEvents {
    'workflow:started': (instance: WorkflowInstance) => void;
    'workflow:phase-changed': (instance: WorkflowInstance, phase: WorkflowPhase) => void;
    'workflow:step-completed': (instance: WorkflowInstance, step: {
        phaseName: string;
        stepName: string;
        result: StepResult;
    }) => void;
    'workflow:waiting-approval': (instance: WorkflowInstance, approval: ApprovalRequest) => void;
    'workflow:completed': (instance: WorkflowInstance) => void;
    'workflow:failed': (instance: WorkflowInstance, error: string) => void;
    'workflow:event': (event: WorkflowEvent) => void;
    'workflow:progress': (instanceId: string, progress: WorkflowProgress) => void;
}
/** Dependencies required to construct the WorkflowExecutor */
export interface WorkflowExecutorDeps {
    workflowsDir: string;
    agentManager: AgentManager;
    modelRouter: ModelRouter;
    viadpEngine: VIADPEngine;
    databaseUrl: string;
}
/**
 * LangGraph-backed workflow engine.
 *
 * Uses LangGraph StateGraph internally for state machine execution and
 * PostgresCheckpointSaver for durable checkpoint persistence.
 */
export declare class WorkflowExecutor extends EventEmitter<WorkflowEngineEvents> {
    private readonly loader;
    private readonly checkpointer;
    private readonly instances;
    private readonly agentManager;
    private readonly modelRouter;
    private readonly viadpEngine;
    private compiledGraph;
    private viadpNode;
    constructor(deps: WorkflowExecutorDeps);
    private getCompiledGraph;
    /**
     * Start a new workflow from a definition name, returning the instance.
     */
    startWorkflow(definitionName: string, sessionId: string): Promise<WorkflowInstance>;
    /**
     * Pause a running workflow instance.
     */
    pauseWorkflow(instanceId: string): Promise<void>;
    /**
     * Resume a paused or approval-waiting workflow instance.
     */
    resumeWorkflow(instanceId: string, approvalData?: unknown): Promise<void>;
    /**
     * Get the current progress of a workflow instance.
     */
    getProgress(instanceId: string): Promise<WorkflowProgress>;
    /**
     * Cancel a workflow instance.
     */
    cancelWorkflow(instanceId: string): Promise<void>;
    /**
     * List available workflow definition names.
     */
    listDefinitions(): string[];
    /**
     * Get the workflow loader for direct definition access.
     */
    getLoader(): WorkflowLoader;
    /**
     * Get a workflow instance by ID.
     */
    getInstance(instanceId: string): WorkflowInstance | null;
    /**
     * Get all workflow instances, optionally filtered by session.
     */
    getAllInstances(sessionId?: string): WorkflowInstance[];
    private syncStateToInstance;
    private getGraphState;
    private buildPhases;
    private buildSteps;
    private calculateProgress;
    private requireInstance;
}
//# sourceMappingURL=workflow-engine.d.ts.map