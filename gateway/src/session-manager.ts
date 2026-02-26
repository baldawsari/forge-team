/**
 * Session Manager for the ForgeTeam Gateway.
 *
 * Manages user and agent sessions, tracks state transitions,
 * and maintains message history per session.
 */

import { v4 as uuid } from 'uuid';
import { EventEmitter } from 'eventemitter3';
import type { AgentId, AgentMessage } from '@forge-team/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Session Manager
// ---------------------------------------------------------------------------

export class SessionManager extends EventEmitter<SessionEvents> {
  private sessions: Map<string, Session> = new Map();

  /** Maximum message history per session before truncation */
  private maxHistorySize: number;
  /** Session inactivity timeout in milliseconds (30 minutes default) */
  private inactivityTimeout: number;
  /** Timer for periodic cleanup */
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options?: { maxHistorySize?: number; inactivityTimeoutMs?: number }) {
    super();
    this.maxHistorySize = options?.maxHistorySize ?? 1000;
    this.inactivityTimeout = options?.inactivityTimeoutMs ?? 30 * 60 * 1000;

    // Run cleanup every 5 minutes
    this.cleanupTimer = setInterval(() => this.cleanupInactiveSessions(), 5 * 60 * 1000);
  }

  /**
   * Creates a new session and returns it.
   */
  createSession(options?: {
    label?: string;
    userId?: string;
    metadata?: Record<string, unknown>;
  }): Session {
    const now = new Date().toISOString();
    const session: Session = {
      id: uuid(),
      label: options?.label ?? `Session ${this.sessions.size + 1}`,
      state: 'idle',
      userId: options?.userId ?? null,
      activeAgents: new Set(),
      messageHistory: [],
      metadata: options?.metadata ?? {},
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
    };

    this.sessions.set(session.id, session);
    this.emit('session:created', session);
    return session;
  }

  /**
   * Retrieves a session by ID.
   */
  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Returns all active sessions.
   */
  getAllSessions(): Session[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Returns sessions in a specific state.
   */
  getSessionsByState(state: SessionState): Session[] {
    return Array.from(this.sessions.values()).filter((s) => s.state === state);
  }

  /**
   * Destroys a session and cleans up resources.
   */
  destroySession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.state = 'terminated';
    session.updatedAt = new Date().toISOString();
    this.sessions.delete(sessionId);
    this.emit('session:destroyed', sessionId);
    return true;
  }

  /**
   * Transitions a session to a new state with validation.
   */
  setSessionState(sessionId: string, newState: SessionState): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    const validTransitions: Record<SessionState, SessionState[]> = {
      idle: ['active', 'terminated'],
      active: ['paused', 'idle', 'terminated'],
      paused: ['active', 'terminated'],
      terminated: [],
    };

    if (!validTransitions[session.state].includes(newState)) {
      console.warn(
        `[SessionManager] Invalid state transition: ${session.state} -> ${newState} for session ${sessionId}`
      );
      return false;
    }

    const oldState = session.state;
    session.state = newState;
    session.updatedAt = new Date().toISOString();
    session.lastActivityAt = session.updatedAt;

    this.emit('session:state-changed', sessionId, oldState, newState);
    return true;
  }

  /**
   * Registers an agent as active in a session.
   */
  addAgentToSession(sessionId: string, agentId: AgentId): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.activeAgents.add(agentId);
    session.updatedAt = new Date().toISOString();
    session.lastActivityAt = session.updatedAt;

    this.emit('session:agent-joined', sessionId, agentId);

    // Auto-activate session if idle
    if (session.state === 'idle') {
      this.setSessionState(sessionId, 'active');
    }

    return true;
  }

  /**
   * Removes an agent from a session.
   */
  removeAgentFromSession(sessionId: string, agentId: AgentId): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.activeAgents.delete(agentId);
    session.updatedAt = new Date().toISOString();

    this.emit('session:agent-left', sessionId, agentId);

    // Auto-idle session if no agents remain
    if (session.activeAgents.size === 0 && session.state === 'active') {
      this.setSessionState(sessionId, 'idle');
    }

    return true;
  }

  /**
   * Records a message in the session history.
   */
  addMessage(sessionId: string, message: AgentMessage): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.messageHistory.push(message);
    session.updatedAt = new Date().toISOString();
    session.lastActivityAt = session.updatedAt;

    // Truncate history if it exceeds the maximum
    if (session.messageHistory.length > this.maxHistorySize) {
      const excess = session.messageHistory.length - this.maxHistorySize;
      session.messageHistory.splice(0, excess);
    }

    this.emit('session:message', sessionId, message);
    return true;
  }

  /**
   * Returns the message history for a session.
   */
  getMessageHistory(
    sessionId: string,
    options?: { limit?: number; since?: string; type?: string }
  ): AgentMessage[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];

    let messages = session.messageHistory;

    if (options?.since) {
      const sinceTime = new Date(options.since).getTime();
      messages = messages.filter((m) => new Date(m.timestamp).getTime() >= sinceTime);
    }

    if (options?.type) {
      messages = messages.filter((m) => m.type === options.type);
    }

    if (options?.limit) {
      messages = messages.slice(-options.limit);
    }

    return messages;
  }

  /**
   * Returns the number of active sessions.
   */
  getActiveSessionCount(): number {
    return Array.from(this.sessions.values()).filter((s) => s.state === 'active').length;
  }

  /**
   * Returns a serializable snapshot of a session (Sets converted to arrays).
   */
  serializeSession(sessionId: string): Record<string, unknown> | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    return {
      ...session,
      activeAgents: Array.from(session.activeAgents),
      messageCount: session.messageHistory.length,
      // Exclude full history from snapshot for performance
      messageHistory: undefined,
    };
  }

  /**
   * Cleans up sessions that have been inactive beyond the timeout.
   */
  private cleanupInactiveSessions(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (session.state === 'terminated') continue;
      const lastActive = new Date(session.lastActivityAt).getTime();
      if (now - lastActive > this.inactivityTimeout) {
        console.log(`[SessionManager] Auto-terminating inactive session: ${id}`);
        this.destroySession(id);
      }
    }
  }

  /**
   * Shuts down the session manager and cleans up timers.
   */
  shutdown(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    // Terminate all sessions
    for (const id of this.sessions.keys()) {
      this.destroySession(id);
    }
  }
}
