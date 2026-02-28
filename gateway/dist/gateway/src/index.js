"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sandboxManager = exports.toolRegistry = exports.workflowExecutor = exports.agentRunner = exports.voiceHandler = exports.modelRouter = exports.viadpEngine = exports.taskManager = exports.agentManager = exports.sessionManager = exports.gatewayServer = exports.io = exports.httpServer = exports.app = void 0;
const http_1 = __importDefault(require("http"));
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const socket_io_1 = require("socket.io");
const uuid_1 = require("uuid");
const session_manager_1 = require("./session-manager");
const agent_manager_1 = require("./agent-manager");
const task_manager_1 = require("./task-manager");
const viadp_engine_1 = require("./viadp-engine");
const model_router_1 = require("./model-router");
const voice_handler_1 = require("./voice-handler");
const server_1 = require("./server");
const agent_runner_1 = require("./agent-runner");
const party_mode_1 = require("./party-mode");
const openclaw_1 = require("./openclaw");
const workflow_engine_1 = require("./workflow-engine");
const path_1 = require("path");
const memory_1 = require("@forge-team/memory");
const pg_1 = require("pg");
const ioredis_1 = __importDefault(require("ioredis"));
const tools_1 = require("./tools");
const code_executor_1 = require("./tools/code-executor");
const terminal_tools_1 = require("./tools/terminal-tools");
const git_tools_1 = require("./tools/git-tools");
const ci_tools_1 = require("./tools/ci-tools");
const browser_tools_1 = require("./tools/browser-tools");
// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.GATEWAY_PORT ?? '18789', 10);
const HOST = process.env.GATEWAY_HOST ?? '0.0.0.0';
// ---------------------------------------------------------------------------
// Initialize Managers
// ---------------------------------------------------------------------------
console.log('==========================================================');
console.log('  ForgeTeam Gateway - Initializing');
console.log('==========================================================');
const sessionManager = new session_manager_1.SessionManager({
    maxHistorySize: 2000,
    inactivityTimeoutMs: 60 * 60 * 1000, // 1 hour
});
exports.sessionManager = sessionManager;
console.log('[Init] SessionManager initialized');
const agentManager = new agent_manager_1.AgentManager();
exports.agentManager = agentManager;
console.log('[Init] AgentManager initialized');
const taskManager = new task_manager_1.TaskManager();
exports.taskManager = taskManager;
console.log('[Init] TaskManager initialized');
const viadpEngine = new viadp_engine_1.VIADPEngine(agentManager);
exports.viadpEngine = viadpEngine;
console.log('[Init] VIADPEngine initialized');
const modelRouter = new model_router_1.ModelRouter();
exports.modelRouter = modelRouter;
console.log('[Init] ModelRouter initialized');
const voiceHandler = new voice_handler_1.VoiceHandler();
exports.voiceHandler = voiceHandler;
console.log('[Init] VoiceHandler initialized');
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://forgeteam:forgeteam_secret@localhost:5432/forgeteam';
const pool = new pg_1.Pool({ connectionString: DATABASE_URL });
const redis = new ioredis_1.default(REDIS_URL);
const memoryManager = new memory_1.MemoryManager(pool, redis);
console.log('[Init] MemoryManager initialized');
const geminiFileSearch = process.env.GOOGLE_AI_API_KEY
    ? new memory_1.GeminiFileSearch({ apiKey: process.env.GOOGLE_AI_API_KEY })
    : null;
