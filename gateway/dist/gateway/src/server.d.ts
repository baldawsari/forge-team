/**
 * WebSocket Server for the ForgeTeam Gateway.
 *
 * Manages WebSocket connections for users, agents, and dashboard clients.
 * Routes messages between all participants and broadcasts real-time updates.
 *
 * All WebSocket messages follow the format:
 * { type: string, payload: any, timestamp: string, sessionId: string }
 */
import { WebSocket } from 'ws';
import { EventEmitter } from 'eventemitter3';
import { z } from 'zod';
import type { Server as HTTPServer } from 'http';
import type { AgentId, AgentMessage } from '@forge-team/shared';
import type { SessionManager } from './session-manager';
import type { AgentManager } from './agent-manager';
import type { TaskManager } from './task-manager';
import type { VIADPEngine } from './viadp-engine';
import type { ModelRouter } from './model-router';
import type { VoiceHandler } from './voice-handler';
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
export declare const WSMessageSchema: z.ZodObject<{
    type: z.ZodString;
    payload: z.ZodAny;
    timestamp: z.ZodOptional<z.ZodString>;
    sessionId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: string;
    sessionId?: string | undefined;
    timestamp?: string | undefined;
    payload?: any;
}, {
    type: string;
    sessionId?: string | undefined;
    timestamp?: string | undefined;
    payload?: any;
}>;
export type WSMessage = z.infer<typeof WSMessageSchema>;
/** Events emitted by the GatewayServer */
export interface GatewayServerEvents {
    'client:connected': (client: ConnectedClient) => void;
    'client:disconnected': (clientId: string, type: ClientType) => void;
    'message:received': (clientId: string, message: WSMessage) => void;
    'message:routed': (message: AgentMessage) => void;
    'error': (error: Error) => void;
}
export declare class GatewayServer extends EventEmitter<GatewayServerEvents> {
    private wss;
    private clients;
    /** Map agent IDs to their connected client IDs */
    private agentClientMap;
    /** Heartbeat interval */
    private heartbeatInterval;
    private sessionManager;
    private agentManager;
    private taskManager;
    private viadpEngine;
    private modelRouter;
    private voiceHandler;
    constructor(deps: {
        sessionManager: SessionManager;
        agentManager: AgentManager;
        taskManager: TaskManager;
        viadpEngine: VIADPEngine;
        modelRouter: ModelRouter;
        voiceHandler: VoiceHandler;
    });
    /**
     * Attaches the WebSocket server to an existing HTTP server.
     * Uses noServer mode so that the HTTP upgrade event can be routed
     * between this server (raw WS) and Socket.IO on the same port.
     */
    attach(httpServer: HTTPServer): void;
    /**
     * Handles a new WebSocket connection.
     */
    private handleConnection;
    /**
     * Handles a client disconnection.
     */
    private handleDisconnect;
    /**
     * Handles an incoming WebSocket message from a client.
     */
    private handleMessage;
    private handleSessionCreate;
    private handleSessionJoin;
    private handleSessionLeave;
    private handleSessionList;
    private handleSessionDestroy;
    private handleChatMessage;
    private handleAgentStatus;
    private handleAgentList;
    private handleAgentSend;
    private handleTaskCreate;
    private handleTaskUpdate;
    private handleTaskMove;
    private handleTaskAssign;
    private handleTaskList;
    private handleKanbanBoard;
    private handleDelegationRequest;
    private handleDelegationAccept;
    private handleDelegationReject;
    private handleModelRoute;
    private handleModelAssignments;
    private handleModelCosts;
    private handleVoiceStatus;
    /**
     * Sends a message to a specific client by ID.
     */
    sendToClient(clientId: string, message: WSMessage): boolean;
    /**
     * Routes a message to a specific agent by agent ID.
     */
    routeToAgent(agentId: AgentId, message: WSMessage): boolean;
    /**
     * Broadcasts a message to all clients in a session (except the sender).
     */
    broadcastToSession(sessionId: string, message: WSMessage, excludeClientId?: string): void;
    /**
     * Broadcasts a message to all dashboard connections.
     */
    broadcastToDashboards(message: WSMessage): void;
    /**
     * Broadcasts a message to all connected clients.
     */
    broadcastAll(message: WSMessage): void;
    /**
     * Wires internal manager events to dashboard broadcasts.
     */
    private wireManagerEvents;
    /**
     * Sends heartbeat pings and cleans up dead connections.
     */
    private heartbeat;
    /**
     * Sends an error message to a client.
     */
    private sendError;
    /**
     * Returns the number of connected clients by type.
     */
    getConnectionStats(): {
        total: number;
        users: number;
        agents: number;
        dashboards: number;
        connectedAgents: AgentId[];
    };
    /**
     * Shuts down the WebSocket server.
     */
    shutdown(): void;
}
//# sourceMappingURL=server.d.ts.map