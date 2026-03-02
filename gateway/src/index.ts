/**
 * ForgeTeam Gateway - Main Entry Point
 *
 * The Gateway is the CENTRAL HUB of the ForgeTeam system.
 * Everything flows through it: user messages, agent-to-agent communication,
 * task management, delegation protocol, and real-time dashboard updates.
 *
 * Architecture:
 * - Express HTTP server on port 18789 (health checks, REST API)
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
import { GatewayServer, containsHumanMention } from './server';
import { AgentRunner } from './agent-runner';
import { PartyModeEngine } from './party-mode';
import { OpenClawAgentRegistry, MessageBus, ToolRunner } from './openclaw';
import { WorkflowExecutor } from './workflow-engine';
import { resolve } from 'path';
import type { AgentId, AgentMessage, CreateTaskInput } from '@forge-team/shared';
import { MemoryManager, GeminiFileSearch, VectorStore, Summarizer } from '@forge-team/memory';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { ToolRegistry, SandboxManager } from './tools';
import { generateToken, verifyToken, type AuthRole } from './auth';
import { registerCodeExecutorTool } from './tools/code-executor';
import { registerTerminalTool } from './tools/terminal-tools';
import { registerGitTools } from './tools/git-tools';
import { registerCITools } from './tools/ci-tools';
import { registerBrowserTools } from './tools/browser-tools';
import { AuditMiddleware } from './audit-middleware';
import { StorageService } from './storage';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.GATEWAY_PORT ?? '18789', 10);
const HOST = process.env.GATEWAY_HOST ?? '0.0.0.0';
const AUTH_ENABLED = process.env.NODE_ENV !== 'development' || process.env.FORCE_AUTH === 'true';

// ---------------------------------------------------------------------------
// Initialize Managers
// ---------------------------------------------------------------------------

console.log('==========================================================');
console.log('  ForgeTeam Gateway - Initializing');
console.log('==========================================================');

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://forgeteam:forgeteam_secret@localhost:5432/forgeteam';
const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 20,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
});
pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error on idle client:', err.message);
});
const redis = new Redis(REDIS_URL);
redis.on('error', (err) => {
  console.error('[Redis] Connection error:', err.message);
});

const sessionManager = new SessionManager({
  maxHistorySize: 2000,
  inactivityTimeoutMs: 60 * 60 * 1000, // 1 hour
  pool,
});
console.log('[Init] SessionManager initialized');

const agentManager = new AgentManager(pool);
console.log('[Init] AgentManager initialized');

const taskManager = new TaskManager(pool);
console.log('[Init] TaskManager initialized');

const viadpEngine = new VIADPEngine(agentManager);
console.log('[Init] VIADPEngine initialized');

const modelRouter = new ModelRouter();
console.log('[Init] ModelRouter initialized');

const voiceHandler = new VoiceHandler();
console.log('[Init] VoiceHandler initialized');

const memoryManager = new MemoryManager(pool, redis);
console.log('[Init] MemoryManager initialized');

const geminiFileSearch = process.env.GOOGLE_AI_API_KEY
  ? new GeminiFileSearch({ apiKey: process.env.GOOGLE_AI_API_KEY })
  : null;
if (geminiFileSearch) {
  console.log('[Init] GeminiFileSearch initialized');
}

let companyKBId: string | null = null;
if (geminiFileSearch) {
  initCompanyKB(geminiFileSearch).then(id => {
    companyKBId = id;
  }).catch(err => {
    console.warn('[Gateway] Company KB init failed:', err?.message);
  });
}

const vectorStore = new VectorStore(pool, {
  dimensions: 768,
  apiKey: process.env.GOOGLE_AI_API_KEY,
});
console.log('[Init] VectorStore initialized');

const summarizer = new Summarizer(pool, redis, {
  compactionThreshold: 50,
  preserveRecentCount: 10,
});
console.log('[Init] Summarizer initialized');

const toolRegistry = new ToolRegistry();
const sandboxManager = new SandboxManager();
registerCodeExecutorTool(toolRegistry, sandboxManager);
registerTerminalTool(toolRegistry, sandboxManager);
registerGitTools(toolRegistry, sandboxManager);
registerCITools(toolRegistry);
registerBrowserTools(toolRegistry, sandboxManager);
console.log(`[Init] ToolRegistry initialized with ${toolRegistry.listAll().length} tools`);

const auditMiddleware = new AuditMiddleware();
console.log('[Init] AuditMiddleware initialized');

const storageService = new StorageService({
  endpoint: process.env.MINIO_ENDPOINT ?? 'localhost:9000',
  accessKeyId: process.env.MINIO_ACCESS_KEY ?? 'forgeteam-admin',
  secretAccessKey: process.env.MINIO_SECRET_KEY ?? 'forgeteam-secret',
  bucket: process.env.MINIO_BUCKET ?? 'forgeteam-artifacts',
  useSSL: process.env.MINIO_USE_SSL === 'true',
});
console.log('[Init] StorageService initialized');

const agentRunner = new AgentRunner({
  modelRouter,
  agentManager,
  sessionManager,
  memoryManager,
  geminiFileSearch: geminiFileSearch ?? undefined,
  vectorStore,
  companyKBId: companyKBId ?? undefined,
  toolRegistry,
  sandboxManager,
  viadpEngine,
});
console.log('[Init] AgentRunner initialized');

const messageBus = new MessageBus({ redisUrl: REDIS_URL });
const agentRegistry = new OpenClawAgentRegistry(agentManager);
const toolRunner = new ToolRunner();
console.log('[Init] OpenClaw components initialized (Redis:', REDIS_URL, ')');

const workflowExecutor = new WorkflowExecutor({
  workflowsDir: resolve(__dirname, '../../workflows'),
  agentManager,
  modelRouter,
  viadpEngine,
  agentRunner,
  databaseUrl: process.env.DATABASE_URL ?? 'postgresql://forgeteam:forgeteam_secret@localhost:5432/forgeteam',
});
console.log('[Init] WorkflowExecutor initialized');

// ---------------------------------------------------------------------------
// Company KB Auto-Provisioning
// ---------------------------------------------------------------------------

async function initCompanyKB(geminiFileSearch: GeminiFileSearch): Promise<string | null> {
  try {
    const stores = await geminiFileSearch.listStores();
    const existing = stores.find(s => s.name === 'forgeteam-company-kb');
    if (existing) {
      console.log(`[Gateway] Found existing company KB: ${existing.id}`);
      return existing.id;
    }

    const store = await geminiFileSearch.createStore('forgeteam-company-kb', 'company');
    console.log(`[Gateway] Created company KB: ${store.id}`);
    return store.id;
  } catch (err: any) {
    console.warn(`[Gateway] Failed to initialize company KB:`, err?.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Express HTTP Server
// ---------------------------------------------------------------------------

const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));

function asyncHandler(fn: (req: any, res: any, next: express.NextFunction) => Promise<any>): express.RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

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

app.get('/api/health/providers', asyncHandler(async (_req, res) => {
  const health = await agentRunner.checkProviderHealth();
  const allHealthy = Object.values(health).every(h => h.available);
  res.status(allHealthy ? 200 : 503).json({ providers: health });
}));

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
 * Update task via REST (Kanban drag-and-drop, priority changes, reassignment).
 */
