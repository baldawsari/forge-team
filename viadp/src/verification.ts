/**
 * Verification and Proofs system for the VIADP protocol.
 *
 * Manages verification requests, proof submission/validation,
 * and immutable audit trails for delegated task completion.
 */

import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VerificationPolicyType =
  | 'self_report'
  | 'peer_review'
  | 'consensus'
  | 'proof';

export interface VerificationPolicy {
  type: VerificationPolicyType;
  requiredConfidence: number;
  minReviewers?: number;
  consensusThreshold?: number;
}

export interface VerificationRequest {
  id: string;
  delegationId: string;
  policy: VerificationPolicy;
  status: 'pending' | 'in_review' | 'verified' | 'rejected';
  proofs: Proof[];
  reviewers: ReviewerAssignment[];
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  finalConfidence: number;
  finalVerdict: string;
}

export interface Proof {
  id: string;
  requestId: string;
  type: 'artifact' | 'test_result' | 'log' | 'attestation' | 'metric';
  data: Record<string, unknown>;
  attestation: ProofAttestation;
  submittedBy: string;
  submittedAt: Date;
  valid: boolean | null;
  validationDetails: string;
}

export interface ProofAttestation {
  signer: string;
  timestamp: Date;
  signature: string;
  metadata: Record<string, unknown>;
}

export interface ReviewerAssignment {
  reviewerId: string;
  assignedAt: Date;
  completedAt: Date | null;
  verdict: 'approved' | 'rejected' | 'needs_revision' | null;
  confidence: number;
  comments: string;
}

export interface AuditTrailEntry {
  id: string;
  delegationId: string;
  verificationRequestId: string;
  action: string;
  actor: string;
  timestamp: Date;
  data: Record<string, unknown>;
  previousHash: string;
  hash: string;
}

export interface VerificationResult {
  valid: boolean;
  confidence: number;
  details: string;
  proofId: string;
}

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

export const ProofSchema = z.object({
  type: z.enum(['artifact', 'test_result', 'log', 'attestation', 'metric']),
  data: z.record(z.unknown()),
  attestation: z.object({
    signer: z.string().min(1),
    timestamp: z.date(),
    signature: z.string().min(1),
    metadata: z.record(z.unknown()),
  }),
});

// ---------------------------------------------------------------------------
// Verification Engine
// ---------------------------------------------------------------------------

export class VerificationEngine {
  private requests: Map<string, VerificationRequest> = new Map();
  private auditTrail: AuditTrailEntry[] = [];
  private lastAuditHash = 'genesis';

  /**
   * Create a new verification request for a delegation.
   */
  createVerificationRequest(
    delegationId: string,
    policy: VerificationPolicy,
  ): VerificationRequest {
    const id = uuidv4();
    const now = new Date();

    const request: VerificationRequest = {
      id,
      delegationId,
      policy,
      status: 'pending',
      proofs: [],
      reviewers: [],
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      finalConfidence: 0,
      finalVerdict: '',
    };

    this.requests.set(id, request);

    // Audit trail
    this.appendAuditEntry(delegationId, id, 'verification.created', 'system', {
      policy,
    });

    return request;
  }

  /**
   * Assign a reviewer to a verification request.
   */
  assignReviewer(requestId: string, reviewerId: string): ReviewerAssignment {
    const request = this.getRequestOrThrow(requestId);

    // Prevent duplicate assignments
    const existing = request.reviewers.find(
      (r) => r.reviewerId === reviewerId,
    );
    if (existing) return existing;

    const assignment: ReviewerAssignment = {
      reviewerId,
      assignedAt: new Date(),
      completedAt: null,
      verdict: null,
      confidence: 0,
      comments: '',
    };

    request.reviewers.push(assignment);
    request.status = 'in_review';
    request.updatedAt = new Date();

    this.appendAuditEntry(
      request.delegationId,
      requestId,
      'reviewer.assigned',
      'system',
      { reviewerId },
    );

    return assignment;
  }

  /**
   * Submit a proof for a verification request.
   */
  submitProof(
    requestId: string,
    proof: {
      type: Proof['type'];
      data: Record<string, unknown>;
      attestation: ProofAttestation;
    },
  ): boolean {
    const request = this.getRequestOrThrow(requestId);

    const proofEntry: Proof = {
      id: uuidv4(),
      requestId,
      type: proof.type,
      data: proof.data,
      attestation: proof.attestation,
      submittedBy: proof.attestation.signer,
      submittedAt: new Date(),
      valid: null, // Will be set during verification
      validationDetails: '',
    };

    // Validate proof structure
    const validation = this.validateProofStructure(proofEntry);
    proofEntry.valid = validation.valid;
    proofEntry.validationDetails = validation.details;

    request.proofs.push(proofEntry);
    request.updatedAt = new Date();

    this.appendAuditEntry(
      request.delegationId,
      requestId,
      'proof.submitted',
      proof.attestation.signer,
      { proofId: proofEntry.id, type: proof.type, valid: proofEntry.valid },
    );

    // Check if we can auto-evaluate based on the policy
    this.tryAutoEvaluate(request);

    return proofEntry.valid ?? false;
  }

