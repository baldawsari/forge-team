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
import { Server as SocketIOServer } from 'socket.io';
import { SessionManager } from './session-manager';
import { AgentManager } from './agent-manager';
import { TaskManager } from './task-manager';
import { VIADPEngine } from './viadp-engine';
import { ModelRouter } from './model-router';
import { VoiceHandler } from './voice-handler';
import { GatewayServer } from './server';
import { AgentRunner } from './agent-runner';
import { WorkflowExecutor } from './workflow-engine';
import { ToolRegistry, SandboxManager } from './tools';
declare const sessionManager: SessionManager;
declare const agentManager: AgentManager;
declare const taskManager: TaskManager;
declare const viadpEngine: VIADPEngine;
declare const modelRouter: ModelRouter;
declare const voiceHandler: VoiceHandler;
declare const toolRegistry: ToolRegistry;
declare const sandboxManager: SandboxManager;
declare const agentRunner: AgentRunner;
declare const workflowExecutor: WorkflowExecutor;
declare const app: import("express-serve-static-core").Express;
declare const httpServer: http.Server<typeof http.IncomingMessage, typeof http.ServerResponse>;
declare const gatewayServer: GatewayServer;
declare const io: SocketIOServer<import("socket.io").DefaultEventsMap, import("socket.io").DefaultEventsMap, import("socket.io").DefaultEventsMap, any>;
export { app, httpServer, io, gatewayServer, sessionManager, agentManager, taskManager, viadpEngine, modelRouter, voiceHandler, agentRunner, workflowExecutor, toolRegistry, sandboxManager, };
//# sourceMappingURL=index.d.ts.map