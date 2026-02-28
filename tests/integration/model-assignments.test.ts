/**
 * Integration Test: Model Assignments
 *
 * Verifies that all 12 BMAD agents have the correct primary and fallback
 * model assignments, and that ONLY Anthropic + Google models are used.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';

// Mock DB module used by model-router
vi.mock('../../gateway/src/db.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [] }),
}));

import { ModelRouter } from '../../gateway/src/model-router';

// ---------------------------------------------------------------------------
// Expected Assignments (source of truth for this test)
// ---------------------------------------------------------------------------

const EXPECTED_ASSIGNMENTS = [
  { agentId: 'bmad-master', primary: 'gemini-3.1-pro', fallback: 'claude-sonnet-4-6', role: 'Orchestrator' },
  { agentId: 'product-owner', primary: 'gemini-3.1-pro', fallback: 'claude-sonnet-4-6', role: 'Requirements' },
  { agentId: 'business-analyst', primary: 'gemini-3.1-pro', fallback: 'claude-sonnet-4-6', role: 'Analysis' },
  { agentId: 'scrum-master', primary: 'gemini-flash-3', fallback: 'claude-haiku-4-5', role: 'Agile Coordination' },
  { agentId: 'architect', primary: 'claude-opus-4-6', fallback: 'gemini-3.1-pro', role: 'System Design' },
  { agentId: 'ux-designer', primary: 'gemini-3.1-pro', fallback: 'claude-sonnet-4-6', role: 'UX Design' },
  { agentId: 'frontend-dev', primary: 'gemini-3.1-pro', fallback: 'claude-sonnet-4-6', role: 'Frontend' },
  { agentId: 'backend-dev', primary: 'claude-opus-4-6', fallback: 'claude-sonnet-4-6', role: 'Backend' },
  { agentId: 'qa-architect', primary: 'claude-opus-4-6', fallback: 'claude-sonnet-4-6', role: 'QA' },
  { agentId: 'devops-engineer', primary: 'gemini-3.1-pro', fallback: 'claude-sonnet-4-6', role: 'DevOps' },
  { agentId: 'security-specialist', primary: 'claude-opus-4-6', fallback: 'gemini-3.1-pro', role: 'Security' },
  { agentId: 'tech-writer', primary: 'claude-sonnet-4-6', fallback: 'gemini-3.1-pro', role: 'Documentation' },
];

// Valid model IDs (Anthropic + Google only)
const ANTHROPIC_MODELS = ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'];
const GOOGLE_MODELS = ['gemini-3.1-pro', 'gemini-flash-3'];
const ALL_VALID_MODELS = [...ANTHROPIC_MODELS, ...GOOGLE_MODELS];

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('Model Assignments — Integration Tests', () => {
  let modelRouter: ModelRouter;

  beforeAll(() => {
    modelRouter = new ModelRouter();
  });

  // -----------------------------------------------------------------------
  // 1. Exactly 12 agent assignments
  // -----------------------------------------------------------------------

  it('should have exactly 12 agent assignments', () => {
    const assignments = modelRouter.getAllAssignments();
    const agentIds = Object.keys(assignments);

    expect(agentIds).toHaveLength(12);
    expect(agentIds.sort()).toEqual(
      EXPECTED_ASSIGNMENTS.map((a) => a.agentId).sort()
    );
  });

  // -----------------------------------------------------------------------
  // 2. Per-agent primary and fallback assertions
  // -----------------------------------------------------------------------

  describe('per-agent model assignments', () => {
    for (const expected of EXPECTED_ASSIGNMENTS) {
      it(`${expected.agentId} (${expected.role}) should have primary=${expected.primary} and fallback=${expected.fallback}`, () => {
        const assignment = modelRouter.getAgentAssignment(expected.agentId as any);

        expect(assignment).toBeDefined();
        expect(assignment.agentId).toBe(expected.agentId);
        expect(assignment.primary).toBe(expected.primary);
        expect(assignment.fallback).toBe(expected.fallback);
      });
    }
  });

  // -----------------------------------------------------------------------
  // 3. Only Anthropic and Google models (no GPT, no Grok)
  // -----------------------------------------------------------------------

  it('should only use Anthropic and Google models (no GPT, no Grok)', () => {
    const assignments = modelRouter.getAllAssignments();

    for (const [agentId, assignment] of Object.entries(assignments)) {
      // Primary must be a valid model
      expect(ALL_VALID_MODELS).toContain(assignment.primary);

      // Fallback must be a valid model
      expect(ALL_VALID_MODELS).toContain(assignment.fallback);

      // Explicitly check no GPT or Grok models
      expect(assignment.primary).not.toMatch(/gpt/i);
      expect(assignment.primary).not.toMatch(/grok/i);
      expect(assignment.fallback).not.toMatch(/gpt/i);
      expect(assignment.fallback).not.toMatch(/grok/i);
    }

    // Also verify the model catalog itself
    const catalog = modelRouter.getModelCatalog();
    for (const [modelId, config] of Object.entries(catalog)) {
      expect(['anthropic', 'google']).toContain(config.provider);
      expect(config.provider).not.toBe('openai');
      expect(config.provider).not.toBe('xai');
    }
  });

  // -----------------------------------------------------------------------
  // 4. Claude Opus 4.6 agents
  // -----------------------------------------------------------------------

  it('Claude Opus 4.6 agents should be: architect, backend-dev, qa-architect, security-specialist', () => {
    const opusAgents = EXPECTED_ASSIGNMENTS
      .filter((a) => a.primary === 'claude-opus-4-6')
      .map((a) => a.agentId)
      .sort();

    expect(opusAgents).toEqual([
      'architect',
      'backend-dev',
      'qa-architect',
      'security-specialist',
    ]);

    // Verify via ModelRouter
    for (const agentId of opusAgents) {
      const assignment = modelRouter.getAgentAssignment(agentId as any);
      expect(assignment.primary).toBe('claude-opus-4-6');
    }
  });

  // -----------------------------------------------------------------------
  // 5. Gemini Flash 3 agents
  // -----------------------------------------------------------------------

  it('Gemini Flash 3 agents should be: scrum-master only', () => {
    const flashAgents = EXPECTED_ASSIGNMENTS
      .filter((a) => a.primary === 'gemini-flash-3')
      .map((a) => a.agentId);

    expect(flashAgents).toEqual(['scrum-master']);

    const assignment = modelRouter.getAgentAssignment('scrum-master');
    expect(assignment.primary).toBe('gemini-flash-3');
    expect(assignment.fallback).toBe('claude-haiku-4-5');
  });

  // -----------------------------------------------------------------------
  // 6. Claude Sonnet 4.6 agents
  // -----------------------------------------------------------------------

  it('Claude Sonnet 4.6 agents should be: tech-writer only', () => {
    const sonnetAgents = EXPECTED_ASSIGNMENTS
      .filter((a) => a.primary === 'claude-sonnet-4-6')
      .map((a) => a.agentId);

    expect(sonnetAgents).toEqual(['tech-writer']);

    const assignment = modelRouter.getAgentAssignment('tech-writer');
    expect(assignment.primary).toBe('claude-sonnet-4-6');
    expect(assignment.fallback).toBe('gemini-3.1-pro');
  });

  // -----------------------------------------------------------------------
  // 7. Model catalog completeness
  // -----------------------------------------------------------------------

  it('should have exactly 5 models in the catalog', () => {
    const catalog = modelRouter.getModelCatalog();
    const modelIds = Object.keys(catalog);

    expect(modelIds).toHaveLength(5);
    expect(modelIds.sort()).toEqual(ALL_VALID_MODELS.sort());
  });

  // -----------------------------------------------------------------------
  // 8. Every model used in assignments exists in catalog
  // -----------------------------------------------------------------------

  it('should reference only models that exist in the catalog', () => {
    const catalog = modelRouter.getModelCatalog();
    const catalogModelIds = Object.keys(catalog);
    const assignments = modelRouter.getAllAssignments();

    for (const [agentId, assignment] of Object.entries(assignments)) {
      expect(catalogModelIds).toContain(assignment.primary);
      expect(catalogModelIds).toContain(assignment.fallback);
    }
  });

  // -----------------------------------------------------------------------
  // 9. Routing respects assignments
  // -----------------------------------------------------------------------

  it('should route each agent to their primary model for standard tasks', () => {
    for (const expected of EXPECTED_ASSIGNMENTS) {
      const result = modelRouter.route({
        agentId: expected.agentId as any,
        taskContent: 'Implement a standard feature for the project.',
        sessionId: 'test-session',
      });

      expect(result.model.id).toBe(expected.primary);
      expect(result.reason).toBe('primary');
    }
  });

  // -----------------------------------------------------------------------
  // 10. Model tier distribution
  // -----------------------------------------------------------------------

  it('should have correct tier distribution across models', () => {
    const catalog = modelRouter.getModelCatalog();

    expect(catalog['claude-opus-4-6'].tier).toBe('premium');
    expect(catalog['claude-sonnet-4-6'].tier).toBe('balanced');
    expect(catalog['claude-haiku-4-5'].tier).toBe('fast');
    expect(catalog['gemini-3.1-pro'].tier).toBe('balanced');
    expect(catalog['gemini-flash-3'].tier).toBe('fast');
  });
});
