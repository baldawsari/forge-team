/**
 * Trust Calibration system for the VIADP protocol.
 *
 * Maintains Bayesian trust scores for each agent, updated based on
 * delegation outcomes. Supports decay over time and domain-specific
 * trust tracking.
 */

import { v4 as uuidv4 } from 'uuid';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TrustEvent {
  id: string;
  agentId: string;
  outcome: 'success' | 'partial' | 'failure';
  taskCriticality: number;
  previousScore: number;
  newScore: number;
  delegationId: string;
  domain: string;
  timestamp: Date;
}

export interface TrustScore {
  agentId: string;
  score: number;
  alpha: number;
  beta: number;
  successes: number;
  failures: number;
  partials: number;
  history: TrustEvent[];
  domainScores: Record<string, number>;
  lastUpdated: Date;
  lastTaskTimestamp: Date | null;
}

export interface TrustMatrix {
  agents: Record<string, TrustScore>;
  globalAverage: number;
  lastUpdated: Date;
}

export interface TrustManagerConfig {
  defaultAlpha: number;
  defaultBeta: number;
  maxHistoryLength: number;
  decayRatePerDay: number;
  minScore: number;
  maxScore: number;
  criticalityWeight: number;
}

// ---------------------------------------------------------------------------
// Trust Manager
// ---------------------------------------------------------------------------

export class TrustManager {
  private scores: Map<string, TrustScore> = new Map();
  private config: TrustManagerConfig;

  constructor(config: Partial<TrustManagerConfig> = {}) {
    this.config = {
      defaultAlpha: config.defaultAlpha ?? 2,
      defaultBeta: config.defaultBeta ?? 2,
      maxHistoryLength: config.maxHistoryLength ?? 200,
      decayRatePerDay: config.decayRatePerDay ?? 0.005,
      minScore: config.minScore ?? 0.05,
      maxScore: config.maxScore ?? 0.95,
      criticalityWeight: config.criticalityWeight ?? 1.5,
    };
  }

  /**
   * Initialize trust for a new agent with a default score of 0.5.
   * Uses a Beta(alpha, beta) prior. Default: Beta(2, 2) -> mean 0.5.
   */
  initializeTrust(agentId: string): TrustScore {
    const existing = this.scores.get(agentId);
    if (existing) return existing;

    const now = new Date();
    const score: TrustScore = {
      agentId,
      score: this.config.defaultAlpha / (this.config.defaultAlpha + this.config.defaultBeta),
      alpha: this.config.defaultAlpha,
      beta: this.config.defaultBeta,
      successes: 0,
      failures: 0,
      partials: 0,
      history: [],
      domainScores: {},
      lastUpdated: now,
      lastTaskTimestamp: null,
    };

    this.scores.set(agentId, score);
    return score;
  }

  /**
   * Update trust for an agent based on a delegation outcome.
   * Uses Bayesian update on the Beta distribution parameters.
   *
   * - Success: alpha += criticalityWeight * taskCriticality
   * - Failure: beta += criticalityWeight * taskCriticality
   * - Partial: alpha += 0.3 * weight, beta += 0.7 * weight
   */
  updateTrust(
    agentId: string,
    outcome: 'success' | 'partial' | 'failure',
    taskCriticality: number,
    delegationId: string = '',
    domain: string = 'general',
  ): TrustScore {
    let trustScore = this.scores.get(agentId);
    if (!trustScore) {
      trustScore = this.initializeTrust(agentId);
    }

    const previousScore = trustScore.score;
    const weight = Math.max(0.1, taskCriticality) * this.config.criticalityWeight;

    // Bayesian update
    switch (outcome) {
      case 'success':
        trustScore.alpha += weight;
        trustScore.successes += 1;
        break;
      case 'failure':
        trustScore.beta += weight;
        trustScore.failures += 1;
        break;
      case 'partial':
        trustScore.alpha += weight * 0.3;
        trustScore.beta += weight * 0.7;
        trustScore.partials += 1;
        break;
    }

    // Recalculate score from Beta distribution mean
    trustScore.score = this.clampScore(
      trustScore.alpha / (trustScore.alpha + trustScore.beta),
    );
    trustScore.lastUpdated = new Date();
    trustScore.lastTaskTimestamp = new Date();

    // Update domain-specific score
    this.updateDomainScore(trustScore, domain, outcome, taskCriticality);

    // Record history event
    const event: TrustEvent = {
      id: uuidv4(),
      agentId,
      outcome,
      taskCriticality,
      previousScore,
      newScore: trustScore.score,
      delegationId,
      domain,
      timestamp: new Date(),
    };
    trustScore.history.push(event);

    // Trim history if too long
    if (trustScore.history.length > this.config.maxHistoryLength) {
      trustScore.history = trustScore.history.slice(
        -this.config.maxHistoryLength,
      );
    }

    return trustScore;
  }

  /**
   * Get the current trust score for an agent.
   */
  getTrustScore(agentId: string): TrustScore | null {
    return this.scores.get(agentId) ?? null;
  }

