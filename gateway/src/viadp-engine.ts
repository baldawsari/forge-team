import { EventEmitter } from 'eventemitter3';
import { v4 as uuid } from 'uuid';
import crypto from 'crypto';
import {
  DelegationEngine,
  TrustManager,
  VerificationEngine,
  ResilienceEngine,
  AuditLog,
} from '@forge-team/viadp';
import type {
  AgentId, DelegationToken, DelegationScope, TrustScore,
  VerificationProof, CriteriaResult, DelegationRequest,
  DelegationStatus, DelegationCheckpoint, EscalationConfig,
  DelegationAuditEntry, DelegationAuditAction, RiskLevel,
} from '@forge-team/shared';
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

const DEFAULT_ESCALATION: EscalationConfig = {
  timeoutMinutes: 30, minTrustScore: 0.3, maxFailures: 3,
  escalateTo: 'bmad-master', autoEscalate: false,
};

export class VIADPEngine extends EventEmitter<VIADPEvents> {
  private requests = new Map<string, DelegationRequest>();
  private tokens = new Map<string, DelegationToken>();
  private proofs = new Map<string, VerificationProof>();
  private monitorTimer: ReturnType<typeof setInterval> | null = null;
  private readonly delegation: DelegationEngine;
  private readonly trust: TrustManager;
  private readonly verification: VerificationEngine;
  private readonly resilience: ResilienceEngine;
  private readonly audit: AuditLog;
  private readonly agentManager: AgentManager;

  constructor(agentManager: AgentManager) {
    super();
    this.agentManager = agentManager;
    this.delegation = new DelegationEngine();
    this.trust = new TrustManager();
    this.verification = new VerificationEngine();
    this.resilience = new ResilienceEngine();
    this.audit = new AuditLog();
    for (const a of this.agentManager.getAllConfigs()) {
      this.delegation.registerAgent({
        id: a.id, capabilities: a.capabilities,
        modelFamily: ((a as unknown as Record<string, unknown>).defaultModelTier as string) ?? 'balanced',
        costPerToken: 0.001, avgResponseTime: 5000, trustScore: 0.5,
        currentLoad: 0, maxConcurrentTasks: a.maxConcurrentTasks, status: 'idle',
      });
      this.trust.initializeTrust(a.id);
    }
    this.monitorTimer = setInterval(() => this.monitor(), 60_000);
  }

  assessDelegation(from: AgentId, to: AgentId, _desc: string, caps: string[]) {
    const s = this.delegation.assessCapability(to, caps);
    const f: string[] = [];
    if (!this.resilience.isAgentAvailable(to)) f.push('Circuit breaker open');
    const ts = this.trust.getTrustScore(to);
    if (ts && ts.score < 0.3) f.push('Low trust score');
    const riskLevel: RiskLevel = s.overallScore < 0.3 || f.length >= 3 ? 'critical'
      : s.overallScore < 0.5 || f.length >= 2 ? 'high'
      : s.overallScore < 0.7 || f.length >= 1 ? 'medium' : 'low';
    return { capabilityScore: s.overallScore, riskLevel, riskFactors: f };
  }

  createDelegationRequest(params: {
    from: AgentId; to: AgentId; taskId: string; sessionId: string;
    reason: string; requiredCapabilities: string[];
    scope: DelegationScope; escalation?: Partial<EscalationConfig>;
  }): DelegationRequest {
    const a = this.assessDelegation(params.from, params.to, params.reason, params.requiredCapabilities);
    const now = new Date().toISOString();
    const req: DelegationRequest = {
      id: uuid(), from: params.from, to: params.to, taskId: params.taskId,
      sessionId: params.sessionId, status: 'pending', reason: params.reason,
      capabilityScore: a.capabilityScore, riskLevel: a.riskLevel, riskFactors: a.riskFactors,
      proposedScope: params.scope, checkpoints: [],
      escalation: { ...DEFAULT_ESCALATION, ...params.escalation },
      tokenId: null, createdAt: now, respondedAt: null, completedAt: null,
    };
    this.requests.set(req.id, req);
    this.audit.log({ type: 'delegation.requested', delegationId: req.id, from: params.from, to: params.to, action: 'request.created', data: { reason: params.reason } });
    this.emit('delegation:requested', req);
    return req;
  }