app.put('/api/tasks/:taskId', (req, res) => {
  const task = taskManager.getTask(req.params.taskId);
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  const updates = req.body ?? {};
  // Map 'column' to 'status' if provided (Kanban drag-and-drop sends column names)
  if (updates.column && !updates.status) {
    updates.status = updates.column;
  }

  if (updates.status && updates.status !== task.status) {
    taskManager.moveTask(task.id, updates.status, 'user');
  }
  if (updates.assignedTo) {
    taskManager.assignTask(task.id, updates.assignedTo, 'user');
  }
  if (updates.priority) {
    taskManager.updateTask(task.id, { priority: updates.priority }, 'user');
  }

  const updated = taskManager.getTask(task.id);
  io.emit('task_update', { type: 'moved', event: { taskId: task.id, sessionId: task.sessionId, currentStatus: updated?.status } });
  res.json({ task: updated, timestamp: new Date().toISOString() });
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
 * Save model assignments for agents.
 */
app.post('/api/models/assignments', express.json(), asyncHandler(async (req, res): Promise<void> => {
  const { assignments } = req.body ?? {};
  if (!assignments || typeof assignments !== 'object') {
    res.status(400).json({ error: 'assignments object required' });
    return;
  }

  for (const [agentId, config] of Object.entries(assignments) as [string, any][]) {
    const primary = config?.primary;
    const fallback = config?.fallback || config?.fallback2 || '';

    // Update in-memory model router
    if (primary) {
      modelRouter.updateAssignment(agentId as any, primary as any, (fallback || primary) as any);
    }

    // Update cost cap if provided
    if (config?.dailyCap !== undefined) {
      const dailyCap = Number(config.dailyCap);
      modelRouter.setCostCap(agentId, {
        dailyCapUsd: dailyCap,
        weeklyCapUsd: dailyCap * 5,
        alertThreshold: 0.8,
      });
    }

    // Persist to PostgreSQL
    const fallbackModels = [config?.fallback, config?.fallback2].filter(Boolean);
    pool.query(
      `UPDATE model_configs
         SET primary_model   = $1,
             fallback_models = $2,
             temperature     = $3,
             daily_cap_usd   = $4,
             weekly_cap_usd  = $5,
             updated_at      = NOW()
       WHERE agent_id = $6`,
      [
        primary,
        JSON.stringify(fallbackModels),
        config?.temperature ?? 0.3,
        config?.dailyCap ?? 50,
        (config?.dailyCap ?? 50) * 5,
        agentId,
      ]
    ).catch((err: any) => {
      console.warn(`[Gateway] Failed to persist model config for ${agentId}:`, err?.message);
    });
  }

  const updated = modelRouter.getAllAssignments();
  res.json({ success: true, assignments: updated, timestamp: new Date().toISOString() });
}));

/**
 * Model cost summary endpoint.
 */
app.get('/api/models/costs', (req, res) => {
  const summary = modelRouter.getCostSummary(
    req.query.from as string,
    req.query.to as string,
    req.query.agentId as string
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
  let delegations = viadpEngine.getAllRequests({
    status: req.query.status as any,
    from: req.query.from as any,
    to: req.query.to as any,
  });
  // Support ?agentId= filter (matches from OR to)
  const agentId = req.query.agentId as string | undefined;
  if (agentId) {
    delegations = delegations.filter(d => d.from === agentId || d.to === agentId);
  }
  res.json({ delegations, timestamp: new Date().toISOString() });
});

app.get('/api/viadp/trust', (_req, res) => {
  const trustScores = viadpEngine.getGlobalTrustScores();
  res.json({ trustScores, timestamp: new Date().toISOString() });
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
  const limit = parseInt(req.query.limit as string) || 0;
  const result = limit > 0 ? entries.slice(0, limit) : entries;
  res.json({ entries: result, total: entries.length, timestamp: new Date().toISOString() });
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
app.post('/api/voice/transcribe', asyncHandler(async (req, res) => {
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
}));

/**
 * Voice synthesize endpoint (TTS).
 * Accepts { text, language } and returns audio base64.
 */
app.post('/api/voice/synthesize', asyncHandler(async (req, res) => {
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
}));

// -- OpenClaw REST endpoints --

app.get('/api/openclaw/agents', (_req, res) => {
  const agents = agentRegistry.getAllWithCapabilities();
  res.json({ agents, timestamp: new Date().toISOString() });
});

app.get('/api/openclaw/tools', (_req, res) => {
  const tools = toolRunner.listTools();
  res.json({ tools, timestamp: new Date().toISOString() });
});

app.post('/api/openclaw/tools/:name/execute', express.json(), asyncHandler(async (req, res) => {
  try {
    const result = await toolRunner.executeTool(req.params.name, req.body.input ?? {}, {
      sessionId: req.body.sessionId,
      agentId: req.body.agentId,
    });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'Tool execution failed' });
  }
}));

// ---------------------------------------------------------------------------
// Workflow REST Endpoints
// ---------------------------------------------------------------------------

app.get('/api/workflows', (_req, res) => {
  try {
    const definitions = workflowExecutor.listDefinitions();
    res.json({ workflows: definitions, timestamp: new Date().toISOString() });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'Failed to list workflows' });
  }
});

app.post('/api/workflows/start', express.json(), asyncHandler(async (req, res) => {
  try {
    const { definitionName, sessionId } = req.body;
    if (!definitionName || !sessionId) {
      res.status(400).json({ error: 'definitionName and sessionId are required' });
      return;
    }
    const instance = await workflowExecutor.startWorkflow(definitionName, sessionId);
    res.json({ instance, timestamp: new Date().toISOString() });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'Failed to start workflow' });
  }
}));

app.post('/api/workflows/pause-all', (_req, res) => {
  try {
    const result = workflowExecutor.pauseAllWorkflows();
    io.emit('workflow_update', { type: 'global_pause', paused: result.paused });
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/workflows/resume-all', asyncHandler(async (_req, res) => {
  try {
    const result = await workflowExecutor.resumeAllWorkflows();
    io.emit('workflow_update', { type: 'global_resume', resumed: result.resumed });
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
}));

app.get('/api/workflows/status', (_req, res) => {
  const statuses = workflowExecutor.getWorkflowStatuses();
  res.json({ workflows: statuses });
});

app.post('/api/workflows/:instanceId/pause', asyncHandler(async (req, res) => {
  try {
    await workflowExecutor.pauseWorkflow(req.params.instanceId);
    io.emit('workflow_update', { type: 'instance_paused', instanceId: req.params.instanceId });
    res.json({ status: 'paused', timestamp: new Date().toISOString() });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'Failed to pause workflow' });
  }
}));

