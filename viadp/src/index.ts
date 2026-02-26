/**
 * VIADP (Verified Inter-Agent Delegation Protocol) entry point.
 * Exports all VIADP modules for the ForgeTeam system.
 */

export {
  DelegationEngine,
  DelegationRequestSchema,
  type DelegationRequest,
  type DelegationToken,
  type DelegationScope,
  type CapabilityScore,
  type RankedCandidate,
  type ExecutionStatus,
  type CheckpointStatus,
  type VerificationResult,
  type VerificationPolicy,
  type AgentProfile,
  type RiskLevel,
} from './delegation-engine';

export {
  TrustManager,
  type TrustScore,
  type TrustEvent,
  type TrustMatrix,
  type TrustManagerConfig,
} from './trust-manager';

export {
  VerificationEngine,
  ProofSchema,
  type VerificationPolicy as VerificationPolicyConfig,
  type VerificationPolicyType,
  type VerificationRequest,
  type Proof,
  type ProofAttestation,
  type ReviewerAssignment,
  type AuditTrailEntry,
  type VerificationResult as VerificationEngineResult,
} from './verification';

export {
  ResilienceEngine,
  type AgentCandidate,
  type ParallelBidResult,
  type ConsensusResult,
  type ConsensusVote,
  type CircuitBreakerState,
  type HealthCheckResult,
  type ResilienceConfig,
} from './resilience';

export {
  AuditLog,
  AuditEntryInputSchema,
  type AuditEntry,
  type AuditAction,
  type AuditFilter,
  type IntegrityReport,
} from './audit-log';
