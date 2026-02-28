/**
 * LangGraph Node Functions
 *
 * Each node is a higher-order function: it takes runtime deps and returns
 * a function that accepts workflow state and returns a partial state update.
 *
 * IMPORTANT: Nodes do NOT make actual LLM calls. They log what they would
 * dispatch and mark steps/phases as completed (stub execution).
 */

import { interrupt } from '@langchain/langgraph';

import type { WorkflowStateType } from './state';
import type { AgentManager } from '../agent-manager';
import type { ModelRouter } from '../model-router';
import type { VIADPEngine } from '../viadp-engine';
import type {
  StepResult,
  PhaseResult,
  ApprovalRequest,
  YAMLStepDefinition,
} from '@forge-team/shared';

/** Dependencies injected into each node at build time */
export interface NodeDeps {
  agentManager: AgentManager;
  modelRouter: ModelRouter;
  viadpEngine: VIADPEngine;
}

// ---------------------------------------------------------------------------
// viadpPreCheck
// ---------------------------------------------------------------------------

/**
 * Run VIADP delegation assessment before each phase begins.
 * If risk is critical, pause for human approval.
 */
export function viadpPreCheck(deps: NodeDeps) {
  return (state: WorkflowStateType): Partial<WorkflowStateType> => {
    const { definition, currentPhaseIndex } = state;
    const phase = definition.phases[currentPhaseIndex];
    if (!phase || phase.steps.length === 0) {
      return { viadpContext: null };
    }

    const firstStep = phase.steps[0];
    const agentId = firstStep.agent;

    console.log(
      `[LangGraph] viadpPreCheck: phase="${phase.name}" agent="${agentId}"`
    );

    // Run VIADP delegation assessment
    const assessment = deps.viadpEngine.assessDelegation(
      'bmad-master' as any,
      agentId as any,
      `Execute phase "${phase.name}"`,
      phase.steps.map(s => s.action)
    );

    // If risk is critical, pause for human approval
    if (assessment.riskLevel === 'critical') {
      console.log(
        `[LangGraph] viadpPreCheck: CRITICAL risk for phase="${phase.name}" — pausing`
      );
      return {
        viadpContext: {
          riskLevel: assessment.riskLevel,
          capabilityScore: assessment.capabilityScore,
        },
        waitingForApproval: true,
        status: 'waiting_approval',
        approvalRequest: {
          id: crypto.randomUUID(),
          workflowInstanceId: state.instanceId,
          phaseName: phase.name,
          stepName: null,
          description: `VIADP: Critical risk detected for phase "${phase.name}". Human approval required.`,
          status: 'pending',
          requestedBy: 'system',
          resolvedBy: null,
          comment: null,
          requestedAt: new Date().toISOString(),
          resolvedAt: null,
          context: { viadpAssessment: assessment },
        },
        updatedAt: new Date().toISOString(),
      };
    }

    // Store VIADP context for use during step execution
    return {
      viadpContext: {
        riskLevel: assessment.riskLevel,
        capabilityScore: assessment.capabilityScore,
        delegationApproved: true,
      },
      updatedAt: new Date().toISOString(),
    };
  };
}

// ---------------------------------------------------------------------------
// executeStep
// ---------------------------------------------------------------------------

/**
 * Execute the current step. Looks up the step from the definition,
 * logs that it would dispatch the work, and returns state with the
 * step marked as completed.
 */
export function executeStep(deps: NodeDeps) {
  return (state: WorkflowStateType): Partial<WorkflowStateType> => {
    const { definition, currentPhaseIndex, currentStepIndex } = state;
    const phase = definition.phases[currentPhaseIndex];
    if (!phase) {
      return {
        lastError: `No phase at index ${currentPhaseIndex}`,
        status: 'failed',
        updatedAt: new Date().toISOString(),
      };
    }

    const step: YAMLStepDefinition | undefined = phase.steps[currentStepIndex];
    if (!step) {
      return {
        lastError: `No step at index ${currentStepIndex} in phase "${phase.name}"`,
        status: 'failed',
        updatedAt: new Date().toISOString(),
      };
    }

    const stepKey = `${phase.name}.${step.name}`;

    console.log(
      `[LangGraph] executeStep: phase="${phase.name}" step="${step.name}" ` +
      `agent="${step.agent}" action="${step.action}"`
    );

    // Build simulated outputs from declared output artifacts
    const outputs: Record<string, unknown> = {};
    if (step.outputs) {
      for (const outputKey of step.outputs) {
        outputs[outputKey] = {
          _generated: true,
          _step: step.name,
          _agent: step.agent,
          _action: step.action,
          _timestamp: new Date().toISOString(),
        };
      }
    }

    // Apply per-step model override from YAML definition
    const routedModel: string | null = step.model_override ?? null;
    if (step.model_override) {
      console.log(
        `[LangGraph] executeStep: applying modelOverride="${step.model_override}" for step="${step.name}"`
      );
    }

    const result: StepResult = {
      success: true,
      outputs,
      logs: [
        `[${step.agent}] Executed action "${step.action}" for step "${step.name}".`,
        `[${step.agent}] Produced outputs: ${step.outputs?.join(', ') || 'none'}.`,
      ],
      durationMs: 0,
      modelUsed: routedModel,
      tokenUsage: null,
    };

    const newStepResults = { ...state.stepResults, [stepKey]: result };

    // Advance step index
    const nextStepIndex = currentStepIndex + 1;

    // Check if step requires approval
    if (step.approval_required) {
      return {
        stepResults: newStepResults,
        currentStepIndex: nextStepIndex,
        waitingForApproval: true,
        status: 'waiting_approval',
        approvalRequest: {
          id: crypto.randomUUID(),
          workflowInstanceId: state.instanceId,
          phaseName: phase.name,
          stepName: step.name,
          description: `Step "${step.name}" requires approval to proceed.`,
          status: 'pending',
          requestedBy: step.agent,
          resolvedBy: null,
          comment: null,
          requestedAt: new Date().toISOString(),
          resolvedAt: null,
          context: { definitionName: state.definitionName },
        },
        updatedAt: new Date().toISOString(),
      };
    }

    return {
      stepResults: newStepResults,
      currentStepIndex: nextStepIndex,
      updatedAt: new Date().toISOString(),
    };
  };
}