app.post('/api/workflows/:instanceId/resume', express.json(), asyncHandler(async (req, res) => {
  try {
    const { approvalData } = req.body;
    await workflowExecutor.resumeWorkflow(req.params.instanceId, approvalData);
    io.emit('workflow_update', { type: 'instance_resumed', instanceId: req.params.instanceId });
    res.json({ status: 'resumed', timestamp: new Date().toISOString() });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'Failed to resume workflow' });
  }
}));

app.get('/api/workflows/:instanceId/progress', asyncHandler(async (req, res) => {
  try {
    const progress = await workflowExecutor.getProgress(req.params.instanceId);
    res.json({ progress, timestamp: new Date().toISOString() });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'Failed to get progress' });
  }
}));

app.post('/api/workflows/:instanceId/cancel', asyncHandler(async (req, res) => {
  try {
    await workflowExecutor.cancelWorkflow(req.params.instanceId);
    res.json({ status: 'cancelled', timestamp: new Date().toISOString() });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'Failed to cancel workflow' });
  }
}));

app.get('/api/workflows/:name', (req, res) => {
  try {
    const loader = workflowExecutor.getLoader();
    const definition = loader.loadWorkflow(`${req.params.name}.yaml`);
    res.json({ workflow: definition, timestamp: new Date().toISOString() });
  } catch (error: any) {
    res.status(404).json({ error: error?.message ?? 'Workflow not found' });
  }
});

app.get('/api/workflow-instances', (req, res) => {
  const sessionId = req.query.sessionId as string | undefined;
  const instances = workflowExecutor.getAllInstances(sessionId);
  res.json({ instances, timestamp: new Date().toISOString() });
});

app.get('/api/workflow-instances/:id', (req, res) => {
  const instance = workflowExecutor.getInstance(req.params.id);
  if (instance) {
    res.json({ instance, timestamp: new Date().toISOString() });
  } else {
    res.status(404).json({ error: 'Workflow instance not found' });
  }
});

/**
 * Connection stats endpoint.
 */
app.get('/api/connections', (_req, res) => {
  const stats = gatewayServer.getConnectionStats();
  res.json({ stats, timestamp: new Date().toISOString() });
});

app.get('/api/tools', (_req, res) => {
  res.json({ tools: toolRegistry.listAll().map(t => ({ name: t.name, description: t.description, category: t.category, agentWhitelist: t.agentWhitelist })) });
});

app.get('/api/tools/:agentId', (req, res) => {
  const agentId = req.params.agentId as AgentId;
  const tools = toolRegistry.listForAgent(agentId).map(t => ({ name: t.name, description: t.description, category: t.category }));
  res.json({ agentId, tools });
});

app.get('/api/sandboxes', asyncHandler(async (_req, res) => {
  const sandboxes = await sandboxManager.listActive();
  res.json({ sandboxes });
}));

// ---------------------------------------------------------------------------
// Human-in-the-Loop REST Endpoints
// ---------------------------------------------------------------------------

app.get('/api/interrupts', (_req, res) => {
  const pending = workflowExecutor.getPendingInterrupts();
  res.json({ interrupts: pending });
});

app.get('/api/interrupts/all', (_req, res) => {
  const all = workflowExecutor.getAllInterrupts();
  res.json({ interrupts: all });
});

