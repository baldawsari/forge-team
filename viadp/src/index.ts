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
  type RFQ,
  type RFQBid,
  type RFQResult,
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

export {
  runDynamicAssessment,
  registerAgentsForAssessment,
  type AssessmentDelegationRequest,
  type Bid,
} from './assessment';

export {
  startMonitoring,
  stopMonitoring,
  checkAgentHealth,
  recordMetric,
  detectAnomaly,
  type MonitoringContext,
  type MetricSample,
  type AnomalyResult,
} from './execution-monitor';

export {
  issueDelegationToken,
  updateTrustBayesian,
  getHeatPenalty,
  getReputation,
  type TrustCalibrationDelegationRequest,
  type TrustCalibrationBid,
  type TrustCalibrationDelegationToken,
} from './trust-calibration';

export { generateZKProof } from './verification';

export {
  applyEconomicSelfRegulation,
  enforceParallelBidsForCritical,
} from './resilience';
