import crypto from 'node:crypto';
import { TrustManager } from './trust-manager';

export interface TrustCalibrationDelegationRequest {
  taskId: string;
  fromAgent: string;
  goal: string;
  requirements: Record<string, unknown>;
  criticality: 'low' | 'medium' | 'high' | 'critical';
}

export interface TrustCalibrationBid {
  agentId: string;
  estCost: number;
  durationHours: number;
  reputationBond: number;
  verificationPolicy: { zkRequired: boolean; teeRequired: boolean };
  diversityScore: number;
}

export interface TrustCalibrationDelegationToken {
  token: string;
  caveats: string[];
  signature: string;
}

// Heat penalties stored in-memory (would be in viadp_reputation table in production)
const heatPenalties = new Map<string, number>();

function createMacaroonStyleToken(
  req: TrustCalibrationDelegationRequest,
  bid: TrustCalibrationBid
): TrustCalibrationDelegationToken {
  const maxDuration = `max-duration:${bid.durationHours}h`;
  const caveats = [maxDuration];
  if (req.criticality === 'critical') caveats.push('read-only');
  if (bid.verificationPolicy.zkRequired) caveats.push('zk-proof-required');

  const tokenData = `${req.taskId}:${req.fromAgent}:${bid.agentId}:${Date.now()}`;
  const signature = crypto.createHmac('sha256', 'forgeteam-viadp-secret')
    .update(tokenData)
    .digest('hex');

  return {
    token: `dct_${crypto.randomUUID()}`,
    caveats,
    signature,
  };
}

export async function issueDelegationToken(
  req: TrustCalibrationDelegationRequest,
  chosenBid: TrustCalibrationBid
): Promise<TrustCalibrationDelegationToken> {
  const token = createMacaroonStyleToken(req, chosenBid);
  return token;
}

export async function updateTrustBayesian(
  agentId: string,
  outcome: 'success' | 'failure',
  criticality: number
): Promise<void> {
  const currentHeat = heatPenalties.get(agentId) ?? 1.0;
  const newHeat = outcome === 'failure'
    ? currentHeat * 1.2
    : Math.max(0.8, currentHeat * 0.95);
  heatPenalties.set(agentId, newHeat);
}

export function getHeatPenalty(agentId: string): number {
  return heatPenalties.get(agentId) ?? 1.0;
}

export function getReputation(agentId: string): { score: number; heat_penalty: number } {
  return {
    score: 0.5,
    heat_penalty: heatPenalties.get(agentId) ?? 1.0,
  };
}
