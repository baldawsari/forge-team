import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockClientQuery = vi.fn();
const mockClientRelease = vi.fn();
const mockPoolQuery = vi.fn();
const mockPoolConnect = vi.fn(() => ({
  query: mockClientQuery,
  release: mockClientRelease,
}));

vi.mock('pg', () => ({
  Pool: vi.fn(() => ({
    query: mockPoolQuery,
    connect: mockPoolConnect,
  })),
}));

const mockRedisGet = vi.fn();
const mockRedisSetex = vi.fn();
const mockRedisDel = vi.fn();

vi.mock('ioredis', () => ({
  default: vi.fn(() => ({
    get: mockRedisGet,
    set: vi.fn(),
    setex: mockRedisSetex,
    del: mockRedisDel,
  })),
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid-1234'),
}));

import { Pool } from 'pg';
import Redis from 'ioredis';
import { MemoryManager } from '../memory-manager';

describe('MemoryManager', () => {
  let manager: MemoryManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisDel.mockResolvedValue(1);
    mockRedisSetex.mockResolvedValue('OK');
    const pool = new Pool();
    const redis = new (Redis as any)();
    manager = new MemoryManager(pool, redis);
  });

  describe('store', () => {
    beforeEach(() => {
      mockClientQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    });

    it('should store a memory entry with correct scope', async () => {
      const entry = await manager.store('project', 'Design the API gateway', {
        source: 'architect',
      });

      expect(entry.scope).toBe('project');
      expect(entry.content).toBe('Design the API gateway');
      expect(entry.metadata).toEqual({ source: 'architect' });
      expect(entry.id).toBe('test-uuid-1234');
      expect(mockClientQuery).toHaveBeenCalledOnce();
      expect(mockClientRelease).toHaveBeenCalledOnce();
    });

    it('should support all 5 hierarchical scopes', async () => {
      const scopes = ['company', 'team', 'project', 'agent', 'thread'] as const;

      for (const scope of scopes) {
        vi.clearAllMocks();
        mockClientQuery.mockResolvedValue({ rows: [], rowCount: 1 });
        mockRedisDel.mockResolvedValue(1);

        const entry = await manager.store(scope, `Content for ${scope}`);
        expect(entry.scope).toBe(scope);
      }
    });

    it('should set default importance to 0.5', async () => {
      const entry = await manager.store('agent', 'Remember this fact');

      expect(entry.importance).toBe(0.5);
    });

    it('should support tags and metadata', async () => {
      const entry = await manager.store(
        'project',
        'Use PostgreSQL for persistence',
        { decision: true, author: 'architect-agent' },
        {
          tags: ['tech:postgresql', 'decision'],
          importance: 0.9,
          agentId: 'architect',
          projectId: 'proj-001',
        },
      );

      expect(entry.tags).toEqual(['tech:postgresql', 'decision']);
      expect(entry.importance).toBe(0.9);
      expect(entry.agentId).toBe('architect');
      expect(entry.projectId).toBe('proj-001');
      expect(entry.metadata).toEqual({ decision: true, author: 'architect-agent' });
    });

    it('should set null for optional fields when not provided', async () => {
      const entry = await manager.store('company', 'Global coding standards');

      expect(entry.agentId).toBeNull();
      expect(entry.projectId).toBeNull();
      expect(entry.teamId).toBeNull();
      expect(entry.threadId).toBeNull();
      expect(entry.embedding).toBeNull();
      expect(entry.expiresAt).toBeNull();
      expect(entry.supersededBy).toBeNull();
      expect(entry.accessCount).toBe(0);
    });
  });

  describe('search', () => {
    it('should search within a specific scope', async () => {
      mockPoolQuery.mockResolvedValue({
        rows: [
          {
            id: 'entry-1',
            scope: 'project',
            agent_id: null,
            project_id: 'proj-001',
            team_id: null,
            thread_id: null,
            content: 'Use TypeScript for the backend',
            embedding: null,
            metadata: '{}',
            tags: '[]',
            importance: 0.7,
            access_count: 3,
            created_at: '2026-02-01T00:00:00Z',
            updated_at: '2026-02-01T00:00:00Z',
            expires_at: null,
            superseded_by: null,
          },
        ],
      });

      const results = await manager.search('TypeScript', { scope: 'project' });

      expect(results).toHaveLength(1);
      expect(results[0].content).toBe('Use TypeScript for the backend');
      expect(results[0].scope).toBe('project');
      expect(mockPoolQuery).toHaveBeenCalled();
      const callArgs = mockPoolQuery.mock.calls[0];
      expect(callArgs[0]).toContain('ILIKE');
      expect(callArgs[1]).toContain('%TypeScript%');
      expect(callArgs[1]).toContain('project');
    });

    it('should respect hierarchical scope precedence', async () => {
      mockPoolQuery.mockResolvedValue({
        rows: [
          {
            id: 'agent-entry',
            scope: 'agent',
            agent_id: 'backend-dev',
            project_id: null,
            team_id: null,
            thread_id: null,
            content: 'Agent-specific config for backend-dev',
            embedding: null,
            metadata: '{}',
            tags: '[]',
            importance: 0.8,
            access_count: 1,
            created_at: '2026-02-01T00:00:00Z',
            updated_at: '2026-02-01T00:00:00Z',
            expires_at: null,
            superseded_by: null,
          },
        ],
      });

      const results = await manager.search('config', {
        scope: 'agent',
        agentId: 'backend-dev',
      });

      expect(results).toHaveLength(1);
      expect(results[0].scope).toBe('agent');
      expect(results[0].agentId).toBe('backend-dev');
      const callArgs = mockPoolQuery.mock.calls[0];
      expect(callArgs[1]).toContain('agent');
      expect(callArgs[1]).toContain('backend-dev');
    });

    it('should return cached results when available', async () => {
      const cachedData = JSON.stringify([
        {
          id: 'cached-entry',
          scope: 'team',
          content: 'Cached team memory',
          importance: 0.6,
        },
      ]);
      mockRedisGet.mockResolvedValue(cachedData);

      const results = await manager.search('team');

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('cached-entry');
      expect(mockPoolQuery).not.toHaveBeenCalled();
    });

    it('should filter by tags and minImportance', async () => {
      mockPoolQuery.mockResolvedValue({ rows: [] });

      await manager.search('architecture', {
        tags: ['decision', 'architecture'],
        minImportance: 0.7,
        limit: 10,
      });

      const callArgs = mockPoolQuery.mock.calls[0];
      const sql = callArgs[0] as string;
      expect(sql).toContain('tags::jsonb');
      expect(sql).toContain('importance >=');
      expect(sql).toContain('LIMIT 10');
    });
  });

  describe('getRecentContext', () => {
    it('should return most recent entries for an agent', async () => {
      mockPoolQuery.mockResolvedValue({
        rows: [
          {
            id: 'ctx-1',
            scope: 'agent',
            agent_id: 'qa-agent',
            project_id: null,
            team_id: null,
            thread_id: null,
            content: 'QA agent recent context entry',
            embedding: null,
            metadata: '{}',
            tags: '[]',
            importance: 0.6,
            access_count: 2,
            created_at: '2026-02-27T12:00:00Z',
            updated_at: '2026-02-27T12:00:00Z',
            expires_at: null,
            superseded_by: null,
            scope_priority: 1,
          },
          {
            id: 'ctx-2',
            scope: 'project',
            agent_id: null,
            project_id: 'proj-001',
            team_id: null,
            thread_id: null,
            content: 'Project-level architecture decisions',
            embedding: null,
            metadata: '{}',
            tags: '[]',
            importance: 0.9,
            access_count: 5,
            created_at: '2026-02-26T10:00:00Z',
            updated_at: '2026-02-26T10:00:00Z',
            expires_at: null,
            superseded_by: null,
            scope_priority: 3,
          },
        ],
      });

      const results = await manager.getRecentContext('qa-agent');

      expect(results).toHaveLength(2);
      expect(results[0].agentId).toBe('qa-agent');
      expect(results[1].scope).toBe('project');
      const callArgs = mockPoolQuery.mock.calls[0];
      expect(callArgs[1]).toContain('qa-agent');
    });

    it('should limit results to specified count', async () => {
      mockPoolQuery.mockResolvedValue({ rows: [] });

      await manager.getRecentContext('qa-agent', 5);

      const callArgs = mockPoolQuery.mock.calls[0];
      expect(callArgs[1]).toContain(5);
    });

    it('should default limit to 20', async () => {
      mockPoolQuery.mockResolvedValue({ rows: [] });

      await manager.getRecentContext('qa-agent');

      const callArgs = mockPoolQuery.mock.calls[0];
      expect(callArgs[1]).toContain(20);
    });
  });

  describe('delete', () => {
    it('should delete entry by id and return true on success', async () => {
      mockPoolQuery.mockResolvedValue({ rowCount: 1 });

      const result = await manager.delete('entry-to-remove');

      expect(result).toBe(true);
      const callArgs = mockPoolQuery.mock.calls[0];
      expect(callArgs[0]).toContain('DELETE FROM memory_entries');
      expect(callArgs[1]).toEqual(['entry-to-remove']);
    });

    it('should return false when entry does not exist', async () => {
      mockPoolQuery.mockResolvedValue({ rowCount: 0 });

      const result = await manager.delete('nonexistent-id');

      expect(result).toBe(false);
    });
  });

  describe('compact', () => {
    it('should not compact when entry count is below threshold', async () => {
      mockClientQuery
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({
          rows: Array.from({ length: 10 }, (_, i) => ({
            id: `entry-${i}`,
            scope: 'thread',
            agent_id: 'dev-agent',
            project_id: null,
            team_id: null,
            thread_id: 'session-1',
            content: `Entry ${i} content.`,
            embedding: null,
            metadata: '{}',
            tags: '[]',
            importance: 0.5,
            access_count: 0,
            created_at: new Date(2026, 1, 1, i).toISOString(),
            updated_at: new Date(2026, 1, 1, i).toISOString(),
            expires_at: null,
            superseded_by: null,
          })),
        })
        .mockResolvedValueOnce(undefined); // COMMIT

      const result = await manager.compact('session-1');

      expect(result.compactedCount).toBe(0);
      expect(result.removedIds).toEqual([]);
    });

    it('should compact old entries and preserve recent ones', async () => {
      const entries = Array.from({ length: 60 }, (_, i) => ({
        id: `entry-${i}`,
        scope: 'thread',
        agent_id: 'dev-agent',
        project_id: null,
        team_id: null,
        thread_id: 'session-2',
        content: `This is a detailed entry number ${i} about software design patterns and architecture decisions.`,
        embedding: null,
        metadata: '{}',
        tags: '["dev"]',
        importance: 0.5,
        access_count: 0,
        created_at: new Date(2026, 1, 1, 0, i).toISOString(),
        updated_at: new Date(2026, 1, 1, 0, i).toISOString(),
        expires_at: null,
        superseded_by: null,
      }));

      mockClientQuery
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: entries }) // SELECT entries
        .mockResolvedValueOnce({ rowCount: 1 }) // INSERT summary
        .mockResolvedValueOnce({ rowCount: 10 }) // UPDATE superseded_by
        .mockResolvedValueOnce(undefined); // COMMIT
      mockRedisDel.mockResolvedValue(1);

      const result = await manager.compact('session-2');

      expect(result.originalCount).toBe(60);
      expect(result.compactedCount).toBe(10);
      expect(result.summaryId).toBe('test-uuid-1234');
      expect(result.removedIds).toHaveLength(10);
    });
  });

  describe('summarize', () => {
    it('should return empty string for no entries', async () => {
      const result = await manager.summarize([]);
      expect(result).toBe('');
    });

    it('should return content directly for single entry', async () => {
      const entry = {
        id: 'e1',
        scope: 'agent' as const,
        agentId: null,
        projectId: null,
        teamId: null,
        threadId: null,
        content: 'The system uses microservices architecture.',
        embedding: null,
        metadata: {},
        tags: [],
        importance: 0.5,
        accessCount: 0,
        createdAt: new Date('2026-02-01'),
        updatedAt: new Date('2026-02-01'),
        expiresAt: null,
        supersededBy: null,
      };

      const result = await manager.summarize([entry]);
      expect(result).toBe('The system uses microservices architecture.');
    });

    it('should deduplicate sentences across entries', async () => {
      const makeEntry = (id: string, content: string, importance: number) => ({
        id,
        scope: 'project' as const,
        agentId: null,
        projectId: null,
        teamId: null,
        threadId: null,
        content,
        embedding: null,
        metadata: {},
        tags: [],
        importance,
        accessCount: 0,
        createdAt: new Date('2026-02-01'),
        updatedAt: new Date('2026-02-01'),
        expiresAt: null,
        supersededBy: null,
      });

      const entries = [
        makeEntry('e1', 'The backend uses Node.js for processing. Security is critical.', 0.8),
        makeEntry('e2', 'The backend uses Node.js for processing. Performance is also important.', 0.6),
      ];

      const result = await manager.summarize(entries);

      const nodeMatches = result.match(/The backend uses Node\.js for processing/g);
      expect(nodeMatches).toHaveLength(1);
      expect(result).toContain('Security is critical');
    });
  });

  describe('getById', () => {
    it('should return entry and increment access count', async () => {
      mockPoolQuery
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'fetch-me',
              scope: 'agent',
              agent_id: 'dev',
              project_id: null,
              team_id: null,
              thread_id: null,
              content: 'Fetched entry content',
              embedding: null,
              metadata: '{}',
              tags: '[]',
              importance: 0.5,
              access_count: 4,
              created_at: '2026-02-01T00:00:00Z',
              updated_at: '2026-02-01T00:00:00Z',
              expires_at: null,
              superseded_by: null,
            },
          ],
        })
        .mockResolvedValueOnce({ rowCount: 1 }); // access count update

      const entry = await manager.getById('fetch-me');

      expect(entry).not.toBeNull();
      expect(entry!.id).toBe('fetch-me');
      expect(entry!.content).toBe('Fetched entry content');
      expect(entry!.accessCount).toBe(4);
      expect(mockPoolQuery).toHaveBeenCalledTimes(2);
    });

    it('should return null for non-existent entry', async () => {
      mockPoolQuery.mockResolvedValueOnce({ rows: [] });

      const entry = await manager.getById('does-not-exist');

      expect(entry).toBeNull();
    });
  });

  describe('update', () => {
    it('should update content and metadata', async () => {
      mockPoolQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'upd-1',
            scope: 'agent',
            agent_id: 'dev',
            project_id: null,
            team_id: null,
            thread_id: null,
            content: 'Updated content',
            embedding: null,
            metadata: '{"version":2}',
            tags: '[]',
            importance: 0.5,
            access_count: 0,
            created_at: '2026-02-01T00:00:00Z',
            updated_at: '2026-02-28T00:00:00Z',
            expires_at: null,
            superseded_by: null,
          },
        ],
      });

      const entry = await manager.update('upd-1', 'Updated content', { version: 2 });

      expect(entry).not.toBeNull();
      expect(entry!.content).toBe('Updated content');
      const callArgs = mockPoolQuery.mock.calls[0];
      expect(callArgs[0]).toContain('UPDATE memory_entries');
    });

    it('should return null when entry not found', async () => {
      mockPoolQuery.mockResolvedValueOnce({ rows: [] });

      const entry = await manager.update('missing', 'new content');

      expect(entry).toBeNull();
    });
  });
});
