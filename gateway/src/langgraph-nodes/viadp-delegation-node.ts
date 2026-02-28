import type { VIADPEngine } from '../viadp-engine';
import type { AgentId } from '@forge-team/shared';

interface VIADPNodeState {
  taskId: string;
  currentAgent: string;
  delegationRequest?: {
    fromAgent: string;
    goal: string;
    requirements: Record<string, unknown>;
    criticality: 'low' | 'medium' | 'high' | 'critical';
  };
  needsDelegation: boolean;
  viadpContext?: {
    delegationId: string;
    token: { token: string; caveats: string[]; signature: string };
    trustScore: number;
    riskScore: number;
  };
  [key: string]: unknown;
}

export function createViadpDelegationNode(engine: VIADPEngine) {
  return async (state: VIADPNodeState): Promise<Partial<VIADPNodeState>> => {
    if (!state.needsDelegation) {
      return {};
    }

    const request = state.delegationRequest;
    if (!request) {
      return { needsDelegation: false };
    }

    const assessment = engine.assessDelegation(
      request.fromAgent as AgentId,
      state.currentAgent as AgentId,
      request.goal,
      Object.keys(request.requirements)
    );

    const delegationReq = engine.createDelegationRequest({
      from: request.fromAgent as AgentId,
      to: state.currentAgent as AgentId,
      taskId: state.taskId,
      sessionId: 'workflow',
      reason: request.goal,
      requiredCapabilities: Object.keys(request.requirements),
      scope: {
        allowedActions: Object.keys(request.requirements),
        resourceLimits: { maxDuration: 30 },
        canRedelegate: request.criticality !== 'critical',
        allowedArtifactTypes: ['code', 'document', 'config', 'test'],
      },
    });

    const result = engine.acceptDelegation(delegationReq.id);

    if (result) {
      return {
        needsDelegation: false,
        viadpContext: {
          delegationId: delegationReq.id,
          token: {
            token: result.token.id,
            caveats: result.token.scope.allowedActions,
            signature: result.token.signature,
          },
          trustScore: assessment.capabilityScore,
          riskScore: assessment.riskLevel === 'critical' ? 1.0
            : assessment.riskLevel === 'high' ? 0.7
            : assessment.riskLevel === 'medium' ? 0.4 : 0.1,
        },
      };
    }

    return { needsDelegation: false };
  };
}
