// Canonical VIADP type definitions.
// This is the single source of truth for all VIADP protocol types.

type AgentId = string;

// --- Phase-5 new types ---

export interface DelegationRequest {
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

export interface DelegationToken {
  token: string;
  caveats: string[];
  signature: string;
}

export interface VIADPContext {
  delegationId: string;
  token: DelegationToken;
  trustScore: number;
  riskScore: number;
}

// --- Merged from shared/types/viadp.ts ---

export type DelegationStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'in-progress'
  | 'completed'
  | 'failed'
  | 'revoked'
  | 'escalated';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface DelegationScope {
  allowedActions: string[];
  resourceLimits: {
    maxTokens?: number;
    maxDuration?: number;
    maxCost?: number;
  };
  canRedelegate: boolean;
  allowedArtifactTypes: string[];
}

export interface TrustScore {
  agentId: AgentId;
  evaluator: AgentId | 'system';
  score: number;
  successes: number;
  failures: number;
  alpha: number;
  beta: number;
  domainScores: Record<string, number>;
  lastUpdated: string;
  history: TrustScoreChange[];
}

export interface TrustScoreChange {
  timestamp: string;
  previousScore: number;
  newScore: number;
  reason: string;
  delegationId: string;
}

export interface VerificationProof {
  id: string;
  delegationTokenId: string;
  delegate: AgentId;
  verifier: AgentId;
  status: 'pending' | 'verified' | 'rejected' | 'needs-revision';
  artifacts: string[];
  criteriaResults: CriteriaResult[];
  qualityScore: number | null;
  comments: string;
  submittedAt: string;
  verifiedAt: string | null;
}

export interface CriteriaResult {
  criterion: string;
  passed: boolean;
  notes: string;
}

export interface DelegationCheckpoint {
  id: string;
  name: string;
  description: string;
  expectedAt: string;
  completedAt: string | null;
  passed: boolean | null;
  metrics: Record<string, number>;
}

export interface EscalationConfig {
  timeoutMinutes: number;
  minTrustScore: number;
  maxFailures: number;
  escalateTo: AgentId;
  autoEscalate: boolean;
}

export interface DelegationAuditEntry {
  id: string;
  timestamp: string;
  delegationId: string;
  action: DelegationAuditAction;
  actor: AgentId | 'system';
  details: string;
  metadata: Record<string, unknown>;
}

export type DelegationAuditAction =
  | 'request.created'
  | 'request.accepted'
  | 'request.rejected'
  | 'token.issued'
  | 'token.revoked'
  | 'checkpoint.reached'
  | 'checkpoint.failed'
  | 'work.submitted'
  | 'verification.started'
  | 'verification.passed'
  | 'verification.failed'
  | 'escalation.triggered'
  | 'trust.updated';

// --- Merged from viadp/src/delegation-engine.ts ---

export interface AgentProfile {
  id: string;
  capabilities: string[];
  modelFamily: string;
  costPerToken: number;
  avgResponseTime: number;
  trustScore: number;
  currentLoad: number;
  maxConcurrentTasks: number;
  status: 'idle' | 'working' | 'reviewing' | 'blocked' | 'offline' | 'error';
}

// --- Merged from viadp/src/resilience.ts ---

export interface CircuitBreakerState {
  agentId: string;
  state: 'closed' | 'open' | 'half_open';
  failureCount: number;
  successCount: number;
  lastFailure: Date | null;
  lastSuccess: Date | null;
  openedAt: Date | null;
  halfOpenAt: Date | null;
  nextRetryAt: Date | null;
}