  /**
   * Submit a review verdict for a verification request.
   */
  submitReview(
    requestId: string,
    reviewerId: string,
    verdict: 'approved' | 'rejected' | 'needs_revision',
    confidence: number,
    comments: string,
  ): boolean {
    const request = this.getRequestOrThrow(requestId);

    const assignment = request.reviewers.find(
      (r) => r.reviewerId === reviewerId,
    );
    if (!assignment) {
      throw new Error(
        `Reviewer ${reviewerId} not assigned to request ${requestId}`,
      );
    }

    assignment.verdict = verdict;
    assignment.confidence = Math.max(0, Math.min(1, confidence));
    assignment.comments = comments;
    assignment.completedAt = new Date();
    request.updatedAt = new Date();

    this.appendAuditEntry(
      request.delegationId,
      requestId,
      'review.submitted',
      reviewerId,
      { verdict, confidence, comments },
    );

    // Check if all reviews are in
    this.tryAutoEvaluate(request);

    return true;
  }

  /**
   * Verify a submitted proof's validity.
   */
  verifyProof(proofId: string): VerificationResult {
    // Search across all requests for this proof
    for (const request of this.requests.values()) {
      const proof = request.proofs.find((p) => p.id === proofId);
      if (proof) {
        const result = this.deepVerifyProof(proof);

        // Update the proof record
        proof.valid = result.valid;
        proof.validationDetails = result.details;

        this.appendAuditEntry(
          request.delegationId,
          request.id,
          'proof.verified',
          'system',
          { proofId, valid: result.valid, confidence: result.confidence },
        );

        return result;
      }
    }

    return {
      valid: false,
      confidence: 0,
      details: `Proof ${proofId} not found`,
      proofId,
    };
  }

  /**
   * Get the full audit trail for a delegation.
   */
  getAuditTrail(delegationId: string): AuditTrailEntry[] {
    return this.auditTrail.filter((e) => e.delegationId === delegationId);
  }

  /**
   * Get a verification request by ID.
   */
  getRequest(requestId: string): VerificationRequest | null {
    return this.requests.get(requestId) ?? null;
  }

  /**
   * Get all verification requests for a delegation.
   */
  getRequestsForDelegation(delegationId: string): VerificationRequest[] {
    return Array.from(this.requests.values()).filter(
      (r) => r.delegationId === delegationId,
    );
  }

