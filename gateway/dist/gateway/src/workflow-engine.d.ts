/**
 * ForgeTeam Workflow Engine
 *
 * Core workflow engine that:
 * 1. Loads BMAD YAML workflow files
 * 2. Converts them to executable state machines (LangGraph-style)
 * 3. Manages workflow execution with checkpoints
 * 4. Handles parallel steps, dependencies, approvals
 * 5. Emits real-time progress updates
 * 6. Supports pause/resume/restart from any checkpoint
 */
import EventEmitter from 'eventemitter3';
import type { WorkflowDefinition, WorkflowInstance, WorkflowInstanceStatus, WorkflowStep, WorkflowCheckpoint, WorkflowInstanceState, WorkflowProgress, WorkflowEvent, ApprovalRequest, StepResult, PipelineConfig } from '@forge-team/shared';
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
/** Manages saving and restoring workflow checkpoints */
export declare class CheckpointManager {
    /** In-memory store of checkpoints by workflow instance ID */
    private readonly checkpoints;
    /**
     * Create a checkpoint for the given workflow instance.
     */
    createCheckpoint(instance: WorkflowInstance, label?: string): WorkflowCheckpoint;
    /**
     * List all checkpoints for a workflow instance.
     */
    getCheckpoints(workflowInstanceId: string): WorkflowCheckpoint[];
    /**
     * Get a specific checkpoint by ID.
     */
    getCheckpoint(workflowInstanceId: string, checkpointId: string): WorkflowCheckpoint | null;
    /**
     * Get the latest checkpoint for a workflow instance.
     */
    getLatestCheckpoint(workflowInstanceId: string): WorkflowCheckpoint | null;
    /**
     * Restore a workflow instance to a given checkpoint state.
     * Returns the restored state. Caller is responsible for applying it
     * back to the WorkflowInstance.
     */
    restoreFromCheckpoint(checkpoint: WorkflowCheckpoint): WorkflowInstanceState;
    /**
     * Delete all checkpoints for a workflow instance.
     */
    deleteCheckpoints(workflowInstanceId: string): void;
    /**
     * Serialize the current workflow instance state into a checkpoint-safe format.
     */
    private serializeState;
}
/** Event types emitted by the workflow engine */
export interface WorkflowEngineEvents {
    'workflow:event': (event: WorkflowEvent) => void;
    'workflow:progress': (instanceId: string, progress: WorkflowProgress) => void;
    'workflow:approval_required': (approval: ApprovalRequest) => void;
    'workflow:checkpoint': (checkpoint: WorkflowCheckpoint) => void;
    'workflow:error': (instanceId: string, error: Error) => void;
}
/** Step executor function type - the actual work done for a step */
export type StepExecutorFn = (step: WorkflowStep, context: StepExecutionContext) => Promise<StepResult>;
/** Context provided to a step executor */
export interface StepExecutionContext {
    /** The workflow instance */
    workflowInstanceId: string;
    /** The phase this step belongs to */
    phaseName: string;
    /** Session ID */
    sessionId: string;
    /** All accumulated outputs from prior steps */
    accumulatedOutputs: Record<string, unknown>;
    /** The input artifacts this step requests */
    resolvedInputs: Record<string, unknown>;
    /** Project name */
    projectName: string;
    /** Project description */
    projectDescription: string;
}
/** Options for creating a workflow instance */
export interface CreateWorkflowOptions {
    sessionId: string;
    projectName: string;
    projectDescription: string;
    config?: Partial<PipelineConfig>;
}
/**
 * The main workflow engine. Manages creation, execution, pausing, resuming,
 * and event emission for workflow instances.
 */
