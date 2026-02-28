/**
 * WebSocket Server for the ForgeTeam Gateway.
 *
 * Manages WebSocket connections for users, agents, and dashboard clients.
 * Routes messages between all participants and broadcasts real-time updates.
 *
 * All WebSocket messages follow the format:
 * { type: string, payload: any, timestamp: string, sessionId: string }
 */

import { WebSocketServer, WebSocket, RawData } from 'ws';
import { v4 as uuid } from 'uuid';
import { EventEmitter } from 'eventemitter3';
import { z } from 'zod';
import type { Server as HTTPServer } from 'http';
import type { AgentId, AgentMessage, AgentMessageType } from '@forge-team/shared';
import type { SessionManager } from './session-manager';
import type { AgentManager } from './agent-manager';
import type { TaskManager } from './task-manager';
import type { VIADPEngine } from './viadp-engine';
import type { ModelRouter } from './model-router';
import type { VoiceHandler } from './voice-handler';
import type { MessageBus } from './openclaw/message-bus';
import type { OpenClawAgentRegistry } from './openclaw/agent-registry';
import type { ToolRunner } from './openclaw/tool-runner';
import type { WorkflowExecutor } from './workflow-engine';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Type of connected client */
export type ClientType = 'user' | 'agent' | 'dashboard';

/** A connected WebSocket client */
export interface ConnectedClient {
  id: string;
  ws: WebSocket;
  type: ClientType;
  /** Agent ID if this is an agent connection */
  agentId: AgentId | null;
  /** Session IDs this client is subscribed to */
  sessionIds: Set<string>;
  /** When the client connected */
  connectedAt: string;
  /** Last message received from this client */
  lastMessageAt: string;
  /** Whether the client is alive (for heartbeat) */
  isAlive: boolean;
}

/** Standard WebSocket message envelope */
export const WSMessageSchema = z.object({
  type: z.string(),
  payload: z.any(),
  timestamp: z.string().optional(),
  sessionId: z.string().optional(),
});

export type WSMessage = z.infer<typeof WSMessageSchema>;

/** Events emitted by the GatewayServer */
export interface GatewayServerEvents {
  'client:connected': (client: ConnectedClient) => void;
  'client:disconnected': (clientId: string, type: ClientType) => void;
  'message:received': (clientId: string, message: WSMessage) => void;
  'message:routed': (message: AgentMessage) => void;
  'error': (error: Error) => void;
}

// ---------------------------------------------------------------------------
// Gateway WebSocket Server
// ---------------------------------------------------------------------------

export class GatewayServer extends EventEmitter<GatewayServerEvents> {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, ConnectedClient> = new Map();
  /** Map agent IDs to their connected client IDs */
  private agentClientMap: Map<AgentId, string> = new Map();
  /** Heartbeat interval */
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  // Manager references
  private sessionManager: SessionManager;
  private agentManager: AgentManager;
  private taskManager: TaskManager;
  private viadpEngine: VIADPEngine;
  private modelRouter: ModelRouter;
  private voiceHandler: VoiceHandler;
  private messageBus: MessageBus | null;
  private agentRegistry: OpenClawAgentRegistry | null;
  private toolRunner: ToolRunner | null;
  private workflowExecutor: WorkflowExecutor | null;

  constructor(deps: {
    sessionManager: SessionManager;
    agentManager: AgentManager;
    taskManager: TaskManager;
    viadpEngine: VIADPEngine;
    modelRouter: ModelRouter;
    voiceHandler: VoiceHandler;
    messageBus?: MessageBus;
    agentRegistry?: OpenClawAgentRegistry;
    toolRunner?: ToolRunner;
    workflowExecutor?: WorkflowExecutor;
  }) {
    super();
    this.sessionManager = deps.sessionManager;
    this.agentManager = deps.agentManager;
    this.taskManager = deps.taskManager;
    this.viadpEngine = deps.viadpEngine;
    this.modelRouter = deps.modelRouter;
    this.voiceHandler = deps.voiceHandler;
    this.messageBus = deps.messageBus ?? null;
    this.agentRegistry = deps.agentRegistry ?? null;
    this.toolRunner = deps.toolRunner ?? null;
    this.workflowExecutor = deps.workflowExecutor ?? null;
  }

