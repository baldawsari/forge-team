import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionManager } from '../session-manager';

describe('SessionManager', () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager({ maxHistorySize: 100, inactivityTimeoutMs: 60000 });
  });

  afterEach(() => {
    manager.shutdown();
  });

  describe('createSession', () => {
    it('should create a session with idle state', () => {
      const session = manager.createSession({ label: 'test-session' });
      expect(session.state).toBe('idle');
      expect(session.activeAgents.size).toBe(0);
    });

    it('should create session with provided label', () => {
      const session = manager.createSession({ label: 'my-label' });
      expect(session.label).toBe('my-label');
    });

    it('should assign unique IDs to each session', () => {
      const s1 = manager.createSession({ label: 's1' });
      const s2 = manager.createSession({ label: 's2' });
      expect(s1.id).not.toBe(s2.id);
    });
  });

  describe('agent join/leave', () => {
    it('should add an agent to a session', () => {
      const session = manager.createSession({ label: 'test' });
      manager.addAgentToSession(session.id, 'architect');
      const updated = manager.getSession(session.id);
      expect(updated?.activeAgents.has('architect')).toBe(true);
    });

    it('should remove an agent from a session', () => {
      const session = manager.createSession({ label: 'test' });
      manager.addAgentToSession(session.id, 'architect');
      manager.removeAgentFromSession(session.id, 'architect');
      const updated = manager.getSession(session.id);
      expect(updated?.activeAgents.has('architect')).toBe(false);
    });

    it('should emit session:agent-joined event', () => {
      const session = manager.createSession({ label: 'test' });
      const handler = vi.fn();
      manager.on('session:agent-joined', handler);
      manager.addAgentToSession(session.id, 'backend-dev');
      expect(handler).toHaveBeenCalledWith(session.id, 'backend-dev');
    });
  });

  describe('state transitions', () => {
    it('should transition from idle to active', () => {
      const session = manager.createSession({ label: 'test' });
      manager.setSessionState(session.id, 'active');
      expect(manager.getSession(session.id)?.state).toBe('active');
    });

    it('should emit state-changed event', () => {
      const session = manager.createSession({ label: 'test' });
      const handler = vi.fn();
      manager.on('session:state-changed', handler);
      manager.setSessionState(session.id, 'active');
      expect(handler).toHaveBeenCalledWith(session.id, 'idle', 'active');
    });
  });

  describe('message history', () => {
    it('should store messages in session history', () => {
      const session = manager.createSession({ label: 'test' });
      const message = {
        id: 'msg-1',
        from: 'architect' as const,
        to: 'backend-dev' as const,
        payload: { content: 'Review the API design' },
        type: 'chat.message' as const,
        sessionId: session.id,
        timestamp: new Date().toISOString(),
      };
      manager.addMessage(session.id, message);
      const updated = manager.getSession(session.id);
      expect(updated?.messageHistory).toHaveLength(1);
      expect(updated?.messageHistory[0].payload.content).toBe('Review the API design');
    });

    it('should respect maxHistorySize', () => {
      const smallManager = new SessionManager({ maxHistorySize: 3, inactivityTimeoutMs: 60000 });
      const session = smallManager.createSession({ label: 'test' });
      for (let i = 0; i < 5; i++) {
        smallManager.addMessage(session.id, {
          id: `msg-${i}`,
          from: 'architect',
          to: 'backend-dev',
          payload: { content: `Message ${i}` },
          type: 'chat.message',
          sessionId: session.id,
          timestamp: new Date().toISOString(),
        });
      }
      const updated = smallManager.getSession(session.id);
      expect(updated?.messageHistory.length).toBeLessThanOrEqual(3);
      smallManager.shutdown();
    });
  });

  describe('destroySession', () => {
    it('should remove the session', () => {
      const session = manager.createSession({ label: 'test' });
      manager.destroySession(session.id);
      expect(manager.getSession(session.id)).toBeUndefined();
    });

    it('should emit session:destroyed event', () => {
      const session = manager.createSession({ label: 'test' });
      const handler = vi.fn();
      manager.on('session:destroyed', handler);
      manager.destroySession(session.id);
      expect(handler).toHaveBeenCalledWith(session.id);
    });
  });
});