// ---------------------------------------------------------------------------
// checkApproval
// ---------------------------------------------------------------------------

/**
 * Human-in-the-loop approval gate. Uses LangGraph's `interrupt()` to
 * pause execution until approval data is provided via `resumeWorkflow`.
 */
export function checkApproval(_deps: NodeDeps) {
  return (state: WorkflowStateType): Partial<WorkflowStateType> => {
    if (!state.waitingForApproval) {
      return {};
    }

    console.log(
      `[LangGraph] checkApproval: waiting for approval on instance="${state.instanceId}"`
    );

    // interrupt() pauses the graph and waits for human input
    const approvalData = interrupt({
      type: 'approval_required',
      approvalRequest: state.approvalRequest,
    });

    // When resumed, approvalData contains the approval decision
    const approved = approvalData?.approved === true;

    if (approved) {
      return {
        waitingForApproval: false,
        approvalRequest: null,
        status: 'in-progress',
        updatedAt: new Date().toISOString(),
      };
    }

    return {
      waitingForApproval: false,
      approvalRequest: null,
      status: 'failed',
      lastError: `Approval rejected: ${approvalData?.reason ?? 'no reason given'}`,
      updatedAt: new Date().toISOString(),
    };
  };
}

// ---------------------------------------------------------------------------
// advancePhase
// ---------------------------------------------------------------------------

/**
 * Advance to the next phase. Increments currentPhaseIndex and resets
 * currentStepIndex. If all phases are done, marks the workflow completed.
 */