if (geminiFileSearch) {
    console.log('[Init] GeminiFileSearch initialized');
}
let companyKBId = null;
if (geminiFileSearch) {
    initCompanyKB(geminiFileSearch).then(id => {
        companyKBId = id;
    }).catch(err => {
        console.warn('[Gateway] Company KB init failed:', err?.message);
    });
}
const vectorStore = new memory_1.VectorStore(pool, {
    dimensions: 768,
    apiKey: process.env.GOOGLE_AI_API_KEY,
});
console.log('[Init] VectorStore initialized');
const summarizer = new memory_1.Summarizer(pool, redis, {
    compactionThreshold: 50,
    preserveRecentCount: 10,
});
console.log('[Init] Summarizer initialized');
const toolRegistry = new tools_1.ToolRegistry();
exports.toolRegistry = toolRegistry;
const sandboxManager = new tools_1.SandboxManager();
exports.sandboxManager = sandboxManager;
(0, code_executor_1.registerCodeExecutorTool)(toolRegistry, sandboxManager);
(0, terminal_tools_1.registerTerminalTool)(toolRegistry, sandboxManager);
(0, git_tools_1.registerGitTools)(toolRegistry, sandboxManager);
(0, ci_tools_1.registerCITools)(toolRegistry);
(0, browser_tools_1.registerBrowserTools)(toolRegistry, sandboxManager);
console.log(`[Init] ToolRegistry initialized with ${toolRegistry.listAll().length} tools`);
const agentRunner = new agent_runner_1.AgentRunner({
    modelRouter,
    agentManager,
    sessionManager,
    memoryManager,
    geminiFileSearch: geminiFileSearch ?? undefined,
    vectorStore,
    companyKBId: companyKBId ?? undefined,
    toolRegistry,
    sandboxManager,
});
exports.agentRunner = agentRunner;
console.log('[Init] AgentRunner initialized');
const messageBus = new openclaw_1.MessageBus({ redisUrl: REDIS_URL });
const agentRegistry = new openclaw_1.OpenClawAgentRegistry(agentManager);
const toolRunner = new openclaw_1.ToolRunner();
console.log('[Init] OpenClaw components initialized (Redis:', REDIS_URL, ')');
const workflowExecutor = new workflow_engine_1.WorkflowExecutor({
    workflowsDir: (0, path_1.resolve)(__dirname, '../../workflows'),
    agentManager,
    modelRouter,
    viadpEngine,
    databaseUrl: process.env.DATABASE_URL ?? 'postgresql://forgeteam:forgeteam_secret@localhost:5432/forgeteam',
});
exports.workflowExecutor = workflowExecutor;
console.log('[Init] WorkflowExecutor initialized');
// ---------------------------------------------------------------------------
// Company KB Auto-Provisioning
// ---------------------------------------------------------------------------
async function initCompanyKB(geminiFileSearch) {
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
    }
    catch (err) {
        console.warn(`[Gateway] Failed to initialize company KB:`, err?.message);
        return null;
    }
}
// ---------------------------------------------------------------------------
// Express HTTP Server
// ---------------------------------------------------------------------------
const app = (0, express_1.default)();
exports.app = app;
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: '25mb' }));
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
    const agentId = req.params.agentId;
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
    const sessions = sessionManager.getAllSessions().map((s) => sessionManager.serializeSession(s.id));
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
        sessionId: req.query.sessionId,
        status: req.query.status,
        assignedTo: req.query.assignedTo,
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
    const summary = modelRouter.getCostSummary(req.query.from, req.query.to);
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
        status: req.query.status,
        from: req.query.from,
        to: req.query.to,
        sessionId: req.query.sessionId,
    });
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
    const agentId = req.params.agentId;
    const scores = viadpEngine.getAllTrustScores(agentId);
    res.json({ agentId, scores, timestamp: new Date().toISOString() });
});
/**
 * VIADP audit trail endpoint.
 */