  /**
   * Attaches the WebSocket server to an existing HTTP server.
   * Uses noServer mode so that the HTTP upgrade event can be routed
   * between this server (raw WS) and Socket.IO on the same port.
   */
  attach(httpServer: HTTPServer): void {
    this.wss = new WebSocketServer({ noServer: true });

    this.wss.on('connection', (ws: WebSocket, req) => {
      this.handleConnection(ws, req);
    });

    // Handle HTTP upgrade manually: only upgrade non-socket.io paths
    httpServer.on('upgrade', (request, socket, head) => {
      const pathname = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`).pathname;

      // Let Socket.IO handle its own path (/socket.io)
      if (pathname.startsWith('/socket.io')) {
        return; // Socket.IO's own upgrade handler will pick this up
      }

      // Everything else goes to the raw WS server
      this.wss!.handleUpgrade(request, socket, head, (ws) => {
        this.wss!.emit('connection', ws, request);
      });
    });

    // Start heartbeat monitoring every 30 seconds
    this.heartbeatInterval = setInterval(() => this.heartbeat(), 30_000);

    // Wire up manager events to broadcast to dashboards
    this.wireManagerEvents();

    console.log('[GatewayServer] WebSocket server attached and listening');
  }

  // =========================================================================
  // Connection Management
  // =========================================================================

  /**
   * Handles a new WebSocket connection.
   */
  private handleConnection(ws: WebSocket, req: any): void {
    const clientId = uuid();
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const clientType = (url.searchParams.get('type') as ClientType) || 'user';
    const agentId = url.searchParams.get('agentId') as AgentId | null;
    const sessionId = url.searchParams.get('sessionId');

    const client: ConnectedClient = {
      id: clientId,
      ws,
      type: clientType,
      agentId: clientType === 'agent' ? agentId : null,
      sessionIds: new Set(sessionId ? [sessionId] : []),
      connectedAt: new Date().toISOString(),
      lastMessageAt: new Date().toISOString(),
      isAlive: true,
    };

    this.clients.set(clientId, client);

    // Register agent connection
    if (clientType === 'agent' && agentId) {
      this.agentClientMap.set(agentId, clientId);
      this.agentManager.setAgentStatus(agentId, 'idle');
      console.log(`[GatewayServer] Agent ${agentId} connected (client: ${clientId})`);
    } else {
      console.log(`[GatewayServer] ${clientType} client connected: ${clientId}`);
    }

    // Send welcome message
    this.sendToClient(clientId, {
      type: 'system.welcome',
      payload: {
        clientId,
        clientType,
        agentId,
        serverTime: new Date().toISOString(),
        message: 'Connected to ForgeTeam Gateway',
      },
      timestamp: new Date().toISOString(),
      sessionId: sessionId ?? '',
    });

    this.emit('client:connected', client);

    // Set up message handling
    ws.on('message', (data: RawData) => {
      this.handleMessage(clientId, data);
    });

    ws.on('close', () => {
      this.handleDisconnect(clientId);
    });

    ws.on('error', (error: Error) => {
      console.error(`[GatewayServer] Client ${clientId} error:`, error.message);
      this.emit('error', error);
    });

    ws.on('pong', () => {
      const c = this.clients.get(clientId);
      if (c) c.isAlive = true;
    });
  }

  /**
   * Handles a client disconnection.
   */
  private handleDisconnect(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    // Unregister agent
    if (client.type === 'agent' && client.agentId) {
      this.agentClientMap.delete(client.agentId);
      this.agentManager.setAgentStatus(client.agentId, 'offline');
      console.log(`[GatewayServer] Agent ${client.agentId} disconnected`);

      // Remove agent from sessions
      for (const sessionId of client.sessionIds) {
        this.sessionManager.removeAgentFromSession(sessionId, client.agentId);
      }
    }

    this.clients.delete(clientId);
    this.emit('client:disconnected', clientId, client.type);
    console.log(`[GatewayServer] ${client.type} client disconnected: ${clientId}`);
  }

  // =========================================================================
  // Message Handling
  // =========================================================================

  /**
   * Handles an incoming WebSocket message from a client.
   */
  private handleMessage(clientId: string, rawData: RawData): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    client.lastMessageAt = new Date().toISOString();
    client.isAlive = true;

    let parsed: WSMessage;
    try {
      const text = rawData.toString();
      const json = JSON.parse(text);
      parsed = WSMessageSchema.parse(json);
    } catch (error) {
      this.sendToClient(clientId, {
        type: 'system.error',
        payload: {
          error: {
            code: 'INVALID_MESSAGE',
            message: 'Failed to parse message. Expected JSON with { type, payload, timestamp?, sessionId? }',
          },
        },
        timestamp: new Date().toISOString(),
        sessionId: '',
      });
      return;
    }

    // Ensure timestamp
    if (!parsed.timestamp) {
      parsed.timestamp = new Date().toISOString();
    }

    this.emit('message:received', clientId, parsed);

    // Route based on message type
    switch (parsed.type) {
      // -- Session management --
      case 'session.create':
        this.handleSessionCreate(clientId, parsed);
        break;
      case 'session.join':
        this.handleSessionJoin(clientId, parsed);
        break;
      case 'session.leave':
        this.handleSessionLeave(clientId, parsed);
        break;
      case 'session.list':
        this.handleSessionList(clientId);
        break;
      case 'session.destroy':
        this.handleSessionDestroy(clientId, parsed);
        break;

      // -- Chat messages --
      case 'chat.message':
        this.handleChatMessage(clientId, parsed);
        break;

      // -- Agent messages --
      case 'agent.status':
        this.handleAgentStatus(clientId, parsed);
        break;
      case 'agent.list':
        this.handleAgentList(clientId);
        break;
      case 'agent.send':
        this.handleAgentSend(clientId, parsed);
        break;

      // -- Task management --
      case 'task.create':
        this.handleTaskCreate(clientId, parsed);
        break;
      case 'task.update':
        this.handleTaskUpdate(clientId, parsed);
        break;
      case 'task.move':
        this.handleTaskMove(clientId, parsed);
        break;
      case 'task.assign':
        this.handleTaskAssign(clientId, parsed);
        break;
      case 'task.list':
        this.handleTaskList(clientId, parsed);
        break;
      case 'kanban.board':
        this.handleKanbanBoard(clientId, parsed);
        break;

      // -- Delegation --
      case 'delegation.request':
        this.handleDelegationRequest(clientId, parsed);
        break;
      case 'delegation.accept':
        this.handleDelegationAccept(clientId, parsed);
        break;
      case 'delegation.reject':
        this.handleDelegationReject(clientId, parsed);
        break;

      // -- Model routing --
      case 'model.route':
        this.handleModelRoute(clientId, parsed);
        break;
      case 'model.assignments':
        this.handleModelAssignments(clientId);
        break;
      case 'model.costs':
        this.handleModelCosts(clientId, parsed);
        break;

      // -- Voice --
      case 'voice.status':
        this.handleVoiceStatus(clientId);
        break;
      case 'voice.transcribe':
        this.handleVoiceTranscribe(clientId, parsed);
        break;
      case 'voice.synthesize':
        this.handleVoiceSynthesize(clientId, parsed);
        break;
      case 'voice.languages':
        this.handleVoiceLanguages(clientId);
        break;

      // -- Workflow control --
      case 'workflow.list':
        this.handleWorkflowList(clientId);
        break;
      case 'workflow.start':
        this.handleWorkflowStart(clientId, parsed);
        break;
      case 'workflow.pause':
        this.handleWorkflowPause(clientId, parsed);
        break;
      case 'workflow.resume':
        this.handleWorkflowResume(clientId, parsed);
        break;
      case 'workflow.progress':
        this.handleWorkflowProgress(clientId, parsed);
        break;
      case 'workflow.cancel':
        this.handleWorkflowCancel(clientId, parsed);
        break;

      // -- System --
      case 'ping':
        this.sendToClient(clientId, {
          type: 'pong',
          payload: { serverTime: new Date().toISOString() },
          timestamp: new Date().toISOString(),
          sessionId: parsed.sessionId ?? '',
        });
        break;

      // -- OpenClaw messages --
      case 'openclaw.agent.register': {
        const { agentId, capabilities } = parsed.payload ?? {};
        if (this.agentRegistry && agentId) {
          this.agentRegistry.register(agentId, { capabilities: capabilities ?? [] });
        }
        this.sendToClient(clientId, {
          type: 'openclaw.agent.registered',
          payload: { agentId, success: true },
          timestamp: new Date().toISOString(),
          sessionId: parsed.sessionId ?? '',
        });
        break;
      }
      case 'openclaw.agent.heartbeat': {
        const agentId = parsed.payload?.agentId;
        if (this.agentRegistry && agentId) {
          this.agentRegistry.heartbeat(agentId);
        }
        this.sendToClient(clientId, {
          type: 'openclaw.agent.heartbeat.ack',
          payload: { agentId, timestamp: new Date().toISOString() },
          timestamp: new Date().toISOString(),
          sessionId: parsed.sessionId ?? '',
        });
        break;
      }
      case 'openclaw.agent.capabilities': {
        const agentId = parsed.payload?.agentId;
        const capabilities = this.agentRegistry?.getCapabilities(agentId) ?? null;
        this.sendToClient(clientId, {
          type: 'openclaw.agent.capabilities',
          payload: { agentId, capabilities },
          timestamp: new Date().toISOString(),
          sessionId: parsed.sessionId ?? '',
        });
        break;
      }
      case 'openclaw.tool.list': {
        const tools = this.toolRunner?.listTools() ?? [];
        this.sendToClient(clientId, {
          type: 'openclaw.tool.list',
          payload: { tools },
          timestamp: new Date().toISOString(),
          sessionId: parsed.sessionId ?? '',
        });
        break;
      }
      case 'openclaw.tool.execute': {
        const { name, input } = parsed.payload ?? {};
        if (this.toolRunner && name) {
          this.toolRunner.executeTool(name, input ?? {}, {
            sessionId: parsed.sessionId,
            agentId: parsed.payload?.agentId,
          }).then((result) => {
            this.sendToClient(clientId, {
              type: 'openclaw.tool.result',
              payload: result,
              timestamp: new Date().toISOString(),
              sessionId: parsed.sessionId ?? '',
            });
          }).catch((error: any) => {
            this.sendToClient(clientId, {
              type: 'openclaw.tool.error',
              payload: { error: error?.message ?? 'Tool execution failed' },
              timestamp: new Date().toISOString(),
              sessionId: parsed.sessionId ?? '',
            });
          });
        } else {
          this.sendError(clientId, 'TOOL_NAME_REQUIRED', 'Tool name is required');
        }
        break;
      }

      default:
        this.sendToClient(clientId, {
          type: 'system.error',
          payload: {
            error: {
              code: 'UNKNOWN_MESSAGE_TYPE',
              message: `Unknown message type: ${parsed.type}`,
            },
          },
          timestamp: new Date().toISOString(),
          sessionId: parsed.sessionId ?? '',
        });
    }
  }

  // =========================================================================
  // Session Handlers
  // =========================================================================

  private handleSessionCreate(clientId: string, msg: WSMessage): void {
    const session = this.sessionManager.createSession({
      label: msg.payload?.label,
      userId: msg.payload?.userId,
      metadata: msg.payload?.metadata,
    });

    const client = this.clients.get(clientId);
    if (client) {
      client.sessionIds.add(session.id);
    }

    this.sendToClient(clientId, {
      type: 'session.created',
      payload: this.sessionManager.serializeSession(session.id),
      timestamp: new Date().toISOString(),
      sessionId: session.id,
    });

    this.broadcastToDashboards({
      type: 'session.created',
      payload: this.sessionManager.serializeSession(session.id),
      timestamp: new Date().toISOString(),
      sessionId: session.id,
    });
  }

  private handleSessionJoin(clientId: string, msg: WSMessage): void {
    const sessionId = msg.payload?.sessionId ?? msg.sessionId;
    if (!sessionId) {
      this.sendError(clientId, 'SESSION_ID_REQUIRED', 'sessionId is required');
      return;
    }

    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      this.sendError(clientId, 'SESSION_NOT_FOUND', `Session ${sessionId} not found`);
      return;
    }

    const client = this.clients.get(clientId);
    if (client) {
      client.sessionIds.add(sessionId);

      if (client.type === 'agent' && client.agentId) {
        this.sessionManager.addAgentToSession(sessionId, client.agentId);
      }
    }

    this.sendToClient(clientId, {
      type: 'session.joined',
      payload: this.sessionManager.serializeSession(sessionId),
      timestamp: new Date().toISOString(),
      sessionId,
    });
  }

  private handleSessionLeave(clientId: string, msg: WSMessage): void {
    const sessionId = msg.payload?.sessionId ?? msg.sessionId;
    if (!sessionId) return;

    const client = this.clients.get(clientId);
    if (client) {
      client.sessionIds.delete(sessionId);

      if (client.type === 'agent' && client.agentId) {
        this.sessionManager.removeAgentFromSession(sessionId, client.agentId);
      }
    }

    this.sendToClient(clientId, {
      type: 'session.left',
      payload: { sessionId },
      timestamp: new Date().toISOString(),
      sessionId,
    });
  }

  private handleSessionList(clientId: string): void {
    const sessions = this.sessionManager.getAllSessions().map((s) =>
      this.sessionManager.serializeSession(s.id)
    );

    this.sendToClient(clientId, {
      type: 'session.list',
      payload: { sessions },
      timestamp: new Date().toISOString(),
      sessionId: '',
    });
  }

  private handleSessionDestroy(clientId: string, msg: WSMessage): void {
    const sessionId = msg.payload?.sessionId ?? msg.sessionId;
    if (!sessionId) return;

    this.sessionManager.destroySession(sessionId);

    // Remove session from all clients
    for (const client of this.clients.values()) {
      client.sessionIds.delete(sessionId);
    }

    this.sendToClient(clientId, {
      type: 'session.destroyed',
      payload: { sessionId },
      timestamp: new Date().toISOString(),
      sessionId,
    });

    this.broadcastToDashboards({
      type: 'session.destroyed',
      payload: { sessionId },
      timestamp: new Date().toISOString(),
      sessionId,
    });
  }

  // =========================================================================
  // Chat Handlers
  // =========================================================================

  private handleChatMessage(clientId: string, msg: WSMessage): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    const sessionId = msg.sessionId ?? Array.from(client.sessionIds)[0];
    if (!sessionId) {
      this.sendError(clientId, 'SESSION_REQUIRED', 'Must be in a session to send chat messages');
      return;
    }

    const agentMessage: AgentMessage = {
      id: uuid(),
      type: 'chat.message',
      from: client.type === 'agent' && client.agentId ? client.agentId : 'user',
      to: msg.payload?.to ?? 'broadcast',
      payload: {
        content: msg.payload?.content ?? '',
        data: msg.payload?.data,
      },
      sessionId,
      timestamp: new Date().toISOString(),
      correlationId: msg.payload?.correlationId,
    };

    // Record in session history
    this.sessionManager.addMessage(sessionId, agentMessage);

    // Route the message
    if (agentMessage.to === 'broadcast') {
      this.broadcastToSession(sessionId, {
        type: 'chat.message',
        payload: agentMessage,
        timestamp: agentMessage.timestamp,
        sessionId,
      }, clientId);
    } else if (agentMessage.to === 'dashboard') {
      this.broadcastToDashboards({
        type: 'chat.message',
        payload: agentMessage,
        timestamp: agentMessage.timestamp,
        sessionId,
      });
    } else {
      // Direct message to a specific agent
      this.routeToAgent(agentMessage.to as AgentId, {
        type: 'chat.message',
        payload: agentMessage,
        timestamp: agentMessage.timestamp,
        sessionId,
      });
    }

    this.emit('message:routed', agentMessage);
  }

  // =========================================================================
  // Agent Handlers
  // =========================================================================

  private handleAgentStatus(clientId: string, msg: WSMessage): void {
    const client = this.clients.get(clientId);
    if (!client || client.type !== 'agent' || !client.agentId) {
      this.sendError(clientId, 'NOT_AGENT', 'Only agent connections can update status');
      return;
    }

    const newStatus = msg.payload?.status;
    if (newStatus) {
      this.agentManager.setAgentStatus(client.agentId, newStatus);
    }

    const state = this.agentManager.getState(client.agentId);
    this.sendToClient(clientId, {
      type: 'agent.status',
      payload: state,
      timestamp: new Date().toISOString(),
      sessionId: msg.sessionId ?? '',
    });
  }

  private handleAgentList(clientId: string): void {
    const summary = this.agentManager.getAgentSummary();
    this.sendToClient(clientId, {
      type: 'agent.list',
      payload: { agents: summary },
      timestamp: new Date().toISOString(),
      sessionId: '',
    });
  }

  private handleAgentSend(clientId: string, msg: WSMessage): void {
    const targetAgentId = msg.payload?.to as AgentId;
    const sessionId = msg.sessionId ?? '';

    if (!targetAgentId) {
      this.sendError(clientId, 'TARGET_REQUIRED', 'Target agent ID is required');
      return;
    }

    const client = this.clients.get(clientId);
    const from = client?.type === 'agent' && client.agentId ? client.agentId : 'user';

    const agentMessage: AgentMessage = {
      id: uuid(),
      type: (msg.payload?.messageType as AgentMessageType) ?? 'chat.message',
      from: from as AgentId | 'user',
      to: targetAgentId,
      payload: {
        content: msg.payload?.content ?? '',
        data: msg.payload?.data,
        artifacts: msg.payload?.artifacts,
      },
      sessionId,
      timestamp: new Date().toISOString(),
      correlationId: msg.payload?.correlationId,
    };

    // Record in session history
    if (sessionId) {
      this.sessionManager.addMessage(sessionId, agentMessage);
    }

    // Dispatch via agent manager
    this.agentManager.dispatchMessage(agentMessage);

    // Also directly route to the agent's WebSocket if connected
    this.routeToAgent(targetAgentId, {
      type: agentMessage.type,
      payload: agentMessage,
      timestamp: agentMessage.timestamp,
      sessionId,
    });

    // Acknowledge to sender
    this.sendToClient(clientId, {
      type: 'agent.send.ack',
      payload: { messageId: agentMessage.id, to: targetAgentId },
      timestamp: new Date().toISOString(),
      sessionId,
    });

    this.emit('message:routed', agentMessage);
  }

  // =========================================================================
  // Task Handlers
  // =========================================================================

  private handleTaskCreate(clientId: string, msg: WSMessage): void {
    const sessionId = msg.sessionId;
    if (!sessionId) {
      this.sendError(clientId, 'SESSION_REQUIRED', 'sessionId is required for task creation');
      return;
    }

    const task = this.taskManager.createTask(
      {
        title: msg.payload?.title ?? 'Untitled Task',
        description: msg.payload?.description ?? '',
        priority: msg.payload?.priority,
        complexity: msg.payload?.complexity,
        assignedTo: msg.payload?.assignedTo,
        parentTaskId: msg.payload?.parentTaskId,
        dependsOn: msg.payload?.dependsOn,
        tags: msg.payload?.tags,
        phase: msg.payload?.phase,
        storyPoints: msg.payload?.storyPoints,
        dueAt: msg.payload?.dueAt,
        metadata: msg.payload?.metadata,
      },
      sessionId
    );

    this.sendToClient(clientId, {
      type: 'task.created',
      payload: task,
      timestamp: new Date().toISOString(),
      sessionId,
    });

    this.broadcastToDashboards({
      type: 'task.created',
      payload: task,
      timestamp: new Date().toISOString(),
      sessionId,
    });
  }

  private handleTaskUpdate(clientId: string, msg: WSMessage): void {
    const taskId = msg.payload?.taskId;
    if (!taskId) {
      this.sendError(clientId, 'TASK_ID_REQUIRED', 'taskId is required');
      return;
    }

    const task = this.taskManager.updateTask(taskId, msg.payload);
    if (!task) {
      this.sendError(clientId, 'TASK_NOT_FOUND', `Task ${taskId} not found`);
      return;
    }

    this.sendToClient(clientId, {
      type: 'task.updated',
      payload: task,
      timestamp: new Date().toISOString(),
      sessionId: msg.sessionId ?? task.sessionId,
    });

    this.broadcastToDashboards({
      type: 'task.updated',
      payload: task,
      timestamp: new Date().toISOString(),
      sessionId: task.sessionId,
    });
  }

  private handleTaskMove(clientId: string, msg: WSMessage): void {
    const taskId = msg.payload?.taskId;
    const newStatus = msg.payload?.status as any;
    if (!taskId || !newStatus) {
      this.sendError(clientId, 'TASK_MOVE_PARAMS', 'taskId and status are required');
      return;
    }

    const moved = this.taskManager.moveTask(taskId, newStatus);
    const task = this.taskManager.getTask(taskId);

    this.sendToClient(clientId, {
      type: moved ? 'task.moved' : 'system.error',
      payload: moved ? task : { error: { code: 'MOVE_FAILED', message: 'Task move failed' } },
      timestamp: new Date().toISOString(),
      sessionId: msg.sessionId ?? task?.sessionId ?? '',
    });

    if (moved && task) {
      this.broadcastToDashboards({
        type: 'task.moved',
        payload: task,
        timestamp: new Date().toISOString(),
        sessionId: task.sessionId,
      });
    }
  }

  private handleTaskAssign(clientId: string, msg: WSMessage): void {
    const taskId = msg.payload?.taskId;
    const agentId = msg.payload?.agentId as AgentId;
    if (!taskId || !agentId) {
      this.sendError(clientId, 'TASK_ASSIGN_PARAMS', 'taskId and agentId are required');
      return;
    }

    const assigned = this.taskManager.assignTask(taskId, agentId);
    const task = this.taskManager.getTask(taskId);

    this.sendToClient(clientId, {
      type: assigned ? 'task.assigned' : 'system.error',
      payload: assigned ? task : { error: { code: 'ASSIGN_FAILED', message: 'Task assignment failed' } },
      timestamp: new Date().toISOString(),
      sessionId: msg.sessionId ?? task?.sessionId ?? '',
    });

    if (assigned && task) {
      this.broadcastToDashboards({
        type: 'task.assigned',
        payload: task,
        timestamp: new Date().toISOString(),
        sessionId: task.sessionId,
      });
    }
  }

  private handleTaskList(clientId: string, msg: WSMessage): void {
    const tasks = this.taskManager.getTasks({
      sessionId: msg.sessionId ?? msg.payload?.sessionId,
      status: msg.payload?.status,
      assignedTo: msg.payload?.assignedTo,
    });

    this.sendToClient(clientId, {
      type: 'task.list',
      payload: { tasks },
      timestamp: new Date().toISOString(),
      sessionId: msg.sessionId ?? '',
    });
  }

  private handleKanbanBoard(clientId: string, msg: WSMessage): void {
    const sessionId = msg.sessionId ?? msg.payload?.sessionId;
    if (!sessionId) {
      this.sendError(clientId, 'SESSION_REQUIRED', 'sessionId is required for kanban board');
      return;
    }

    const board = this.taskManager.getKanbanBoard(sessionId);

    this.sendToClient(clientId, {
      type: 'kanban.board',
      payload: board,
      timestamp: new Date().toISOString(),
      sessionId,
    });
  }

  // =========================================================================
  // Delegation Handlers
  // =========================================================================

  private handleDelegationRequest(clientId: string, msg: WSMessage): void {
    const request = this.viadpEngine.createDelegationRequest({
      from: msg.payload?.from,
      to: msg.payload?.to,
      taskId: msg.payload?.taskId,
      sessionId: msg.sessionId ?? '',
      reason: msg.payload?.reason ?? '',
      requiredCapabilities: msg.payload?.requiredCapabilities ?? [],
      scope: msg.payload?.scope ?? {
        allowedActions: ['*'],
        resourceLimits: {},
        canRedelegate: false,
        allowedArtifactTypes: ['*'],
      },
      escalation: msg.payload?.escalation,
      checkpoints: msg.payload?.checkpoints,
    });

    this.sendToClient(clientId, {
      type: 'delegation.requested',
      payload: request,
      timestamp: new Date().toISOString(),
      sessionId: msg.sessionId ?? '',
    });

    // Notify the target agent
    this.routeToAgent(request.to, {
      type: 'delegation.request',
      payload: request,
      timestamp: new Date().toISOString(),
      sessionId: msg.sessionId ?? '',
    });

    this.broadcastToDashboards({
      type: 'delegation.requested',
      payload: request,
      timestamp: new Date().toISOString(),
      sessionId: msg.sessionId ?? '',
    });
  }

  private handleDelegationAccept(clientId: string, msg: WSMessage): void {
    const requestId = msg.payload?.requestId;
    if (!requestId) {
      this.sendError(clientId, 'REQUEST_ID_REQUIRED', 'requestId is required');
      return;
    }

    const result = this.viadpEngine.acceptDelegation(requestId);
    if (!result) {
      this.sendError(clientId, 'ACCEPT_FAILED', 'Could not accept delegation');
      return;
    }

    this.sendToClient(clientId, {
      type: 'delegation.accepted',
      payload: result,
      timestamp: new Date().toISOString(),
      sessionId: msg.sessionId ?? '',
    });

    // Notify the delegator
    this.routeToAgent(result.request.from, {
      type: 'delegation.accepted',
      payload: result,
      timestamp: new Date().toISOString(),
      sessionId: msg.sessionId ?? '',
    });

    this.broadcastToDashboards({
      type: 'delegation.accepted',
      payload: result,
      timestamp: new Date().toISOString(),
      sessionId: msg.sessionId ?? '',
    });
  }

  private handleDelegationReject(clientId: string, msg: WSMessage): void {
    const requestId = msg.payload?.requestId;
    const reason = msg.payload?.reason ?? 'No reason provided';
    if (!requestId) {
      this.sendError(clientId, 'REQUEST_ID_REQUIRED', 'requestId is required');
      return;
    }

    const request = this.viadpEngine.rejectDelegation(requestId, reason);
    if (!request) {
      this.sendError(clientId, 'REJECT_FAILED', 'Could not reject delegation');
      return;
    }

    this.sendToClient(clientId, {
      type: 'delegation.rejected',
      payload: { request, reason },
      timestamp: new Date().toISOString(),
      sessionId: msg.sessionId ?? '',
    });

    this.broadcastToDashboards({
      type: 'delegation.rejected',
      payload: { request, reason },
      timestamp: new Date().toISOString(),
      sessionId: msg.sessionId ?? '',
    });
  }

  // =========================================================================
  // Model Routing Handlers
  // =========================================================================

  private handleModelRoute(clientId: string, msg: WSMessage): void {
    const result = this.modelRouter.route({
      agentId: msg.payload?.agentId,
      taskContent: msg.payload?.taskContent ?? '',
      tierOverride: msg.payload?.tierOverride,
      maxCost: msg.payload?.maxCost,
      requireVision: msg.payload?.requireVision,
      requireTools: msg.payload?.requireTools,
      sessionId: msg.sessionId ?? '',
    });

    this.sendToClient(clientId, {
      type: 'model.routed',
      payload: result,
      timestamp: new Date().toISOString(),
      sessionId: msg.sessionId ?? '',
    });
  }

  private handleModelAssignments(clientId: string): void {
    const assignments = this.modelRouter.getAllAssignments();
    const catalog = this.modelRouter.getModelCatalog();

    this.sendToClient(clientId, {
      type: 'model.assignments',
      payload: { assignments, catalog },
      timestamp: new Date().toISOString(),
      sessionId: '',
    });
  }

  private handleModelCosts(clientId: string, msg: WSMessage): void {
    const summary = this.modelRouter.getCostSummary(msg.payload?.from, msg.payload?.to);

    this.sendToClient(clientId, {
      type: 'model.costs',
      payload: summary,
      timestamp: new Date().toISOString(),
      sessionId: '',
    });
  }

  // =========================================================================
  // Voice Handler
  // =========================================================================

  private handleVoiceStatus(clientId: string): void {
    const status = this.voiceHandler.getStatus();
    this.sendToClient(clientId, {
      type: 'voice.status',
      payload: status,
      timestamp: new Date().toISOString(),
      sessionId: '',
    });
  }

  // =========================================================================
  // Voice WS Handlers (STT/TTS)
  // =========================================================================

  private async handleVoiceTranscribe(clientId: string, msg: WSMessage): Promise<void> {
    try {
      const audioData = msg.payload?.audio;
      const language = msg.payload?.language;

      if (!audioData) {
        this.sendError(clientId, 'AUDIO_REQUIRED', 'audio (base64) is required for transcription');
        return;
      }

      const audioBuffer = Buffer.from(audioData, 'base64');
      const result = await this.voiceHandler.transcribe(audioBuffer, language);

      this.sendToClient(clientId, {
        type: 'voice.transcribed',
        payload: result,
        timestamp: new Date().toISOString(),
        sessionId: msg.sessionId ?? '',
      });

      this.broadcastToDashboards({
        type: 'voice.transcribed',
        payload: result,
        timestamp: new Date().toISOString(),
        sessionId: msg.sessionId ?? '',
      });
    } catch (error: any) {
      this.sendError(clientId, 'TRANSCRIBE_FAILED', error?.message ?? 'Transcription failed');
    }
  }

  private async handleVoiceSynthesize(clientId: string, msg: WSMessage): Promise<void> {
    try {
      const text = msg.payload?.text;
      const language = msg.payload?.language ?? 'en';
      const voiceId = msg.payload?.voiceId;

      if (!text) {
        this.sendError(clientId, 'TEXT_REQUIRED', 'text is required for synthesis');
        return;
      }

      const result = await this.voiceHandler.synthesize({
        text,
        language,
        voiceId,
      });

      this.sendToClient(clientId, {
        type: 'voice.synthesized',
        payload: {
          audio: result.audioBase64,
          durationMs: result.durationMs,
          language,
        },
        timestamp: new Date().toISOString(),
        sessionId: msg.sessionId ?? '',
      });

      this.broadcastToDashboards({
        type: 'voice.synthesized',
        payload: {
          text,
          durationMs: result.durationMs,
          language,
        },
        timestamp: new Date().toISOString(),
        sessionId: msg.sessionId ?? '',
      });
    } catch (error: any) {
      this.sendError(clientId, 'SYNTHESIZE_FAILED', error?.message ?? 'Synthesis failed');
    }
  }

  private handleVoiceLanguages(clientId: string): void {
    this.sendToClient(clientId, {
      type: 'voice.languages',
      payload: {
        stt: ['en', 'ar', 'en-US', 'ar-SA'],
        tts: ['en', 'ar', 'en-US', 'ar-SA'],
        default: 'ar',
      },
      timestamp: new Date().toISOString(),
      sessionId: '',
    });
  }

  // =========================================================================
  // Workflow WS Handlers
  // =========================================================================

  private handleWorkflowList(clientId: string): void {
    if (!this.workflowExecutor) {
      this.sendError(clientId, 'WORKFLOW_NOT_AVAILABLE', 'WorkflowExecutor not configured');
      return;
    }
    try {
      const definitions = this.workflowExecutor.listDefinitions();
      this.sendToClient(clientId, {
        type: 'workflow.list',
        payload: { workflows: definitions },
        timestamp: new Date().toISOString(),
        sessionId: '',
      });
    } catch (error: any) {
      this.sendError(clientId, 'WORKFLOW_LIST_FAILED', error?.message ?? 'Failed to list workflows');
    }
  }

  private async handleWorkflowStart(clientId: string, msg: WSMessage): Promise<void> {
    if (!this.workflowExecutor) {
      this.sendError(clientId, 'WORKFLOW_NOT_AVAILABLE', 'WorkflowExecutor not configured');
      return;
    }
    try {
      const { definitionName, sessionId } = msg.payload ?? {};
      if (!definitionName || !sessionId) {
        this.sendError(clientId, 'INVALID_PARAMS', 'definitionName and sessionId are required');
        return;
      }
      const instance = await this.workflowExecutor.startWorkflow(definitionName, sessionId);
      this.sendToClient(clientId, {
        type: 'workflow.started',
        payload: instance,
        timestamp: new Date().toISOString(),
        sessionId,
      });
    } catch (error: any) {
      this.sendError(clientId, 'WORKFLOW_START_FAILED', error?.message ?? 'Failed to start workflow');
    }
  }

  private async handleWorkflowPause(clientId: string, msg: WSMessage): Promise<void> {
    if (!this.workflowExecutor) {
      this.sendError(clientId, 'WORKFLOW_NOT_AVAILABLE', 'WorkflowExecutor not configured');
      return;
    }
    try {
      const instanceId = msg.payload?.instanceId;
      if (!instanceId) {
        this.sendError(clientId, 'INVALID_PARAMS', 'instanceId is required');
        return;
      }
      await this.workflowExecutor.pauseWorkflow(instanceId);
      this.sendToClient(clientId, {
        type: 'workflow.paused',
        payload: { instanceId },
        timestamp: new Date().toISOString(),
        sessionId: msg.sessionId ?? '',
      });
    } catch (error: any) {
      this.sendError(clientId, 'WORKFLOW_PAUSE_FAILED', error?.message ?? 'Failed to pause workflow');
    }
  }

  private async handleWorkflowResume(clientId: string, msg: WSMessage): Promise<void> {
    if (!this.workflowExecutor) {
      this.sendError(clientId, 'WORKFLOW_NOT_AVAILABLE', 'WorkflowExecutor not configured');
      return;
    }
    try {
      const { instanceId, approvalData } = msg.payload ?? {};
      if (!instanceId) {
        this.sendError(clientId, 'INVALID_PARAMS', 'instanceId is required');
        return;
      }
      await this.workflowExecutor.resumeWorkflow(instanceId, approvalData);
      this.sendToClient(clientId, {
        type: 'workflow.resumed',
        payload: { instanceId },
        timestamp: new Date().toISOString(),
        sessionId: msg.sessionId ?? '',
      });
    } catch (error: any) {
      this.sendError(clientId, 'WORKFLOW_RESUME_FAILED', error?.message ?? 'Failed to resume workflow');
    }
  }

  private async handleWorkflowProgress(clientId: string, msg: WSMessage): Promise<void> {
    if (!this.workflowExecutor) {
      this.sendError(clientId, 'WORKFLOW_NOT_AVAILABLE', 'WorkflowExecutor not configured');
      return;
    }
    try {
      const instanceId = msg.payload?.instanceId;
      if (!instanceId) {
        this.sendError(clientId, 'INVALID_PARAMS', 'instanceId is required');
        return;
      }
      const progress = await this.workflowExecutor.getProgress(instanceId);
      this.sendToClient(clientId, {
        type: 'workflow.progress',
        payload: progress,
        timestamp: new Date().toISOString(),
        sessionId: msg.sessionId ?? '',
      });
    } catch (error: any) {
      this.sendError(clientId, 'WORKFLOW_PROGRESS_FAILED', error?.message ?? 'Failed to get progress');
    }
  }

  private async handleWorkflowCancel(clientId: string, msg: WSMessage): Promise<void> {
    if (!this.workflowExecutor) {
      this.sendError(clientId, 'WORKFLOW_NOT_AVAILABLE', 'WorkflowExecutor not configured');
      return;
    }
    try {
      const instanceId = msg.payload?.instanceId;
      if (!instanceId) {
        this.sendError(clientId, 'INVALID_PARAMS', 'instanceId is required');
        return;
      }
      await this.workflowExecutor.cancelWorkflow(instanceId);
      this.sendToClient(clientId, {
        type: 'workflow.cancelled',
        payload: { instanceId },
        timestamp: new Date().toISOString(),
        sessionId: msg.sessionId ?? '',
      });
    } catch (error: any) {
      this.sendError(clientId, 'WORKFLOW_CANCEL_FAILED', error?.message ?? 'Failed to cancel workflow');
    }
  }

  // =========================================================================
  // Message Routing
  // =========================================================================

  /**
   * Sends a message to a specific client by ID.
   */
  sendToClient(clientId: string, message: WSMessage): boolean {
    const client = this.clients.get(clientId);
    if (!client || client.ws.readyState !== WebSocket.OPEN) return false;

    try {
      client.ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error(`[GatewayServer] Failed to send to client ${clientId}:`, error);
      return false;
    }
  }

  /**
   * Routes a message to a specific agent by agent ID.
   */
  routeToAgent(agentId: AgentId, message: WSMessage): boolean {
    const clientId = this.agentClientMap.get(agentId);
    if (!clientId) {
      console.warn(`[GatewayServer] Agent ${agentId} not connected, message queued`);
      return false;
    }

    if (this.messageBus) {
      this.messageBus.publish(`agent:${agentId}` as any, message as any);
    }

    return this.sendToClient(clientId, message);
  }

  /**
   * Broadcasts a message to all clients in a session (except the sender).
   */
  broadcastToSession(sessionId: string, message: WSMessage, excludeClientId?: string): void {
    for (const [clientId, client] of this.clients) {
      if (clientId === excludeClientId) continue;
      if (client.sessionIds.has(sessionId) && client.ws.readyState === WebSocket.OPEN) {
        this.sendToClient(clientId, message);
      }
    }

    if (this.messageBus) {
      this.messageBus.publish(`session:${sessionId}` as any, message as any);
    }
  }

  /**
   * Broadcasts a message to all dashboard connections.
   */
  broadcastToDashboards(message: WSMessage): void {
    for (const [clientId, client] of this.clients) {
      if (client.type === 'dashboard' && client.ws.readyState === WebSocket.OPEN) {
        this.sendToClient(clientId, message);
      }
    }

    if (this.messageBus) {
      this.messageBus.publish('dashboard', message as any);
    }
  }

  /**
   * Broadcasts a message to all connected clients.
   */
  broadcastAll(message: WSMessage): void {
    for (const [clientId, client] of this.clients) {
      if (client.ws.readyState === WebSocket.OPEN) {
        this.sendToClient(clientId, message);
      }
    }
  }

  // =========================================================================
  // Manager Event Wiring
  // =========================================================================

  /**
   * Wires internal manager events to dashboard broadcasts.
   */
  private wireManagerEvents(): void {
    // Session events
    this.sessionManager.on('session:state-changed', (sessionId, oldState, newState) => {
      this.broadcastToDashboards({
        type: 'session.state-changed',
        payload: { sessionId, oldState, newState },
        timestamp: new Date().toISOString(),
        sessionId,
      });
    });

    // Agent events
    this.agentManager.on('agent:status-changed', (agentId, oldStatus, newStatus) => {
      this.broadcastToDashboards({
        type: 'agent.status-changed',
        payload: { agentId, oldStatus, newStatus },
        timestamp: new Date().toISOString(),
        sessionId: '',
      });
    });

    this.agentManager.on('agent:task-assigned', (agentId, taskId, sessionId) => {
      this.broadcastToDashboards({
        type: 'agent.task-assigned',
        payload: { agentId, taskId },
        timestamp: new Date().toISOString(),
        sessionId,
      });
    });

    this.agentManager.on('agent:task-completed', (agentId, taskId, sessionId) => {
      this.broadcastToDashboards({
        type: 'agent.task-completed',
        payload: { agentId, taskId },
        timestamp: new Date().toISOString(),
        sessionId,
      });
    });

    // Inter-agent message routing
    this.agentManager.on('agent:inter-agent-message', (message) => {
      const targetId = message.to as AgentId;
      this.routeToAgent(targetId, {
        type: message.type,
        payload: message,
        timestamp: message.timestamp,
        sessionId: message.sessionId,
      });
    });

    // Task events
    const taskEventHandler = (eventName: string) => (event: any) => {
      this.broadcastToDashboards({
        type: eventName,
        payload: event,
        timestamp: new Date().toISOString(),
        sessionId: event.sessionId,
      });
      // Also broadcast to session members
      this.broadcastToSession(event.sessionId, {
        type: eventName,
        payload: event,
        timestamp: new Date().toISOString(),
        sessionId: event.sessionId,
      });
    };

    this.taskManager.on('task:created', taskEventHandler('task.created'));
    this.taskManager.on('task:moved', taskEventHandler('task.moved'));
    this.taskManager.on('task:assigned', taskEventHandler('task.assigned'));
    this.taskManager.on('task:completed', taskEventHandler('task.completed'));

    // VIADP events
    this.viadpEngine.on('delegation:requested', (request) => {
      this.broadcastToDashboards({
        type: 'delegation.requested',
        payload: request,
        timestamp: new Date().toISOString(),
        sessionId: request.sessionId,
      });
    });

    this.viadpEngine.on('delegation:completed', (request, proof) => {
      this.broadcastToDashboards({
        type: 'delegation.completed',
        payload: { request, proof },
        timestamp: new Date().toISOString(),
        sessionId: request.sessionId,
      });
    });

    this.viadpEngine.on('delegation:escalated', (request, escalateTo) => {
      this.broadcastToDashboards({
        type: 'delegation.escalated',
        payload: { request, escalateTo },
        timestamp: new Date().toISOString(),
        sessionId: request.sessionId,
      });

      // Also notify the escalation target
      this.routeToAgent(escalateTo, {
        type: 'delegation.escalated',
        payload: { request, escalateTo },
        timestamp: new Date().toISOString(),
        sessionId: request.sessionId,
      });
    });

    this.viadpEngine.on('trust:updated', (agentId, score) => {
      this.broadcastToDashboards({
        type: 'trust.updated',
        payload: { agentId, score },
        timestamp: new Date().toISOString(),
        sessionId: '',
      });
    });

    // Workflow events
    if (this.workflowExecutor) {
      this.workflowExecutor.on('workflow:started', (instance: any) => {
        this.broadcastToDashboards({
          type: 'workflow.started',
          payload: instance,
          timestamp: new Date().toISOString(),
          sessionId: instance.sessionId,
        });
      });

      this.workflowExecutor.on('workflow:phase-changed', (instance: any, phase: any) => {
        this.broadcastToDashboards({
          type: 'workflow.phase-changed',
          payload: { instance, phase },
          timestamp: new Date().toISOString(),
          sessionId: instance.sessionId,
        });
      });

      this.workflowExecutor.on('workflow:step-completed', (instance: any, step: any) => {
        this.broadcastToDashboards({
          type: 'workflow.step-completed',
          payload: { instance, step },
          timestamp: new Date().toISOString(),
          sessionId: instance.sessionId,
        });
      });

      this.workflowExecutor.on('workflow:waiting-approval', (instance: any, approval: any) => {
        this.broadcastToDashboards({
          type: 'workflow.waiting-approval',
          payload: { instance, approval },
          timestamp: new Date().toISOString(),
          sessionId: instance.sessionId,
        });
      });

      this.workflowExecutor.on('workflow:completed', (instance: any) => {
        this.broadcastToDashboards({
          type: 'workflow.completed',
          payload: instance,
          timestamp: new Date().toISOString(),
          sessionId: instance.sessionId,
        });
      });

      this.workflowExecutor.on('workflow:failed', (instance: any, error: any) => {
        this.broadcastToDashboards({
          type: 'workflow.failed',
          payload: { instance, error },
          timestamp: new Date().toISOString(),
          sessionId: instance.sessionId,
        });
      });
    }
  }

  // =========================================================================
  // Heartbeat
  // =========================================================================

  /**
   * Sends heartbeat pings and cleans up dead connections.
   */
  private heartbeat(): void {
    for (const [clientId, client] of this.clients) {
      if (!client.isAlive) {
        console.log(`[GatewayServer] Client ${clientId} failed heartbeat, disconnecting`);
        client.ws.terminate();
        this.handleDisconnect(clientId);
        continue;
      }

      client.isAlive = false;
      try {
        client.ws.ping();
      } catch {
        // Ignore ping errors
      }
    }
  }

  // =========================================================================
  // Utility
  // =========================================================================

  /**
   * Sends an error message to a client.
   */
  private sendError(clientId: string, code: string, message: string): void {
    this.sendToClient(clientId, {
      type: 'system.error',
      payload: { error: { code, message } },
      timestamp: new Date().toISOString(),
      sessionId: '',
    });
  }

  /**
   * Returns the number of connected clients by type.
   */
  getConnectionStats(): {
    total: number;
    users: number;
    agents: number;
    dashboards: number;
    connectedAgents: AgentId[];
  } {
    let users = 0;
    let agents = 0;
    let dashboards = 0;
    const connectedAgents: AgentId[] = [];

    for (const client of this.clients.values()) {
      switch (client.type) {
        case 'user':
          users++;
          break;
        case 'agent':
          agents++;
          if (client.agentId) connectedAgents.push(client.agentId);
          break;
        case 'dashboard':
          dashboards++;
          break;
      }
    }

    return {
      total: this.clients.size,
      users,
      agents,
      dashboards,
      connectedAgents,
    };
  }

  /**
   * Shuts down the WebSocket server.
   */
  shutdown(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Close all client connections
    for (const [clientId, client] of this.clients) {
      try {
        client.ws.close(1001, 'Server shutting down');
      } catch {
        // Ignore close errors
      }
    }
    this.clients.clear();
    this.agentClientMap.clear();

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    console.log('[GatewayServer] WebSocket server shut down');
  }
}
