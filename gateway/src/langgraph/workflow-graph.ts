/**
 * LangGraph Workflow Graph Builder
 *
 * Constructs a LangGraph StateGraph with all nodes and conditional edges
 * for executing ForgeTeam BMAD workflows.
 */

import { StateGraph, START, END } from '@langchain/langgraph';
import type { BaseCheckpointSaver } from '@langchain/langgraph';

import { WorkflowState } from './state';
import {
  executeStep,
  checkApproval,
  advancePhase,
  handleError,
  checkTransition,
  routeAfterStep,
  routeAfterTransition,
  routeAfterAdvance,
  routeAfterError,
  routeAfterApproval,
} from './nodes';
import type { NodeDeps } from './nodes';

/**
 * Build and compile a LangGraph workflow graph.
 *
 * @param deps  Runtime dependencies (AgentManager, ModelRouter, VIADPEngine)
 * @param checkpointer  Checkpoint saver for persistence
 * @returns A compiled LangGraph graph ready to invoke
 */
export function buildWorkflowGraph(
  deps: NodeDeps,
  checkpointer: BaseCheckpointSaver
) {
  const graph = new StateGraph(WorkflowState)
    // Register nodes
    .addNode('executeStep', executeStep(deps))
    .addNode('checkApproval', checkApproval(deps))
    .addNode('advancePhase', advancePhase(deps))
    .addNode('handleError', handleError(deps))
    .addNode('checkTransition', checkTransition(deps))

    // Entry edge: start -> executeStep
    .addEdge(START, 'executeStep')

    // Conditional edges after each node
    .addConditionalEdges('executeStep', routeAfterStep, {
      executeStep: 'executeStep',
      checkApproval: 'checkApproval',
      checkTransition: 'checkTransition',
      handleError: 'handleError',
    })
    .addConditionalEdges('checkTransition', routeAfterTransition, {
      checkApproval: 'checkApproval',
      advancePhase: 'advancePhase',
    })
    .addConditionalEdges('advancePhase', routeAfterAdvance, {
      executeStep: 'executeStep',
      [END]: END,
    })
    .addConditionalEdges('handleError', routeAfterError, {
      executeStep: 'executeStep',
      [END]: END,
    })
    .addConditionalEdges('checkApproval', routeAfterApproval, {
      executeStep: 'executeStep',
      advancePhase: 'advancePhase',
      [END]: END,
    });

  return graph.compile({ checkpointer });
}
