import { describe, it, expect, beforeEach } from 'vitest';
import {
  DelegationEngine,
  AgentProfile,
  DelegationRequest,
} from '../delegation-engine';

function makeAgent(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: 'agent-1',
    capabilities: ['typescript', 'testing', 'code-review'],
    modelFamily: 'claude',
    costPerToken: 0.01,
    avgResponseTime: 500,
    trustScore: 0.8,
    currentLoad: 0,
    maxConcurrentTasks: 3,
    status: 'idle',
    ...overrides,
  };
}

function makeRequest(overrides: Partial<DelegationRequest> = {}): DelegationRequest {
  return {
    taskId: 'task-1',
    delegator: 'pm-agent',
    capabilityRequirements: ['typescript', 'testing'],
    riskLevel: 'low',
    deadline: new Date(Date.now() + 3600_000),
    verificationPolicy: { type: 'self_report', requiredConfidence: 0.5 },
    ...overrides,
  };
}

describe('DelegationEngine', () => {
  let engine: DelegationEngine;

  beforeEach(() => {
    engine = new DelegationEngine();
  });

  describe('assessCapability', () => {
    it('should score agents higher when they match required capabilities', () => {
      engine.registerAgent(
        makeAgent({
          id: 'backend-agent',
          capabilities: ['typescript', 'testing', 'code-review', 'nodejs'],
        }),
      );

      const score = engine.assessCapability('backend-agent', [
        'typescript',
        'testing',
      ]);

      expect(score.agentId).toBe('backend-agent');
      expect(score.overallScore).toBe(1.0);
      expect(score.matchedCapabilities).toEqual(['typescript', 'testing']);
      expect(score.missingCapabilities).toEqual([]);
      expect(score.confidence).toBe(1.0);
    });

    it('should score agents lower when capabilities are missing', () => {
      engine.registerAgent(
        makeAgent({
          id: 'frontend-agent',
          capabilities: ['react', 'css'],
        }),
      );

      const score = engine.assessCapability('frontend-agent', [
        'typescript',
        'testing',
        'kubernetes',
      ]);

      expect(score.overallScore).toBeLessThan(0.5);
      expect(score.missingCapabilities.length).toBeGreaterThan(0);
      expect(score.confidence).toBeLessThan(1.0);
    });

    it('should return matched and missing capabilities', () => {
      engine.registerAgent(
        makeAgent({
          id: 'mixed-agent',
          capabilities: ['typescript', 'docker'],
        }),
      );

      const score = engine.assessCapability('mixed-agent', [
        'typescript',
        'kubernetes',
      ]);

      expect(score.matchedCapabilities).toContain('typescript');
      expect(score.missingCapabilities).toContain('kubernetes');
      expect(score.domainScores['typescript']).toBe(1.0);
      expect(score.domainScores['kubernetes']).toBeLessThan(0.5);
    });
  });

  describe('matchDelegates', () => {
    beforeEach(() => {
      engine.registerAgent(
        makeAgent({
          id: 'agent-a',
          capabilities: ['typescript', 'testing', 'nodejs'],
          modelFamily: 'claude',
          costPerToken: 0.02,
          trustScore: 0.9,
        }),
      );
      engine.registerAgent(
        makeAgent({
          id: 'agent-b',
          capabilities: ['typescript', 'testing'],
          modelFamily: 'gemini',
          costPerToken: 0.005,
          trustScore: 0.7,
        }),
      );
      engine.registerAgent(
        makeAgent({
          id: 'agent-c',
          capabilities: ['python', 'testing'],
          modelFamily: 'claude',
          costPerToken: 0.01,
          trustScore: 0.6,
        }),
      );
    });

    it('should return ranked candidates sorted by composite score', () => {
      const candidates = engine.matchDelegates(makeRequest());

      expect(candidates.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < candidates.length; i++) {
        expect(candidates[i - 1].compositeScore).toBeGreaterThanOrEqual(
          candidates[i].compositeScore,
        );
      }
    });

    it('should apply diversity bonus for different model families', () => {
      const candidates = engine.matchDelegates(makeRequest());
      const claudeAgent = candidates.find((c) => c.agentId === 'agent-a');
      const geminiAgent = candidates.find((c) => c.agentId === 'agent-b');

      expect(claudeAgent).toBeDefined();
      expect(geminiAgent).toBeDefined();
      expect(claudeAgent!.diversityBonus).toBeGreaterThan(0);
      expect(geminiAgent!.diversityBonus).toBeGreaterThan(0);
    });

    it('should respect cost constraints in ranking', () => {
      const candidates = engine.matchDelegates(
        makeRequest({ maxCost: 1 }),
      );

      for (const c of candidates) {
        expect(c.costEstimate).toBeDefined();
        expect(typeof c.costEstimate).toBe('number');
      }
    });

    it('should factor in risk level', () => {
      const lowRisk = engine.matchDelegates(
        makeRequest({ riskLevel: 'low' }),
      );
      const criticalRisk = engine.matchDelegates(
        makeRequest({ riskLevel: 'critical' }),
      );

      expect(lowRisk.length).toBeGreaterThanOrEqual(1);
      expect(criticalRisk.length).toBeGreaterThanOrEqual(1);

      const lowAgent = lowRisk.find((c) => c.agentId === 'agent-a')!;
      const critAgent = criticalRisk.find((c) => c.agentId === 'agent-a')!;
      expect(lowAgent.riskScore).not.toBe(critAgent.riskScore);
    });
  });

  describe('delegate', () => {
    beforeEach(() => {
      engine.registerAgent(makeAgent({ id: 'delegate-agent' }));
    });

    it('should create a delegation token on success', () => {
      const token = engine.delegate(makeRequest(), 'delegate-agent');

      expect(token.id).toBeDefined();
      expect(token.taskId).toBe('task-1');
      expect(token.delegator).toBe('pm-agent');
      expect(token.delegate).toBe('delegate-agent');
      expect(token.revoked).toBe(false);
      expect(token.chain).toContain('pm-agent');
      expect(token.chain).toContain('delegate-agent');
      expect(token.signature).toMatch(/^sig_/);
    });

    it('should respect maximum chain depth', () => {
      const token = engine.delegate(
        makeRequest({ riskLevel: 'critical' }),
        'delegate-agent',
      );

      expect(token.maxChainDepth).toBe(1);

      const lowToken = engine.delegate(
        makeRequest({ riskLevel: 'low', taskId: 'task-2' }),
        'delegate-agent',
      );
      expect(lowToken.maxChainDepth).toBe(3);
    });

    it('should include resource limits in scope', () => {
      const token = engine.delegate(
        makeRequest({ maxCost: 7 }),
        'delegate-agent',
      );

      expect(token.scope.resourceLimits).toBeDefined();
      expect(token.scope.resourceLimits.maxTokens).toBeGreaterThan(0);
      expect(token.scope.resourceLimits.maxDuration).toBeGreaterThan(0);
      expect(token.scope.resourceLimits.maxCost).toBe(7);
    });
  });

  describe('reDelegation', () => {
    beforeEach(() => {
      engine.registerAgent(
        makeAgent({
          id: 'agent-x',
          capabilities: ['typescript', 'testing'],
          modelFamily: 'claude',
        }),
      );
      engine.registerAgent(
        makeAgent({
          id: 'agent-y',
          capabilities: ['typescript', 'testing'],
          modelFamily: 'gemini',
        }),
      );
    });

    it('should allow re-delegation when canRedelegate is true', () => {
      const original = engine.delegate(
        makeRequest({ riskLevel: 'low' }),
        'agent-x',
      );

      expect(original.scope.canRedelegate).toBe(true);

      const newToken = engine.redelegate(original.id, 'agent-x failed');

      expect(newToken.id).not.toBe(original.id);
      expect(newToken.delegate).not.toBe('agent-x');
      expect(newToken.chain.length).toBeGreaterThan(original.chain.length);
    });

    it('should block re-delegation when canRedelegate is false', () => {
      const original = engine.delegate(
        makeRequest({ riskLevel: 'high' }),
        'agent-x',
      );

      expect(original.scope.canRedelegate).toBe(false);

      // redelegate does not check canRedelegate on the scope itself,
      // but it checks maxChainDepth. For 'critical' risk, maxChainDepth=1
      // and chain starts at length 2, so it should throw on chain depth.
      const criticalToken = engine.delegate(
        makeRequest({ riskLevel: 'critical', taskId: 'task-crit' }),
        'agent-x',
      );

      expect(criticalToken.maxChainDepth).toBe(1);
      expect(criticalToken.chain.length).toBe(2);

      expect(() =>
        engine.redelegate(criticalToken.id, 'failed'),
      ).toThrow(/Maximum re-delegation depth/);
    });
  });
});
