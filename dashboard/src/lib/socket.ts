"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";

const GATEWAY_URL = typeof window !== 'undefined'
  ? 'http://localhost:18789'  // Browser always talks to localhost, not Docker-internal hostname
  : (process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:18789');

// ---------------------------------------------------------------------------
// Event types matching the gateway Socket.IO broadcasts
// ---------------------------------------------------------------------------

/** Agent status change broadcast from agentManager events */
export interface AgentStatusEvent {
  agentId: string;
  oldStatus?: string;
  newStatus?: string;
  status?: string;
  currentTask?: string | null;
  sessionId?: string;
  model?: string;
  error?: string;
}

/** Task event payload from taskManager events */
export interface TaskUpdateEvent {
  type:
    | "created"
    | "updated"
    | "moved"
    | "assigned"
    | "completed"
    | "cancelled";
  event: {
    type: string;
    taskId: string;
    sessionId: string;
    timestamp: string;
    previousStatus?: string;
    currentStatus: string;
    triggeredBy: string;
    data: {
      title: string;
      assignedTo: string | null;
      priority: string;
    };
  };
}

/** Agent message broadcast */
export interface GatewayMessageEvent {
  id: string;
  type: string;
  from: string;
  to: string;
  payload: {
    content: string;
    data?: unknown;
    artifacts?: unknown[];
  };
  sessionId: string;
  timestamp: string;
  correlationId?: string;
}

/** Session lifecycle events */
export interface SessionUpdateEvent {
  type:
    | "created"
    | "destroyed"
    | "state_changed"
    | "agent_joined"
    | "agent_left";
  session?: Record<string, unknown>;
  sessionId?: string;
  oldState?: string;
  newState?: string;
  agentId?: string;
}

/** VIADP delegation, trust, verification, checkpoint, and audit events */
export interface ViadpUpdateEvent {
  type:
    | "delegation_requested"
    | "delegation_accepted"
    | "delegation_rejected"
    | "delegation_completed"
    | "delegation_failed"
    | "delegation_revoked"
    | "delegation_escalated"
    | "trust_updated"
    | "verification_submitted"
    | "verification_passed"
    | "verification_failed"
    | "checkpoint_reached"
    | "checkpoint_failed"
    | "audit_entry";
  data: unknown;
}

/** Initial state snapshot sent on connection */
export interface InitialStateEvent {
  agents: Array<{
    id: string;
    name: string;
    role: string;
    status: string;
    currentTaskId: string | null;
    tasksCompleted: number;
    tasksFailed: number;
    lastActiveAt: string;
  }>;
  tasks: unknown[];
  sessions: Array<Record<string, unknown> | null>;
  viadp: {
    totalRequests: number;
    activeRequests: number;
    completedRequests: number;
    failedRequests: number;
    activeTokens: number;
    auditEntries: number;
    trustScoreCount: number;
  };
  health: {
    uptime: number;
    connections: {
      total: number;
      users: number;
      agents: number;
      dashboards: number;
      connectedAgents: string[];
    };
  };
}

/** Workflow update (future use) */
export interface WorkflowUpdateEvent {
  phase: string;
  progress: number;
  status: "complete" | "active" | "pending";
}

/** Cost update (future use) */
export interface CostUpdateEvent {
  agentId: string;
  tokensUsed: number;
  cost: number;
  model: string;
}

/** Party Mode agent selection event */
export interface PartyModeSelectionEvent {
  sessionId: string;
  correlationId: string;
  selections: Array<{
    agentId: string;
    role: 'primary' | 'secondary' | 'tertiary';
    reason: string;
  }>;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Socket event map
// ---------------------------------------------------------------------------

interface SocketEvents {
  initial_state: (data: InitialStateEvent) => void;
  agent_status: (data: AgentStatusEvent) => void;
  task_update: (data: TaskUpdateEvent) => void;
  message: (data: GatewayMessageEvent) => void;
  session_update: (data: SessionUpdateEvent) => void;
  viadp_update: (data: ViadpUpdateEvent) => void;
  workflow_update: (data: WorkflowUpdateEvent) => void;
  cost_update: (data: CostUpdateEvent) => void;
  party_mode_selection: (data: PartyModeSelectionEvent) => void;
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

export function useSocket() {
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  useEffect(() => {
    const socket = io(GATEWAY_URL, {
      transports: ["websocket", "polling"],
      path: "/socket.io",
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000,
      autoConnect: true,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("[Socket.IO] Connected to gateway:", socket.id);
      setIsConnected(true);
      setConnectionError(null);
    });

    socket.on("disconnect", (reason) => {
      console.log("[Socket.IO] Disconnected:", reason);
      setIsConnected(false);
    });

    socket.on("connect_error", (error) => {
      console.warn("[Socket.IO] Connection error:", error.message);
      setConnectionError(error.message);
      setIsConnected(false);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  /**
   * Subscribe to a typed Socket.IO event.
   * Returns an unsubscribe function for cleanup.
   */
  const on = useCallback(
    <K extends keyof SocketEvents>(event: K, handler: SocketEvents[K]) => {
      socketRef.current?.on(
        event as string,
        handler as (...args: unknown[]) => void
      );
      return () => {
        socketRef.current?.off(
          event as string,
          handler as (...args: unknown[]) => void
        );
      };
    },
    []
  );

  /**
   * Emit an event to the gateway.
   */
  const emit = useCallback((event: string, data?: unknown) => {
    socketRef.current?.emit(event, data);
  }, []);

  return { isConnected, connectionError, on, emit, socket: socketRef };
}