  acceptDelegation(requestId: string): { request: DelegationRequest; token: DelegationToken } | null {
    const req = this.requests.get(requestId);
    if (!req || req.status !== 'pending') return null;
    const now = new Date().toISOString();
    const token: DelegationToken = {
      id: uuid(), delegator: req.from, delegate: req.to, taskId: req.taskId,
      sessionId: req.sessionId, scope: req.proposedScope, issuedAt: now,
      expiresAt: new Date(Date.now() + req.escalation.timeoutMinutes * 60_000).toISOString(),
      revoked: false, chain: [req.from, req.to], maxChainDepth: 3,
      signature: crypto.createHash('sha256').update(`${req.id}:${req.from}:${req.to}:${now}`).digest('hex'),
    };
    this.tokens.set(token.id, token);
    req.status = 'accepted'; req.tokenId = token.id; req.respondedAt = now;
    this.resilience.recordSuccess(req.to);
    this.audit.log({ type: 'delegation.accepted', delegationId: req.id, from: req.from, to: req.to, action: 'request.accepted', data: { tokenId: token.id } });
    this.emit('delegation:accepted', req, token);
    return { request: req, token };
  }
  rejectDelegation(id: string, reason: string): DelegationRequest | null {
    const req = this.requests.get(id);
    if (!req || req.status !== 'pending') return null;
    req.status = 'rejected'; req.respondedAt = new Date().toISOString();
    this.emit('delegation:rejected', req, reason);
    return req;
  }
  revokeDelegation(tokenId: string, reason: string): boolean {
    const t = this.tokens.get(tokenId);
    if (!t || t.revoked) return false;
    t.revoked = true; this.emit('delegation:revoked', tokenId, reason);
    return true;
  }

  submitVerification(p: {
    delegationTokenId: string; delegate: AgentId; verifier: AgentId;
    artifacts: string[]; criteriaResults: CriteriaResult[];
  }): VerificationProof | null {
    const t = this.tokens.get(p.delegationTokenId);
    if (!t || t.revoked) return null;
    const proof: VerificationProof = {
      id: uuid(), delegationTokenId: p.delegationTokenId, delegate: p.delegate,
      verifier: p.verifier, status: 'pending', artifacts: p.artifacts,
      criteriaResults: p.criteriaResults, qualityScore: null, comments: '',
      submittedAt: new Date().toISOString(), verifiedAt: null,
    };
    this.proofs.set(proof.id, proof);
    this.emit('verification:submitted', proof);
    return proof;
  }

  verifyProof(proofId: string, passed: boolean, quality: number, comments: string): VerificationProof | null {
    const proof = this.proofs.get(proofId);
    if (!proof || proof.status !== 'pending') return null;
    proof.status = passed ? 'verified' : 'rejected';
    proof.qualityScore = Math.max(0, Math.min(1, quality));
    proof.comments = comments; proof.verifiedAt = new Date().toISOString();
    const token = this.tokens.get(proof.delegationTokenId);
    if (token) {
      for (const req of this.requests.values()) {
        if (req.tokenId !== token.id) continue;
        req.status = passed ? 'completed' : 'failed'; req.completedAt = proof.verifiedAt;
        this.trust.updateTrust(req.to, passed ? 'success' : 'failure', quality, req.id);
        if (passed) { this.resilience.recordSuccess(req.to); this.emit('delegation:completed', req, proof); }
        else { this.resilience.recordFailure(req.to); this.emit('delegation:failed', req, comments); }
        break;
      }
    }
    this.emit(passed ? 'verification:passed' : 'verification:failed', proof);
    return proof;
  }
  getTrustScore(agentId: AgentId): TrustScore | null {
    const ts = this.trust.getTrustScore(agentId);
    if (!ts) return null;
    return { agentId, evaluator: 'system', score: ts.score, successes: ts.successes, failures: ts.failures, alpha: ts.alpha, beta: ts.beta, domainScores: ts.domainScores, lastUpdated: ts.lastUpdated.toISOString(), history: [] };
  }
  getAllTrustScores(agentId: AgentId): TrustScore[] {
    const ts = this.getTrustScore(agentId); return ts ? [ts] : [];
  }
  getGlobalTrustScores(): TrustScore[] {
    return this.trust.exportScores().map(ts => ({
      agentId: ts.agentId as AgentId, evaluator: 'system' as const, score: ts.score,
      successes: ts.successes, failures: ts.failures, alpha: ts.alpha, beta: ts.beta,
      domainScores: ts.domainScores, lastUpdated: ts.lastUpdated.toISOString(), history: [],
    }));
  }

