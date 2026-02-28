import type { AgentProfile } from '../types';

export interface AssessmentDelegationRequest {
  taskId: string;
  fromAgent: string;
  goal: string;
  requirements: Record<string, unknown>;
  criticality: 'low' | 'medium' | 'high' | 'critical';
}

export interface Bid {
  agentId: string;
  estCost: number;
  durationHours: number;
  reputationBond: number;
  verificationPolicy: { zkRequired: boolean; teeRequired: boolean };
  diversityScore: number;
}

// In-memory agent registry as fallback
let registeredAgents: AgentProfile[] = [];

export function registerAgentsForAssessment(agents: AgentProfile[]): void {
  registeredAgents = agents;
}

async function getAvailableAgents(): Promise<AgentProfile[]> {
  return registeredAgents.filter(a => a.status !== 'offline' && a.status !== 'error');
}

function calculateCost(agent: AgentProfile, req: AssessmentDelegationRequest): number {
  const criticMultiplier = req.criticality === 'critical' ? 2.0
    : req.criticality === 'high' ? 1.5
    : req.criticality === 'medium' ? 1.2 : 1.0;
  return agent.costPerToken * 1000 * criticMultiplier;
}

function calculateDiversityScore(modelFamily: string): number {
  // Shannon entropy penalty for same-model families
  const familyCounts = new Map<string, number>();
  for (const agent of registeredAgents) {
    familyCounts.set(agent.modelFamily, (familyCounts.get(agent.modelFamily) ?? 0) + 1);
  }
  const count = familyCounts.get(modelFamily) ?? 1;
  const total = registeredAgents.length || 1;
  const proportion = count / total;
  return 1 - proportion;
}

function estimateDuration(agent: AgentProfile, req: AssessmentDelegationRequest): number {
  const loadFactor = 1 + (agent.currentLoad / Math.max(1, agent.maxConcurrentTasks));
  const complexityFactor = Object.keys(req.requirements).length * 0.5;
  return (agent.avgResponseTime / 3600000) * loadFactor + complexityFactor;
}

export async function runDynamicAssessment(req: AssessmentDelegationRequest): Promise<Bid[]> {
  const candidates = await getAvailableAgents();
  return candidates
    .filter(agent => agent.id !== req.fromAgent)
    .map(agent => ({
      agentId: agent.id,
      estCost: calculateCost(agent, req),
      durationHours: estimateDuration(agent, req),
      reputationBond: agent.trustScore * 10,
      verificationPolicy: { zkRequired: req.criticality === 'critical', teeRequired: false },
      diversityScore: calculateDiversityScore(agent.modelFamily),
    }))
    .sort((a, b) => (b.reputationBond * b.diversityScore) - (a.reputationBond * a.diversityScore));
}
