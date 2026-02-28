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
    private agentManager;
    private monitorTimer;
    private delegationEngine;
    private trustManager;
    private verificationEngine;
    private resilienceEngine;
    private auditLog;
    constructor(agentManager: AgentManager);
    private registerAgentProfiles;
    assessDelegation(from: AgentId, to: AgentId, taskDescription: string, requiredCapabilities: string[]): {
        capabilityScore: number;
        riskLevel: RiskLevel;
        riskFactors: string[];
    };
    createDelegationRequest(params: {
        from: AgentId;
        to: AgentId;
        taskId: string;
        sessionId: string;
        reason: string;
        requiredCapabilities: string[];
        scope: DelegationScope;
        escalation?: Partial<EscalationConfig>;
    }): DelegationRequest;
    acceptDelegation(requestId: string): {
        request: DelegationRequest;
        token: DelegationToken;
    } | null;
    rejectDelegation(requestId: string, reason: string): DelegationRequest | null;
    revokeDelegation(tokenId: string, reason: string): boolean;
    submitVerification(params: {
        delegationTokenId: string;
        delegate: AgentId;
        verifier: AgentId;
        artifacts: string[];
        criteriaResults: CriteriaResult[];
    }): VerificationProof | null;
    verifyProof(proofId: string, passed: boolean, qualityScore: number, comments: string): VerificationProof | null;
    getTrustScore(agentId: AgentId): TrustScore | null;
    getAllTrustScores(agentId: AgentId): TrustScore[];
    getGlobalTrustScores(): TrustScore[];
    getAuditTrail(delegationId: string): DelegationAuditEntry[];
    getFullAuditTrail(filters?: {
        actor?: AgentId | 'system';
        action?: DelegationAuditAction;
        since?: string;
    }): DelegationAuditEntry[];
    getRequest(requestId: string): DelegationRequest | undefined;
    getAllRequests(filters?: {
        status?: DelegationStatus;
        from?: AgentId;
        to?: AgentId;
    }): DelegationRequest[];
    getToken(tokenId: string): DelegationToken | undefined;
    validateToken(tokenId: string): {
        valid: boolean;
        reason?: string;
    };
    getSummary(): {
        totalRequests: number;
        activeRequests: number;
        completedRequests: number;
        failedRequests: number;
        activeTokens: number;
        auditEntries: number;
        trustScoreCount: number;
    };
    private monitorActiveDelegations;
    shutdown(): void;
}
//# sourceMappingURL=viadp-engine.d.ts.map