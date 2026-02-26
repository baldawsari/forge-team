"use strict";
/**
 * Session Manager for the ForgeTeam Gateway.
 *
 * Manages user and agent sessions, tracks state transitions,
 * and maintains message history per session.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionManager = void 0;
const uuid_1 = require("uuid");
const eventemitter3_1 = require("eventemitter3");
// ---------------------------------------------------------------------------
// Session Manager
// ---------------------------------------------------------------------------
class SessionManager extends eventemitter3_1.EventEmitter {
    sessions = new Map();
    /** Maximum message history per session before truncation */
    maxHistorySize;
    /** Session inactivity timeout in milliseconds (30 minutes default) */
    inactivityTimeout;
    /** Timer for periodic cleanup */
    cleanupTimer = null;
    constructor(options) {
        super();
        this.maxHistorySize = options?.maxHistorySize ?? 1000;
        this.inactivityTimeout = options?.inactivityTimeoutMs ?? 30 * 60 * 1000;
        // Run cleanup every 5 minutes
        this.cleanupTimer = setInterval(() => this.cleanupInactiveSessions(), 5 * 60 * 1000);
    }
    /**
     * Creates a new session and returns it.
     */
    createSession(options) {
        const now = new Date().toISOString();
        const session = {
            id: (0, uuid_1.v4)(),
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
    getSession(sessionId) {
        return this.sessions.get(sessionId);
    }
    /**
     * Returns all active sessions.
     */
    getAllSessions() {
        return Array.from(this.sessions.values());
    }
    /**
     * Returns sessions in a specific state.
     */
    getSessionsByState(state) {
        return Array.from(this.sessions.values()).filter((s) => s.state === state);
    }
    /**
     * Destroys a session and cleans up resources.
     */
    destroySession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session)
            return false;
        session.state = 'terminated';
        session.updatedAt = new Date().toISOString();
        this.sessions.delete(sessionId);
        this.emit('session:destroyed', sessionId);
        return true;
    }
    /**
     * Transitions a session to a new state with validation.
     */
    setSessionState(sessionId, newState) {
        const session = this.sessions.get(sessionId);
        if (!session)
            return false;
        const validTransitions = {
            idle: ['active', 'terminated'],
            active: ['paused', 'idle', 'terminated'],
            paused: ['active', 'terminated'],
            terminated: [],
        };
        if (!validTransitions[session.state].includes(newState)) {
            console.warn(`[SessionManager] Invalid state transition: ${session.state} -> ${newState} for session ${sessionId}`);
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
    addAgentToSession(sessionId, agentId) {
        const session = this.sessions.get(sessionId);
        if (!session)
            return false;
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
    removeAgentFromSession(sessionId, agentId) {
        const session = this.sessions.get(sessionId);
        if (!session)
            return false;
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
    addMessage(sessionId, message) {
        const session = this.sessions.get(sessionId);
        if (!session)
            return false;
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
    getMessageHistory(sessionId, options) {
        const session = this.sessions.get(sessionId);
        if (!session)
            return [];
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
    getActiveSessionCount() {
        return Array.from(this.sessions.values()).filter((s) => s.state === 'active').length;
    }
    /**
     * Returns a serializable snapshot of a session (Sets converted to arrays).
     */
    serializeSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session)
            return null;
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
    cleanupInactiveSessions() {
        const now = Date.now();
        for (const [id, session] of this.sessions) {
            if (session.state === 'terminated')
                continue;
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
    shutdown() {
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
exports.SessionManager = SessionManager;
//# sourceMappingURL=session-manager.js.map