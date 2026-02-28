import { describe, it, expect, beforeEach } from 'vitest';
import { TrustManager } from '../trust-manager';

const AGENT_IDS = [
  'pm-agent',
  'architect-agent',
  'backend-agent',
  'frontend-agent',
  'qa-agent',
  'security-agent',
  'devops-agent',
  'ux-agent',
  'analyst-agent',
  'scrum-agent',
  'docs-agent',
  'data-agent',
];

describe('TrustManager', () => {
  let tm: TrustManager;

  beforeEach(() => {
    tm = new TrustManager();
  });

  describe('initializeTrust', () => {
    it('should initialize with Beta(2,2) prior (score = 0.5)', () => {
      const score = tm.initializeTrust('backend-agent');

      expect(score.agentId).toBe('backend-agent');
      expect(score.score).toBe(0.5);
      expect(score.alpha).toBe(2);
      expect(score.beta).toBe(2);
      expect(score.successes).toBe(0);
      expect(score.failures).toBe(0);
      expect(score.partials).toBe(0);
      expect(score.history).toEqual([]);
      expect(score.domainScores).toEqual({});
      expect(score.lastTaskTimestamp).toBeNull();
    });

    it('should initialize trust for all 12 agents', () => {
      for (const id of AGENT_IDS) {
        tm.initializeTrust(id);
      }

      const matrix = tm.getTrustMatrix();
      expect(Object.keys(matrix.agents)).toHaveLength(12);

      for (const id of AGENT_IDS) {
        expect(matrix.agents[id]).toBeDefined();
        expect(matrix.agents[id].score).toBe(0.5);
      }
    });
  });

  describe('updateTrust', () => {
    it('should increase score on success', () => {
      tm.initializeTrust('backend-agent');
      const before = tm.getTrustScore('backend-agent')!.score;

      tm.updateTrust('backend-agent', 'success', 0.8, 'del-1', 'coding');
      const after = tm.getTrustScore('backend-agent')!.score;

      expect(after).toBeGreaterThan(before);
      expect(tm.getTrustScore('backend-agent')!.successes).toBe(1);
    });

    it('should decrease score on failure', () => {
      tm.initializeTrust('frontend-agent');
      const before = tm.getTrustScore('frontend-agent')!.score;

      tm.updateTrust('frontend-agent', 'failure', 0.8, 'del-2', 'coding');
      const after = tm.getTrustScore('frontend-agent')!.score;

      expect(after).toBeLessThan(before);
      expect(tm.getTrustScore('frontend-agent')!.failures).toBe(1);
    });

    it('should weight by task criticality', () => {
      tm.initializeTrust('agent-low');
      tm.initializeTrust('agent-high');

      tm.updateTrust('agent-low', 'success', 0.2, 'del-3', 'general');
      tm.updateTrust('agent-high', 'success', 1.0, 'del-4', 'general');

      const lowScore = tm.getTrustScore('agent-low')!.score;
      const highScore = tm.getTrustScore('agent-high')!.score;

      expect(highScore).toBeGreaterThan(lowScore);
    });

    it('should handle partial success', () => {
      tm.initializeTrust('qa-agent');
      const before = tm.getTrustScore('qa-agent')!.score;

      tm.updateTrust('qa-agent', 'partial', 0.5, 'del-5', 'testing');
      const after = tm.getTrustScore('qa-agent')!;

      expect(after.partials).toBe(1);
      // Partial: alpha += 0.3 * weight, beta += 0.7 * weight => net decrease
      expect(after.score).toBeLessThan(before);
      // But the decrease should be less severe than a full failure
      tm.initializeTrust('qa-agent-fail');
      tm.updateTrust('qa-agent-fail', 'failure', 0.5, 'del-6', 'testing');
      const failScore = tm.getTrustScore('qa-agent-fail')!.score;

      expect(after.score).toBeGreaterThan(failScore);
    });

    it('should update domain-specific scores', () => {
      tm.initializeTrust('security-agent');

      tm.updateTrust('security-agent', 'success', 0.8, 'del-7', 'security');
      tm.updateTrust('security-agent', 'failure', 0.8, 'del-8', 'coding');

      const score = tm.getTrustScore('security-agent')!;
      expect(score.domainScores['security']).toBeGreaterThan(0.5);
      expect(score.domainScores['coding']).toBeLessThan(0.5);
    });
  });

  describe('decay', () => {
    it('should decay scores toward 0.5 over time', () => {
      tm.initializeTrust('decay-agent');
      // Build up high trust
      for (let i = 0; i < 5; i++) {
        tm.updateTrust('decay-agent', 'success', 1.0, `del-${i}`, 'general');
      }
      const highScore = tm.getTrustScore('decay-agent')!.score;
      expect(highScore).toBeGreaterThan(0.7);

      // Decay for 30 days (in ms)
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      tm.decayTrust('decay-agent', thirtyDaysMs);
      const decayedScore = tm.getTrustScore('decay-agent')!.score;

      expect(decayedScore).toBeLessThan(highScore);
      expect(decayedScore).toBeGreaterThan(0.5);
    });

    it('should not decay below the prior', () => {
      tm.initializeTrust('stable-agent');
      // Decay even at 0.5 should not go below minScore
      const oneYearMs = 365 * 24 * 60 * 60 * 1000;
      tm.decayTrust('stable-agent', oneYearMs);

      const score = tm.getTrustScore('stable-agent')!;
      expect(score.score).toBeGreaterThanOrEqual(0.05); // minScore default
      expect(score.alpha).toBeGreaterThanOrEqual(2); // defaultAlpha
      expect(score.beta).toBeGreaterThanOrEqual(2); // defaultBeta
    });
  });

  describe('getTrustMatrix', () => {
    it('should return all agents with their scores', () => {
      tm.initializeTrust('agent-1');
      tm.initializeTrust('agent-2');
      tm.initializeTrust('agent-3');

      const matrix = tm.getTrustMatrix();

      expect(Object.keys(matrix.agents)).toHaveLength(3);
      expect(matrix.agents['agent-1']).toBeDefined();
      expect(matrix.agents['agent-2']).toBeDefined();
      expect(matrix.agents['agent-3']).toBeDefined();
      expect(matrix.lastUpdated).toBeInstanceOf(Date);
    });

    it('should compute correct global average', () => {
      tm.initializeTrust('agent-a');
      tm.initializeTrust('agent-b');

      // Both start at 0.5, so average is 0.5
      let matrix = tm.getTrustMatrix();
      expect(matrix.globalAverage).toBeCloseTo(0.5, 2);

      // Increase one agent's score
      tm.updateTrust('agent-a', 'success', 1.0, 'del-1', 'general');
      matrix = tm.getTrustMatrix();

      const scoreA = matrix.agents['agent-a'].score;
      const scoreB = matrix.agents['agent-b'].score;
      const expected = (scoreA + scoreB) / 2;

      expect(matrix.globalAverage).toBeCloseTo(expected, 5);
    });
  });
});
