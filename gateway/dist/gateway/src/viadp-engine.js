"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VIADPEngine = void 0;
const eventemitter3_1 = require("eventemitter3");
const uuid_1 = require("uuid");
const crypto_1 = __importDefault(require("crypto"));
const viadp_1 = require("@forge-team/viadp");
const DEFAULT_ESCALATION = {
    timeoutMinutes: 30,
    minTrustScore: 0.3,
    maxFailures: 3,
    escalateTo: 'bmad-master',
    autoEscalate: false,
};
class VIADPEngine extends eventemitter3_1.EventEmitter {
    delegationRequests = new Map();
    delegationTokens = new Map();
    verificationProofs = new Map();
    agentManager;
    monitorTimer = null;
    delegationEngine;
    trustManager;
    verificationEngine;
    resilienceEngine;
    auditLog;
    constructor(agentManager) {
        super();
        this.agentManager = agentManager;
        this.delegationEngine = new viadp_1.DelegationEngine();
        this.trustManager = new viadp_1.TrustManager();
        this.verificationEngine = new viadp_1.VerificationEngine();
        this.resilienceEngine = new viadp_1.ResilienceEngine();
        this.auditLog = new viadp_1.AuditLog();
        this.registerAgentProfiles();
        this.monitorTimer = setInterval(() => this.monitorActiveDelegations(), 60_000);
    }
    registerAgentProfiles() {
        const agents = this.agentManager.getAllConfigs();
        for (const agent of agents) {
            this.delegationEngine.registerAgent({
                id: agent.id,
                capabilities: agent.capabilities,
                modelFamily: agent.defaultModelTier ?? 'balanced',
                costPerToken: 0.001,
                avgResponseTime: 5000,
                trustScore: 0.5,
                currentLoad: 0,
                maxConcurrentTasks: agent.maxConcurrentTasks,
                status: 'idle',
            });
            this.trustManager.initializeTrust(agent.id);
        }
    }
    assessDelegation(from, to, taskDescription, requiredCapabilities) {
        const score = this.delegationEngine.assessCapability(to, requiredCapabilities);
        const riskFactors = [];
        if (!this.resilienceEngine.isAgentAvailable(to))
            riskFactors.push('Circuit breaker open');
        const trustScore = this.trustManager.getTrustScore(to);
        if (trustScore && trustScore.score < 0.3)
            riskFactors.push('Low trust score');
        let riskLevel = 'low';
        if (score.overallScore < 0.3 || riskFactors.length >= 3)
            riskLevel = 'critical';
        else if (score.overallScore < 0.5 || riskFactors.length >= 2)
            riskLevel = 'high';
        else if (score.overallScore < 0.7 || riskFactors.length >= 1)
            riskLevel = 'medium';
        return { capabilityScore: score.overallScore, riskLevel, riskFactors };
    }
    createDelegationRequest(params) {
        const assessment = this.assessDelegation(params.from, params.to, params.reason, params.requiredCapabilities);
        const now = new Date().toISOString();
        const request = {
            id: (0, uuid_1.v4)(),
            from: params.from,
            to: params.to,
            taskId: params.taskId,
            sessionId: params.sessionId,
            status: 'pending',
            reason: params.reason,
            capabilityScore: assessment.capabilityScore,
            riskLevel: assessment.riskLevel,
            riskFactors: assessment.riskFactors,
            proposedScope: params.scope,
            checkpoints: [],
            escalation: { ...DEFAULT_ESCALATION, ...params.escalation },
            tokenId: null,
            createdAt: now,
            respondedAt: null,
            completedAt: null,
        };
        this.delegationRequests.set(request.id, request);
        this.auditLog.log({ type: 'delegation.requested', delegationId: request.id, from: params.from, to: params.to, action: 'request.created', data: { reason: params.reason } });
        this.emit('delegation:requested', request);
        return request;
    }
    acceptDelegation(requestId) {
        const request = this.delegationRequests.get(requestId);
        if (!request || request.status !== 'pending')
            return null;
        const now = new Date().toISOString();
        const token = {
            id: (0, uuid_1.v4)(),
            delegator: request.from,
            delegate: request.to,
            taskId: request.taskId,
            sessionId: request.sessionId,
            scope: request.proposedScope,
            issuedAt: now,
            expiresAt: new Date(Date.now() + request.escalation.timeoutMinutes * 60_000).toISOString(),
            revoked: false,
            signature: crypto_1.default.createHash('sha256').update(`${request.id}:${request.from}:${request.to}:${now}`).digest('hex'),
            chain: [request.from, request.to],
            maxChainDepth: 3,
        };
        this.delegationTokens.set(token.id, token);
        request.status = 'accepted';
        request.tokenId = token.id;
        request.respondedAt = now;
        this.resilienceEngine.recordSuccess(request.to);
        this.auditLog.log({ type: 'delegation.accepted', delegationId: request.id, from: request.from, to: request.to, action: 'request.accepted', data: { tokenId: token.id } });
        this.emit('delegation:accepted', request, token);
        return { request, token };
    }
    rejectDelegation(requestId, reason) {
        const request = this.delegationRequests.get(requestId);
        if (!request || request.status !== 'pending')
            return null;
        request.status = 'rejected';
        request.respondedAt = new Date().toISOString();
        this.emit('delegation:rejected', request, reason);
        return request;
    }
    revokeDelegation(tokenId, reason) {
        const token = this.delegationTokens.get(tokenId);
        if (!token || token.revoked)
            return false;
        token.revoked = true;
        this.emit('delegation:revoked', tokenId, reason);
        return true;
    }
    submitVerification(params) {
        const token = this.delegationTokens.get(params.delegationTokenId);
        if (!token || token.revoked)
            return null;
        const proof = {
            id: (0, uuid_1.v4)(),
            delegationTokenId: params.delegationTokenId,
            delegate: params.delegate,
            verifier: params.verifier,
            status: 'pending',
            artifacts: params.artifacts,
            criteriaResults: params.criteriaResults,
            qualityScore: null,
            comments: '',
            submittedAt: new Date().toISOString(),
            verifiedAt: null,
        };
        this.verificationProofs.set(proof.id, proof);
        this.emit('verification:submitted', proof);
        return proof;
    }
    verifyProof(proofId, passed, qualityScore, comments) {
        const proof = this.verificationProofs.get(proofId);
        if (!proof || proof.status !== 'pending')
            return null;
        proof.status = passed ? 'verified' : 'rejected';
        proof.qualityScore = Math.max(0, Math.min(1, qualityScore));
        proof.comments = comments;
        proof.verifiedAt = new Date().toISOString();
        const token = this.delegationTokens.get(proof.delegationTokenId);
        if (token) {
            for (const request of this.delegationRequests.values()) {
                if (request.tokenId === token.id) {
                    request.status = passed ? 'completed' : 'failed';
                    request.completedAt = proof.verifiedAt;
                    this.trustManager.updateTrust(request.to, passed ? 'success' : 'failure', qualityScore, request.id);
                    if (passed) {
                        this.resilienceEngine.recordSuccess(request.to);
                        this.emit('delegation:completed', request, proof);
                    }
                    else {
                        this.resilienceEngine.recordFailure(request.to);
                        this.emit('delegation:failed', request, comments);
                    }
                    break;
                }
            }
        }
        this.emit(passed ? 'verification:passed' : 'verification:failed', proof);
        return proof;
    }
    getTrustScore(agentId) {
        const ts = this.trustManager.getTrustScore(agentId);
        if (!ts)
            return null;
        return { agentId, evaluator: 'system', score: ts.score, successes: ts.successes, failures: ts.failures, alpha: ts.alpha, beta: ts.beta, domainScores: ts.domainScores, lastUpdated: ts.lastUpdated.toISOString(), history: [] };
    }
    getAllTrustScores(agentId) {
        const ts = this.getTrustScore(agentId);
        return ts ? [ts] : [];
    }
    getGlobalTrustScores() {
        return this.trustManager.exportScores().map(ts => ({ agentId: ts.agentId, evaluator: 'system', score: ts.score, successes: ts.successes, failures: ts.failures, alpha: ts.alpha, beta: ts.beta, domainScores: ts.domainScores, lastUpdated: ts.lastUpdated.toISOString(), history: [] }));
    }
    getAuditTrail(delegationId) {
        return this.auditLog.getLog({ delegationId }).map(e => ({ id: e.id, timestamp: e.timestamp.toISOString(), delegationId: e.delegationId, action: e.action, actor: e.from || 'system', details: e.action, metadata: e.data }));
    }
    getFullAuditTrail(filters) {
        let entries = this.auditLog.getLog().map(e => ({ id: e.id, timestamp: e.timestamp.toISOString(), delegationId: e.delegationId, action: e.action, actor: e.from || 'system', details: e.action, metadata: e.data }));
        if (filters?.actor)
            entries = entries.filter(e => e.actor === filters.actor);
        if (filters?.action)
            entries = entries.filter(e => e.action === filters.action);
        if (filters?.since) {
            const sinceTime = new Date(filters.since).getTime();
            entries = entries.filter(e => new Date(e.timestamp).getTime() >= sinceTime);
        }
        return entries;
    }
    getRequest(requestId) {
        return this.delegationRequests.get(requestId);
    }
    getAllRequests(filters) {
        let requests = Array.from(this.delegationRequests.values());
        if (filters?.status)
            requests = requests.filter(r => r.status === filters.status);
        if (filters?.from)
            requests = requests.filter(r => r.from === filters.from);
        if (filters?.to)
            requests = requests.filter(r => r.to === filters.to);
        return requests;
    }
    getToken(tokenId) {
        return this.delegationTokens.get(tokenId);
    }
    validateToken(tokenId) {
        const token = this.delegationTokens.get(tokenId);
        if (!token)
            return { valid: false, reason: 'Token not found' };
        if (token.revoked)
            return { valid: false, reason: 'Token revoked' };
        if (new Date(token.expiresAt).getTime() < Date.now())
            return { valid: false, reason: 'Token expired' };
        return { valid: true };
    }
    getSummary() {
        const requests = Array.from(this.delegationRequests.values());
        return {
            totalRequests: requests.length,
            activeRequests: requests.filter(r => r.status === 'pending' || r.status === 'accepted' || r.status === 'in-progress').length,
            completedRequests: requests.filter(r => r.status === 'completed').length,
            failedRequests: requests.filter(r => r.status === 'failed' || r.status === 'escalated').length,
            activeTokens: Array.from(this.delegationTokens.values()).filter(t => !t.revoked).length,
            auditEntries: this.auditLog.getEntryCount(),
            trustScoreCount: this.trustManager.exportScores().length,
        };
    }
    monitorActiveDelegations() {
        const now = Date.now();
        for (const request of this.delegationRequests.values()) {
            if (request.status !== 'in-progress' && request.status !== 'accepted')
                continue;
            if (request.tokenId) {
                const token = this.delegationTokens.get(request.tokenId);
                if (token && !token.revoked && new Date(token.expiresAt).getTime() < now) {
                    request.status = 'escalated';
                    this.emit('delegation:escalated', request, request.escalation.escalateTo);
                }
            }
        }
    }
    shutdown() {
        if (this.monitorTimer) {
            clearInterval(this.monitorTimer);
            this.monitorTimer = null;
        }
    }
}
exports.VIADPEngine = VIADPEngine;
//# sourceMappingURL=viadp-engine.js.map