app.post('/api/interrupts/:id/resolve', express.json(), (req, res) => {
  const { id } = req.params;
  const { approved, feedback } = req.body;
  try {
    workflowExecutor.resolveInterrupt(id, approved, feedback);
    io.emit('interrupt_update', {
      type: approved ? 'approved' : 'rejected',
      interruptId: id,
      feedback,
      timestamp: new Date().toISOString(),
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/escalations', (req, res) => {
  const status = req.query.status as string | undefined;
  let escalations = agentRunner.getEscalations();
  if (status) {
    escalations = escalations.filter(e => e.status === status);
  }
  res.json({ escalations });
});

app.post('/api/escalations/:id/review', express.json(), (req, res) => {
  try {
    agentRunner.reviewEscalation(req.params.id, req.body.feedback);
    io.emit('escalation_update', {
      type: 'reviewed',
      escalationId: req.params.id,
      timestamp: new Date().toISOString(),
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/escalations/:id/dismiss', (req, res) => {
  try {
    agentRunner.dismissEscalation(req.params.id);
    io.emit('escalation_update', {
      type: 'dismissed',
      escalationId: req.params.id,
      timestamp: new Date().toISOString(),
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/agents/:agentId/takeover', (req, res) => {
  try {
    agentManager.takeOverAgent(req.params.agentId);
    io.emit('agent_status', {
      agentId: req.params.agentId,
      newStatus: 'human_controlled',
    });
    res.json({ success: true, agentId: req.params.agentId });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/agents/:agentId/release', (req, res) => {
  try {
    agentManager.releaseAgent(req.params.agentId);
    const state = agentManager.getState(req.params.agentId as AgentId);
    io.emit('agent_status', {
      agentId: req.params.agentId,
      newStatus: state?.status ?? 'idle',
    });
    res.json({ success: true, agentId: req.params.agentId });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/agents/:agentId/human-message', express.json(), (req, res) => {
  const { agentId } = req.params;
  const { content, taskId } = req.body;

  if (!agentManager.isAgentTakenOver(agentId)) {
    res.status(400).json({ error: `Agent ${agentId} is not in takeover mode` });
    return;
  }

  const messageId = uuid();
  const message = {
    id: messageId,
    type: 'task',
    from: agentId,
    to: 'human-proxy',
    payload: { content },
    sessionId: 'human-takeover',
    timestamp: new Date().toISOString(),
    metadata: { humanProxy: true },
  };

  io.emit('message', message);

  if (taskId) {
    const task = taskManager.getTask(taskId);
    if (task) {
      task.metadata = task.metadata || {};
      task.metadata.agentResponse = content;
      task.metadata.humanProxy = true;
    }
  }

  res.json({ success: true, messageId });
});

// -- Memory REST endpoints --

app.get('/api/memory/search', asyncHandler(async (req, res) => {
  try {
    const query = (req.query.q as string) ?? '';
    const scope = req.query.scope as string | undefined;
    const agentId = req.query.agentId as string | undefined;
    const limit = parseInt(req.query.limit as string) || 20;

    const results = await memoryManager.search(query, {
      scope: scope as any,
      agentId,
      limit,
    });

    res.json({ results, total: results.length });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Memory search failed' });
  }
}));

app.get('/api/memory/stats', asyncHandler(async (req, res) => {
  try {
    const statsResult = await pool.query(`
      SELECT
        agent_id,
        scope,
        COUNT(*) as entry_count,
        SUM(LENGTH(content)) as total_chars,
        MAX(updated_at) as last_updated
      FROM memory_entries
      WHERE superseded_by IS NULL
      GROUP BY agent_id, scope
      ORDER BY agent_id, scope
    `);

    res.json({ stats: statsResult.rows });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Memory stats failed' });
  }
}));

app.post('/api/memory/store', asyncHandler(async (req, res) => {
  try {
    const { scope, content, metadata, agentId, projectId, teamId, threadId, tags, importance } = req.body;

    if (!scope || !content) {
      res.status(400).json({ error: 'scope and content are required' });
      return;
    }

    const entry = await memoryManager.store(scope, content, metadata ?? {}, {
      agentId,
      projectId,
      teamId,
      threadId,
      tags,
      importance,
    });

    res.json({ entry });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Memory store failed' });
  }
}));

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
// Task Orchestration Endpoints
// ---------------------------------------------------------------------------

const TASK_KEYWORD_CAPABILITIES: Record<string, string[]> = {
  'architecture|system design|scalability|api design|database schema': ['system-design', 'architecture-review'],
  'frontend|ui|component|react|css|tailwind|responsive': ['frontend-development', 'component-building'],
  'backend|api|endpoint|database|server|node|express|postgres': ['backend-development', 'api-design'],
  'test|qa|quality|bug|regression|coverage': ['test-strategy', 'test-automation'],
  'deploy|ci.cd|docker|kubernetes|infrastructure|monitoring': ['ci-cd', 'deployment'],
  'security|auth|owasp|vulnerability|penetration|compliance': ['security-review', 'threat-modeling'],
  'ux|user experience|wireframe|design|accessibility': ['ui-design', 'ux-research'],
  'requirement|user story|feature|priority|backlog|prd': ['product-vision', 'backlog-management'],
  'doc|readme|api doc|guide|knowledge base': ['technical-writing', 'api-documentation'],
};

function autoAssignAgent(taskTitle: string, taskDescription: string): AgentId | null {
  const text = `${taskTitle} ${taskDescription}`.toLowerCase();
  for (const [pattern, capabilities] of Object.entries(TASK_KEYWORD_CAPABILITIES)) {
    const regex = new RegExp(pattern, 'i');
    if (regex.test(text)) {
      for (const cap of capabilities) {
        const agent = agentManager.findAgentForCapability(cap);
        if (agent) return agent;
      }
    }
  }
  // Fallback: assign to orchestrator instead of failing
  return 'bmad-master';
}

// Helper: extract code-block artifacts from agent response and upload to storage
async function extractAndUploadArtifacts(
  responseContent: string,
  taskId: string,
  taskTitle: string,
  sessionIdParam: string,
): Promise<string[]> {
  const codeBlockRegex = /```(\w+)?\s*\n([\s\S]*?)```/g;
  const langExtMap: Record<string, string> = {
    html: '.html', css: '.css', js: '.js', javascript: '.js',
    ts: '.ts', typescript: '.ts', tsx: '.tsx', jsx: '.jsx',
    json: '.json', yaml: '.yaml', yml: '.yml', xml: '.xml',
    sql: '.sql', py: '.py', python: '.py', sh: '.sh', bash: '.sh',
    dockerfile: '.Dockerfile', md: '.md', markdown: '.md',
    java: '.java', go: '.go', rust: '.rs', c: '.c', cpp: '.cpp',
  };
  const langContentType: Record<string, string> = {
    html: 'text/html', css: 'text/css', js: 'application/javascript',
    json: 'application/json', yaml: 'text/yaml', sql: 'text/sql',
    xml: 'application/xml', md: 'text/markdown', py: 'text/x-python',
  };

  let blockIndex = 0;
  let codeMatch: RegExpExecArray | null;
  const extractedArtifacts: string[] = [];

  while ((codeMatch = codeBlockRegex.exec(responseContent)) !== null) {
    const lang = (codeMatch[1] ?? '').toLowerCase();
    const code = codeMatch[2];
    if (!code || code.trim().length < 10) continue;

    const ext = langExtMap[lang] || '.txt';
    const slug = taskTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
    const filename = blockIndex === 0
      ? `${slug}${ext}`
      : `${slug}-${blockIndex}${ext}`;
    const artifactKey = `${sessionIdParam}/${taskId}/${filename}`;
    const ct = langContentType[lang] || 'text/plain';

    try {
      await storageService.upload(artifactKey, code, ct);
      const downloadUrl = `/api/artifacts/download?key=${encodeURIComponent(artifactKey)}`;
      taskManager.addArtifact(taskId, downloadUrl);
      extractedArtifacts.push(filename);
      console.log(`[Artifacts] Saved ${filename} (${code.length} bytes) for task ${taskId}`);
    } catch (artifactErr: any) {
      console.warn(`[Artifacts] Failed to save ${filename}:`, artifactErr?.message);
    }
    blockIndex++;
  }

  if (extractedArtifacts.length > 0) {
    console.log(`[Artifacts] Extracted ${extractedArtifacts.length} artifact(s) for task ${taskId}: ${extractedArtifacts.join(', ')}`);
  }
  return extractedArtifacts;
}

app.post('/api/tasks/:taskId/start', asyncHandler(async (req, res) => {
  try {
    const task = taskManager.getTask(req.params.taskId);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    // Auto-assign agent if none assigned
    let assignedAgent = task.assignedTo;
    if (!assignedAgent) {
      assignedAgent = autoAssignAgent(task.title, task.description);
      if (assignedAgent) {
        taskManager.assignTask(task.id, assignedAgent, 'system');
        task.assignedTo = assignedAgent;
      }
    }

    if (!assignedAgent) {
      res.status(400).json({ error: 'No suitable agent found for this task' });
      return;
    }

    // Move task through Kanban: backlog -> todo -> in-progress
    if (task.status === 'backlog') taskManager.moveTask(task.id, 'todo', 'system');
    if (task.status === 'backlog' || task.status === 'todo') taskManager.moveTask(task.id, 'in-progress', 'system');

    agentManager.assignTask(assignedAgent, task.id, task.sessionId);

    // Run VIADP delegation assessment before agent execution
    const viadpAssessment = viadpEngine.assessDelegation(
      'bmad-master' as AgentId,
      assignedAgent,
      `Execute task: ${task.title}`,
      task.tags.length > 0 ? task.tags : ['general'],
    );

    if (viadpAssessment.riskLevel === 'critical') {
      console.warn(`[TaskStart] VIADP critical risk for task ${task.id} -> ${assignedAgent}: ${viadpAssessment.riskFactors.join(', ')}`);
      viadpEngine.createDelegationRequest({
        from: 'bmad-master' as AgentId,
        to: assignedAgent,
        taskId: task.id,
        sessionId: task.sessionId,
        reason: `Task execution: ${task.title}`,
        requiredCapabilities: task.tags.length > 0 ? task.tags : ['general'],
        scope: { allowedActions: ['execute-task'], resourceLimits: {}, canRedelegate: false, allowedArtifactTypes: ['code', 'document'] },
      });
      taskManager.moveTask(task.id, 'backlog', 'system');
      agentManager.completeTask(assignedAgent, task.id);
      io.emit('task_update', { type: 'moved', event: { taskId: task.id, sessionId: task.sessionId, currentStatus: 'backlog' } });
      res.status(403).json({
        error: 'VIADP: Critical risk detected — task requires human approval before agent execution',
        riskLevel: viadpAssessment.riskLevel,
        riskFactors: viadpAssessment.riskFactors,
      });
      return;
    }

    if (viadpAssessment.riskLevel !== 'low') {
      console.log(`[TaskStart] VIADP risk=${viadpAssessment.riskLevel} for task ${task.id} -> ${assignedAgent}`);
    }

    // Emit immediate status update so dashboard shows "in-progress"
    io.emit('task_update', { type: 'moved', event: { taskId: task.id, sessionId: task.sessionId, currentStatus: 'in-progress' } });

    // Return 202 Accepted immediately — agent execution runs in background
    res.status(202).json({
      task: taskManager.getTask(task.id),
      agentId: assignedAgent,
      status: 'processing',
      message: 'Task accepted and agent is working. Results will be pushed via WebSocket.',
      timestamp: new Date().toISOString(),
    });

    // Capture values for the background closure
    const taskId = task.id;
    const taskTitle = task.title;
    const taskDescription = task.description;
    const taskPriority = task.priority;
    const taskComplexity = task.complexity;
    const taskTags = task.tags;
    const taskSessionId = task.sessionId;
    const agent = assignedAgent;

    // Run agent in background (fire-and-forget with error handling)
    (async () => {
      try {
        const taskPrompt =
          `You have been assigned the following task:\n\n` +
          `TITLE: ${taskTitle}\n` +
          `DESCRIPTION: ${taskDescription}\n` +
          `PRIORITY: ${taskPriority}\n` +
          `COMPLEXITY: ${taskComplexity}\n` +
          `TAGS: ${taskTags.join(', ')}\n\n` +
          `Please analyze this task and provide your implementation plan or deliverable.`;

        const result = await agentRunner.processUserMessage(agent, taskPrompt, taskSessionId);

        // Extract and upload artifacts
        await extractAndUploadArtifacts(result.content, taskId, taskTitle, taskSessionId);

        // Store the agent response on the task
        taskManager.updateTask(taskId, {
          metadata: { agentResponse: result.content, agentModel: result.model },
        }, agent);

        // Move to review
        taskManager.moveTask(taskId, 'review', agent);

        // Emit socket events for real-time dashboard updates
        const agentConfig = agentManager.getConfig(agent);
        const responseTimestamp = new Date().toISOString();
        const responseMessage = {
          id: `msg-${taskId}-response`,
          from: agent as any,
          to: 'user' as const,
          type: 'task.complete' as const,
          payload: { content: result.content },
          sessionId: taskSessionId,
          timestamp: responseTimestamp,
        };
        sessionManager.addMessage(taskSessionId, responseMessage);
        io.emit('message', {
          id: responseMessage.id,
          from: agentConfig?.name ?? agent,
          to: 'user',
          type: 'task',
          content: result.content,
          taskId,
          model: result.model,
          sessionId: taskSessionId,
          timestamp: responseTimestamp,
        });

        io.emit('task_update', {
          type: 'moved',
          event: { taskId, sessionId: taskSessionId, currentStatus: 'review', data: { agentResponse: result.content, agentModel: result.model } },
        });

        console.log(`[TaskStart] Background execution completed for task ${taskId}`);
      } catch (bgError: any) {
        console.error(`[TaskStart] Background execution failed for task ${taskId}:`, bgError?.message);

        // Move task back to backlog on failure and notify dashboard
        try { taskManager.moveTask(taskId, 'backlog', 'system'); } catch {}
        try { agentManager.completeTask(agent, taskId); } catch {}

        io.emit('task_update', {
          type: 'error',
          event: { taskId, sessionId: taskSessionId, currentStatus: 'backlog', data: { error: bgError?.message ?? 'Agent execution failed' } },
        });
        io.emit('message', {
          id: `msg-${taskId}-error`,
          from: 'system',
          to: 'user',
          type: 'error',
          content: `Task "${taskTitle}" failed: ${bgError?.message ?? 'Unknown error'}`,
          taskId,
          sessionId: taskSessionId,
          timestamp: new Date().toISOString(),
        });
      }
    })();
  } catch (error: any) {
    console.error('[TaskStart] Error:', error);
    res.status(500).json({ error: error?.message ?? 'Failed to start task' });
  }
}));

app.post('/api/tasks/:taskId/approve', (req, res) => {
  const task = taskManager.getTask(req.params.taskId);
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  if (task.status !== 'review') {
    res.status(400).json({ error: `Task is in "${task.status}" status, must be in "review" to approve` });
    return;
  }

  taskManager.moveTask(task.id, 'done', 'user');

  if (task.assignedTo) {
    agentManager.completeTask(task.assignedTo, task.id);
  }

  io.emit('task_update', { type: 'completed', event: { taskId: task.id, sessionId: task.sessionId, currentStatus: 'done' } });

  // Trigger memory summarization on task close
  const sessionId = task.sessionId;
  if (sessionId && summarizer) {
    summarizer.checkAndCompact(sessionId).catch((err: any) => {
      console.warn('[Memory] Task-close summarization failed:', err?.message);
    });
  }

  res.json({
    task: taskManager.getTask(task.id),
    status: 'done',
    timestamp: new Date().toISOString(),
  });
});

app.post('/api/tasks/:taskId/reject', asyncHandler(async (req, res) => {
  try {
    const task = taskManager.getTask(req.params.taskId);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    if (task.status !== 'review') {
      res.status(400).json({ error: `Task is in "${task.status}" status, must be in "review" to reject` });
      return;
    }

    const feedback = req.body?.feedback ?? 'Please revise your work.';

    // Move back to in-progress
    taskManager.moveTask(task.id, 'in-progress', 'user');
    io.emit('task_update', { type: 'moved', event: { taskId: task.id, sessionId: task.sessionId, currentStatus: 'in-progress' } });

    let response: string | null = null;

    // If there's an assigned agent, send feedback and get revised response
    if (task.assignedTo) {
      const feedbackPrompt =
        `Your previous work on task "${task.title}" was rejected with the following feedback:\n\n` +
        `${feedback}\n\n` +
        `Original task description: ${task.description}\n\n` +
        `Please revise your work based on the feedback.`;

      const result = await agentRunner.processUserMessage(task.assignedTo, feedbackPrompt, task.sessionId);
      response = result.content;

      // Extract artifacts from revised response
      await extractAndUploadArtifacts(result.content, task.id, task.title, task.sessionId);

      // Store revised response on task
      taskManager.updateTask(task.id, {
        metadata: { agentResponse: result.content, agentModel: result.model },
      }, task.assignedTo);

      // Move back to review
      taskManager.moveTask(task.id, 'review', task.assignedTo);
      io.emit('task_update', { type: 'moved', event: { taskId: task.id, sessionId: task.sessionId, currentStatus: 'review', data: { agentResponse: result.content } } });
    }

    res.json({
      task: taskManager.getTask(task.id),
      feedback,
      response,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[TaskReject] Error:', error);
    res.status(500).json({ error: error?.message ?? 'Failed to process rejection' });
  }
}));

app.post('/api/tasks/:taskId/assign', (req, res) => {
  const task = taskManager.getTask(req.params.taskId);
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  const agentId = req.body?.agentId as AgentId;
  if (!agentId) {
    res.status(400).json({ error: 'agentId is required' });
    return;
  }

  const agentConfig = agentManager.getConfig(agentId);
  if (!agentConfig) {
    res.status(404).json({ error: `Agent "${agentId}" not found` });
    return;
  }

  taskManager.assignTask(task.id, agentId, 'user');
  agentManager.assignTask(agentId, task.id, task.sessionId);

  const updatedTask = taskManager.getTask(task.id);
  io.emit('task_update', {
    type: 'assigned',
    event: {
      taskId: task.id,
      sessionId: task.sessionId,
      assignedTo: agentId,
      currentStatus: updatedTask?.status,
      data: updatedTask,
    },
  });

  res.json({
    task: updatedTask,
    assignedTo: agentId,
    timestamp: new Date().toISOString(),
  });
});

// -- Auth REST endpoints --

app.post('/api/auth/token', express.json(), (req, res) => {
  const { role, agentId } = req.body;
  if (process.env.NODE_ENV !== 'development') {
    const adminSecret = req.headers['x-admin-secret'];
    if (adminSecret !== process.env.ADMIN_SECRET) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
  }
  const token = generateToken({ sub: agentId ?? role, role, agentId });
  res.json({ token, expiresIn: process.env.JWT_EXPIRY ?? '24h' });
});

app.get('/api/auth/verify', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }
  res.json({ valid: true, payload });
});

// -- Cost management REST endpoints --

app.get('/api/costs/summary', (_req, res) => {
  const summary = modelRouter.getCostSummary();
  res.json({ summary, timestamp: new Date().toISOString() });
});

app.get('/api/costs/agent/:agentId', (req, res) => {
  const agentId = req.params.agentId;
  const capStatus = modelRouter.checkCostCap(agentId as any);
  const records = modelRouter.getCostRecords({ agentId: agentId as any });
  res.json({ agentId, capStatus, recentRecords: records.slice(-20), timestamp: new Date().toISOString() });
});

app.put('/api/costs/caps/:agentId', express.json(), (req, res) => {
  const agentId = req.params.agentId;
  const { dailyCapUsd, weeklyCapUsd, alertThreshold } = req.body;
  modelRouter.setCostCap(agentId as any, {
    dailyCapUsd: dailyCapUsd ?? 50,
    weeklyCapUsd: weeklyCapUsd ?? 200,
    alertThreshold: alertThreshold ?? 0.8,
  });
  res.json({ agentId, cap: modelRouter.getCostCap(agentId as any), timestamp: new Date().toISOString() });
});

app.get('/api/costs/caps', (_req, res) => {
  const caps: Record<string, any> = {};
  const assignments = modelRouter.getAllAssignments();
  for (const agentId of Object.keys(assignments)) {
    caps[agentId] = modelRouter.getCostCap(agentId as any);
  }
  res.json({ caps, timestamp: new Date().toISOString() });
});

// -- Audit REST endpoints --

app.get('/api/audit', (req, res) => {
  const { from, to, type, clientId, limit, offset } = req.query;
  const entries = auditMiddleware.getEntries({
    from: from as string,
    to: to as string,
    type: type as string,
    clientId: clientId as string,
  });
  const start = Number(offset ?? 0);
  const end = start + Number(limit ?? 100);
  const paginated = entries.slice(start, end);
  res.json({ entries: paginated, total: entries.length });
});

app.get('/api/audit/verify', (_req, res) => {
  const result = auditMiddleware.verifyIntegrity();
  res.json(result);
});

// GET /api/system/sovereignty — data sovereignty configuration
app.get('/api/system/sovereignty', (_req, res) => {
  res.json({
    deploymentRegion: process.env.DEPLOYMENT_REGION ?? 'riyadh',
    dataResidency: 'sa',
    externalApiEndpoints: [
      { service: 'Anthropic', endpoint: 'api.anthropic.com', purpose: 'LLM inference (Claude models)', dataFlow: 'outbound-prompts-inbound-completions' },
      { service: 'Google AI', endpoint: 'generativelanguage.googleapis.com', purpose: 'LLM inference (Gemini models)', dataFlow: 'outbound-prompts-inbound-completions' },
      { service: 'ElevenLabs', endpoint: 'api.elevenlabs.io', purpose: 'Text-to-Speech', dataFlow: 'outbound-text-inbound-audio' },
      { service: 'OpenAI Whisper', endpoint: 'api.openai.com', purpose: 'Speech-to-Text', dataFlow: 'outbound-audio-inbound-text' },
    ],
    internalServices: [
      { service: 'PostgreSQL', host: 'postgres:5432', dataStored: 'All structured data, memory, audit logs' },
      { service: 'Redis', host: 'redis:6379', dataStored: 'Ephemeral cache, pub/sub messages' },
      { service: 'MinIO', host: 'minio:9000', dataStored: 'Task artifacts, documents' },
    ],
    compliance: {
      dataAtRest: 'Stored in deployment region only',
      dataInTransit: 'TLS 1.3 for all external API calls',
      llmDataPolicy: 'Prompts sent to external LLM APIs; no persistent storage by providers (per API ToS)',
    },
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// Artifact Storage Endpoints
// ---------------------------------------------------------------------------

// POST /api/artifacts/upload — upload an artifact
app.post('/api/artifacts/upload', express.raw({ type: '*/*', limit: '50mb' }), asyncHandler(async (req, res): Promise<void> => {
  const { sessionId, taskId, filename } = req.query as { sessionId: string; taskId: string; filename: string };
  if (!sessionId || !taskId || !filename) {
    res.status(400).json({ error: 'Missing sessionId, taskId, or filename query params' });
    return;
  }
  const key = `${sessionId}/${taskId}/${filename}`;
  const contentType = req.headers['content-type'] ?? 'application/octet-stream';
  const result = await storageService.upload(key, req.body, contentType);
  res.json(result);
}));

// GET /api/artifacts/download — download an artifact
app.get('/api/artifacts/download', asyncHandler(async (req, res): Promise<void> => {
  const { key } = req.query as { key: string };
  if (!key) { res.status(400).json({ error: 'Missing key query param' }); return; }
  try {
    const { body, contentType } = await storageService.download(key);
    res.setHeader('Content-Type', contentType);
    res.send(body);
  } catch (dlErr: any) {
    console.warn(`[Artifacts] Download failed for key="${key}":`, dlErr?.message);
    res.status(404).json({ error: 'Artifact not found', key });
  }
}));

// GET /api/artifacts/list — list artifacts for a task
app.get('/api/artifacts/list', asyncHandler(async (req, res) => {
  const { sessionId, taskId } = req.query as { sessionId: string; taskId: string };
  const prefix = taskId ? `${sessionId ?? ''}/${taskId}/` : `${sessionId ?? ''}/`;
  const objects = await storageService.list(prefix);
  res.json({ objects, timestamp: new Date().toISOString() });
}));

// ---------------------------------------------------------------------------
// Global Express Error Handler
// ---------------------------------------------------------------------------

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Express] Unhandled route error:', err?.message ?? err);
  if (!res.headersSent) {
    res.status(500).json({ error: err?.message ?? 'Internal server error' });
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
  messageBus,
  agentRegistry,
  toolRunner,
  workflowExecutor,
  toolRegistry,
  sandboxManager,
  auditMiddleware,
});

gatewayServer.attach(httpServer);

// ---------------------------------------------------------------------------
// Socket.IO Server (for Dashboard real-time updates)
// ---------------------------------------------------------------------------

const io = new SocketIOServer(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  path: '/socket.io',
});

io.use((socket, next) => {
  if (!AUTH_ENABLED) return next();
  const token = socket.handshake.auth?.token ?? socket.handshake.query?.token;
  if (!token) return next(new Error('Authentication required'));
  const payload = verifyToken(token as string);
  if (!payload) return next(new Error('Invalid token'));
  (socket as any).tokenPayload = payload;
  next();
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

    if (isBroadcast) {
      // --- Party Mode: select relevant agents and get in-character responses ---
      const partyEngine = new PartyModeEngine();

      partyEngine
        .executePartyMode(payload.content, sessionId, agentRunner, agentManager)
        .then((partyResult) => {
          // Emit agent selection event
          io.emit('party_mode_selection', {
            sessionId,
            selections: partyResult.selections,
            correlationId: message.id,
          });

          // Emit each agent response as a separate message
          for (const resp of partyResult.responses) {
            const responseMessage: AgentMessage = {
              id: uuid(),
              type: 'chat.response',
              from: resp.agentId as AgentId,
              to: 'user',
              payload: {
                content: resp.content,
                data: {
                  model: resp.model,
                  inputTokens: resp.inputTokens,
                  outputTokens: resp.outputTokens,
                  partyMode: true,
                },
              },
              sessionId,
              timestamp: new Date().toISOString(),
              correlationId: message.id,
            };

            sessionManager.addMessage(sessionId, responseMessage);
            io.emit('message', responseMessage);
          }

          console.log(
            `[PartyMode] ${partyResult.responses.length} agents responded for broadcast`,
          );
        })
        .catch((error) => {
          console.error('[PartyMode] Failed, falling back to bmad-master:', error?.message);

          // Fallback: single bmad-master response
          agentManager.setAgentStatus('bmad-master' as AgentId, 'working');
          agentRunner
            .processUserMessage('bmad-master' as AgentId, payload.content, sessionId)
            .then((result) => {
              const responseMessage: AgentMessage = {
                id: uuid(),
                type: 'chat.response',
                from: 'bmad-master' as AgentId,
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
              sessionManager.addMessage(sessionId, responseMessage);
              io.emit('message', responseMessage);
              agentManager.setAgentStatus('bmad-master' as AgentId, 'idle');
            })
            .catch((fallbackError) => {
              console.error('[PartyMode] Fallback also failed:', fallbackError?.message);
              agentManager.setAgentStatus('bmad-master' as AgentId, 'idle');
            });
        });
    } else {
      // --- Direct message: single agent reply ---
      const targetAgentId = payload.to as AgentId;
      const agentConfig = agentManager.getConfig(targetAgentId);

      if (agentConfig) {
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

            sessionManager.addMessage(sessionId, responseMessage);
            io.emit('message', responseMessage);
            agentManager.setAgentStatus(targetAgentId, 'idle');

            if (containsHumanMention(result.content)) {
              const intId = workflowExecutor.createInterrupt(
                sessionId, targetAgentId, agentConfig.name, 'direct-message',
                'human_mention', result.content,
                `Agent ${agentConfig.name} requested human attention via @human mention`,
              );
              io.emit('interrupt_update', {
                type: 'created',
                interrupt: {
                  id: intId, instanceId: sessionId, agentId: targetAgentId,
                  agentName: agentConfig.name, stepId: 'direct-message',
                  type: 'human_mention', question: result.content,
                  context: `Agent ${agentConfig.name} requested human attention via @human mention`,
                  createdAt: new Date().toISOString(),
                },
                timestamp: new Date().toISOString(),
              });
            }

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
    }
  });

  // -- Workflow WebSocket Commands --

  socket.on('workflow:list', () => {
    try {
      const definitions = workflowExecutor.listDefinitions();
      socket.emit('workflow:list', { workflows: definitions });
    } catch (error: any) {
      socket.emit('workflow:error', { error: error?.message ?? 'Failed to list workflows' });
    }
  });

  socket.on('workflow:start', async (data: { workflowName: string; sessionId: string }) => {
    try {
      if (!data?.workflowName || !data?.sessionId) {
        socket.emit('workflow:error', { error: 'workflowName and sessionId are required' });
        return;
      }
      const instance = await workflowExecutor.startWorkflow(data.workflowName, data.sessionId);
      socket.emit('workflow:started', { instanceId: instance.id, workflowName: data.workflowName });
    } catch (error: any) {
      socket.emit('workflow:error', { error: error?.message ?? 'Failed to start workflow' });
    }
  });

  socket.on('workflow:approve', async (data: { instanceId: string; comment?: string }) => {
    try {
      if (!data?.instanceId) {
        socket.emit('workflow:error', { error: 'instanceId is required' });
        return;
      }
      await workflowExecutor.resumeWorkflow(data.instanceId, { approved: true, comment: data.comment });
      socket.emit('workflow:approved', { instanceId: data.instanceId });
    } catch (error: any) {
      socket.emit('workflow:error', { error: error?.message ?? 'Failed to approve' });
    }
  });

  socket.on('workflow:reject', async (data: { instanceId: string; comment?: string }) => {
    try {
      if (!data?.instanceId) {
        socket.emit('workflow:error', { error: 'instanceId is required' });
        return;
      }
      await workflowExecutor.resumeWorkflow(data.instanceId, { approved: false, reason: data.comment ?? 'Rejected' });
      socket.emit('workflow:rejected', { instanceId: data.instanceId });
    } catch (error: any) {
      socket.emit('workflow:error', { error: error?.message ?? 'Failed to reject' });
    }
  });

  socket.on('workflow:pause', async (data: { instanceId: string }) => {
    try {
      if (!data?.instanceId) {
        socket.emit('workflow:error', { error: 'instanceId is required' });
        return;
      }
      await workflowExecutor.pauseWorkflow(data.instanceId);
      socket.emit('workflow:paused', { instanceId: data.instanceId });
    } catch (error: any) {
      socket.emit('workflow:error', { error: error?.message ?? 'Failed to pause' });
    }
  });

  socket.on('workflow:resume', async (data: { instanceId: string }) => {
    try {
      if (!data?.instanceId) {
        socket.emit('workflow:error', { error: 'instanceId is required' });
        return;
      }
      await workflowExecutor.resumeWorkflow(data.instanceId);
      socket.emit('workflow:resumed', { instanceId: data.instanceId });
    } catch (error: any) {
      socket.emit('workflow:error', { error: error?.message ?? 'Failed to resume' });
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

agentManager.on('agent:task-completed', async (agentId, taskId, sessionId) => {
  if (!memoryManager || !summarizer) return;

  console.log(`[Gateway] Task ${taskId} completed by ${agentId} — triggering summarization`);
  try {
    const result = await summarizer.checkAndCompact(sessionId, memoryManager);
    if (result.compacted) {
      console.log(`[Gateway] Compacted session ${sessionId}: summary=${result.summaryId}`);
    }
  } catch (err: any) {
    console.warn(`[Gateway] Task-close summarization failed for ${sessionId}:`, err?.message);
  }
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

  const msgContent = message.payload?.content ?? '';
  if (msgContent && containsHumanMention(msgContent)) {
    const fromAgentId = message.from as string;
    const fromConfig = agentManager.getConfig(fromAgentId as AgentId);
    const fromAgentName = fromConfig?.name ?? fromAgentId;
    const interruptId = workflowExecutor.createInterrupt(
      message.sessionId ?? 'direct',
      fromAgentId,
      fromAgentName,
      'direct-message',
      'human_mention',
      msgContent,
      `Agent ${fromAgentName} requested human attention via @human mention`,
    );
    io.emit('interrupt_update', {
      type: 'created',
      interrupt: {
        id: interruptId,
        instanceId: message.sessionId ?? 'direct',
        agentId: fromAgentId,
        agentName: fromAgentName,
        stepId: 'direct-message',
        type: 'human_mention',
        question: msgContent,
        context: `Agent ${fromAgentName} requested human attention via @human mention`,
        createdAt: new Date().toISOString(),
      },
      timestamp: new Date().toISOString(),
    });
  }
});

// --- Cost control ---
modelRouter.on('cost:alert', (alert) => {
  const { agentId, alertType, message, dailyUsed, dailyCap } = alert;
  const ratio = dailyUsed / dailyCap;

  if (ratio >= 1.2) {
    console.error(`[CostControl] BLOCKED: ${agentId} at ${(ratio * 100).toFixed(0)}% of daily cap`);
    agentManager.setAgentStatus(agentId as AgentId, 'blocked' as any);
    io.emit('agent_status', { agentId, status: 'blocked', reason: 'cost-cap-exceeded' });
    io.emit('cost_update', { type: 'agent-blocked', agentId, dailyUsed, dailyCap });
  } else if (ratio >= 1.0) {
    console.warn(`[CostControl] THROTTLE: ${agentId} at ${(ratio * 100).toFixed(0)}% — model downgraded`);
    io.emit('cost_update', { type: 'agent-throttled', agentId, dailyUsed, dailyCap });
  } else {
    console.warn(`[CostControl] ALERT: ${message}`);
    io.emit('cost_update', { type: 'threshold-warning', agentId, dailyUsed, dailyCap });
  }
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

  // Trigger memory summarization on task close
  const sessionId = event.sessionId;
  if (sessionId && summarizer) {
    summarizer.checkAndCompact(sessionId).catch((err: any) => {
      console.warn('[Memory] Task-close summarization failed:', err?.message);
    });
  }
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

// --- Workflow events ---
workflowExecutor.on('workflow:started', (instance) => {
  io.emit('workflow_update', { type: 'started', instanceId: instance.id, workflowName: instance.workflowName });
});

workflowExecutor.on('workflow:completed', (instance) => {
  io.emit('workflow_update', { type: 'completed', instanceId: instance.id, workflowName: instance.workflowName });
});

workflowExecutor.on('workflow:failed', (instance, error) => {
  io.emit('workflow_update', { type: 'failed', instanceId: instance.id, workflowName: instance.workflowName, error });
});

workflowExecutor.on('workflow:phase-changed', (instance, phase) => {
  io.emit('workflow_update', { type: 'phase_changed', instanceId: instance.id, phaseName: phase.name, displayName: phase.displayName });
});

workflowExecutor.on('workflow:step-completed', (instance, stepInfo) => {
  io.emit('workflow_update', { type: 'step_completed', instanceId: instance.id, phaseName: stepInfo.phaseName, stepName: stepInfo.stepName });
});

workflowExecutor.on('workflow:waiting-approval', (instance, approval) => {
  io.emit('approval_requested', { instanceId: instance.id, approval });
});

workflowExecutor.on('workflow:progress', (instanceId, progress) => {
  io.emit('workflow_progress', { instanceId, progress });
});

// --- Cost alert events ---
modelRouter.on('cost:alert', (alertData) => {
  const msgType = alertData.alertType === 'exceeded' ? 'cost.cap_exceeded' : 'cost.alert';
  io.emit(msgType, {
    type: msgType,
    payload: alertData,
    timestamp: new Date().toISOString(),
  });
  gatewayServer.broadcastToDashboards({
    type: msgType,
    payload: alertData,
    timestamp: new Date().toISOString(),
    sessionId: '',
  });
});

// --- Escalation creation events (from AgentRunner) ---
agentRunner.onEscalationCreated = (escalation) => {
  io.emit('escalation_update', {
    type: 'created',
    escalation,
    timestamp: new Date().toISOString(),
  });
};

// --- Voice transcript events ---
voiceHandler.on('voice:stt-completed', (result) => {
  io.emit('voice_transcript', {
    id: result.id,
    sessionId: 'default',
    direction: 'stt',
    language: result.language,
    text: result.text,
    confidence: result.confidence,
    duration: `${(result.durationMs / 1000).toFixed(1)}s`,
    timestamp: result.timestamp,
  });
});

voiceHandler.on('voice:tts-completed', (result) => {
  io.emit('voice_transcript', {
    id: result.id,
    sessionId: 'default',
    direction: 'tts',
    language: result.language,
    text: '',
    duration: `${(result.durationMs / 1000).toFixed(1)}s`,
    timestamp: result.timestamp,
  });
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

  storageService.ensureBucket().catch(err => console.warn('[Storage] Bucket init deferred:', err.message));

  // Load persisted state from PostgreSQL (graceful degradation if DB unavailable)
  (async () => {
    try {
      await taskManager.loadFromDB();
      await sessionManager.loadFromDB();
      await agentManager.loadFromDB();
      console.log('[Init] Persisted state loaded from PostgreSQL');
    } catch (err: any) {
      console.warn('[Init] Failed to load persisted state from DB (continuing in-memory only):', err?.message);
    }
  })();
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
  sandboxManager.destroyAll().catch((err: any) => {
    console.error('[Shutdown] Failed to destroy sandboxes:', err?.message);
  });

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
  workflowExecutor,
  toolRegistry,
  sandboxManager,
};