  private mapAudit(e: { id: string; timestamp: Date; delegationId: string; action: string; from: string; data: Record<string, unknown> }): DelegationAuditEntry {
    return { id: e.id, timestamp: e.timestamp.toISOString(), delegationId: e.delegationId, action: e.action as DelegationAuditAction, actor: (e.from || 'system') as AgentId | 'system', details: e.action, metadata: e.data };
  }

  getAuditTrail(delegationId: string): DelegationAuditEntry[] {
    return this.audit.getLog({ delegationId }).map(e => this.mapAudit(e));
  }
  getFullAuditTrail(filters?: { actor?: AgentId | 'system'; action?: DelegationAuditAction; since?: string }): DelegationAuditEntry[] {
    let entries = this.audit.getLog().map(e => this.mapAudit(e));
    if (filters?.actor) entries = entries.filter(e => e.actor === filters.actor);
    if (filters?.action) entries = entries.filter(e => e.action === filters.action);
    if (filters?.since) { const t = new Date(filters.since).getTime(); entries = entries.filter(e => new Date(e.timestamp).getTime() >= t); }
    return entries;
  }

  getRequest(id: string) { return this.requests.get(id); }
  getToken(id: string) { return this.tokens.get(id); }
  getAllRequests(filters?: { status?: DelegationStatus; from?: AgentId; to?: AgentId }): DelegationRequest[] {
    let arr = Array.from(this.requests.values());
    if (filters?.status) arr = arr.filter(r => r.status === filters.status);
    if (filters?.from) arr = arr.filter(r => r.from === filters.from);
    if (filters?.to) arr = arr.filter(r => r.to === filters.to);
    return arr;
  }
  validateToken(tokenId: string): { valid: boolean; reason?: string } {
    const t = this.tokens.get(tokenId);
    if (!t) return { valid: false, reason: 'Token not found' };
    if (t.revoked) return { valid: false, reason: 'Token revoked' };
    if (new Date(t.expiresAt).getTime() < Date.now()) return { valid: false, reason: 'Token expired' };
    return { valid: true };
  }
  getSummary() {
    const reqs = Array.from(this.requests.values());
    return {
      totalRequests: reqs.length,
      activeRequests: reqs.filter(r => ['pending', 'accepted', 'in-progress'].includes(r.status)).length,
      completedRequests: reqs.filter(r => r.status === 'completed').length,
      failedRequests: reqs.filter(r => r.status === 'failed' || r.status === 'escalated').length,
      activeTokens: Array.from(this.tokens.values()).filter(t => !t.revoked).length,
      auditEntries: this.audit.getEntryCount(),
      trustScoreCount: this.trust.exportScores().length,
    };
  }
  private monitor(): void {
    const now = Date.now();
    for (const req of this.requests.values()) {
      if (req.status !== 'in-progress' && req.status !== 'accepted') continue;
      if (!req.tokenId) continue;
      const t = this.tokens.get(req.tokenId);
      if (t && !t.revoked && new Date(t.expiresAt).getTime() < now) {
        req.status = 'escalated';
        this.emit('delegation:escalated', req, req.escalation.escalateTo);
      }
    }
  }
  shutdown(): void {
    if (this.monitorTimer) { clearInterval(this.monitorTimer); this.monitorTimer = null; }
  }
}
