/**
 * Workflow and SDLC pipeline type definitions for the ForgeTeam system.
 * Defines the structured flow of work through software development lifecycle phases.
 *
 * Includes both:
 * - YAML workflow definition types (parsed from workflows/*.yaml)
 * - Runtime workflow instance types (execution state)
 */
import type { AgentId } from './agent';
/** A step definition as written in the YAML workflow file */
export interface YAMLStepDefinition {
    name: string;
    agent: AgentId;
    action: string;
    model_override?: string | null;
    inputs?: string[];
    outputs?: string[];
    depends_on?: string[];
    parallel?: boolean;
    approval_required?: boolean;
}
/** A phase definition as written in the YAML workflow file */
export interface YAMLPhaseDefinition {
    name: string;
    display_name: string;
    display_name_ar: string;
    agents: AgentId[];
    model_override?: string | null;
    steps: YAMLStepDefinition[];
    checkpoint: boolean;
}
/** Transition type between phases */
export type TransitionType = 'auto' | 'requires_approval';
/** The full YAML workflow definition as parsed from a .yaml file */
export interface WorkflowDefinition {
    name: string;
    version: string;
    description: string;
    phases: YAMLPhaseDefinition[];
    transitions: Record<string, TransitionType>;
}
/** Status of a workflow step */
export type WorkflowStepStatus = 'pending' | 'active' | 'completed' | 'failed' | 'skipped' | 'blocked' | 'waiting_approval';
/** Overall status of a workflow instance */
export type WorkflowInstanceStatus = 'not-started' | 'in-progress' | 'completed' | 'failed' | 'paused' | 'waiting_approval' | 'cancelled';
/** A single step within a workflow phase */
export interface WorkflowStep {
    id: string;
    name: string;
    description: string;
    status: WorkflowStepStatus;
    /** Agent responsible for this step */
    assignedAgent: AgentId;
    /** Action to perform */
    action: string;
    /** Model override for this specific step */
    modelOverride: string | null;
    /** Agents that must review/approve this step's output */
    reviewers: AgentId[];
    /** Step IDs that must complete before this step can start */
    dependencies: string[];
    /** Whether this step can run in parallel with siblings */
    parallel: boolean;
    /** Whether human approval is required before proceeding */
    approvalRequired: boolean;
    /** Artifacts required as input */
    inputArtifacts: string[];
    /** Artifacts produced as output */
    outputArtifacts: string[];
    /** Acceptance criteria for step completion */
    acceptanceCriteria: string[];
    /** Estimated duration in minutes */
    estimatedDuration: number | null;
    /** Actual duration in minutes once completed */
    actualDuration: number | null;
    /** Timestamps */
    startedAt: string | null;
    completedAt: string | null;
    /** Number of retry attempts */
    retryCount: number;
    maxRetries: number;
    /** Error message if failed */
    error: string | null;
    /** Result data from step execution */
    result: StepResult | null;
    /** Free-form metadata */
    metadata: Record<string, unknown>;
}
/** Result of executing a single workflow step */
export interface StepResult {
    /** Whether the step succeeded */
    success: boolean;
    /** Produced output artifact keys and their data */
    outputs: Record<string, unknown>;
    /** Any messages or logs from execution */
    logs: string[];
    /** Duration in milliseconds */
    durationMs: number;
    /** Model used for this step (after routing) */
    modelUsed: string | null;
    /** Token usage for this step */
    tokenUsage: {
        input: number;
        output: number;
    } | null;
}
/** Result of a phase (derived from all step results) */
export interface PhaseResult {
    /** Phase name */
    phaseName: string;
    /** Whether the phase succeeded */
    success: boolean;
    /** Individual step results */
    stepResults: Record<string, StepResult>;
    /** Aggregated outputs from all steps */
    outputs: Record<string, unknown>;
    /** Total duration in milliseconds */
    durationMs: number;
    /** Timestamp when phase completed */
    completedAt: string;
}
/** A phase in the SDLC pipeline containing multiple steps */
export interface WorkflowPhase {
    id: string;
    name: string;
    displayName: string;
    displayNameAr: string;
    description: string;
    /** Ordered steps within this phase */
    steps: WorkflowStep[];
    /** Overall phase status derived from step statuses */
    status: WorkflowStepStatus;
    /** Whether a checkpoint is saved after this phase completes */
    hasCheckpoint: boolean;
    /** Gate condition: all steps must pass for phase to complete */
    gateCondition: 'all-pass' | 'majority-pass' | 'any-pass';
    /** Agents involved in this phase */
    involvedAgents: AgentId[];
    /** Phase-level entry criteria */
    entryCriteria: string[];
    /** Phase-level exit criteria */
    exitCriteria: string[];
    /** Transition type to the next phase */
    transitionToNext: TransitionType;
    /** Order in the pipeline (0-indexed) */
    order: number;
    /** Phase result once completed */
    result: PhaseResult | null;
    /** Timestamps */
    startedAt: string | null;
    completedAt: string | null;
}
/** A request for human approval, generated when a step or transition requires it */
export interface ApprovalRequest {
    id: string;
    /** The workflow instance this belongs to */
    workflowInstanceId: string;
    /** Phase name where approval is needed */
    phaseName: string;
    /** Step name (null if it's a phase transition approval) */
    stepName: string | null;
    /** Description of what is being approved */
    description: string;
    /** Current status of the approval */
    status: 'pending' | 'approved' | 'rejected';
    /** Who requested this approval (agent or system) */
    requestedBy: AgentId | 'system';
    /** Who resolved this approval (null if still pending) */
    resolvedBy: string | null;
    /** Optional comment from the approver */
    comment: string | null;
    /** Timestamp when the approval was requested */
    requestedAt: string;
    /** Timestamp when the approval was resolved */
    resolvedAt: string | null;
    /** Data context for the reviewer */
    context: Record<string, unknown>;
}
/** Checkpoint: a snapshot of workflow state that can be restored */
export interface WorkflowCheckpoint {
    id: string;
    /** The workflow instance this checkpoint belongs to */
    workflowInstanceId: string;
    /** Phase name at the time of checkpoint */
    phaseName: string;
    /** Phase index at the time of checkpoint */
    phaseIndex: number;
    /** Serialized workflow state */
    state: WorkflowInstanceState;
    /** All outputs produced up to this checkpoint */
    accumulatedOutputs: Record<string, unknown>;
    /** Timestamp of checkpoint creation */
    createdAt: string;
    /** Optional label for this checkpoint */
    label: string | null;
}
/** The serializable state of a workflow instance */
export interface WorkflowInstanceState {
    /** Current phase index */
    currentPhaseIndex: number;
    /** Status of each phase by name */
    phaseStatuses: Record<string, WorkflowStepStatus>;
    /** Status of each step by "phase.step" key */
    stepStatuses: Record<string, WorkflowStepStatus>;
    /** All outputs accumulated so far */
    outputs: Record<string, unknown>;
    /** History log of events */
    history: WorkflowHistoryEntry[];
    /** Pending approval requests */
    pendingApprovals: ApprovalRequest[];
}
/** A single entry in the workflow history log */
export interface WorkflowHistoryEntry {
    timestamp: string;
    type: 'phase_started' | 'phase_completed' | 'phase_failed' | 'step_started' | 'step_completed' | 'step_failed' | 'approval_requested' | 'approval_resolved' | 'checkpoint_created' | 'workflow_paused' | 'workflow_resumed' | 'workflow_started' | 'workflow_completed' | 'workflow_failed' | 'workflow_cancelled';
    phaseName?: string;
    stepName?: string;
    message: string;
    data?: Record<string, unknown>;
}
/** A running (or completed) instance of a workflow */
export interface WorkflowInstance {
    id: string;
    /** The workflow definition name (e.g., "Full SDLC Pipeline") */
    workflowName: string;
    /** The workflow definition file path */
    workflowFile: string;
    /** Session this instance belongs to */
    sessionId: string;
    /** Overall status */
    status: WorkflowInstanceStatus;
    /** Project metadata */
    projectName: string;
    projectDescription: string;
    /** Resolved phases with runtime state */
    phases: WorkflowPhase[];
    /** Current active phase index (-1 if not started) */
    currentPhaseIndex: number;
    /** Serializable state snapshot */
    state: WorkflowInstanceState;
    /** Checkpoint history */
    checkpoints: WorkflowCheckpoint[];
    /** Progress as a percentage [0-100] */
    progress: WorkflowProgress;
    /** Timestamps */
    createdAt: string;
    updatedAt: string;
    startedAt: string | null;
    completedAt: string | null;
    /** Configuration overrides */
    config: PipelineConfig;
}
/** Progress tracking for a workflow instance */
export interface WorkflowProgress {
    /** Overall percentage [0-100] */
    overall: number;
    /** Per-phase progress */
    phases: Record<string, {
        percentage: number;
        completedSteps: number;
        totalSteps: number;
        status: WorkflowStepStatus;
    }>;
    /** Total steps across all phases */
    totalSteps: number;
    /** Completed steps across all phases */
    completedSteps: number;
    /** Failed steps across all phases */
    failedSteps: number;
    /** Currently active steps */
    activeSteps: string[];
    /** Steps waiting for approval */
    waitingApproval: string[];
}
/** Full SDLC pipeline definition */
export interface SDLCPipeline {
    id: string;
    name: string;
    description: string;
    /** Session this pipeline belongs to */
    sessionId: string;
    /** Ordered phases */
    phases: WorkflowPhase[];
    /** Current active phase index */
    currentPhaseIndex: number;
    /** Overall pipeline status */
    status: 'not-started' | 'in-progress' | 'completed' | 'failed' | 'paused';
    /** Project-level metadata */
    projectName: string;
    projectDescription: string;
    /** Timestamps */
    createdAt: string;
    updatedAt: string;
    startedAt: string | null;
    completedAt: string | null;
    /** Configuration overrides */
    config: PipelineConfig;
}
/** Configuration for pipeline behavior */
export interface PipelineConfig {
    /** Whether to auto-advance to next phase on completion */
    autoAdvance: boolean;
    /** Whether to allow parallel phase execution */
    allowParallelPhases: boolean;
    /** Maximum time for a single phase in minutes */
    phaseTimeout: number | null;
    /** Whether to require human approval between phases */
    requireHumanGates: boolean;
    /** Phases to skip (by phase ID) */
    skipPhases: string[];
    /** Custom phase ordering override */
    phaseOrder: string[] | null;
}
/** Predefined SDLC phases used in the BMAD-Claw workflow */
export declare const SDLC_PHASES: readonly ["discovery", "requirements", "architecture", "design", "implementation", "testing", "security-review", "documentation", "deployment", "monitoring"];
export type SDLCPhaseId = (typeof SDLC_PHASES)[number];
/** Template for creating a default SDLC pipeline */
export interface PipelineTemplate {
    id: string;
    name: string;
    description: string;
    phases: {
        phaseId: SDLCPhaseId;
        name: string;
        agents: AgentId[];
        steps: {
            name: string;
            agent: AgentId;
            reviewers: AgentId[];
            acceptanceCriteria: string[];
        }[];
    }[];
}
/** All possible workflow event types */
export type WorkflowEventType = 'workflow.phase.started' | 'workflow.phase.completed' | 'workflow.phase.failed' | 'workflow.step.started' | 'workflow.step.completed' | 'workflow.step.failed' | 'workflow.step.approval_requested' | 'workflow.step.approval_resolved' | 'workflow.instance.created' | 'workflow.instance.started' | 'workflow.instance.completed' | 'workflow.instance.failed' | 'workflow.instance.paused' | 'workflow.instance.resumed' | 'workflow.instance.cancelled' | 'workflow.checkpoint.created' | 'workflow.checkpoint.restored' | 'workflow.progress.updated' | 'workflow.pipeline.started' | 'workflow.pipeline.completed' | 'workflow.pipeline.failed';
/** Event emitted when a workflow changes */
export interface WorkflowEvent {
    type: WorkflowEventType;
    /** Workflow instance ID */
    workflowInstanceId: string;
    /** Legacy: pipeline ID alias */
    pipelineId: string;
    phaseId?: string;
    phaseName?: string;
    stepId?: string;
    stepName?: string;
    sessionId: string;
    timestamp: string;
    triggeredBy: AgentId | 'system' | 'user';
    data?: Record<string, unknown>;
    /** Progress snapshot at the time of this event */
    progress?: WorkflowProgress;
}
//# sourceMappingURL=workflow.d.ts.map