"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VIADPEngine = void 0;
const eventemitter3_1 = require("eventemitter3");
const uuid_1 = require("uuid");
const crypto_1 = __importDefault(require("crypto"));
// ---------------------------------------------------------------------------
// Default escalation config
// ---------------------------------------------------------------------------
const DEFAULT_ESCALATION = {
    timeoutMinutes: 30,
    minTrustScore: 0.3,
    maxFailures: 3,
    escalateTo: 'bmad-master',
    autoEscalate: false,
};
// ---------------------------------------------------------------------------
// VIADP Engine
// ---------------------------------------------------------------------------
class VIADPEngine extends eventemitter3_1.EventEmitter {
    delegationRequests = new Map();
    delegationTokens = new Map();
    verificationProofs = new Map();
    trustScores = new Map(); // key: "evaluator:agentId"
    auditTrail = [];
    agentManager;
    /** Timer for monitoring active delegations */
    monitorTimer = null;
    constructor(agentManager) {
        super();
        this.agentManager = agentManager;
        this.initializeTrustScores();
        // Monitor active delegations every 60 seconds
        this.monitorTimer = setInterval(() => this.monitorActiveDelegations(), 60_000);
    }
    // =========================================================================
    // Trust Score Initialization
    // =========================================================================
    /**
     * Initializes trust scores for all agents with uniform prior (Beta(2,2)).
     * This gives a starting score of 0.5 with moderate confidence.
     */
    initializeTrustScores() {
        const agents = this.agentManager.getAllConfigs();
        for (const agent of agents) {
            const key = `system:${agent.id}`;
            if (!this.trustScores.has(key)) {
                this.trustScores.set(key, {
                    agentId: agent.id,
                    evaluator: 'system',
                    score: 0.5,
                    successes: 0,
                    failures: 0,
                    alpha: 2,
                    beta: 2,
                    domainScores: {},
                    lastUpdated: new Date().toISOString(),
                    history: [],
                });
            }
        }
    }
    // =========================================================================
    // Pre-Delegation Assessment
    // =========================================================================
    /**
     * Assesses whether an agent is capable of handling a delegation.
     * Returns a capability score [0.0, 1.0] and risk assessment.
     */
    assessDelegation(from, to, taskDescription, requiredCapabilities) {
        const toConfig = this.agentManager.getConfig(to);
        const toState = this.agentManager.getState(to);
        const riskFactors = [];
        if (!toConfig || !toState) {
            return { capabilityScore: 0, riskLevel: 'critical', riskFactors: ['Agent not found'] };
        }
        // 1. Capability matching
        let matchedCapabilities = 0;
        for (const cap of requiredCapabilities) {
            if (toConfig.capabilities.includes(cap)) {
                matchedCapabilities++;
            }
        }
        const capabilityRatio = requiredCapabilities.length > 0
            ? matchedCapabilities / requiredCapabilities.length
            : 0.5;
        // 2. Trust score factor
        const trustScore = this.getTrustScore(to, from);
        const trustFactor = trustScore?.score ?? 0.5;
        // 3. Availability factor
        let availabilityFactor = 1.0;
        if (toState.status === 'working') {
            availabilityFactor = 0.5;
            riskFactors.push('Agent is currently working on another task');
        }
        if (toState.status === 'blocked' || toState.status === 'error') {
            availabilityFactor = 0.1;
            riskFactors.push(`Agent is ${toState.status}`);
        }
        if (toState.status === 'offline') {
            availabilityFactor = 0;
            riskFactors.push('Agent is offline');
        }
        // 4. Delegation permission check
        if (!this.agentManager.canDelegate(from, to)) {
            riskFactors.push(`${from} is not authorized to delegate to ${to}`);
            availabilityFactor *= 0.3;
        }
        // 5. Failure history
        if (toState.tasksFailed > 3) {
            riskFactors.push(`Agent has ${toState.tasksFailed} recent failures`);
        }
        // Weighted composite score
        const capabilityScore = Math.min(1.0, capabilityRatio * 0.4 + trustFactor * 0.3 + availabilityFactor * 0.3);
        // Risk level determination
        let riskLevel = 'low';
        if (capabilityScore < 0.3 || riskFactors.length >= 3)
            riskLevel = 'critical';
        else if (capabilityScore < 0.5 || riskFactors.length >= 2)
            riskLevel = 'high';
        else if (capabilityScore < 0.7 || riskFactors.length >= 1)
            riskLevel = 'medium';
        return { capabilityScore, riskLevel, riskFactors };
    }
    // =========================================================================
    // Delegation Request/Response Protocol
    // =========================================================================
    /**
     * Creates a new delegation request from one agent to another.
     */
    createDelegationRequest(params) {
        // Run pre-delegation assessment
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
            checkpoints: (params.checkpoints ?? []).map((cp) => ({
                ...cp,
                id: (0, uuid_1.v4)(),
                completedAt: null,
                passed: null,
                metrics: {},
            })),
            escalation: {
                ...DEFAULT_ESCALATION,
                ...params.escalation,
            },
            tokenId: null,
            createdAt: now,
            respondedAt: null,
            completedAt: null,
        };
        this.delegationRequests.set(request.id, request);
        this.addAuditEntry(request.id, 'request.created', params.from, `Delegation requested from ${params.from} to ${params.to} for task ${params.taskId}`);
        this.emit('delegation:requested', request);
        return request;
    }
    /**
     * Accepts a delegation request, issuing a delegation token.
     */
    acceptDelegation(requestId) {
        const request = this.delegationRequests.get(requestId);
        if (!request || request.status !== 'pending')
            return null;
        const now = new Date().toISOString();
        // Issue delegation token
        const token = {
            id: (0, uuid_1.v4)(),
            delegator: request.from,
            delegate: request.to,
            taskId: request.taskId,
            sessionId: request.sessionId,
            scope: request.proposedScope,
            issuedAt: now,
            expiresAt: new Date(Date.now() + request.escalation.timeoutMinutes * 60 * 1000).toISOString(),
            revoked: false,
            signature: this.generateSignature(request),
            chain: [request.from, request.to],
            maxChainDepth: 3,
        };
        this.delegationTokens.set(token.id, token);
        // Update request
        request.status = 'accepted';
        request.tokenId = token.id;
        request.respondedAt = now;
        this.addAuditEntry(request.id, 'request.accepted', request.to, `Delegation accepted by ${request.to}`);
        this.addAuditEntry(request.id, 'token.issued', 'system', `Token ${token.id} issued`);
        this.emit('delegation:accepted', request, token);
        return { request, token };
    }
    /**
     * Rejects a delegation request.
     */
    rejectDelegation(requestId, reason) {
        const request = this.delegationRequests.get(requestId);
        if (!request || request.status !== 'pending')
            return null;
        request.status = 'rejected';
        request.respondedAt = new Date().toISOString();
        this.addAuditEntry(request.id, 'request.rejected', request.to, `Delegation rejected: ${reason}`);
        this.emit('delegation:rejected', request, reason);
        return request;
    }
    /**
     * Revokes an active delegation token.
     */
    revokeDelegation(tokenId, reason) {
        const token = this.delegationTokens.get(tokenId);
        if (!token || token.revoked)
            return false;
        token.revoked = true;
        // Find and update the corresponding request
        for (const request of this.delegationRequests.values()) {
            if (request.tokenId === tokenId) {
                request.status = 'revoked';
                this.addAuditEntry(request.id, 'token.revoked', token.delegator, `Token revoked: ${reason}`);
                break;
            }
        }
        this.emit('delegation:revoked', tokenId, reason);
        return true;
    }
    // =========================================================================
    // Task Monitoring with Checkpoints
    // =========================================================================
    /**
     * Records that a checkpoint has been reached for an active delegation.
     */
    recordCheckpoint(requestId, checkpointId, passed, metrics) {
        const request = this.delegationRequests.get(requestId);
        if (!request)
            return false;
        const checkpoint = request.checkpoints.find((cp) => cp.id === checkpointId);
        if (!checkpoint)
            return false;
        checkpoint.completedAt = new Date().toISOString();
        checkpoint.passed = passed;
        if (metrics)
            checkpoint.metrics = metrics;
        if (passed) {
            this.addAuditEntry(requestId, 'checkpoint.reached', request.to, `Checkpoint "${checkpoint.name}" passed`);
            this.emit('checkpoint:reached', requestId, checkpoint);
        }
        else {
            this.addAuditEntry(requestId, 'checkpoint.failed', request.to, `Checkpoint "${checkpoint.name}" failed`);
            this.emit('checkpoint:failed', requestId, checkpoint);
            // Check if we should escalate
            const failedCheckpoints = request.checkpoints.filter((cp) => cp.passed === false).length;
            if (failedCheckpoints >= request.escalation.maxFailures) {
                this.triggerEscalation(request, `${failedCheckpoints} checkpoints failed`);
            }
        }
        return true;
    }
    /**
     * Starts the delegation (transitions from accepted to in-progress).
     */
    startDelegation(requestId) {
        const request = this.delegationRequests.get(requestId);
        if (!request || request.status !== 'accepted')
            return false;
        request.status = 'in-progress';
        return true;
    }
    // =========================================================================
    // Verification on Completion
    // =========================================================================
    /**
     * Submits work for verification after a delegation completes.
     */
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
        // Find the request for audit
        for (const request of this.delegationRequests.values()) {
            if (request.tokenId === params.delegationTokenId) {
                this.addAuditEntry(request.id, 'work.submitted', params.delegate, `Work submitted for verification`);
                break;
            }
        }
        this.emit('verification:submitted', proof);
        return proof;
    }
    /**
     * Verifies a submitted proof, calculating quality score.
     */
    verifyProof(proofId, passed, qualityScore, comments) {
        const proof = this.verificationProofs.get(proofId);
        if (!proof || proof.status !== 'pending')
            return null;
        proof.status = passed ? 'verified' : 'rejected';
        proof.qualityScore = Math.max(0, Math.min(1, qualityScore));
        proof.comments = comments;
        proof.verifiedAt = new Date().toISOString();
        // Update the delegation request
        const token = this.delegationTokens.get(proof.delegationTokenId);
        if (token) {
            for (const request of this.delegationRequests.values()) {
                if (request.tokenId === token.id) {
                    if (passed) {
                        request.status = 'completed';
                        request.completedAt = proof.verifiedAt;
                        this.addAuditEntry(request.id, 'verification.passed', proof.verifier, `Verification passed with quality score ${qualityScore.toFixed(2)}`);
                        this.emit('delegation:completed', request, proof);
                    }
                    else {
                        request.status = 'failed';
                        request.completedAt = proof.verifiedAt;
                        this.addAuditEntry(request.id, 'verification.failed', proof.verifier, `Verification failed: ${comments}`);
                        this.emit('delegation:failed', request, comments);
                    }
                    // Update trust scores based on outcome
                    this.updateTrustScore(request.to, request.from, passed, qualityScore, request.id);
                    break;
                }
            }
        }
        if (passed) {
            this.emit('verification:passed', proof);
        }
        else {
            this.emit('verification:failed', proof);
        }
        return proof;
    }
    // =========================================================================
    // Trust Score Tracking (Bayesian Updates)
    // =========================================================================
    /**
     * Returns the trust score between two agents.
     */
    getTrustScore(agentId, evaluator = 'system') {
        const key = `${evaluator}:${agentId}`;
        return this.trustScores.get(key) ?? null;
    }
    /**
     * Returns all trust scores for a given agent.
     */
    getAllTrustScores(agentId) {
        const scores = [];
        for (const [key, score] of this.trustScores) {
            if (score.agentId === agentId) {
                scores.push(score);
            }
        }
        return scores;
    }
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
    updateTrustScore(agentId, evaluator, success, qualityScore, delegationId) {
        const key = `${evaluator}:${agentId}`;
        let trustScore = this.trustScores.get(key);
        if (!trustScore) {
            trustScore = {
                agentId,
                evaluator,
                score: 0.5,
                successes: 0,
                failures: 0,
                alpha: 2,
                beta: 2,
                domainScores: {},
                lastUpdated: new Date().toISOString(),
                history: [],
            };
            this.trustScores.set(key, trustScore);
        }
        const previousScore = trustScore.score;
        // Weight based on quality: higher quality = more impact
        const weight = 0.5 + qualityScore * 0.5; // Range: [0.5, 1.0]
        if (success) {
            trustScore.alpha += weight;
            trustScore.successes += 1;
        }
        else {
            trustScore.beta += weight;
            trustScore.failures += 1;
        }
        // New score is the expected value of the Beta distribution
        trustScore.score = trustScore.alpha / (trustScore.alpha + trustScore.beta);
        trustScore.lastUpdated = new Date().toISOString();
        // Record history
        const change = {
            timestamp: trustScore.lastUpdated,
            previousScore,
            newScore: trustScore.score,
            reason: success
                ? `Delegation completed successfully (quality: ${qualityScore.toFixed(2)})`
                : `Delegation failed (quality: ${qualityScore.toFixed(2)})`,
            delegationId,
        };
        trustScore.history.push(change);
        // Keep only last 100 history entries
        if (trustScore.history.length > 100) {
            trustScore.history = trustScore.history.slice(-100);
        }
        // Also update the system-level trust score
        if (evaluator !== 'system') {
            this.updateTrustScore(agentId, 'system', success, qualityScore, delegationId);
        }
        // Find the delegation request for audit
        for (const request of this.delegationRequests.values()) {
            if (request.id === delegationId) {
                this.addAuditEntry(delegationId, 'trust.updated', evaluator, `Trust score updated: ${previousScore.toFixed(3)} -> ${trustScore.score.toFixed(3)}`);
                break;
            }
        }
        this.emit('trust:updated', agentId, trustScore);
    }
    // =========================================================================
    // Escalation
    // =========================================================================
    /**
     * Triggers escalation for a delegation that is failing or timing out.
     */
    triggerEscalation(request, reason) {
        request.status = 'escalated';
        const escalateTo = request.escalation.escalateTo;
        this.addAuditEntry(request.id, 'escalation.triggered', 'system', `Escalated to ${escalateTo}: ${reason}`);
        this.emit('delegation:escalated', request, escalateTo);
        // If we have a token, revoke it
        if (request.tokenId) {
            this.revokeDelegation(request.tokenId, `Escalated: ${reason}`);
        }
    }
    // =========================================================================
    // Active Delegation Monitoring
    // =========================================================================
    /**
     * Monitors all active delegations for timeouts and trust thresholds.
     * Called periodically by the monitor timer.
     */
    monitorActiveDelegations() {
        const now = Date.now();
        for (const request of this.delegationRequests.values()) {
            if (request.status !== 'in-progress' && request.status !== 'accepted')
                continue;
            // Check timeout
            if (request.tokenId) {
                const token = this.delegationTokens.get(request.tokenId);
                if (token && !token.revoked) {
                    const expiresAt = new Date(token.expiresAt).getTime();
                    if (now > expiresAt) {
                        this.triggerEscalation(request, 'Delegation timed out');
                        continue;
                    }
                }
            }
            // Check trust score threshold
            const trustScore = this.getTrustScore(request.to, request.from);
            if (trustScore && trustScore.score < request.escalation.minTrustScore) {
                this.triggerEscalation(request, `Trust score (${trustScore.score.toFixed(3)}) below threshold (${request.escalation.minTrustScore})`);
            }
        }
    }
    // =========================================================================
    // Audit Trail
    // =========================================================================
    /**
     * Adds an entry to the delegation audit trail.
     */
    addAuditEntry(delegationId, action, actor, details, metadata = {}) {
        const entry = {
            id: (0, uuid_1.v4)(),
            timestamp: new Date().toISOString(),
            delegationId,
            action,
            actor,
            details,
            metadata,
        };
        this.auditTrail.push(entry);
        this.emit('audit:entry', entry);
    }
    /**
     * Returns the audit trail for a specific delegation.
     */
    getAuditTrail(delegationId) {
        return this.auditTrail.filter((e) => e.delegationId === delegationId);
    }
    /**
     * Returns the full audit trail (optionally filtered).
     */
    getFullAuditTrail(filters) {
        let entries = this.auditTrail;
        if (filters?.actor) {
            entries = entries.filter((e) => e.actor === filters.actor);
        }
        if (filters?.action) {
            entries = entries.filter((e) => e.action === filters.action);
        }
        if (filters?.since) {
            const sinceTime = new Date(filters.since).getTime();
            entries = entries.filter((e) => new Date(e.timestamp).getTime() >= sinceTime);
        }
        return entries;
    }
    // =========================================================================
    // Query Methods
    // =========================================================================
    /**
     * Returns a delegation request by ID.
     */
    getRequest(requestId) {
        return this.delegationRequests.get(requestId);
    }
    /**
     * Returns all delegation requests (optionally filtered).
     */
    getAllRequests(filters) {
        let requests = Array.from(this.delegationRequests.values());
        if (filters?.status)
            requests = requests.filter((r) => r.status === filters.status);
        if (filters?.from)
            requests = requests.filter((r) => r.from === filters.from);
        if (filters?.to)
            requests = requests.filter((r) => r.to === filters.to);
        if (filters?.sessionId)
            requests = requests.filter((r) => r.sessionId === filters.sessionId);
        return requests;
    }
    /**
     * Returns a delegation token by ID.
     */
    getToken(tokenId) {
        return this.delegationTokens.get(tokenId);
    }
    /**
     * Validates a delegation token (checks expiry and revocation).
     */
    validateToken(tokenId) {
        const token = this.delegationTokens.get(tokenId);
        if (!token)
            return { valid: false, reason: 'Token not found' };
        if (token.revoked)
            return { valid: false, reason: 'Token has been revoked' };
        if (new Date(token.expiresAt).getTime() < Date.now()) {
            return { valid: false, reason: 'Token has expired' };
        }
        return { valid: true };
    }
    /**
     * Returns a verification proof by ID.
     */
    getProof(proofId) {
        return this.verificationProofs.get(proofId);
    }
    // =========================================================================
    // Utilities
    // =========================================================================
    /**
     * Generates a cryptographic signature for a delegation request.
     */
    generateSignature(request) {
        const data = `${request.id}:${request.from}:${request.to}:${request.taskId}:${request.createdAt}`;
        return crypto_1.default.createHash('sha256').update(data).digest('hex');
    }
    /**
     * Returns a summary of the VIADP engine state.
     */
    getSummary() {
        const requests = Array.from(this.delegationRequests.values());
        return {
            totalRequests: requests.length,
            activeRequests: requests.filter((r) => r.status === 'pending' || r.status === 'accepted' || r.status === 'in-progress').length,
            completedRequests: requests.filter((r) => r.status === 'completed').length,
            failedRequests: requests.filter((r) => r.status === 'failed' || r.status === 'escalated').length,
            activeTokens: Array.from(this.delegationTokens.values()).filter((t) => !t.revoked).length,
            auditEntries: this.auditTrail.length,
            trustScoreCount: this.trustScores.size,
        };
    }
    /**
     * Shuts down the VIADP engine.
     */
    shutdown() {
        if (this.monitorTimer) {
            clearInterval(this.monitorTimer);
            this.monitorTimer = null;
        }
    }
}
exports.VIADPEngine = VIADPEngine;
//# sourceMappingURL=viadp-engine.js.map