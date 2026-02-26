/**
 * Session Manager for the ForgeTeam Gateway.
 *
 * Manages user and agent sessions, tracks state transitions,
 * and maintains message history per session.
 */
import { EventEmitter } from 'eventemitter3';
import type { AgentId, AgentMessage } from '@forge-team/shared';
/** Possible states for a session */
export type SessionState = 'idle' | 'active' | 'paused' | 'terminated';
/** A session represents a single user interaction context */
export interface Session {
    id: string;
    /** Human-readable label */
    label: string;
    /** Current state */
    state: SessionState;
    /** User identifier (if applicable) */
    userId: string | null;
    /** Agents currently participating in this session */
    activeAgents: Set<AgentId>;
    /** Message history ordered chronologically */
    messageHistory: AgentMessage[];
    /** Session-scoped metadata */
    metadata: Record<string, unknown>;
    /** Timestamps */
    createdAt: string;
    updatedAt: string;
    /** When the session last had activity */
    lastActivityAt: string;
}
/** Events emitted by the SessionManager */
export interface SessionEvents {
    'session:created': (session: Session) => void;
    'session:destroyed': (sessionId: string) => void;
    'session:state-changed': (sessionId: string, oldState: SessionState, newState: SessionState) => void;
    'session:agent-joined': (sessionId: string, agentId: AgentId) => void;
    'session:agent-left': (sessionId: string, agentId: AgentId) => void;
    'session:message': (sessionId: string, message: AgentMessage) => void;
}
export declare class SessionManager extends EventEmitter<SessionEvents> {
    private sessions;
    /** Maximum message history per session before truncation */
    private maxHistorySize;
    /** Session inactivity timeout in milliseconds (30 minutes default) */
    private inactivityTimeout;
    /** Timer for periodic cleanup */
    private cleanupTimer;
    constructor(options?: {
        maxHistorySize?: number;
        inactivityTimeoutMs?: number;
    });
    /**
     * Creates a new session and returns it.
     */
    createSession(options?: {
        label?: string;
        userId?: string;
        metadata?: Record<string, unknown>;
    }): Session;
    /**
     * Retrieves a session by ID.
     */
    getSession(sessionId: string): Session | undefined;
    /**
     * Returns all active sessions.
     */
    getAllSessions(): Session[];
    /**
     * Returns sessions in a specific state.
     */
    getSessionsByState(state: SessionState): Session[];
    /**
     * Destroys a session and cleans up resources.
     */
    destroySession(sessionId: string): boolean;
    /**
     * Transitions a session to a new state with validation.
     */
    setSessionState(sessionId: string, newState: SessionState): boolean;
    /**
     * Registers an agent as active in a session.
     */
    addAgentToSession(sessionId: string, agentId: AgentId): boolean;
    /**
     * Removes an agent from a session.
     */
    removeAgentFromSession(sessionId: string, agentId: AgentId): boolean;
    /**
     * Records a message in the session history.
     */
    addMessage(sessionId: string, message: AgentMessage): boolean;
    /**
     * Returns the message history for a session.
     */
    getMessageHistory(sessionId: string, options?: {
        limit?: number;
        since?: string;
        type?: string;
    }): AgentMessage[];
    /**
     * Returns the number of active sessions.
     */
    getActiveSessionCount(): number;
    /**
     * Returns a serializable snapshot of a session (Sets converted to arrays).
     */
    serializeSession(sessionId: string): Record<string, unknown> | null;
    /**
     * Cleans up sessions that have been inactive beyond the timeout.
     */
    private cleanupInactiveSessions;
    /**
     * Shuts down the session manager and cleans up timers.
     */
    shutdown(): void;
}
//# sourceMappingURL=session-manager.d.ts.map