app.get('/api/viadp/audit', (req, res) => {
    const entries = viadpEngine.getFullAuditTrail({
        actor: req.query.actor,
        action: req.query.action,
        since: req.query.since,
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
    }
    catch (error) {
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
    }
    catch (error) {
        console.error('[Voice] Synthesize error:', error);
        res.status(500).json({ error: error?.message ?? 'Synthesis failed' });
    }
});
// -- OpenClaw REST endpoints --
app.get('/api/openclaw/agents', (_req, res) => {
    const agents = agentRegistry.getAllWithCapabilities();
    res.json({ agents, timestamp: new Date().toISOString() });
});
app.get('/api/openclaw/tools', (_req, res) => {
    const tools = toolRunner.listTools();
    res.json({ tools, timestamp: new Date().toISOString() });
});
app.post('/api/openclaw/tools/:name/execute', express_1.default.json(), async (req, res) => {
    try {
        const result = await toolRunner.executeTool(req.params.name, req.body.input ?? {}, {
            sessionId: req.body.sessionId,
            agentId: req.body.agentId,
        });
        res.json(result);
    }
    catch (error) {
        res.status(500).json({ error: error?.message ?? 'Tool execution failed' });
    }
});
// ---------------------------------------------------------------------------
// Workflow REST Endpoints
// ---------------------------------------------------------------------------
app.get('/api/workflows', (_req, res) => {
    try {
        const definitions = workflowExecutor.listDefinitions();
        res.json({ workflows: definitions, timestamp: new Date().toISOString() });
    }
    catch (error) {
        res.status(500).json({ error: error?.message ?? 'Failed to list workflows' });
    }
});
app.post('/api/workflows/start', express_1.default.json(), async (req, res) => {
    try {
        const { definitionName, sessionId } = req.body;
        if (!definitionName || !sessionId) {
            res.status(400).json({ error: 'definitionName and sessionId are required' });
            return;
        }
        const instance = await workflowExecutor.startWorkflow(definitionName, sessionId);
        res.json({ instance, timestamp: new Date().toISOString() });
    }
    catch (error) {
        res.status(500).json({ error: error?.message ?? 'Failed to start workflow' });
    }
});
app.post('/api/workflows/:instanceId/pause', async (req, res) => {
    try {
        await workflowExecutor.pauseWorkflow(req.params.instanceId);
        res.json({ status: 'paused', timestamp: new Date().toISOString() });
    }
    catch (error) {
        res.status(500).json({ error: error?.message ?? 'Failed to pause workflow' });
    }
});
app.post('/api/workflows/:instanceId/resume', express_1.default.json(), async (req, res) => {
    try {
        const { approvalData } = req.body;
        await workflowExecutor.resumeWorkflow(req.params.instanceId, approvalData);
        res.json({ status: 'resumed', timestamp: new Date().toISOString() });
    }
    catch (error) {
        res.status(500).json({ error: error?.message ?? 'Failed to resume workflow' });
    }
});
app.get('/api/workflows/:instanceId/progress', async (req, res) => {
    try {
        const progress = await workflowExecutor.getProgress(req.params.instanceId);
        res.json({ progress, timestamp: new Date().toISOString() });
    }
    catch (error) {
        res.status(500).json({ error: error?.message ?? 'Failed to get progress' });
    }
});
app.post('/api/workflows/:instanceId/cancel', async (req, res) => {
    try {
        await workflowExecutor.cancelWorkflow(req.params.instanceId);
        res.json({ status: 'cancelled', timestamp: new Date().toISOString() });
    }
    catch (error) {
        res.status(500).json({ error: error?.message ?? 'Failed to cancel workflow' });
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
    const agentId = req.params.agentId;
    const tools = toolRegistry.listForAgent(agentId).map(t => ({ name: t.name, description: t.description, category: t.category }));
    res.json({ agentId, tools });
});
app.get('/api/sandboxes', async (_req, res) => {
    const sandboxes = await sandboxManager.listActive();
    res.json({ sandboxes });
});
// -- Memory REST endpoints --
app.get('/api/memory/search', async (req, res) => {
    try {
        const query = req.query.q ?? '';
        const scope = req.query.scope;
        const agentId = req.query.agentId;
        const limit = parseInt(req.query.limit) || 20;
        const results = await memoryManager.search(query, {
            scope: scope,
            agentId,
            limit,
        });
        res.json({ results, total: results.length });
    }
    catch (err) {
        res.status(500).json({ error: err?.message ?? 'Memory search failed' });
    }
});
app.get('/api/memory/stats', async (req, res) => {
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
    }
    catch (err) {
        res.status(500).json({ error: err?.message ?? 'Memory stats failed' });
    }
});
app.post('/api/memory/store', async (req, res) => {
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
    }
    catch (err) {
        res.status(500).json({ error: err?.message ?? 'Memory store failed' });
    }
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
        const createAndMove = (input, targetStatus) => {
            const task = taskManager.createTask(input, sid);
            const transitions = ['backlog', 'todo', 'in-progress', 'review', 'done'];
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
            assignedTo: 'backend-dev',
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
            assignedTo: 'backend-dev',
            tags: ['geofencing', 'check-in', 'gps'],
            phase: 'implementation',
            storyPoints: 8,
        }, 'in-progress');
        const t7 = createAndMove({
            title: 'Implement real-time dashboard KPIs',
            description: 'Build live dashboard showing: present/absent counts, late arrivals, department-wise breakdown, trend charts',
            priority: 'high',
            complexity: 'moderate',
            assignedTo: 'frontend-dev',
            tags: ['dashboard', 'kpi', 'real-time'],
            phase: 'implementation',
            storyPoints: 5,
        }, 'in-progress');
        const t8 = createAndMove({
            title: 'Set up Supabase auth + RLS policies',
            description: 'Configure Supabase authentication with role-based access and Row Level Security for multi-tenant data isolation',
            priority: 'critical',
            complexity: 'moderate',
            assignedTo: 'backend-dev',
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
            assignedTo: 'architect',
            tags: ['architecture', 'design', 'documentation'],
            phase: 'architecture',
            storyPoints: 8,
        }, 'review');
        const t10 = createAndMove({
            title: 'UI/UX wireframes RTL',
            description: 'Full wireframe set with RTL Arabic layout, responsive breakpoints, and accessibility compliance for WCAG 2.1 AA',
            priority: 'high',
            complexity: 'moderate',
            assignedTo: 'ux-designer',
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
        agentManager.assignTask('backend-dev', t6.id, sid);
        // frontend-dev: working on dashboard task
        agentManager.assignTask('frontend-dev', t7.id, sid);
        // architect: reviewing architecture doc
        agentManager.setAgentStatus('architect', 'reviewing');
        // ux-designer: reviewing wireframes
        agentManager.setAgentStatus('ux-designer', 'reviewing');
        // qa-architect: idle (explicitly, already default)
        agentManager.setAgentStatus('qa-architect', 'idle');
        // ------------------------------------------------------------------
        // 4. Create sample inter-agent messages
        // ------------------------------------------------------------------
        const makeMessage = (from, to, content, type = 'chat.message', minutesAgo = 0) => ({
            id: (0, uuid_1.v4)(),
            type,
            from,
            to,
            payload: { content },
            sessionId: sid,
            timestamp: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
        });
        const messages = [
            makeMessage('bmad-master', 'product-owner', 'New project assigned: Riyadh Attendance Tracker. Full context attached.', 'task.assign', 55),
            makeMessage('product-owner', 'architect', 'Requirements doc ready. 12 user stories with acceptance criteria. Please begin architecture.', 'chat.message', 45),
            makeMessage('architect', 'frontend-dev', 'Architecture approved. Here\'s the system diagram and component spec. Start with the dashboard layout.', 'task.assign', 30),
            makeMessage('architect', 'backend-dev', 'API spec attached. 14 endpoints. Start with auth + geofencing modules.', 'task.assign', 30),
            makeMessage('backend-dev', 'qa-architect', 'Check-in API ready for review. Includes geofencing validation.', 'review.request', 15),
            makeMessage('frontend-dev', 'ux-designer', 'Need RTL clarification on the Kanban component - should columns reverse?', 'chat.message', 10),
            makeMessage('ux-designer', 'frontend-dev', 'Yes, columns should flow right-to-left. Use CSS logical properties.', 'chat.response', 8),
            makeMessage('qa-architect', 'bmad-master', '@human - Need approval on test strategy for Saudization compliance module.', 'chat.message', 3),
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
    }
    catch (error) {
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
const TASK_KEYWORD_CAPABILITIES = {
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
function autoAssignAgent(taskTitle, taskDescription) {
    const text = `${taskTitle} ${taskDescription}`.toLowerCase();
    for (const [pattern, capabilities] of Object.entries(TASK_KEYWORD_CAPABILITIES)) {
        const regex = new RegExp(pattern, 'i');
        if (regex.test(text)) {
            for (const cap of capabilities) {
                const agent = agentManager.findAgentForCapability(cap);
                if (agent)
                    return agent;
            }
        }
    }
    // Fallback: assign to orchestrator instead of failing
    return 'bmad-master';
}
app.post('/api/tasks/:taskId/start', async (req, res) => {
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
        if (task.status === 'backlog')
            taskManager.moveTask(task.id, 'todo', 'system');
        if (task.status === 'backlog' || task.status === 'todo')
            taskManager.moveTask(task.id, 'in-progress', 'system');
        agentManager.assignTask(assignedAgent, task.id, task.sessionId);
        // Build task prompt
        const taskPrompt = `You have been assigned the following task:\n\n` +
            `TITLE: ${task.title}\n` +
            `DESCRIPTION: ${task.description}\n` +
            `PRIORITY: ${task.priority}\n` +
            `COMPLEXITY: ${task.complexity}\n` +
            `TAGS: ${task.tags.join(', ')}\n\n` +
            `Please analyze this task and provide your implementation plan or deliverable.`;
        const result = await agentRunner.processUserMessage(assignedAgent, taskPrompt, task.sessionId);
        // Store the agent response on the task so it persists through API polling
        taskManager.updateTask(task.id, {
            metadata: { agentResponse: result.content, agentModel: result.model },
        }, assignedAgent);
        // Move to review
        taskManager.moveTask(task.id, 'review', assignedAgent);
        // Emit socket events for real-time dashboard updates
        const agentConfig = agentManager.getConfig(assignedAgent);
        const responseTimestamp = new Date().toISOString();
        const responseMessage = {
            id: `msg-${task.id}-response`,
            from: assignedAgent,
            to: 'user',
            type: 'task.complete',
            payload: { content: result.content },
            sessionId: task.sessionId,
            timestamp: responseTimestamp,
        };
        sessionManager.addMessage(task.sessionId, responseMessage);
        io.emit('message', {
            id: responseMessage.id,
            from: agentConfig?.name ?? assignedAgent,
            to: 'user',
            type: 'task',
            content: result.content,
            taskId: task.id,
            model: result.model,
            sessionId: task.sessionId,
            timestamp: responseTimestamp,
        });
        io.emit('task_update', { type: 'moved', event: { taskId: task.id, sessionId: task.sessionId, currentStatus: 'review' } });
        res.json({
            task: taskManager.getTask(task.id),
            agentId: assignedAgent,
            response: result.content,
            model: result.model,
            timestamp: new Date().toISOString(),
        });
    }
    catch (error) {
        console.error('[TaskStart] Error:', error);
        res.status(500).json({ error: error?.message ?? 'Failed to start task' });
    }
});
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
    res.json({
        task: taskManager.getTask(task.id),
        status: 'done',
        timestamp: new Date().toISOString(),
    });
});
app.post('/api/tasks/:taskId/reject', async (req, res) => {
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
        let response = null;
        // If there's an assigned agent, send feedback and get revised response
        if (task.assignedTo) {
            const feedbackPrompt = `Your previous work on task "${task.title}" was rejected with the following feedback:\n\n` +
                `${feedback}\n\n` +
                `Original task description: ${task.description}\n\n` +
                `Please revise your work based on the feedback.`;
            const result = await agentRunner.processUserMessage(task.assignedTo, feedbackPrompt, task.sessionId);
            response = result.content;
            // Move back to review
            taskManager.moveTask(task.id, 'review', task.assignedTo);
            io.emit('task_update', { type: 'moved', event: { taskId: task.id, sessionId: task.sessionId, currentStatus: 'review' } });
        }
        res.json({
            task: taskManager.getTask(task.id),
            feedback,
            response,
            timestamp: new Date().toISOString(),
        });
    }
    catch (error) {
        console.error('[TaskReject] Error:', error);
        res.status(500).json({ error: error?.message ?? 'Failed to process rejection' });
    }
});
app.post('/api/tasks/:taskId/assign', (req, res) => {
    const task = taskManager.getTask(req.params.taskId);
    if (!task) {
        res.status(404).json({ error: 'Task not found' });
        return;
    }
    const agentId = req.body?.agentId;
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
    io.emit('task_update', { type: 'assigned', event: { taskId: task.id, sessionId: task.sessionId, assignedTo: agentId } });
    res.json({
        task: taskManager.getTask(task.id),
        assignedTo: agentId,
        timestamp: new Date().toISOString(),
    });
});
// ---------------------------------------------------------------------------
// Create HTTP + WebSocket Server
// ---------------------------------------------------------------------------
const httpServer = http_1.default.createServer(app);
exports.httpServer = httpServer;
const gatewayServer = new server_1.GatewayServer({
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
});
exports.gatewayServer = gatewayServer;
gatewayServer.attach(httpServer);
// ---------------------------------------------------------------------------
// Socket.IO Server (for Dashboard real-time updates)
// ---------------------------------------------------------------------------
const io = new socket_io_1.Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    path: '/socket.io',
});
exports.io = io;
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
    socket.on('chat.message', (data) => {
        const { payload, sessionId } = data;
        if (!payload?.content || !sessionId)
            return;
        const isBroadcast = payload.to === 'broadcast';
        const message = {
            id: (0, uuid_1.v4)(),
            type: 'chat.message',
            from: 'user',
            to: (isBroadcast ? 'bmad-master' : payload.to),
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
            const partyEngine = new party_mode_1.PartyModeEngine();
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
                    const responseMessage = {
                        id: (0, uuid_1.v4)(),
                        type: 'chat.response',
                        from: resp.agentId,
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
                console.log(`[PartyMode] ${partyResult.responses.length} agents responded for broadcast`);
            })
                .catch((error) => {
                console.error('[PartyMode] Failed, falling back to bmad-master:', error?.message);
                // Fallback: single bmad-master response
                agentManager.setAgentStatus('bmad-master', 'working');
                agentRunner
                    .processUserMessage('bmad-master', payload.content, sessionId)
                    .then((result) => {
                    const responseMessage = {
                        id: (0, uuid_1.v4)(),
                        type: 'chat.response',
                        from: 'bmad-master',
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
                    agentManager.setAgentStatus('bmad-master', 'idle');
                })
                    .catch((fallbackError) => {
                    console.error('[PartyMode] Fallback also failed:', fallbackError?.message);
                    agentManager.setAgentStatus('bmad-master', 'idle');
                });
            });
        }
        else {
            // --- Direct message: single agent reply ---
            const targetAgentId = payload.to;
            const agentConfig = agentManager.getConfig(targetAgentId);
            if (agentConfig) {
                agentManager.setAgentStatus(targetAgentId, 'working');
                agentRunner
                    .processUserMessage(targetAgentId, payload.content, sessionId)
                    .then((result) => {
                    const responseMessage = {
                        id: (0, uuid_1.v4)(),
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
                    console.log(`[Chat] ${targetAgentId} replied: ${result.content.length} chars ` +
                        `(model=${result.model}, tokens=${result.inputTokens}/${result.outputTokens})`);
                })
                    .catch((error) => {
                    console.error(`[Chat] Agent ${targetAgentId} reply failed:`, error);
                    const errorMessage = {
                        id: (0, uuid_1.v4)(),
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
    if (!memoryManager || !summarizer)
        return;
    console.log(`[Gateway] Task ${taskId} completed by ${agentId} — triggering summarization`);
    try {
        const result = await summarizer.checkAndCompact(sessionId, memoryManager);
        if (result.compacted) {
            console.log(`[Gateway] Compacted session ${sessionId}: summary=${result.summaryId}`);
        }
    }
    catch (err) {
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
const shutdown = (signal) => {
    console.log(`\n[Shutdown] Received ${signal}, shutting down gracefully...`);
    io.close();
    gatewayServer.shutdown();
    sessionManager.shutdown();
    viadpEngine.shutdown();
    sandboxManager.destroyAll().catch((err) => {
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
//# sourceMappingURL=index.js.map