export declare class WorkflowExecutor extends EventEmitter<WorkflowEngineEvents> {
    private readonly instances;
    private readonly loader;
    private readonly checkpointManager;
    private stepExecutor;
    /** Tracks which instances currently have an active execution loop running */
    private readonly executionLocks;
    constructor(workflowsDir: string, stepExecutor?: StepExecutorFn);
    /** Get the workflow loader for direct definition access */
    getLoader(): WorkflowLoader;
    /** Get the checkpoint manager */
    getCheckpointManager(): CheckpointManager;
    /**
     * Set or replace the step executor function.
     * This is the function that performs the actual work for each step
     * (e.g., calling an LLM agent).
     */
    setStepExecutor(executor: StepExecutorFn): void;
    /**
     * Create a new workflow instance from a YAML definition file.
     * Does not start execution; call startWorkflow() to begin.
     */
    createInstance(workflowFile: string, options: CreateWorkflowOptions): WorkflowInstance;
    /**
     * Get a workflow instance by ID.
     */
    getInstance(instanceId: string): WorkflowInstance | null;
    /**
     * Get all workflow instances, optionally filtered by session.
     */
    getAllInstances(sessionId?: string): WorkflowInstance[];
    /**
     * Delete a workflow instance and its checkpoints.
     */
    deleteInstance(instanceId: string): boolean;
    /**
     * Start executing a workflow instance from the beginning
     * or from the current position if it was restored from a checkpoint.
     */
    startWorkflow(instanceId: string): Promise<void>;
    /**
     * Pause a running workflow instance.
     */
    pauseWorkflow(instanceId: string): void;
    /**
     * Resume a paused workflow instance.
     */
    resumeWorkflow(instanceId: string): Promise<void>;
    /**
     * Cancel a workflow instance.
     */
    cancelWorkflow(instanceId: string): void;
    /**
     * Restart a workflow from a specific checkpoint.
     */
    restartFromCheckpoint(instanceId: string, checkpointId: string): Promise<void>;
    /**
     * Handle an approval decision for a pending approval request.
     */
    handleApproval(workflowInstanceId: string, approvalId: string, approved: boolean, resolvedBy: string, comment?: string): Promise<void>;
    /**
     * Get all pending approval requests for a workflow instance.
     */
    getPendingApprovals(instanceId: string): ApprovalRequest[];
    /**
     * Get the current progress of a workflow instance.
     */
    getProgress(instanceId: string): WorkflowProgress;
    /**
     * Get a summary of workflow status suitable for display.
     */
    getWorkflowSummary(instanceId: string): {
        id: string;
        name: string;
        status: WorkflowInstanceStatus;
        progress: WorkflowProgress;
        currentPhase: string | null;
        pendingApprovals: number;
        checkpoints: number;
        startedAt: string | null;
        elapsedMs: number | null;
    };
    /**
     * Execute phases starting from the current phase index.
     * Uses a re-entrancy lock to prevent multiple concurrent execution loops
     * for the same workflow instance (e.g., when approval handlers are called
     * synchronously during step execution).
     */
    private executeFromCurrentPhase;
    /**
     * Inner execution loop (called by executeFromCurrentPhase with lock held).
     */
    private executeFromCurrentPhaseInner;
    /**
     * Execute a single phase, running steps in dependency order,
     * handling parallel execution.
     */
    private executePhase;
    /**
     * Execute a single workflow step.
     * Returns true if the step completed successfully.
     */
    private executeStep;
    private createApprovalRequest;
    private requestTransitionApproval;
    private checkTransitionApproval;
    private getTransitionType;
    private completeWorkflow;
    private failWorkflow;
    /**
     * Build runtime WorkflowPhase objects from a YAML WorkflowDefinition.
     */
    private buildPhases;
    /**
     * Build runtime WorkflowStep objects from YAML step definitions.
     */
    private buildSteps;
    /**
     * Calculate the current progress of a workflow from its phases and state.
     */
    private calculateProgress;
    private addHistory;
    private emitWorkflowEvent;
    private requireInstance;
}
/**
 * Create and configure a WorkflowExecutor with sensible defaults.
 * workflowsDir defaults to the project's workflows/ directory.
 */
export declare function createWorkflowEngine(workflowsDir?: string, stepExecutor?: StepExecutorFn): WorkflowExecutor;
//# sourceMappingURL=workflow-engine.d.ts.map