  /**
   * Verify the integrity of the audit trail hash chain.
   */
  verifyAuditIntegrity(): {
    valid: boolean;
    brokenAt: number | null;
    totalEntries: number;
  } {
    if (this.auditTrail.length === 0) {
      return { valid: true, brokenAt: null, totalEntries: 0 };
    }

    let previousHash = 'genesis';

    for (let i = 0; i < this.auditTrail.length; i++) {
      const entry = this.auditTrail[i];

      // Check previous hash reference
      if (entry.previousHash !== previousHash) {
        return {
          valid: false,
          brokenAt: i,
          totalEntries: this.auditTrail.length,
        };
      }

      // Verify the entry's own hash
      const expectedHash = this.computeHash(entry, previousHash);
      if (entry.hash !== expectedHash) {
        return {
          valid: false,
          brokenAt: i,
          totalEntries: this.auditTrail.length,
        };
      }

      previousHash = entry.hash;
    }

    return {
      valid: true,
      brokenAt: null,
      totalEntries: this.auditTrail.length,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private getRequestOrThrow(requestId: string): VerificationRequest {
    const request = this.requests.get(requestId);
    if (!request) {
      throw new Error(`Verification request ${requestId} not found`);
    }
    return request;
  }

  private validateProofStructure(proof: Proof): {
    valid: boolean;
    details: string;
  } {
    const issues: string[] = [];

    // Check attestation is present and well-formed
    if (!proof.attestation.signer) {
      issues.push('Missing attestation signer');
    }
    if (!proof.attestation.signature) {
      issues.push('Missing attestation signature');
    }
    if (!proof.attestation.timestamp) {
      issues.push('Missing attestation timestamp');
    }

    // Type-specific validation
    switch (proof.type) {
      case 'artifact':
        if (!proof.data.artifactId && !proof.data.content) {
          issues.push('Artifact proof must include artifactId or content');
        }
        break;
      case 'test_result':
        if (proof.data.passed === undefined) {
          issues.push('Test result proof must include passed status');
        }
        break;
      case 'metric':
        if (!proof.data.metricName || proof.data.value === undefined) {
          issues.push('Metric proof must include metricName and value');
        }
        break;
      case 'log':
        if (!proof.data.entries && !proof.data.logContent) {
          issues.push('Log proof must include entries or logContent');
        }
        break;
      case 'attestation':
        // Attestation-only proof is valid if the attestation itself is complete
        break;
    }

    // Check that the attestation signature is consistent
    // (In production, verify with the signer's public key)
    const sigValid = proof.attestation.signature.length > 0;
    if (!sigValid) {
      issues.push('Invalid attestation signature');
    }

    return {
      valid: issues.length === 0,
      details:
        issues.length === 0
          ? 'Proof structure valid'
          : `Invalid: ${issues.join('; ')}`,
    };
  }

  private deepVerifyProof(proof: Proof): VerificationResult {
    let confidence = 0;
    const details: string[] = [];

    // Structural validity
    const structural = this.validateProofStructure(proof);
    if (structural.valid) {
      confidence += 0.3;
      details.push('Structure: valid');
    } else {
      details.push(`Structure: ${structural.details}`);
      return {
        valid: false,
        confidence: 0,
        details: details.join(' | '),
        proofId: proof.id,
      };
    }

    // Attestation freshness (within last 24 hours)
    const ageMs = Date.now() - proof.attestation.timestamp.getTime();
    const ageHours = ageMs / (1000 * 60 * 60);
    if (ageHours <= 24) {
      confidence += 0.2;
      details.push(`Freshness: ${ageHours.toFixed(1)}h (ok)`);
    } else {
      details.push(`Freshness: ${ageHours.toFixed(1)}h (stale)`);
    }

    // Type-specific confidence
    switch (proof.type) {
      case 'test_result':
        if (proof.data.passed === true) {
          confidence += 0.3;
          const coverage = Number(proof.data.coverage ?? 0);
          if (coverage >= 80) confidence += 0.1;
          details.push(
            `Tests: passed (coverage: ${coverage}%)`,
          );
        } else {
          details.push('Tests: failed');
        }
        break;

      case 'artifact':
        confidence += 0.2;
        if (proof.data.content && String(proof.data.content).length > 100) {
          confidence += 0.1;
          details.push('Artifact: substantial content');
        } else {
          details.push('Artifact: minimal content');
        }
        break;

      case 'metric':
        confidence += 0.2;
        details.push(
          `Metric: ${proof.data.metricName}=${proof.data.value}`,
        );
        break;

      case 'log':
        confidence += 0.15;
        details.push('Log: provided');
        break;

      case 'attestation':
        confidence += 0.1;
        details.push('Attestation: signed');
        break;
    }

    // Cap confidence at 1.0
    confidence = Math.min(1.0, confidence);

    return {
      valid: confidence >= 0.5,
      confidence,
      details: details.join(' | '),
      proofId: proof.id,
    };
  }

  private tryAutoEvaluate(request: VerificationRequest): void {
    switch (request.policy.type) {
      case 'self_report':
        this.evaluateSelfReport(request);
        break;
      case 'peer_review':
        this.evaluatePeerReview(request);
        break;
      case 'consensus':
        this.evaluateConsensus(request);
        break;
      case 'proof':
        this.evaluateProofBased(request);
        break;
    }
  }

  private evaluateSelfReport(request: VerificationRequest): void {
    // Self-report: just needs at least one valid proof
    const validProofs = request.proofs.filter((p) => p.valid === true);
    if (validProofs.length > 0) {
      const avgConfidence =
        validProofs.length > 0
          ? Math.min(0.7, 0.5 + validProofs.length * 0.1) // Self-report caps at 0.7
          : 0;

      if (avgConfidence >= request.policy.requiredConfidence) {
        request.status = 'verified';
        request.finalConfidence = avgConfidence;
        request.finalVerdict = `Self-reported with ${validProofs.length} proof(s)`;
        request.completedAt = new Date();
      }
    }
  }

  private evaluatePeerReview(request: VerificationRequest): void {
    const minReviewers = request.policy.minReviewers ?? 1;
    const completedReviews = request.reviewers.filter(
      (r) => r.verdict !== null,
    );

    if (completedReviews.length < minReviewers) return;

    const approvals = completedReviews.filter(
      (r) => r.verdict === 'approved',
    );
    const rejections = completedReviews.filter(
      (r) => r.verdict === 'rejected',
    );

    // Weighted average confidence from approvals
    const avgConfidence =
      approvals.length > 0
        ? approvals.reduce((sum, r) => sum + r.confidence, 0) /
          approvals.length
        : 0;

    if (approvals.length > rejections.length && avgConfidence >= request.policy.requiredConfidence) {
      request.status = 'verified';
      request.finalConfidence = avgConfidence;
      request.finalVerdict = `Peer reviewed: ${approvals.length} approvals, ${rejections.length} rejections`;
      request.completedAt = new Date();
    } else if (rejections.length >= minReviewers) {
      request.status = 'rejected';
      request.finalConfidence = avgConfidence;
      request.finalVerdict = `Peer review rejected: ${rejections.length} rejections`;
      request.completedAt = new Date();
    }
  }

  private evaluateConsensus(request: VerificationRequest): void {
    const threshold = request.policy.consensusThreshold ?? 0.66;
    const completedReviews = request.reviewers.filter(
      (r) => r.verdict !== null,
    );
    const minReviewers = request.policy.minReviewers ?? 3;

    if (completedReviews.length < minReviewers) return;

    const approvals = completedReviews.filter(
      (r) => r.verdict === 'approved',
    );
    const approvalRate =
      completedReviews.length > 0
        ? approvals.length / completedReviews.length
        : 0;

    const avgConfidence =
      completedReviews.length > 0
        ? completedReviews.reduce((sum, r) => sum + r.confidence, 0) /
          completedReviews.length
        : 0;

    if (approvalRate >= threshold && avgConfidence >= request.policy.requiredConfidence) {
      request.status = 'verified';
      request.finalConfidence = avgConfidence;
      request.finalVerdict = `Consensus reached: ${(approvalRate * 100).toFixed(0)}% approval (threshold: ${(threshold * 100).toFixed(0)}%)`;
      request.completedAt = new Date();
    } else if (1 - approvalRate > 1 - threshold) {
      // Rejection threshold met
      request.status = 'rejected';
      request.finalConfidence = avgConfidence;
      request.finalVerdict = `Consensus rejected: ${(approvalRate * 100).toFixed(0)}% approval (needed: ${(threshold * 100).toFixed(0)}%)`;
      request.completedAt = new Date();
    }
  }

  private evaluateProofBased(request: VerificationRequest): void {
    // Proof-based: all proofs must be valid and confidence must meet threshold
    if (request.proofs.length === 0) return;

    const validProofs = request.proofs.filter((p) => p.valid === true);
    const invalidProofs = request.proofs.filter((p) => p.valid === false);

    if (invalidProofs.length > 0) {
      request.status = 'rejected';
      request.finalConfidence = 0;
      request.finalVerdict = `Proof verification failed: ${invalidProofs.length} invalid proof(s)`;
      request.completedAt = new Date();
      return;
    }

    // All proofs verified (no unverified proofs remaining)
    const unverified = request.proofs.filter((p) => p.valid === null);
    if (unverified.length > 0) return; // Wait for all proofs to be verified

    // Compute aggregate confidence from proof details
    const proofConfidences = validProofs.map((p) => {
      const result = this.deepVerifyProof(p);
      return result.confidence;
    });

    const avgConfidence =
      proofConfidences.reduce((a, b) => a + b, 0) /
      proofConfidences.length;

    if (avgConfidence >= request.policy.requiredConfidence) {
      request.status = 'verified';
      request.finalConfidence = avgConfidence;
      request.finalVerdict = `All ${validProofs.length} proofs verified with avg confidence ${(avgConfidence * 100).toFixed(0)}%`;
      request.completedAt = new Date();
    }
  }

  private appendAuditEntry(
    delegationId: string,
    verificationRequestId: string,
    action: string,
    actor: string,
    data: Record<string, unknown>,
  ): void {
    const previousHash = this.lastAuditHash;
    const entry: AuditTrailEntry = {
      id: uuidv4(),
      delegationId,
      verificationRequestId,
      action,
      actor,
      timestamp: new Date(),
      data,
      previousHash,
      hash: '', // Will be computed below
    };

    entry.hash = this.computeHash(entry, previousHash);
    this.lastAuditHash = entry.hash;
    this.auditTrail.push(entry);
  }

  private computeHash(
    entry: Omit<AuditTrailEntry, 'hash'> & { hash?: string },
    previousHash: string,
  ): string {
    const payload = [
      entry.id,
      entry.delegationId,
      entry.verificationRequestId,
      entry.action,
      entry.actor,
      entry.timestamp.toISOString(),
      JSON.stringify(entry.data),
      previousHash,
    ].join('|');

    // Simple hash function (in production use SHA-256)
    let hash = 0;
    for (let i = 0; i < payload.length; i++) {
      const char = payload.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0;
    }
    return `h_${Math.abs(hash).toString(36).padStart(10, '0')}`;
  }
}