export function advancePhase(_deps: NodeDeps) {
  return (state: WorkflowStateType): Partial<WorkflowStateType> => {
    const { definition, currentPhaseIndex } = state;
    const currentPhase = definition.phases[currentPhaseIndex];

    // Build phase result from accumulated step results
    const stepResultsForPhase: Record<string, StepResult> = {};
    const phaseOutputs: Record<string, unknown> = {};

    if (currentPhase) {
      for (const step of currentPhase.steps) {
        const key = `${currentPhase.name}.${step.name}`;
        const sr = state.stepResults[key];
        if (sr) {
          stepResultsForPhase[step.name] = sr;
          Object.assign(phaseOutputs, sr.outputs);
        }
      }
    }

    const phaseResult: PhaseResult = {
      phaseName: currentPhase?.name ?? `phase-${currentPhaseIndex}`,
      success: true,
      stepResults: stepResultsForPhase,
      outputs: phaseOutputs,
      durationMs: 0,
      completedAt: new Date().toISOString(),
    };

    const newPhaseResults = {
      ...state.phaseResults,
      [phaseResult.phaseName]: phaseResult,
    };

    const nextPhaseIndex = currentPhaseIndex + 1;
    const totalPhases = definition.phases.length;

    console.log(
      `[LangGraph] advancePhase: ${currentPhase?.name ?? '?'} -> ` +
      `phase ${nextPhaseIndex}/${totalPhases}`
    );

    if (nextPhaseIndex >= totalPhases) {
      return {
        currentPhaseIndex: nextPhaseIndex,
        currentStepIndex: 0,
        phaseResults: newPhaseResults,
        status: 'completed',
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    return {
      currentPhaseIndex: nextPhaseIndex,
      currentStepIndex: 0,
      phaseResults: newPhaseResults,
      updatedAt: new Date().toISOString(),
    };
  };
}

// ---------------------------------------------------------------------------
// handleError
// ---------------------------------------------------------------------------

/**
 * Handle a step error. Increments retryCount; if >= 3, marks the workflow
 * as failed. Otherwise clears the error for a retry.
 */
export function handleError(_deps: NodeDeps) {
  return (state: WorkflowStateType): Partial<WorkflowStateType> => {
    const newRetryCount = state.retryCount + 1;

    console.log(
      `[LangGraph] handleError: retryCount=${newRetryCount}, error="${state.lastError}"`
    );

    if (newRetryCount >= 3) {
      return {
        retryCount: newRetryCount,
        status: 'failed',
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    return {
      retryCount: newRetryCount,
      lastError: null,
      updatedAt: new Date().toISOString(),
    };
  };
}

// ---------------------------------------------------------------------------
// checkTransition
// ---------------------------------------------------------------------------

/**
 * Check the transition rule between the current phase and the next.
 * Returns a routing string for the conditional edge:
 * - "requires_approval" -> route to checkApproval
 * - "auto" -> route to advancePhase
 */
export function checkTransition(_deps: NodeDeps) {
  return (state: WorkflowStateType): Partial<WorkflowStateType> => {
    const { definition, currentPhaseIndex } = state;
    const currentPhase = definition.phases[currentPhaseIndex];
    const nextPhase = definition.phases[currentPhaseIndex + 1];

    if (!currentPhase || !nextPhase) {
      // No next phase; will advance to completion
      return { updatedAt: new Date().toISOString() };
    }

    const transitionKey = `${currentPhase.name} -> ${nextPhase.name}`;
    const transitionType = definition.transitions[transitionKey] ?? 'auto';

    console.log(
      `[LangGraph] checkTransition: "${transitionKey}" = ${transitionType}`
    );

    if (transitionType === 'requires_approval') {
      const approval: ApprovalRequest = {
        id: crypto.randomUUID(),
        workflowInstanceId: state.instanceId,
        phaseName: nextPhase.name,
        stepName: null,
        description: `Transition from "${currentPhase.name}" to "${nextPhase.name}" requires approval.`,
        status: 'pending',
        requestedBy: 'system',
        resolvedBy: null,
        comment: null,
        requestedAt: new Date().toISOString(),
        resolvedAt: null,
        context: { fromPhase: currentPhase.name, toPhase: nextPhase.name },
      };

      return {
        waitingForApproval: true,
        approvalRequest: approval,
        status: 'waiting_approval',
        updatedAt: new Date().toISOString(),
      };
    }

    return { updatedAt: new Date().toISOString() };
  };
}

// ---------------------------------------------------------------------------
// Routing functions (used by conditional edges)
// ---------------------------------------------------------------------------

/**
 * Route after executeStep: if there are more steps in the current phase,
 * loop back to executeStep. If step requires approval, go to checkApproval.
 * If all steps done, go to checkTransition.
 * If there's an error, go to handleError.
 */
export function routeAfterStep(state: WorkflowStateType): string {
  if (state.status === 'failed') {
    return 'handleError';
  }
  if (state.waitingForApproval) {
    return 'checkApproval';
  }

  const phase = state.definition.phases[state.currentPhaseIndex];
  if (!phase) {
    return 'checkTransition';
  }

  if (state.currentStepIndex < phase.steps.length) {
    return 'executeStep';
  }

  return 'checkTransition';
}

/**
 * Route after checkTransition: if approval is required, go to checkApproval.
 * Otherwise go to advancePhase.
 */
export function routeAfterTransition(state: WorkflowStateType): string {
  if (state.waitingForApproval) {
    return 'checkApproval';
  }
  return 'advancePhase';
}

/**
 * Route after advancePhase: if completed, go to END. Otherwise loop
 * back to viadpPreCheck for the next phase.
 */
export function routeAfterAdvance(state: WorkflowStateType): string {
  if (state.status === 'completed' || state.status === 'failed') {
    return '__end__';
  }
  return 'viadpPreCheck';
}

/**
 * Route after viadpPreCheck: if critical risk requires approval, go to
 * checkApproval. Otherwise proceed to executeStep.
 */
export function routeAfterViadp(state: WorkflowStateType): string {
  if (state.waitingForApproval) {
    return 'checkApproval';
  }
  return 'executeStep';
}

/**
 * Route after handleError: if failed permanently, go to END.
 * Otherwise retry by going back to executeStep.
 */
export function routeAfterError(state: WorkflowStateType): string {
  if (state.status === 'failed') {
    return '__end__';
  }
  return 'executeStep';
}

/**
 * Route after checkApproval: if failed (rejected), go to END.
 * If still in progress, continue from where we left off.
 */
export function routeAfterApproval(state: WorkflowStateType): string {
  if (state.status === 'failed') {
    return '__end__';
  }

  // If approval was for a transition, advance the phase
  if (state.approvalRequest === null) {
    const phase = state.definition.phases[state.currentPhaseIndex];
    if (phase && state.currentStepIndex >= phase.steps.length) {
      return 'advancePhase';
    }
  }

  return 'executeStep';
}
