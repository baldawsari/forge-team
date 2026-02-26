/**
 * ForgeTeam Gateway - Main Entry Point
 *
 * The Gateway is the CENTRAL HUB of the ForgeTeam system.
 * Everything flows through it: user messages, agent-to-agent communication,
 * task management, delegation protocol, and real-time dashboard updates.
 *
 * Architecture:
 * - Express HTTP server on port 3001 (health checks, REST API)
 * - WebSocket server on the same port (real-time communication)
 * - SessionManager: session lifecycle management
 * - AgentManager: agent configuration, state, and dispatch
 * - TaskManager: Kanban board and task CRUD
 * - VIADPEngine: inter-agent delegation protocol
 * - ModelRouter: AI model selection and cost tracking
 * - VoiceHandler: STT/TTS integration
 */

import http from 'http';
import express from 'express';
import cors from 'cors';
import { Server as SocketIOServer } from 'socket.io';
import { v4 as uuid } from 'uuid';
import { SessionManager } from './session-manager';
import { AgentManager } from './agent-manager';
import { TaskManager } from './task-manager';
import { VIADPEngine } from './viadp-engine';
import { ModelRouter } from './model-router';
import { VoiceHandler } from './voice-handler';
import { GatewayServer } from './server';
import { AgentRunner } from './agent-runner';
import type { AgentId, AgentMessage, CreateTaskInput } from '@forge-team/shared';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.GATEWAY_PORT ?? '3001', 10);
const HOST = process.env.GATEWAY_HOST ?? '0.0.0.0';

// ---------------------------------------------------------------------------
// Initialize Managers
// ---------------------------------------------------------------------------

console.log('==========================================================');
console.log('  ForgeTeam Gateway - Initializing');
console.log('==========================================================');

const sessionManager = new SessionManager({
  maxHistorySize: 2000,
  inactivityTimeoutMs: 60 * 60 * 1000, // 1 hour
});
console.log('[Init] SessionManager initialized');

const agentManager = new AgentManager();
console.log('[Init] AgentManager initialized');

const taskManager = new TaskManager();
console.log('[Init] TaskManager initialized');

const viadpEngine = new VIADPEngine(agentManager);
console.log('[Init] VIADPEngine initialized');

const modelRouter = new ModelRouter();
console.log('[Init] ModelRouter initialized');

const voiceHandler = new VoiceHandler();
console.log('[Init] VoiceHandler initialized');

const agentRunner = new AgentRunner({
  modelRouter,
  agentManager,
  sessionManager,
});
console.log('[Init] AgentRunner initialized');

// ---------------------------------------------------------------------------
// Express HTTP Server
// ---------------------------------------------------------------------------

const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));

/**
 * Health check endpoint.
 * Returns system status including all manager states.
 */
app.get('/health', (_req, res) => {
  const connectionStats = gatewayServer.getConnectionStats();
  const voiceStatus = voiceHandler.getStatus();
  const viadpSummary = viadpEngine.getSummary();
  const costSummary = modelRouter.getCostSummary();

  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: '0.1.0',
    services: {
      sessions: {
        active: sessionManager.getActiveSessionCount(),
        total: sessionManager.getAllSessions().length,
      },
      agents: {
        total: agentManager.getAllConfigs().length,
        idle: agentManager.getAgentsByStatus('idle').length,
        working: agentManager.getAgentsByStatus('working').length,
        offline: agentManager.getAgentsByStatus('offline').length,
      },
      connections: connectionStats,
      voice: voiceStatus,
      viadp: viadpSummary,
      costs: {
        totalCost: costSummary.totalCost,
        totalRequests: costSummary.totalRequests,
      },
    },
  });
});

/**
 * Agent list endpoint.
 */
