/**
 * VIADP (Verified Inter-Agent Delegation Protocol) Engine for the ForgeTeam Gateway.
 *
 * Implements the full delegation lifecycle:
 * 1. Pre-delegation assessment (capability matching, risk scoring)
 * 2. Delegation request/response protocol
 * 3. Token issuance with scope constraints
 * 4. Task monitoring with checkpoints
 * 5. Verification on completion
 * 6. Trust score tracking (Bayesian updates)
 * 7. Delegation chain audit trail
 * 8. Escalation triggers
 */
import { EventEmitter } from 'eventemitter3';
import type { AgentId, DelegationToken, DelegationScope, TrustScore, VerificationProof, CriteriaResult, DelegationRequest, DelegationStatus, DelegationCheckpoint, EscalationConfig, DelegationAuditEntry, DelegationAuditAction, RiskLevel } from '@forge-team/shared';
import type { AgentManager } from './agent-manager';
export interface VIADPEvents {
    'delegation:requested': (request: DelegationRequest) => void;
    'delegation:accepted': (request: DelegationRequest, token: DelegationToken) => void;
    'delegation:rejected': (request: DelegationRequest, reason: string) => void;
    'delegation:completed': (request: DelegationRequest, proof: VerificationProof) => void;
    'delegation:failed': (request: DelegationRequest, error: string) => void;
    'delegation:revoked': (tokenId: string, reason: string) => void;
    'delegation:escalated': (request: DelegationRequest, escalateTo: AgentId) => void;
    'verification:submitted': (proof: VerificationProof) => void;
    'verification:passed': (proof: VerificationProof) => void;
    'verification:failed': (proof: VerificationProof) => void;
    'trust:updated': (agentId: AgentId, score: TrustScore) => void;
    'checkpoint:reached': (delegationId: string, checkpoint: DelegationCheckpoint) => void;
    'checkpoint:failed': (delegationId: string, checkpoint: DelegationCheckpoint) => void;
    'audit:entry': (entry: DelegationAuditEntry) => void;
}
export declare class VIADPEngine extends EventEmitter<VIADPEvents> {
    private delegationRequests;
    private delegationTokens;
    private verificationProofs;
    private trustScores;
    private auditTrail;
    private agentManager;
    /** Timer for monitoring active delegations */
    private monitorTimer;
    constructor(agentManager: AgentManager);
    /**
     * Initializes trust scores for all agents with uniform prior (Beta(2,2)).
     * This gives a starting score of 0.5 with moderate confidence.
     */
    private initializeTrustScores;
    /**
     * Assesses whether an agent is capable of handling a delegation.
     * Returns a capability score [0.0, 1.0] and risk assessment.
     */
    assessDelegation(from: AgentId, to: AgentId, taskDescription: string, requiredCapabilities: string[]): {
        capabilityScore: number;
        riskLevel: RiskLevel;
        riskFactors: string[];
    };
    /**
     * Creates a new delegation request from one agent to another.
     */
    createDelegationRequest(params: {
        from: AgentId;
        to: AgentId;
        taskId: string;
        sessionId: string;
        reason: string;
        requiredCapabilities: string[];
        scope: DelegationScope;
        escalation?: Partial<EscalationConfig>;
        checkpoints?: Omit<DelegationCheckpoint, 'id' | 'completedAt' | 'passed' | 'metrics'>[];
    }): DelegationRequest;
    /**
     * Accepts a delegation request, issuing a delegation token.
     */
    acceptDelegation(requestId: string): {
        request: DelegationRequest;
        token: DelegationToken;
    } | null;
    /**
     * Rejects a delegation request.
     */
    rejectDelegation(requestId: string, reason: string): DelegationRequest | null;
    /**
     * Revokes an active delegation token.
     */
    revokeDelegation(tokenId: string, reason: string): boolean;
    /**
     * Records that a checkpoint has been reached for an active delegation.
     */
    recordCheckpoint(requestId: string, checkpointId: string, passed: boolean, metrics?: Record<string, number>): boolean;
    /**
     * Starts the delegation (transitions from accepted to in-progress).
     */
    startDelegation(requestId: string): boolean;
    /**
     * Submits work for verification after a delegation completes.
     */
    submitVerification(params: {
        delegationTokenId: string;
        delegate: AgentId;
        verifier: AgentId;
        artifacts: string[];
        criteriaResults: CriteriaResult[];
    }): VerificationProof | null;
    /**
     * Verifies a submitted proof, calculating quality score.
     */
    verifyProof(proofId: string, passed: boolean, qualityScore: number, comments: string): VerificationProof | null;
    /**
     * Returns the trust score between two agents.
     */
    getTrustScore(agentId: AgentId, evaluator?: AgentId | 'system'): TrustScore | null;
    /**
     * Returns all trust scores for a given agent.
     */
    getAllTrustScores(agentId: AgentId): TrustScore[];
    /**
     * Updates the trust score using a Bayesian Beta-Binomial update.
     *
     * The trust score is modeled as a Beta(alpha, beta) distribution:
     * - Success: alpha += weight
     * - Failure: beta += weight
     * - Score = alpha / (alpha + beta) (the expected value of the Beta distribution)
     *
     * The weight is influenced by the quality score, so high-quality completions
     * boost trust more than marginal ones.
     */
    private updateTrustScore;
    /**
     * Triggers escalation for a delegation that is failing or timing out.
     */
    private triggerEscalation;
    /**
     * Monitors all active delegations for timeouts and trust thresholds.
     * Called periodically by the monitor timer.
     */
    private monitorActiveDelegations;
    /**
     * Adds an entry to the delegation audit trail.
     */
    private addAuditEntry;
    /**
     * Returns the audit trail for a specific delegation.
     */
    getAuditTrail(delegationId: string): DelegationAuditEntry[];
    /**
     * Returns the full audit trail (optionally filtered).
     */
    getFullAuditTrail(filters?: {
        actor?: AgentId | 'system';
        action?: DelegationAuditAction;
        since?: string;
    }): DelegationAuditEntry[];
    /**
     * Returns a delegation request by ID.
     */
    getRequest(requestId: string): DelegationRequest | undefined;
    /**
     * Returns all delegation requests (optionally filtered).
     */
    getAllRequests(filters?: {
        status?: DelegationStatus;
        from?: AgentId;
        to?: AgentId;
        sessionId?: string;
    }): DelegationRequest[];
    /**
     * Returns a delegation token by ID.
     */
    getToken(tokenId: string): DelegationToken | undefined;
    /**
     * Validates a delegation token (checks expiry and revocation).
     */
    validateToken(tokenId: string): {
        valid: boolean;
        reason?: string;
    };
    /**
     * Returns a verification proof by ID.
     */
    getProof(proofId: string): VerificationProof | undefined;
    /**
     * Generates a cryptographic signature for a delegation request.
     */
    private generateSignature;
    /**
     * Returns a summary of the VIADP engine state.
     */
    getSummary(): {
        totalRequests: number;
        activeRequests: number;
        completedRequests: number;
        failedRequests: number;
        activeTokens: number;
        auditEntries: number;
        trustScoreCount: number;
    };
    /**
     * Shuts down the VIADP engine.
     */
    shutdown(): void;
}
//# sourceMappingURL=viadp-engine.d.ts.map