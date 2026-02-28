/**
 * E2E Test: Riyadh Attendance Tracker — 5-Day Sprint Simulation
 *
 * Simulates a full SDLC sprint for building a Riyadh Attendance Tracker.
 * All LLM providers are mocked — no real API calls.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock LLM providers BEFORE importing source modules
// ---------------------------------------------------------------------------

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class Anthropic {
      messages = {
        create: vi.fn().mockResolvedValue({
          id: 'msg_mock_anthropic',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: '{"status":"ok","result":"mocked anthropic response"}' }],
          model: 'claude-opus-4-6',
          usage: { input_tokens: 500, output_tokens: 250 },
        }),
      };
    },
  };
});

vi.mock('@google/generative-ai', () => {
  return {
    GoogleGenerativeAI: class {
      getGenerativeModel() {
        return {
          generateContent: vi.fn().mockResolvedValue({
            response: {
              text: () => '{"status":"ok","result":"mocked gemini response"}',
              usageMetadata: { promptTokenCount: 400, candidatesTokenCount: 200 },
            },
          }),
        };
      }
    },
  };
});

// Mock the DB module used by model-router recordCost
vi.mock('../../gateway/src/db.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [] }),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks are set up)
// ---------------------------------------------------------------------------

import { ModelRouter } from '../../gateway/src/model-router';
import { SessionManager } from '../../gateway/src/session-manager';
import { TaskManager } from '../../gateway/src/task-manager';
import { AgentManager } from '../../gateway/src/agent-manager';
import type { AgentId, AgentMessage } from '@forge-team/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ALL_AGENT_IDS: AgentId[] = [
  'bmad-master', 'product-owner', 'business-analyst', 'scrum-master',
  'architect', 'ux-designer', 'frontend-dev', 'backend-dev',
  'qa-architect', 'devops-engineer', 'security-specialist', 'tech-writer',
];

function makeMockMessage(
  from: AgentId | 'user',
  to: AgentId | 'dashboard',
  sessionId: string,
  content: string,
): AgentMessage {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: 'chat.message',
    from,
    to,
    payload: { content },
    sessionId,
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('Riyadh Attendance Tracker — Full Sprint E2E', () => {
  let modelRouter: ModelRouter;
  let sessionManager: SessionManager;
  let taskManager: TaskManager;
  let agentManager: AgentManager;

  let sessionId: string;

  beforeAll(() => {
    modelRouter = new ModelRouter();
    sessionManager = new SessionManager({ maxHistorySize: 500, inactivityTimeoutMs: 60_000 });
    taskManager = new TaskManager();
    agentManager = new AgentManager();
  });

  afterAll(() => {
    sessionManager.shutdown();
  });

  // -----------------------------------------------------------------------
  // 1. Session creation
  // -----------------------------------------------------------------------

  it('should create a session for the Riyadh project', () => {
    const session = sessionManager.createSession({
      label: 'Riyadh Attendance Tracker Sprint',
      userId: 'user-bandar',
      metadata: { project: 'riyadh-attendance', sprint: 1 },
    });

    sessionId = session.id;

    expect(session).toBeDefined();
    expect(session.id).toBeTruthy();
    expect(session.label).toBe('Riyadh Attendance Tracker Sprint');
    expect(session.state).toBe('idle');
    expect(session.userId).toBe('user-bandar');
    expect(session.metadata.project).toBe('riyadh-attendance');
  });

  // -----------------------------------------------------------------------
  // 2. Register all 12 agents
  // -----------------------------------------------------------------------

  it('should register all 12 agents with correct models', () => {
    const configs = agentManager.getAllConfigs();
    expect(configs).toHaveLength(12);

    for (const agentId of ALL_AGENT_IDS) {
      const config = agentManager.getConfig(agentId);
      expect(config).toBeDefined();
      expect(config!.id).toBe(agentId);

      // Add each agent to the session
      const added = sessionManager.addAgentToSession(sessionId, agentId);
      expect(added).toBe(true);
    }

    const session = sessionManager.getSession(sessionId);
    expect(session).toBeDefined();
    expect(session!.activeAgents.size).toBe(12);

    // Session should auto-activate when agents join
    expect(session!.state).toBe('active');
  });

  // -----------------------------------------------------------------------
  // 3. Create the initial project brief task and assign to bmad-master
  // -----------------------------------------------------------------------

  it('should create the initial project brief task and assign to bmad-master', () => {
    const task = taskManager.createTask(
      {
        title: 'Create Riyadh Attendance Tracker Project Brief',
        description: 'Define the overall project brief for the Riyadh Attendance Tracker including scope, goals, and timeline.',
        priority: 'high',
        complexity: 'moderate',
        assignedTo: 'bmad-master',
        phase: 'discovery',
        tags: ['project-brief', 'riyadh'],
      },
      sessionId,
    );

    expect(task).toBeDefined();
    expect(task.id).toBeTruthy();
    expect(task.title).toContain('Riyadh Attendance');
    expect(task.status).toBe('backlog');
    expect(task.assignedTo).toBe('bmad-master');
    expect(task.sessionId).toBe(sessionId);

    // Assign the task to the agent via AgentManager as well
    const assigned = agentManager.assignTask('bmad-master', task.id, sessionId);
    expect(assigned).toBe(true);

    const agentState = agentManager.getState('bmad-master');
    expect(agentState!.status).toBe('working');
    expect(agentState!.currentTaskId).toBe(task.id);
  });

  // -----------------------------------------------------------------------
  // 4. Route bmad-master to gemini-3.1-pro
  // -----------------------------------------------------------------------

  it('should route bmad-master to gemini-3.1-pro', () => {
    const result = modelRouter.route({
      agentId: 'bmad-master',
      taskContent: 'Create a project brief and coordinate team work for Riyadh attendance project.',
      sessionId,
    });

    expect(result).toBeDefined();
    expect(result.model.id).toBe('gemini-3.1-pro');
    expect(result.model.provider).toBe('google');
    expect(result.reason).toBe('primary');
    expect(result.estimatedCost).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // 5. Create sub-tasks for requirements phase
  // -----------------------------------------------------------------------

  it('should create sub-tasks for requirements phase', () => {
    // Get the parent task (first task we created)
    const allTasks = taskManager.getTasks({ sessionId });
    const parentTask = allTasks[0];
    expect(parentTask).toBeDefined();

    const subtasks = taskManager.createSubtasks(
      parentTask.id,
      [
        {
          title: 'Gather requirements from Riyadh municipality',
          description: 'Interview stakeholders and document attendance tracking requirements.',
          priority: 'high',
          assignedTo: 'product-owner',
          phase: 'requirements',
          tags: ['requirements', 'riyadh'],
        },
        {
          title: 'Analyze attendance data patterns',
          description: 'Study existing attendance systems and identify improvement opportunities.',
          priority: 'medium',
          assignedTo: 'business-analyst',
          phase: 'requirements',
          tags: ['analysis', 'riyadh'],
        },
        {
          title: 'Plan sprint ceremonies and timeline',
          description: 'Set up sprint structure, daily standups, and review schedule.',
          priority: 'medium',
          assignedTo: 'scrum-master',
          phase: 'requirements',
          tags: ['sprint-planning', 'riyadh'],
        },
      ],
      sessionId,
    );

    expect(subtasks).toHaveLength(3);
    expect(subtasks[0].assignedTo).toBe('product-owner');
    expect(subtasks[1].assignedTo).toBe('business-analyst');
    expect(subtasks[2].assignedTo).toBe('scrum-master');

    // All subtasks should reference the parent
    for (const sub of subtasks) {
      expect(sub.parentTaskId).toBe(parentTask.id);
      expect(sub.status).toBe('backlog');
    }

    // Parent should list subtask IDs
    const updatedParent = taskManager.getTask(parentTask.id);
    expect(updatedParent!.subtaskIds).toHaveLength(3);
  });

  // -----------------------------------------------------------------------
  // 6. Architecture task routed to claude-opus-4-6
  // -----------------------------------------------------------------------

  it('should create architecture task and route to claude-opus-4-6', () => {
    const archTask = taskManager.createTask(
      {
        title: 'Design system architecture for Riyadh Attendance Tracker',
        description: 'Create a scalable system design including database schema, API design, and distributed system architecture for the attendance tracker.',
        priority: 'critical',
        complexity: 'complex',
        assignedTo: 'architect',
        phase: 'architecture',
        tags: ['architecture', 'system-design', 'riyadh'],
      },
      sessionId,
    );

    expect(archTask).toBeDefined();
    expect(archTask.assignedTo).toBe('architect');

    // Route the architect — should get claude-opus-4-6 (primary for architect)
    const result = modelRouter.route({
      agentId: 'architect',
      taskContent: archTask.description,
      sessionId,
    });

    expect(result.model.id).toBe('claude-opus-4-6');
    expect(result.model.provider).toBe('anthropic');
    expect(result.model.tier).toBe('premium');
  });

  // -----------------------------------------------------------------------
  // 7. Track task progression through Kanban columns
  // -----------------------------------------------------------------------

  it('should track task progression through Kanban columns', () => {
    const tasks = taskManager.getTasks({ sessionId });
    const task = tasks[0]; // The project brief task

    // backlog -> todo
    expect(task.status).toBe('backlog');
    let moved = taskManager.moveTask(task.id, 'todo', 'bmad-master');
    expect(moved).toBe(true);
    expect(taskManager.getTask(task.id)!.status).toBe('todo');

    // todo -> in-progress
    moved = taskManager.moveTask(task.id, 'in-progress', 'bmad-master');
    expect(moved).toBe(true);
    expect(taskManager.getTask(task.id)!.status).toBe('in-progress');
    expect(taskManager.getTask(task.id)!.startedAt).toBeTruthy();

    // in-progress -> review
    moved = taskManager.moveTask(task.id, 'review', 'bmad-master');
    expect(moved).toBe(true);
    expect(taskManager.getTask(task.id)!.status).toBe('review');

    // review -> done
    moved = taskManager.moveTask(task.id, 'done', 'bmad-master');
    expect(moved).toBe(true);
    expect(taskManager.getTask(task.id)!.status).toBe('done');
    expect(taskManager.getTask(task.id)!.completedAt).toBeTruthy();

    // Verify the Kanban board reflects the final state
    const board = taskManager.getKanbanBoard(sessionId);
    expect(board.sessionId).toBe(sessionId);
    expect(board.columns).toHaveLength(6); // backlog, todo, in-progress, review, done, cancelled

    const doneColumn = board.columns.find((c) => c.id === 'done');
    expect(doneColumn).toBeDefined();
    expect(doneColumn!.tasks.some((t) => t.id === task.id)).toBe(true);
  });

  // -----------------------------------------------------------------------
  // 8. Record cost for all model calls
  // -----------------------------------------------------------------------

  it('should record cost for all model calls', () => {
    // Simulate 6 model calls across different agents
    const callSpecs: { agentId: AgentId; model: string; inputTokens: number; outputTokens: number }[] = [
      { agentId: 'bmad-master', model: 'gemini-3.1-pro', inputTokens: 1000, outputTokens: 500 },
      { agentId: 'product-owner', model: 'gemini-3.1-pro', inputTokens: 800, outputTokens: 400 },
      { agentId: 'architect', model: 'claude-opus-4-6', inputTokens: 2000, outputTokens: 1500 },
      { agentId: 'backend-dev', model: 'claude-opus-4-6', inputTokens: 1500, outputTokens: 1000 },
      { agentId: 'scrum-master', model: 'gemini-flash-3', inputTokens: 300, outputTokens: 150 },
      { agentId: 'tech-writer', model: 'claude-sonnet-4-6', inputTokens: 600, outputTokens: 300 },
    ];

    for (const spec of callSpecs) {
      const record = modelRouter.recordCost(
        spec.agentId,
        sessionId,
        null,
        spec.model as any,
        spec.inputTokens,
        spec.outputTokens,
        'balanced',
      );

      expect(record).toBeDefined();
      expect(record.id).toBeTruthy();
      expect(record.agentId).toBe(spec.agentId);
      expect(record.cost).toBeGreaterThan(0);
    }

    // Verify cost summary
    const summary = modelRouter.getCostSummary();
    expect(summary.totalRequests).toBe(6);
    expect(summary.totalCost).toBeGreaterThan(0);
    expect(summary.totalInputTokens).toBe(6200); // sum of all input tokens
    expect(summary.totalOutputTokens).toBe(3850); // sum of all output tokens

    // Verify per-agent costs exist
    expect(summary.perAgent['bmad-master']).toBeGreaterThan(0);
    expect(summary.perAgent['architect']).toBeGreaterThan(0);

    // Verify per-provider costs
    expect(summary.perProvider['google']).toBeGreaterThan(0);
    expect(summary.perProvider['anthropic']).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // 9. Verify memory storage for session messages
  // -----------------------------------------------------------------------

  it('should verify memory storage for session messages', () => {
    // Store messages via SessionManager (in-memory message history)
    const messages = [
      makeMockMessage('user', 'bmad-master', sessionId, 'Start the Riyadh Attendance project'),
      makeMockMessage('bmad-master', 'dashboard', sessionId, 'Project brief created for Riyadh Attendance Tracker'),
      makeMockMessage('product-owner', 'dashboard', sessionId, 'Requirements gathered from 5 stakeholders'),
      makeMockMessage('architect', 'dashboard', sessionId, 'System architecture designed: microservices + PostgreSQL'),
      makeMockMessage('backend-dev', 'dashboard', sessionId, 'REST API endpoints implemented'),
    ];

    for (const msg of messages) {
      const added = sessionManager.addMessage(sessionId, msg);
      expect(added).toBe(true);
    }

    // Verify message history
    const history = sessionManager.getMessageHistory(sessionId);
    expect(history).toHaveLength(5);
    expect(history[0].payload.content).toContain('Riyadh Attendance');

    // Filter by type
    const chatMessages = sessionManager.getMessageHistory(sessionId, { type: 'chat.message' });
    expect(chatMessages).toHaveLength(5);

    // Limit
    const last2 = sessionManager.getMessageHistory(sessionId, { limit: 2 });
    expect(last2).toHaveLength(2);
    expect(last2[0].payload.content).toContain('architecture');
    expect(last2[1].payload.content).toContain('API endpoints');

    // Verify session serialization includes message count
    const serialized = sessionManager.serializeSession(sessionId);
    expect(serialized).toBeDefined();
    expect(serialized!.messageCount).toBe(5);
  });
});