app.get('/api/agents', (_req, res) => {
  res.json({
    agents: agentManager.getAgentSummary(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * Agent detail endpoint.
 */
app.get('/api/agents/:agentId', (req, res) => {
  const agentId = req.params.agentId as any;
  const config = agentManager.getConfig(agentId);
  const state = agentManager.getState(agentId);

  if (!config) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }

  res.json({ config, state, timestamp: new Date().toISOString() });
});

/**
 * Session list endpoint.
 */
app.get('/api/sessions', (_req, res) => {
  const sessions = sessionManager.getAllSessions().map((s) =>
    sessionManager.serializeSession(s.id)
  );
  res.json({ sessions, timestamp: new Date().toISOString() });
});

/**
 * Session detail endpoint.
 */
app.get('/api/sessions/:sessionId', (req, res) => {
  const session = sessionManager.getSession(req.params.sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  res.json({
    session: sessionManager.serializeSession(session.id),
    timestamp: new Date().toISOString(),
  });
});

/**
 * Create session via REST.
 */
app.post('/api/sessions', (req, res) => {
  const session = sessionManager.createSession({
    label: req.body?.label,
    userId: req.body?.userId,
    metadata: req.body?.metadata,
  });
  res.status(201).json({
    session: sessionManager.serializeSession(session.id),
    timestamp: new Date().toISOString(),
  });
});

/**
 * Task list endpoint.
 */
app.get('/api/tasks', (req, res) => {
  const tasks = taskManager.getTasks({
    sessionId: req.query.sessionId as string,
    status: req.query.status as any,
    assignedTo: req.query.assignedTo as any,
  });
  res.json({ tasks, timestamp: new Date().toISOString() });
});

/**
 * Kanban board endpoint.
 */
app.get('/api/kanban/:sessionId', (req, res) => {
  const board = taskManager.getKanbanBoard(req.params.sessionId);
  res.json({ board, timestamp: new Date().toISOString() });
});

/**
 * Create task via REST.
 */
app.post('/api/tasks', (req, res) => {
  const sessionId = req.body?.sessionId;
  if (!sessionId) {
    res.status(400).json({ error: 'sessionId is required' });
    return;
  }

  const task = taskManager.createTask(req.body, sessionId);
  res.status(201).json({ task, timestamp: new Date().toISOString() });
});

/**
 * Task statistics endpoint.
 */
app.get('/api/tasks/stats/:sessionId', (req, res) => {
  const stats = taskManager.getStats(req.params.sessionId);
  res.json({ stats, timestamp: new Date().toISOString() });
});

/**
 * Model assignments endpoint.
 */
app.get('/api/models/assignments', (_req, res) => {
  const assignments = modelRouter.getAllAssignments();
  const catalog = modelRouter.getModelCatalog();
  res.json({ assignments, catalog, timestamp: new Date().toISOString() });
});

/**
 * Model cost summary endpoint.
 */
app.get('/api/models/costs', (req, res) => {
  const summary = modelRouter.getCostSummary(
    req.query.from as string,
    req.query.to as string
  );
  res.json({ summary, timestamp: new Date().toISOString() });
});

/**
 * Model route endpoint (classify and route).
 */
app.post('/api/models/route', (req, res) => {
  const result = modelRouter.route({
    agentId: req.body?.agentId,
    taskContent: req.body?.taskContent ?? '',
    tierOverride: req.body?.tierOverride,
    maxCost: req.body?.maxCost,
    requireVision: req.body?.requireVision,
    requireTools: req.body?.requireTools,
    sessionId: req.body?.sessionId ?? '',
  });
  res.json({ result, timestamp: new Date().toISOString() });
});

/**
 * VIADP summary endpoint.
 */
app.get('/api/viadp/summary', (_req, res) => {
  const summary = viadpEngine.getSummary();
  res.json({ summary, timestamp: new Date().toISOString() });
});

/**
 * VIADP delegation requests endpoint.
 */
app.get('/api/viadp/delegations', (req, res) => {
  const delegations = viadpEngine.getAllRequests({
    status: req.query.status as any,
    from: req.query.from as any,
    to: req.query.to as any,
    sessionId: req.query.sessionId as string,
  });
  res.json({ delegations, timestamp: new Date().toISOString() });
});

/**
 * VIADP trust scores endpoint.
 */
app.get('/api/viadp/trust/:agentId', (req, res) => {
  const agentId = req.params.agentId as any;
  const scores = viadpEngine.getAllTrustScores(agentId);
  res.json({ agentId, scores, timestamp: new Date().toISOString() });
});

/**
 * VIADP audit trail endpoint.
 */
app.get('/api/viadp/audit', (req, res) => {
  const entries = viadpEngine.getFullAuditTrail({
    actor: req.query.actor as any,
    action: req.query.action as any,
    since: req.query.since as string,
  });
  res.json({ entries, total: entries.length, timestamp: new Date().toISOString() });
});

/**
 * Voice status endpoint.
 */
app.get('/api/voice/status', (_req, res) => {
  const status = voiceHandler.getStatus();
  res.json({ status, timestamp: new Date().toISOString() });
});

/**
 * Voice transcribe endpoint (STT).
 * Accepts { audioBase64, language } and returns transcribed text.
 */
app.post('/api/voice/transcribe', async (req, res) => {
  try {
    const { audioBase64, language } = req.body ?? {};
    if (!audioBase64) {
      res.status(400).json({ error: 'audioBase64 is required' });
      return;
    }
    const audioBuffer = Buffer.from(audioBase64, 'base64');
    const result = await voiceHandler.transcribe(audioBuffer, language ?? 'en');
    res.json({ result, timestamp: new Date().toISOString() });
  } catch (error: any) {
    console.error('[Voice] Transcribe error:', error);
    res.status(500).json({ error: error?.message ?? 'Transcription failed' });
  }
});

/**
 * Voice synthesize endpoint (TTS).
 * Accepts { text, language } and returns audio base64.
 */
app.post('/api/voice/synthesize', async (req, res) => {
  try {
    const { text, language } = req.body ?? {};
    if (!text) {
      res.status(400).json({ error: 'text is required' });
      return;
    }
    const result = await voiceHandler.synthesize({ text, language: language ?? 'en' });
    res.json({ result, timestamp: new Date().toISOString() });
  } catch (error: any) {
    console.error('[Voice] Synthesize error:', error);
    res.status(500).json({ error: error?.message ?? 'Synthesis failed' });
  }
});

/**
 * Connection stats endpoint.
 */
app.get('/api/connections', (_req, res) => {
  const stats = gatewayServer.getConnectionStats();
  res.json({ stats, timestamp: new Date().toISOString() });
});

/**
 * Seed / Demo endpoint.
 * Creates realistic sample data so the dashboard has something to display.
 * Idempotent-ish: calling it multiple times will create additional data.
 */
app.post('/api/seed', (_req, res) => {
  try {
    // ------------------------------------------------------------------
    // 1. Create a demo session
    // ------------------------------------------------------------------
    const session = sessionManager.createSession({
      label: 'riyadh-attendance-tracker',
      metadata: {
        project: 'Riyadh Attendance Tracker',
        client: 'MOMRA',
        description: 'Employee attendance tracking system with geofencing for Riyadh municipality',
      },
    });
    const sid = session.id;

    // Helper: create a task and move it through Kanban columns to target status
    const createAndMove = (
      input: CreateTaskInput,
      targetStatus: 'backlog' | 'todo' | 'in-progress' | 'review' | 'done',
    ) => {
      const task = taskManager.createTask(input, sid);
      const transitions: Array<'backlog' | 'todo' | 'in-progress' | 'review' | 'done'> =
        ['backlog', 'todo', 'in-progress', 'review', 'done'];
      const from = transitions.indexOf('backlog');
      const to = transitions.indexOf(targetStatus);
      for (let i = from + 1; i <= to; i++) {
        taskManager.moveTask(task.id, transitions[i], 'system');
      }
      return task;
    };

    // ------------------------------------------------------------------
    // 2. Create sample tasks across all Kanban columns
    // ------------------------------------------------------------------

    // Backlog (3 tasks)
    const t1 = createAndMove({
      title: 'Implement WhatsApp Business API notifications',
      description: 'Integrate WhatsApp Business API for sending attendance reminders and alerts to employees',
      priority: 'medium',
      complexity: 'complex',
      tags: ['notifications', 'whatsapp', 'integration'],
      phase: 'implementation',
    }, 'backlog');

    const t2 = createAndMove({
      title: 'Add multi-level approval workflow',
      description: 'Implement configurable approval chains: team lead -> department manager -> HR director',
      priority: 'low',
      complexity: 'complex',
      tags: ['workflow', 'approvals'],
      phase: 'implementation',
    }, 'backlog');

    const t3 = createAndMove({
      title: 'Export to Excel/PDF for MOMRA',
      description: 'Generate compliant attendance reports in Excel and PDF formats for MOMRA auditing requirements',
      priority: 'medium',
      complexity: 'moderate',
      tags: ['export', 'reporting', 'momra'],
      phase: 'implementation',
    }, 'backlog');

    // To Do (2 tasks)
    const t4 = createAndMove({
      title: 'Design database schema for attendance',
      description: 'Design PostgreSQL schema with Supabase: employees, check-ins, locations, departments, shifts',
      priority: 'high',
      complexity: 'moderate',
      tags: ['database', 'schema', 'supabase'],
      phase: 'architecture',
      assignedTo: 'backend-dev' as AgentId,
    }, 'todo');

    const t5 = createAndMove({
      title: 'Create Saudization compliance module',
      description: 'Build module to track and report Saudization (Nitaqat) ratios per department with color-coded zones',
      priority: 'high',
      complexity: 'complex',
      tags: ['saudization', 'compliance', 'nitaqat'],
      phase: 'implementation',
    }, 'todo');

    // In Progress (3 tasks)
    const t6 = createAndMove({
      title: 'Build employee check-in/out with geofencing',
      description: 'Implement GPS-based geofencing for employee check-in/out with configurable radius per office location',
      priority: 'critical',
      complexity: 'complex',
      assignedTo: 'backend-dev' as AgentId,
      tags: ['geofencing', 'check-in', 'gps'],
      phase: 'implementation',
      storyPoints: 8,
    }, 'in-progress');

    const t7 = createAndMove({
      title: 'Implement real-time dashboard KPIs',
      description: 'Build live dashboard showing: present/absent counts, late arrivals, department-wise breakdown, trend charts',
      priority: 'high',
      complexity: 'moderate',
      assignedTo: 'frontend-dev' as AgentId,
      tags: ['dashboard', 'kpi', 'real-time'],
      phase: 'implementation',
      storyPoints: 5,
    }, 'in-progress');

    const t8 = createAndMove({
      title: 'Set up Supabase auth + RLS policies',
      description: 'Configure Supabase authentication with role-based access and Row Level Security for multi-tenant data isolation',
      priority: 'critical',
      complexity: 'moderate',
      assignedTo: 'backend-dev' as AgentId,
      tags: ['auth', 'rls', 'supabase', 'security'],
      phase: 'implementation',
      storyPoints: 5,
    }, 'in-progress');

    // Review (2 tasks)
    const t9 = createAndMove({
      title: 'Architecture design document',
      description: 'Complete system architecture with C4 diagrams, tech stack decisions, scalability plan, and deployment topology',
      priority: 'high',
      complexity: 'complex',
      assignedTo: 'architect' as AgentId,
      tags: ['architecture', 'design', 'documentation'],
      phase: 'architecture',
      storyPoints: 8,
    }, 'review');

    const t10 = createAndMove({
      title: 'UI/UX wireframes RTL',
      description: 'Full wireframe set with RTL Arabic layout, responsive breakpoints, and accessibility compliance for WCAG 2.1 AA',
      priority: 'high',
      complexity: 'moderate',
      assignedTo: 'ux-designer' as AgentId,
      tags: ['ux', 'wireframes', 'rtl', 'arabic', 'accessibility'],
      phase: 'design',
      storyPoints: 5,
    }, 'review');

    // Done (2 tasks)
    const t11 = createAndMove({
      title: 'Requirements gathering and user stories',
      description: '12 user stories with acceptance criteria covering employee check-in, manager oversight, HR reporting, and admin configuration',
      priority: 'critical',
      complexity: 'moderate',
      tags: ['requirements', 'user-stories'],
      phase: 'requirements',
      storyPoints: 5,
    }, 'done');

    const t12 = createAndMove({
      title: 'Market analysis - Saudi attendance solutions',
      description: 'Competitive analysis of 8 existing Saudi attendance solutions. Key differentiators identified: geofencing accuracy and Saudization compliance.',
      priority: 'medium',
      complexity: 'simple',
      tags: ['research', 'market-analysis'],
      phase: 'discovery',
      storyPoints: 3,
    }, 'done');

    const allTasks = [t1, t2, t3, t4, t5, t6, t7, t8, t9, t10, t11, t12];

    // ------------------------------------------------------------------
    // 3. Set agent statuses and assign tasks
    // ------------------------------------------------------------------

    // backend-dev: working on geofencing task
    agentManager.assignTask('backend-dev' as AgentId, t6.id, sid);

    // frontend-dev: working on dashboard task
    agentManager.assignTask('frontend-dev' as AgentId, t7.id, sid);

    // architect: reviewing architecture doc
    agentManager.setAgentStatus('architect' as AgentId, 'reviewing');

    // ux-designer: reviewing wireframes
    agentManager.setAgentStatus('ux-designer' as AgentId, 'reviewing');

    // qa-architect: idle (explicitly, already default)
    agentManager.setAgentStatus('qa-architect' as AgentId, 'idle');

    // ------------------------------------------------------------------
    // 4. Create sample inter-agent messages
    // ------------------------------------------------------------------

    const makeMessage = (
      from: AgentMessage['from'],
      to: AgentMessage['to'],
      content: string,
      type: AgentMessage['type'] = 'chat.message',
      minutesAgo: number = 0,
    ): AgentMessage => ({
      id: uuid(),
      type,
      from,
      to,
      payload: { content },
      sessionId: sid,
      timestamp: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    });

    const messages: AgentMessage[] = [
      makeMessage(
        'bmad-master', 'product-owner',
        'New project assigned: Riyadh Attendance Tracker. Full context attached.',
        'task.assign', 55,
      ),
      makeMessage(
        'product-owner', 'architect',
        'Requirements doc ready. 12 user stories with acceptance criteria. Please begin architecture.',
        'chat.message', 45,
      ),
      makeMessage(
        'architect', 'frontend-dev',
        'Architecture approved. Here\'s the system diagram and component spec. Start with the dashboard layout.',
        'task.assign', 30,
      ),
      makeMessage(
        'architect', 'backend-dev',
        'API spec attached. 14 endpoints. Start with auth + geofencing modules.',
        'task.assign', 30,
      ),
      makeMessage(
        'backend-dev', 'qa-architect',
        'Check-in API ready for review. Includes geofencing validation.',
        'review.request', 15,
      ),
      makeMessage(
        'frontend-dev', 'ux-designer',
        'Need RTL clarification on the Kanban component - should columns reverse?',
        'chat.message', 10,
      ),
      makeMessage(
        'ux-designer', 'frontend-dev',
        'Yes, columns should flow right-to-left. Use CSS logical properties.',
        'chat.response', 8,
      ),
      makeMessage(
        'qa-architect', 'bmad-master',
        '@human - Need approval on test strategy for Saudization compliance module.',
        'chat.message', 3,
      ),
    ];

    // Dispatch all messages through the agent manager and record in session
    for (const msg of messages) {
      agentManager.dispatchMessage(msg);
      sessionManager.addMessage(sid, msg);
    }

    // ------------------------------------------------------------------
    // 5. Return success response
    // ------------------------------------------------------------------

    console.log(`[Seed] Demo data created: session=${sid}, tasks=${allTasks.length}, messages=${messages.length}`);

    res.status(201).json({
      success: true,
      created: {
        session: sid,
        tasks: allTasks.length,
        messages: messages.length,
      },
      timestamp: new Date().toISOString(),
    });

  } catch (error: any) {
    console.error('[Seed] Error creating demo data:', error);
    res.status(500).json({
      success: false,
      error: error?.message ?? 'Unknown error during seeding',
    });
  }
});

// ---------------------------------------------------------------------------
// Create HTTP + WebSocket Server
// ---------------------------------------------------------------------------

const httpServer = http.createServer(app);

const gatewayServer = new GatewayServer({
  sessionManager,
  agentManager,
  taskManager,
  viadpEngine,
  modelRouter,
  voiceHandler,
});

gatewayServer.attach(httpServer);

// ---------------------------------------------------------------------------
// Socket.IO Server (for Dashboard real-time updates)
// ---------------------------------------------------------------------------

const io = new SocketIOServer(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  path: '/socket.io',
});

io.on('connection', (socket) => {
  console.log(`[Socket.IO] Dashboard connected: ${socket.id}`);

  // Send initial state snapshot on connect
  socket.emit('initial_state', {
    agents: agentManager.getAgentSummary(),
    tasks: taskManager.getTasks(),
    sessions: sessionManager.getAllSessions().map((s) => sessionManager.serializeSession(s.id)),
    viadp: viadpEngine.getSummary(),
    health: {
      uptime: process.uptime(),
      connections: gatewayServer.getConnectionStats(),
    },
  });

  // Handle chat messages from the dashboard
  socket.on('chat.message', (data: { payload: { to: string; content: string; correlationId?: string }; sessionId: string }) => {
    const { payload, sessionId } = data;
    if (!payload?.content || !sessionId) return;

    const isBroadcast = payload.to === 'broadcast';

    const message: AgentMessage = {
      id: uuid(),
      type: 'chat.message',
      from: 'user' as any,
      to: (isBroadcast ? 'bmad-master' : payload.to) as any,
      payload: { content: payload.content },
      sessionId,
      timestamp: new Date().toISOString(),
      correlationId: payload.correlationId,
    };

    // Record in session history
    sessionManager.addMessage(sessionId, message);

    // Broadcast to all dashboard connections
    io.emit('message', message);

    console.log(`[Chat] User -> ${payload.to}: "${payload.content.slice(0, 60)}..." (session=${sessionId})`);

    // --- If broadcast, send the message to ALL connected agents in the session ---
    if (isBroadcast) {
      const allAgents = agentManager.getAllConfigs();
      for (const agentCfg of allAgents) {
        const agentId = agentCfg.id as AgentId;
        if (agentId === 'bmad-master') continue; // bmad-master handled below as primary
        agentManager.dispatchMessage({
          ...message,
          id: uuid(),
          to: agentId,
        });
      }
    }

    // --- Trigger agent reply asynchronously (bmad-master is primary handler for broadcasts) ---
    const targetAgentId = (isBroadcast ? 'bmad-master' : payload.to) as AgentId;
    const agentConfig = agentManager.getConfig(targetAgentId);

    if (agentConfig) {
      // Set agent to working while processing
      agentManager.setAgentStatus(targetAgentId, 'working');

      agentRunner
        .processUserMessage(targetAgentId, payload.content, sessionId)
        .then((result) => {
          const responseMessage: AgentMessage = {
            id: uuid(),
            type: 'chat.response',
            from: targetAgentId,
            to: 'user',
            payload: {
              content: result.content,
              data: {
                model: result.model,
                inputTokens: result.inputTokens,
                outputTokens: result.outputTokens,
              },
            },
            sessionId,
            timestamp: new Date().toISOString(),
            correlationId: message.id,
          };

          // Record in session history
          sessionManager.addMessage(sessionId, responseMessage);

          // Broadcast to all dashboard connections
          io.emit('message', responseMessage);

          // Set agent back to idle
          agentManager.setAgentStatus(targetAgentId, 'idle');

          console.log(
            `[Chat] ${targetAgentId} replied: ${result.content.length} chars ` +
            `(model=${result.model}, tokens=${result.inputTokens}/${result.outputTokens})`,
          );
        })
        .catch((error) => {
          console.error(`[Chat] Agent ${targetAgentId} reply failed:`, error);

          const errorMessage: AgentMessage = {
            id: uuid(),
            type: 'chat.response',
            from: targetAgentId,
            to: 'user',
            payload: {
              content: `I encountered an error while processing your message. Please try again.`,
              error: {
                code: 'AGENT_REPLY_FAILED',
                message: error?.message ?? 'Unknown error',
              },
            },
            sessionId,
            timestamp: new Date().toISOString(),
            correlationId: message.id,
          };

          sessionManager.addMessage(sessionId, errorMessage);
          io.emit('message', errorMessage);
          agentManager.setAgentStatus(targetAgentId, 'idle');
        });
    }
  });

  socket.on('disconnect', () => {
    console.log(`[Socket.IO] Dashboard disconnected: ${socket.id}`);
  });
});

// ---------------------------------------------------------------------------
// Wire Manager Events -> Socket.IO Broadcasts
// ---------------------------------------------------------------------------

// --- Agent status changes ---
agentManager.on('agent:status-changed', (agentId, oldStatus, newStatus) => {
  io.emit('agent_status', { agentId, oldStatus, newStatus });
});

agentManager.on('agent:task-assigned', (agentId, taskId, sessionId) => {
  io.emit('agent_status', {
    agentId,
    status: 'working',
    currentTask: taskId,
    sessionId,
  });
});

agentManager.on('agent:task-completed', (agentId, taskId, sessionId) => {
  io.emit('agent_status', {
    agentId,
    status: 'idle',
    currentTask: null,
    sessionId,
  });
});

agentManager.on('agent:task-failed', (agentId, taskId, sessionId, error) => {
  io.emit('agent_status', {
    agentId,
    status: 'idle',
    currentTask: null,
    sessionId,
    error,
  });
});

// --- Agent messages ---
agentManager.on('agent:message', (message) => {
  io.emit('message', message);
});

// --- Task updates ---
taskManager.on('task:created', (event) => {
  io.emit('task_update', { type: 'created', event });
});

taskManager.on('task:updated', (event) => {
  io.emit('task_update', { type: 'updated', event });
});

taskManager.on('task:moved', (event) => {
  io.emit('task_update', { type: 'moved', event });
});

taskManager.on('task:assigned', (event) => {
  io.emit('task_update', { type: 'assigned', event });
});

taskManager.on('task:completed', (event) => {
  io.emit('task_update', { type: 'completed', event });
});

taskManager.on('task:cancelled', (event) => {
  io.emit('task_update', { type: 'cancelled', event });
});

// --- Session updates ---
sessionManager.on('session:created', (session) => {
  io.emit('session_update', { type: 'created', session: sessionManager.serializeSession(session.id) });
});

sessionManager.on('session:destroyed', (sessionId) => {
  io.emit('session_update', { type: 'destroyed', sessionId });
});

sessionManager.on('session:state-changed', (sessionId, oldState, newState) => {
  io.emit('session_update', { type: 'state_changed', sessionId, oldState, newState });
});

sessionManager.on('session:agent-joined', (sessionId, agentId) => {
  io.emit('session_update', { type: 'agent_joined', sessionId, agentId });
});

sessionManager.on('session:agent-left', (sessionId, agentId) => {
  io.emit('session_update', { type: 'agent_left', sessionId, agentId });
});

sessionManager.on('session:message', (sessionId, message) => {
  io.emit('message', message);
});

// --- VIADP delegation events ---
viadpEngine.on('delegation:requested', (request) => {
  io.emit('viadp_update', { type: 'delegation_requested', data: request });
});

viadpEngine.on('delegation:accepted', (request, token) => {
  io.emit('viadp_update', { type: 'delegation_accepted', data: { request, token } });
});

viadpEngine.on('delegation:rejected', (request, reason) => {
  io.emit('viadp_update', { type: 'delegation_rejected', data: { request, reason } });
});

viadpEngine.on('delegation:completed', (request, proof) => {
  io.emit('viadp_update', { type: 'delegation_completed', data: { request, proof } });
});

viadpEngine.on('delegation:failed', (request, error) => {
  io.emit('viadp_update', { type: 'delegation_failed', data: { request, error } });
});

viadpEngine.on('delegation:revoked', (tokenId, reason) => {
  io.emit('viadp_update', { type: 'delegation_revoked', data: { tokenId, reason } });
});

viadpEngine.on('delegation:escalated', (request, escalateTo) => {
  io.emit('viadp_update', { type: 'delegation_escalated', data: { request, escalateTo } });
});

// --- VIADP trust events ---
viadpEngine.on('trust:updated', (agentId, score) => {
  io.emit('viadp_update', { type: 'trust_updated', data: { agentId, score } });
});

// --- VIADP verification events ---
viadpEngine.on('verification:submitted', (proof) => {
  io.emit('viadp_update', { type: 'verification_submitted', data: proof });
});

viadpEngine.on('verification:passed', (proof) => {
  io.emit('viadp_update', { type: 'verification_passed', data: proof });
});

viadpEngine.on('verification:failed', (proof) => {
  io.emit('viadp_update', { type: 'verification_failed', data: proof });
});

// --- VIADP checkpoint events ---
viadpEngine.on('checkpoint:reached', (delegationId, checkpoint) => {
  io.emit('viadp_update', { type: 'checkpoint_reached', data: { delegationId, checkpoint } });
});

viadpEngine.on('checkpoint:failed', (delegationId, checkpoint) => {
  io.emit('viadp_update', { type: 'checkpoint_failed', data: { delegationId, checkpoint } });
});

// --- VIADP audit events ---
viadpEngine.on('audit:entry', (entry) => {
  io.emit('viadp_update', { type: 'audit_entry', data: entry });
});

console.log('[Init] Socket.IO server wired to manager events');

// ---------------------------------------------------------------------------
// Start Listening
// ---------------------------------------------------------------------------

httpServer.listen(PORT, HOST, () => {
  console.log('==========================================================');
  console.log(`  ForgeTeam Gateway is running`);
  console.log(`  HTTP:       http://${HOST}:${PORT}`);
  console.log(`  WebSocket:  ws://${HOST}:${PORT}`);
  console.log(`  Socket.IO:  http://${HOST}:${PORT}/socket.io`);
  console.log(`  Health:     http://${HOST}:${PORT}/health`);
  console.log('==========================================================');
  console.log(`  Agents loaded: ${agentManager.getAllConfigs().length}`);
  console.log(`  Model catalog: ${Object.keys(modelRouter.getModelCatalog()).length} models`);
  console.log(`  Voice STT:     ${voiceHandler.isConfigured().stt ? 'configured' : 'not configured'}`);
  console.log(`  Voice TTS:     ${voiceHandler.isConfigured().tts ? 'configured' : 'not configured'}`);
  console.log(`  Arabic:        ${voiceHandler.isArabicEnabled() ? 'enabled' : 'disabled'}`);
  console.log('==========================================================');
});

// ---------------------------------------------------------------------------
// Graceful Shutdown
// ---------------------------------------------------------------------------

const shutdown = (signal: string) => {
  console.log(`\n[Shutdown] Received ${signal}, shutting down gracefully...`);

  io.close();
  gatewayServer.shutdown();
  sessionManager.shutdown();
  viadpEngine.shutdown();

  httpServer.close(() => {
    console.log('[Shutdown] HTTP server closed');
    process.exit(0);
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    console.error('[Shutdown] Forced exit after timeout');
    process.exit(1);
  }, 10_000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('[Fatal] Uncaught exception:', error);
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  console.error('[Fatal] Unhandled rejection:', reason);
});

// ---------------------------------------------------------------------------
// Exports for testing
// ---------------------------------------------------------------------------

export {
  app,
  httpServer,
  io,
  gatewayServer,
  sessionManager,
  agentManager,
  taskManager,
  viadpEngine,
  modelRouter,
  voiceHandler,
  agentRunner,
};
