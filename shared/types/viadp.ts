/**
 * VIADP (Verified Inter-Agent Delegation Protocol) type definitions.
 * Manages trust, delegation, verification, and audit trails between agents.
 */

import type { AgentId } from './agent';

/** Status of a delegation request */
export type DelegationStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'in-progress'
  | 'completed'
  | 'failed'
  | 'revoked'
  | 'escalated';

/** Risk level assessment for a delegation */
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

/** A token representing delegated authority from one agent to another */
export interface DelegationToken {
  id: string;
  /** The agent granting authority */
  delegator: AgentId;
  /** The agent receiving authority */
  delegate: AgentId;
  /** Task ID being delegated */
  taskId: string;
  /** Session context */
  sessionId: string;
  /** Scope of delegated authority */
  scope: DelegationScope;
  /** When this token was issued */
  issuedAt: string;
  /** When this token expires */
  expiresAt: string;
  /** Whether the token has been revoked */
  revoked: boolean;
  /** Unique signature for verification */
  signature: string;
  /** Chain of delegation (if re-delegated) */
  chain: AgentId[];
  /** Maximum allowed re-delegation depth */
  maxChainDepth: number;
}

/** Defines what a delegate is allowed to do */
export interface DelegationScope {
  /** Specific actions permitted */
  allowedActions: string[];
  /** Resource constraints */
  resourceLimits: {
    maxTokens?: number;
    maxDuration?: number;
    maxCost?: number;
  };
  /** Whether the delegate can further delegate */
  canRedelegate: boolean;
  /** Artifact types the delegate can produce */
  allowedArtifactTypes: string[];
}

/** Trust score between two agents, maintained via Bayesian updates */
export interface TrustScore {
  /** The agent being evaluated */
  agentId: AgentId;
  /** The agent doing the evaluation (or 'system' for global) */
  evaluator: AgentId | 'system';
  /** Overall trust score [0.0, 1.0] */
  score: number;
  /** Number of successful delegations */
  successes: number;
  /** Number of failed delegations */
  failures: number;
  /** Bayesian prior alpha parameter */
  alpha: number;
  /** Bayesian prior beta parameter */
  beta: number;
  /** Breakdown by capability area */
  domainScores: Record<string, number>;
  /** Last time this score was updated */
  lastUpdated: string;
  /** History of score changes */
  history: TrustScoreChange[];
}

/** A single change in trust score */
export interface TrustScoreChange {
  timestamp: string;
  previousScore: number;
  newScore: number;
  reason: string;
  delegationId: string;
}

/** Proof that a delegated task was completed correctly */
export interface VerificationProof {
  id: string;
  /** The delegation token this proof corresponds to */
  delegationTokenId: string;
  /** The agent that completed the work */
  delegate: AgentId;
  /** The agent that will verify */
  verifier: AgentId;
  /** Status of verification */
  status: 'pending' | 'verified' | 'rejected' | 'needs-revision';
  /** Artifacts produced as evidence */
  artifacts: string[];
  /** Acceptance criteria checklist results */
  criteriaResults: CriteriaResult[];
  /** Quality score [0.0, 1.0] */
  qualityScore: number | null;
  /** Verifier's comments */
  comments: string;
  /** Timestamps */
  submittedAt: string;
  verifiedAt: string | null;
}

/** Result of evaluating a single acceptance criterion */
export interface CriteriaResult {
  criterion: string;
  passed: boolean;
  notes: string;
}

/** A request from one agent to delegate work to another */
export interface DelegationRequest {
  id: string;
  /** Agent requesting delegation */
  from: AgentId;
  /** Target agent for delegation */
  to: AgentId;
  /** Task to be delegated */
  taskId: string;
  /** Session context */
  sessionId: string;
  /** Current status */
  status: DelegationStatus;
  /** Why this delegation is being requested */
  reason: string;
  /** Pre-delegation capability assessment score */
  capabilityScore: number;
  /** Risk assessment */
  riskLevel: RiskLevel;
  riskFactors: string[];
  /** Proposed scope of delegation */
  proposedScope: DelegationScope;
  /** Checkpoints for monitoring progress */
  checkpoints: DelegationCheckpoint[];
  /** Escalation configuration */
  escalation: EscalationConfig;
  /** The resulting delegation token if accepted */
  tokenId: string | null;
  /** Timestamps */
  createdAt: string;
  respondedAt: string | null;
  completedAt: string | null;
}

/** A checkpoint for monitoring delegation progress */
export interface DelegationCheckpoint {
  id: string;
  name: string;
  description: string;
  /** Expected completion time */
  expectedAt: string;
  /** Actual completion time */
  completedAt: string | null;
  /** Whether this checkpoint passed */
  passed: boolean | null;
  /** Metrics collected at this checkpoint */
  metrics: Record<string, number>;
}

/** Configuration for when/how to escalate a delegation */
export interface EscalationConfig {
  /** Timeout before auto-escalation (in minutes) */
  timeoutMinutes: number;
  /** Trust score threshold - escalate if delegate's score drops below */
  minTrustScore: number;
  /** Maximum failures before escalation */
  maxFailures: number;
  /** Who to escalate to */
  escalateTo: AgentId;
  /** Whether to auto-escalate or require human confirmation */
  autoEscalate: boolean;
}

/** Audit trail entry for delegation actions */
export interface DelegationAuditEntry {
  id: string;
  timestamp: string;
  delegationId: string;
  action: DelegationAuditAction;
  actor: AgentId | 'system';
  details: string;
  metadata: Record<string, unknown>;
}

/** Actions recorded in the delegation audit trail */
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
