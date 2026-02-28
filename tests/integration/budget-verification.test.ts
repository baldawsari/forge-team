/**
 * Integration Test: Budget Enforcement Verification
 *
 * Verifies the cost cap system including daily/weekly caps, model downgrading,
 * hard blocks, per-agent tracking, and monthly projection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DB module used by model-router
vi.mock('../../gateway/src/db.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [] }),
}));

import { ModelRouter } from '../../gateway/src/model-router';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// For claude-opus-4-6: inputCostPer1M = 15.0, outputCostPer1M = 75.0
// Cost per call with 10000 input + 5000 output tokens:
// (10000/1M)*15 + (5000/1M)*75 = 0.15 + 0.375 = $0.525
const OPUS_INPUT_TOKENS = 10_000;
const OPUS_OUTPUT_TOKENS = 5_000;
const OPUS_COST_PER_CALL = 0.525;

// Architect daily cap = $50, weekly cap = $250
const ARCHITECT_DAILY_CAP = 50;
const ARCHITECT_WEEKLY_CAP = 250;

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('Budget Enforcement — Integration Tests', () => {
  let router: ModelRouter;

  beforeEach(() => {
    router = new ModelRouter();
  });

  // -----------------------------------------------------------------------
  // 1. Allow routing when agent is under daily cap
  // -----------------------------------------------------------------------

  it('should allow routing when agent is under daily cap', () => {
    // Record a small cost that stays well under the $50 daily cap
    router.recordCost('architect', 'session-1', 'task-1', 'claude-opus-4-6', OPUS_INPUT_TOKENS, OPUS_OUTPUT_TOKENS, 'premium');

    const result = router.route({
      agentId: 'architect' as any,
      taskContent: 'Design the database schema for the new feature.',
      sessionId: 'session-1',
    });

    expect(result.model).toBeDefined();
    expect(result.model).not.toBeNull();
    expect(result.model!.id).toBeDefined();

    // Should route to primary model since under cap
    const capStatus = router.checkCostCap('architect');
    expect(capStatus.allowed).toBe(true);
    expect(capStatus.severity).toBe('ok');
    expect(capStatus.dailyUsed).toBeCloseTo(OPUS_COST_PER_CALL, 2);
  });

  // -----------------------------------------------------------------------
  // 2. Downgrade model when agent exceeds 100% daily cap
  // -----------------------------------------------------------------------

  it('should downgrade model when agent exceeds 100% daily cap', () => {
    // Record enough cost to exceed $50 daily cap (96 calls * $0.525 = $50.40)
    const callsToExceed = Math.ceil(ARCHITECT_DAILY_CAP / OPUS_COST_PER_CALL) + 1;
    for (let i = 0; i < callsToExceed; i++) {
      router.recordCost('architect', 'session-1', `task-${i}`, 'claude-opus-4-6', OPUS_INPUT_TOKENS, OPUS_OUTPUT_TOKENS, 'premium');
    }

    const capStatus = router.checkCostCap('architect');
    expect(capStatus.dailyUsed).toBeGreaterThan(ARCHITECT_DAILY_CAP);
    // Between 100% and 120% => downgrade severity
    expect(capStatus.severity).toBe('downgrade');
    expect(capStatus.allowed).toBe(true);

    // Route should still succeed but use a downgraded model
    const result = router.route({
      agentId: 'architect' as any,
      taskContent: 'Implement a standard feature.',
      sessionId: 'session-1',
    });

    expect(result.model).toBeDefined();
    expect(result.model).not.toBeNull();
    // The primary claude-opus-4-6 gets downgraded to claude-sonnet-4-6
    // so the returned model should NOT be the original premium primary
    expect(result.model!.id).not.toBe('claude-opus-4-6');
  });

  // -----------------------------------------------------------------------
  // 3. Hard block when agent exceeds 120% daily cap
  // -----------------------------------------------------------------------

  it('should hard block when agent exceeds 120% daily cap', () => {
    // Need to exceed 120% of $50 = $60
    // 115 calls * $0.525 = $60.375
    const callsToBlock = Math.ceil((ARCHITECT_DAILY_CAP * 1.2) / OPUS_COST_PER_CALL) + 1;
    for (let i = 0; i < callsToBlock; i++) {
      router.recordCost('architect', 'session-1', `task-${i}`, 'claude-opus-4-6', OPUS_INPUT_TOKENS, OPUS_OUTPUT_TOKENS, 'premium');
    }

    const capStatus = router.checkCostCap('architect');
    expect(capStatus.dailyUsed).toBeGreaterThan(ARCHITECT_DAILY_CAP * 1.2);
    expect(capStatus.severity).toBe('blocked');
    expect(capStatus.allowed).toBe(false);
    expect(capStatus.alertTriggered).toBe(true);
  });

  // -----------------------------------------------------------------------
  // 4. Track cost per agent independently
  // -----------------------------------------------------------------------

  it('should track cost per agent independently', () => {
    // Record cost for architect only
    router.recordCost('architect', 'session-1', 'task-1', 'claude-opus-4-6', OPUS_INPUT_TOKENS, OPUS_OUTPUT_TOKENS, 'premium');
    router.recordCost('architect', 'session-1', 'task-2', 'claude-opus-4-6', OPUS_INPUT_TOKENS, OPUS_OUTPUT_TOKENS, 'premium');

    // Architect should have cost recorded
    const architectCost = router.getAgentDailyCost('architect');
    expect(architectCost).toBeCloseTo(OPUS_COST_PER_CALL * 2, 2);

    // Frontend-dev should have $0 cost
    const frontendCost = router.getAgentDailyCost('frontend-dev');
    expect(frontendCost).toBe(0);

    // Verify via cost cap check
    const architectCap = router.checkCostCap('architect');
    expect(architectCap.dailyUsed).toBeGreaterThan(0);

    const frontendCap = router.checkCostCap('frontend-dev');
    expect(frontendCap.dailyUsed).toBe(0);
    expect(frontendCap.severity).toBe('ok');
  });

  // -----------------------------------------------------------------------
  // 5. Enforce weekly caps
  // -----------------------------------------------------------------------

  it('should enforce weekly caps', () => {
    // Architect weekly cap = $250
    // Need to approach/exceed it: 476 calls * $0.525 = $249.90, 477 = $250.425
    const callsToExceedWeekly = Math.ceil(ARCHITECT_WEEKLY_CAP / OPUS_COST_PER_CALL) + 1;
    for (let i = 0; i < callsToExceedWeekly; i++) {
      router.recordCost('architect', 'session-1', `task-${i}`, 'claude-opus-4-6', OPUS_INPUT_TOKENS, OPUS_OUTPUT_TOKENS, 'premium');
    }

    const weeklyUsed = router.getAgentWeeklyCost('architect');
    expect(weeklyUsed).toBeGreaterThan(ARCHITECT_WEEKLY_CAP);

    const capStatus = router.checkCostCap('architect');
    // Weekly ratio > 1.0 so severity should be at least 'downgrade'
    expect(['downgrade', 'blocked']).toContain(capStatus.severity);
    expect(capStatus.weeklyUsed).toBeGreaterThan(ARCHITECT_WEEKLY_CAP);
    expect(capStatus.weeklyCap).toBe(ARCHITECT_WEEKLY_CAP);
    expect(capStatus.alertTriggered).toBe(true);
  });

  // -----------------------------------------------------------------------
  // 6. Monthly projection under $450 with typical usage
  // -----------------------------------------------------------------------

  it('should calculate monthly projection under $450 with typical usage', () => {
    // Simulate 22 working days of moderate usage across all 12 agents.
    // "Moderate" = 3 calls per agent per day using their assigned model.
    //
    // Per-call costs (using primary models):
    // claude-opus-4-6 (architect, backend-dev, qa-architect, security-specialist):
    //   (2000/1M)*15 + (1000/1M)*75 = $0.03 + $0.075 = $0.105
    // claude-sonnet-4-6 (tech-writer):
    //   (2000/1M)*3 + (1000/1M)*15 = $0.006 + $0.015 = $0.021
    // gemini-3.1-pro (bmad-master, product-owner, business-analyst, ux-designer, frontend-dev, devops-engineer):
    //   (2000/1M)*1.25 + (1000/1M)*5 = $0.0025 + $0.005 = $0.0075
    // gemini-flash-3 (scrum-master):
    //   (2000/1M)*0.1 + (1000/1M)*0.4 = $0.0002 + $0.0004 = $0.0006

    const MODERATE_INPUT = 2000;
    const MODERATE_OUTPUT = 1000;
    const CALLS_PER_DAY = 3;
    const WORKING_DAYS = 22;

    const agents: Array<{ id: string; model: string }> = [
      { id: 'bmad-master', model: 'gemini-3.1-pro' },
      { id: 'product-owner', model: 'gemini-3.1-pro' },
      { id: 'business-analyst', model: 'gemini-3.1-pro' },
      { id: 'scrum-master', model: 'gemini-flash-3' },
      { id: 'architect', model: 'claude-opus-4-6' },
      { id: 'ux-designer', model: 'gemini-3.1-pro' },
      { id: 'frontend-dev', model: 'gemini-3.1-pro' },
      { id: 'backend-dev', model: 'claude-opus-4-6' },
      { id: 'qa-architect', model: 'claude-opus-4-6' },
      { id: 'devops-engineer', model: 'gemini-3.1-pro' },
      { id: 'security-specialist', model: 'claude-opus-4-6' },
      { id: 'tech-writer', model: 'claude-sonnet-4-6' },
    ];

    // Record simulated costs
    for (const agent of agents) {
      for (let day = 0; day < WORKING_DAYS; day++) {
        for (let call = 0; call < CALLS_PER_DAY; call++) {
          router.recordCost(
            agent.id as any,
            `session-month`,
            `task-${agent.id}-d${day}-c${call}`,
            agent.model as any,
            MODERATE_INPUT,
            MODERATE_OUTPUT,
            'balanced'
          );
        }
      }
    }

    const summary = router.getCostSummary();

    // Total should be well under $450
    // Calculation:
    //   4 opus agents * 22 days * 3 calls * $0.105 = $27.72
    //   1 sonnet agent * 22 * 3 * $0.021 = $1.386
    //   6 gemini-pro agents * 22 * 3 * $0.0075 = $2.97
    //   1 flash agent * 22 * 3 * $0.0006 = $0.0396
    //   Total ~ $32.12
    expect(summary.totalCost).toBeLessThan(450);
    expect(summary.totalCost).toBeGreaterThan(0);
    expect(summary.totalRequests).toBe(agents.length * WORKING_DAYS * CALLS_PER_DAY);
  });
});