  /**
   * Get the full trust matrix for all agents.
   */
  getTrustMatrix(): TrustMatrix {
    const agents: Record<string, TrustScore> = {};
    let totalScore = 0;
    let count = 0;

    for (const [id, score] of this.scores) {
      agents[id] = score;
      totalScore += score.score;
      count++;
    }

    return {
      agents,
      globalAverage: count > 0 ? totalScore / count : 0.5,
      lastUpdated: new Date(),
    };
  }

  /**
   * Apply time-based decay to an agent's trust score.
   * Trust decays slightly over time to ensure agents must continually
   * prove themselves and to account for model drift.
   */
  decayTrust(agentId: string, timeSinceLastTask: number): TrustScore {
    let trustScore = this.scores.get(agentId);
    if (!trustScore) {
      trustScore = this.initializeTrust(agentId);
    }

    // timeSinceLastTask is in milliseconds; convert to days
    const daysSinceLastTask = timeSinceLastTask / (1000 * 60 * 60 * 24);

    if (daysSinceLastTask <= 0) return trustScore;

    // Exponential decay toward 0.5 (the prior mean)
    const decayFactor = Math.exp(
      -this.config.decayRatePerDay * daysSinceLastTask,
    );
    const priorMean = 0.5;

    // Decay the score toward the prior
    trustScore.score = this.clampScore(
      priorMean + (trustScore.score - priorMean) * decayFactor,
    );

    // Slightly decay alpha and beta toward the prior (information decay)
    const paramDecay = Math.max(0.9, decayFactor);
    trustScore.alpha = Math.max(
      this.config.defaultAlpha,
      trustScore.alpha * paramDecay,
    );
    trustScore.beta = Math.max(
      this.config.defaultBeta,
      trustScore.beta * paramDecay,
    );

    trustScore.lastUpdated = new Date();

    // Decay domain scores too
    for (const domain of Object.keys(trustScore.domainScores)) {
      trustScore.domainScores[domain] = this.clampScore(
        priorMean +
          (trustScore.domainScores[domain] - priorMean) * decayFactor,
      );
    }

    return trustScore;
  }

  /**
   * Apply decay to all agents based on their last task timestamp.
   */
  decayAll(): void {
    const now = Date.now();
    for (const [agentId, score] of this.scores) {
      if (score.lastTaskTimestamp) {
        const timeSince = now - score.lastTaskTimestamp.getTime();
        this.decayTrust(agentId, timeSince);
      }
    }
  }

  /**
   * Get the trust variance (uncertainty) for an agent.
   * Higher variance means less certainty about the trust score.
   */
  getTrustVariance(agentId: string): number {
    const score = this.scores.get(agentId);
    if (!score) return 1; // Maximum uncertainty

    // Variance of Beta distribution: alpha*beta / ((alpha+beta)^2 * (alpha+beta+1))
    const total = score.alpha + score.beta;
    return (score.alpha * score.beta) / (total * total * (total + 1));
  }

  /**
   * Check if an agent's trust is below a threshold.
   */
  isTrustworthy(agentId: string, threshold: number = 0.3): boolean {
    const score = this.scores.get(agentId);
    if (!score) return false;
    return score.score >= threshold;
  }

  /**
   * Get top-N most trusted agents.
   */
  getTopAgents(n: number = 5): TrustScore[] {
    return Array.from(this.scores.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, n);
  }

  /**
   * Get agents below a trust threshold (candidates for circuit breaking).
   */
  getLowTrustAgents(threshold: number = 0.3): TrustScore[] {
    return Array.from(this.scores.values()).filter(
      (s) => s.score < threshold,
    );
  }

  /**
   * Reset an agent's trust to the default prior.
   */
  resetTrust(agentId: string): TrustScore {
    this.scores.delete(agentId);
    return this.initializeTrust(agentId);
  }

  /**
   * Import trust scores (for persistence/recovery).
   */
  importScores(scores: TrustScore[]): void {
    for (const score of scores) {
      this.scores.set(score.agentId, score);
    }
  }

  /**
   * Export all trust scores (for persistence).
   */
  exportScores(): TrustScore[] {
    return Array.from(this.scores.values());
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private clampScore(score: number): number {
    return Math.max(
      this.config.minScore,
      Math.min(this.config.maxScore, score),
    );
  }

  private updateDomainScore(
    trustScore: TrustScore,
    domain: string,
    outcome: 'success' | 'partial' | 'failure',
    criticality: number,
  ): void {
    const currentDomainScore = trustScore.domainScores[domain] ?? 0.5;
    const learningRate = 0.1 * Math.max(0.1, criticality);

    let targetScore: number;
    switch (outcome) {
      case 'success':
        targetScore = 1.0;
        break;
      case 'partial':
        targetScore = 0.4;
        break;
      case 'failure':
        targetScore = 0.0;
        break;
    }

    // Exponential moving average
    trustScore.domainScores[domain] = this.clampScore(
      currentDomainScore + learningRate * (targetScore - currentDomainScore),
    );
  }
}
