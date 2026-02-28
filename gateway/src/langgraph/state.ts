/**
 * LangGraph Workflow State Definition
 *
 * Defines the state annotation used by LangGraph's StateGraph to track
 * workflow execution across phases and steps.
 */

import { Annotation } from '@langchain/langgraph';

import type {
  WorkflowDefinition,
  WorkflowInstanceStatus,
  StepResult,
  PhaseResult,
  ApprovalRequest,
} from '@forge-team/shared';

/**
 * LangGraph state annotation for ForgeTeam workflows.
 *
 * Each field represents a piece of the workflow execution state that
 * LangGraph tracks and passes between nodes.
 */
export const WorkflowState = Annotation.Root({
  /** UUID of the workflow definition */
  workflowId: Annotation<string>,
  /** UUID of the running workflow instance */
  instanceId: Annotation<string>,
  /** Session this workflow belongs to */
  sessionId: Annotation<string>,
  /** Name of the workflow definition (e.g., "full-sdlc") */
  definitionName: Annotation<string>,
  /** Index of the phase currently being executed */
  currentPhaseIndex: Annotation<number>,
  /** Index of the step within the current phase */
  currentStepIndex: Annotation<number>,
  /** Overall workflow status */
  status: Annotation<WorkflowInstanceStatus>,
  /** Results accumulated per phase, keyed by phase name */
  phaseResults: Annotation<Record<string, PhaseResult>>,
  /** Results accumulated per step, keyed by "phaseName.stepName" */
  stepResults: Annotation<Record<string, StepResult>>,
  /** Whether the workflow is currently waiting for human approval */
  waitingForApproval: Annotation<boolean>,
  /** The pending approval request, if any */
  approvalRequest: Annotation<ApprovalRequest | null>,
  /** Last error message, if any */
  lastError: Annotation<string | null>,
  /** Number of retry attempts for the current failing step */
  retryCount: Annotation<number>,
  /** Timestamp when the workflow started */
  startedAt: Annotation<string>,
  /** Timestamp of the last state update */
  updatedAt: Annotation<string>,
  /** Timestamp when the workflow completed (null if still running) */
  completedAt: Annotation<string | null>,
  /** VIADP delegation context for the current phase */
  viadpContext: Annotation<Record<string, unknown> | null>,
  /** The full workflow definition loaded from YAML */
  definition: Annotation<WorkflowDefinition>,
});

/** Convenience type for the full workflow state */
export type WorkflowStateType = typeof WorkflowState.State;
