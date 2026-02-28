import { describe, it, expect, beforeEach } from 'vitest';
import { ModelRouter } from '../model-router';

describe('ModelRouter', () => {
  let router: ModelRouter;

  beforeEach(() => {
    router = new ModelRouter();
  });

  describe('getModelCatalog', () => {
    it('should return exactly 5 models', () => {
      const catalog = router.getModelCatalog();
      expect(Object.keys(catalog)).toHaveLength(5);
    });

    it('should contain only Anthropic and Google providers', () => {
      const catalog = router.getModelCatalog();
      const providers = new Set(Object.values(catalog).map(m => m.provider));
      expect(providers).toEqual(new Set(['anthropic', 'google']));
    });

    it('should have correct tier assignments', () => {
      const catalog = router.getModelCatalog();
      expect(catalog['claude-opus-4-6'].tier).toBe('premium');
      expect(catalog['claude-sonnet-4-6'].tier).toBe('balanced');
      expect(catalog['claude-haiku-4-5'].tier).toBe('fast');
      expect(catalog['gemini-3.1-pro'].tier).toBe('balanced');
      expect(catalog['gemini-flash-3'].tier).toBe('fast');
    });
  });

  describe('getAgentAssignment', () => {
    it('should return correct primary model for each of 12 agents', () => {
      const expectedPrimary: Record<string, string> = {
        'bmad-master': 'gemini-3.1-pro',
        'product-owner': 'gemini-3.1-pro',
        'business-analyst': 'gemini-3.1-pro',
        'scrum-master': 'gemini-flash-3',
        'architect': 'claude-opus-4-6',
        'ux-designer': 'gemini-3.1-pro',
        'frontend-dev': 'gemini-3.1-pro',
        'backend-dev': 'claude-opus-4-6',
        'qa-architect': 'claude-opus-4-6',
        'devops-engineer': 'gemini-3.1-pro',
        'security-specialist': 'claude-opus-4-6',
        'tech-writer': 'claude-sonnet-4-6',
      };

      for (const [agentId, expectedModel] of Object.entries(expectedPrimary)) {
        const assignment = router.getAgentAssignment(agentId as any);
        expect(assignment.primary, `${agentId} primary`).toBe(expectedModel);
      }
    });

    it('should return correct fallback model for each of 12 agents', () => {
      const expectedFallback: Record<string, string> = {
        'bmad-master': 'claude-sonnet-4-6',
        'product-owner': 'claude-sonnet-4-6',
        'business-analyst': 'claude-sonnet-4-6',
        'scrum-master': 'claude-haiku-4-5',
        'architect': 'gemini-3.1-pro',
        'ux-designer': 'claude-sonnet-4-6',
        'frontend-dev': 'claude-sonnet-4-6',
        'backend-dev': 'claude-sonnet-4-6',
        'qa-architect': 'claude-sonnet-4-6',
        'devops-engineer': 'claude-sonnet-4-6',
        'security-specialist': 'gemini-3.1-pro',
        'tech-writer': 'gemini-3.1-pro',
      };

      for (const [agentId, expectedModel] of Object.entries(expectedFallback)) {
        const assignment = router.getAgentAssignment(agentId as any);
        expect(assignment.fallback, `${agentId} fallback`).toBe(expectedModel);
      }
    });
  });

  describe('classifyComplexity', () => {
    it('should classify architecture tasks as premium', () => {
      expect(router.classifyComplexity('Design the system architecture with CQRS pattern')).toBe('premium');
    });

    it('should classify security audits as premium', () => {
      expect(router.classifyComplexity('Perform a security audit and threat model')).toBe('premium');
    });

    it('should classify feature tasks as balanced', () => {
      expect(router.classifyComplexity('Implement the user authentication endpoint')).toBe('balanced');
    });

    it('should classify status updates as fast', () => {
      expect(router.classifyComplexity('Status update on the sprint')).toBe('fast');
    });

    it('should classify typo fixes as fast', () => {
      expect(router.classifyComplexity('Fix typo in readme')).toBe('fast');
    });

    it('should use content length as tiebreaker', () => {
      const longContent = 'a '.repeat(1500);
      expect(router.classifyComplexity(longContent)).toBe('premium');
      expect(router.classifyComplexity('ok')).toBe('fast');
    });
  });

  describe('route', () => {
    it('should return primary model for standard requests', () => {
      const result = router.route({
        agentId: 'architect',
        taskContent: 'Design the system',
        sessionId: 'test-session',
      });
      expect(result.model.id).toBe('claude-opus-4-6');
      expect(result.reason).toBe('primary');
    });

    it('should fall back when cost constraint excludes primary', () => {
      const result = router.route({
        agentId: 'architect',
        taskContent: 'Design the system',
        sessionId: 'test-session',
        maxCost: 0.000001,
      });
      expect(result.model.id).not.toBe('claude-opus-4-6');
    });

    it('should throw for unknown agent', () => {
      expect(() =>
        router.route({
          agentId: 'nonexistent-agent' as any,
          taskContent: 'test',
          sessionId: 'test-session',
        })
      ).toThrow();
    });

    it('should respect tier override', () => {
      const result = router.route({
        agentId: 'bmad-master',
        taskContent: 'simple task',
        sessionId: 'test-session',
        tierOverride: 'premium',
      });
      expect(result.classifiedTier).toBe('premium');
    });
  });

  describe('recordCost', () => {
    it('should calculate cost correctly', () => {
      const record = router.recordCost(
        'architect', 'session-1', 'task-1',
        'claude-opus-4-6', 1000, 500, 'premium'
      );
      const expectedCost = (1000 / 1_000_000) * 15.0 + (500 / 1_000_000) * 75.0;
      expect(record.cost).toBeCloseTo(expectedCost, 6);
    });

    it('should accumulate records in cost summary', () => {
      router.recordCost('architect', 'session-1', 'task-1', 'claude-opus-4-6', 1000, 500, 'premium');
      router.recordCost('bmad-master', 'session-1', 'task-2', 'gemini-3.1-pro', 2000, 1000, 'balanced');
      const summary = router.getCostSummary();
      expect(summary.totalRequests).toBe(2);
      expect(summary.totalInputTokens).toBe(3000);
      expect(summary.totalOutputTokens).toBe(1500);
      expect(summary.perAgent['architect']).toBeGreaterThan(0);
      expect(summary.perAgent['bmad-master']).toBeGreaterThan(0);
    });
  });

  describe('updateAssignment', () => {
    it('should allow runtime model reassignment', () => {
      router.updateAssignment('architect', 'gemini-3.1-pro', 'claude-sonnet-4-6');
      const assignment = router.getAgentAssignment('architect');
      expect(assignment.primary).toBe('gemini-3.1-pro');
      expect(assignment.fallback).toBe('claude-sonnet-4-6');
    });
  });
});
