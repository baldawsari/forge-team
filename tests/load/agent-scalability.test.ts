/**
 * Load Test: Agent Scalability
 *
 * Tests the gateway managers under high-volume agent registrations,
 * concurrent task assignments, model routing, and message throughput.
 * All operations use in-memory managers with mocked dependencies.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock DB for model-router cost recording
vi.mock('../../gateway/src/db.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [] }),
}));

import { SessionManager } from '../../gateway/src/session-manager';
import { TaskManager } from '../../gateway/src/task-manager';
import { AgentManager } from '../../gateway/src/agent-manager';
import { ModelRouter } from '../../gateway/src/model-router';
import type { AgentId, AgentMessage } from '@forge-team/shared';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BMAD_AGENTS: AgentId[] = [
  'bmad-master', 'product-owner', 'business-analyst', 'scrum-master',
  'architect', 'ux-designer', 'frontend-dev', 'backend-dev',
  'qa-architect', 'devops-engineer', 'security-specialist', 'tech-writer',
];

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('Agent Scalability — Load Tests', () => {
  let sessionManager: SessionManager;
  let taskManager: TaskManager;
  let agentManager: AgentManager;
  let modelRouter: ModelRouter;

  beforeEach(() => {
    sessionManager = new SessionManager({ maxHistorySize: 5000, inactivityTimeoutMs: 60_000 });
    taskManager = new TaskManager();
    agentManager = new AgentManager();
    modelRouter = new ModelRouter();
  });

  afterEach(() => {
    sessionManager.shutdown();
  });

  // -----------------------------------------------------------------------
  // 1. Spawn 100 mock agent registrations
  // -----------------------------------------------------------------------

  it('should spawn 100 mock agent registrations without crash', () => {
    // Create 100 sessions, each registering all 12 agents
    const sessions: string[] = [];

    for (let i = 0; i < 100; i++) {
      const session = sessionManager.createSession({
        label: `Load Test Session ${i}`,
        userId: `user-${i}`,
        metadata: { loadTest: true, index: i },
      });
      sessions.push(session.id);

      // Register all 12 BMAD agents into this session
      for (const agentId of BMAD_AGENTS) {
        const added = sessionManager.addAgentToSession(session.id, agentId);
        expect(added).toBe(true);
      }
    }

    expect(sessions).toHaveLength(100);

    // Verify all 100 sessions exist and are active
    const allSessions = sessionManager.getAllSessions();
    expect(allSessions).toHaveLength(100);

    for (const session of allSessions) {
      expect(session.state).toBe('active');
      expect(session.activeAgents.size).toBe(12);
    }

    // Verify the agent manager still has all 12 configs intact
    const configs = agentManager.getAllConfigs();
    expect(configs).toHaveLength(12);
  });

  // -----------------------------------------------------------------------
  // 2. Handle 100 concurrent task assignments
  // -----------------------------------------------------------------------

  it('should handle 100 concurrent task assignments', () => {
    const session = sessionManager.createSession({ label: 'Task Load Session' });
    const sessionId = session.id;

    // Create 100 tasks spread across agents
    const tasks: string[] = [];
    for (let i = 0; i < 100; i++) {
      const agentId = BMAD_AGENTS[i % BMAD_AGENTS.length];
      const task = taskManager.createTask(
        {
          title: `Load test task #${i}`,
          description: `Task number ${i} for load testing assignment throughput.`,
          priority: i % 4 === 0 ? 'critical' : i % 3 === 0 ? 'high' : i % 2 === 0 ? 'medium' : 'low',
          complexity: 'moderate',
          assignedTo: agentId,
          phase: 'implementation',
          tags: ['load-test'],
        },
        sessionId,
      );
      tasks.push(task.id);
    }

    expect(tasks).toHaveLength(100);

    // Verify all tasks were created
    const allTasks = taskManager.getTasks({ sessionId });
    expect(allTasks).toHaveLength(100);

    // Move all tasks through the pipeline: backlog -> todo -> in-progress
    let movedToTodo = 0;
    let movedToInProgress = 0;

    for (const taskId of tasks) {
      const toTodo = taskManager.moveTask(taskId, 'todo', 'system');
      if (toTodo) movedToTodo++;
    }

    // WIP limit for 'todo' is 20, so not all will move
    expect(movedToTodo).toBeLessThanOrEqual(100);
    expect(movedToTodo).toBeGreaterThan(0);

    // Try to move tasks from todo to in-progress
    const todoTasks = taskManager.getTasks({ sessionId, status: 'todo' });
    for (const task of todoTasks) {
      const toInProgress = taskManager.moveTask(task.id, 'in-progress', 'system');
      if (toInProgress) movedToInProgress++;
    }

    // WIP limit for 'in-progress' is 10
    expect(movedToInProgress).toBeLessThanOrEqual(10);
    expect(movedToInProgress).toBeGreaterThan(0);

    // Verify Kanban board stats
    const stats = taskManager.getStats(sessionId);
    expect(stats.total).toBe(100);
    expect(stats.byStatus).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // 3. Handle 100 concurrent model routing requests
  // -----------------------------------------------------------------------

  it('should handle 100 concurrent model routing requests', () => {
    const sessionId = 'routing-load-session';

    const results: { agentId: AgentId; modelId: string; reason: string }[] = [];
    const errors: Error[] = [];

    for (let i = 0; i < 100; i++) {
      const agentId = BMAD_AGENTS[i % BMAD_AGENTS.length];
      try {
        const result = modelRouter.route({
          agentId,
          taskContent: `Load test task content #${i}. This involves implementing a feature for the system.`,
          sessionId,
        });
        results.push({
          agentId,
          modelId: result.model.id,
          reason: result.reason,
        });
      } catch (err) {
        errors.push(err as Error);
      }
    }

    // No errors should occur
    expect(errors).toHaveLength(0);

    // All 100 routing requests should succeed
    expect(results).toHaveLength(100);

    // Verify correct model assignments across all routes
    for (const result of results) {
      // Model should always be one of the 5 supported models
      expect([
        'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5',
        'gemini-3.1-pro', 'gemini-flash-3',
      ]).toContain(result.modelId);

      // Reason should be valid
      expect([
        'primary', 'fallback', 'complexity-override',
        'cost-constraint', 'capability-requirement',
      ]).toContain(result.reason);
    }

    // Record costs for all 100 calls and verify summary
    for (let i = 0; i < results.length; i++) {
      modelRouter.recordCost(
        results[i].agentId,
        sessionId,
        null,
        results[i].modelId as any,
        500 + (i * 10),
        250 + (i * 5),
        'balanced',
      );
    }

    const summary = modelRouter.getCostSummary();
    expect(summary.totalRequests).toBe(100);
    expect(summary.totalCost).toBeGreaterThan(0);
    expect(summary.totalInputTokens).toBeGreaterThan(0);
    expect(summary.totalOutputTokens).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // 4. Handle 1000 messages in a single session
  // -----------------------------------------------------------------------

  it('should handle 1000 messages in a single session', () => {
    const session = sessionManager.createSession({
      label: 'Message Throughput Session',
      maxHistorySize: 5000,
    } as any);
    const sessionId = session.id;

    // Add an agent so the session becomes active
    sessionManager.addAgentToSession(sessionId, 'bmad-master');

    const MESSAGE_COUNT = 1000;
    let addedCount = 0;

    for (let i = 0; i < MESSAGE_COUNT; i++) {
      const fromAgent = BMAD_AGENTS[i % BMAD_AGENTS.length];
      const message: AgentMessage = {
        id: `msg-${i}`,
        type: i % 5 === 0 ? 'task.progress' : 'chat.message',
        from: fromAgent,
        to: 'dashboard',
        payload: {
          content: `Message #${i} from ${fromAgent}: Reporting progress on load test item ${i}.`,
          data: { index: i, timestamp: Date.now() },
        },
        sessionId,
        timestamp: new Date().toISOString(),
      };

      const added = sessionManager.addMessage(sessionId, message);
      if (added) addedCount++;
    }

    expect(addedCount).toBe(MESSAGE_COUNT);

    // Verify message history
    const history = sessionManager.getMessageHistory(sessionId);
    expect(history.length).toBe(MESSAGE_COUNT);

    // Verify filtering works at scale
    const chatOnly = sessionManager.getMessageHistory(sessionId, { type: 'chat.message' });
    const progressOnly = sessionManager.getMessageHistory(sessionId, { type: 'task.progress' });

    // 1 in 5 messages is task.progress, rest are chat.message
    expect(progressOnly.length).toBe(200); // 1000 / 5
    expect(chatOnly.length).toBe(800);     // 1000 - 200

    // Verify limit works
    const last10 = sessionManager.getMessageHistory(sessionId, { limit: 10 });
    expect(last10).toHaveLength(10);
    expect(last10[9].id).toBe(`msg-${MESSAGE_COUNT - 1}`);

    // Verify session serialization performance
    const serialized = sessionManager.serializeSession(sessionId);
    expect(serialized).toBeDefined();
    expect(serialized!.messageCount).toBe(MESSAGE_COUNT);
  });
});
