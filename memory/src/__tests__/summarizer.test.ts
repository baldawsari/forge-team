import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockPoolQuery = vi.fn();
const mockPoolConnect = vi.fn(() => ({
  query: vi.fn(),
  release: vi.fn(),
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
  v4: vi.fn(() => 'summary-uuid-5678'),
}));

import { Pool } from 'pg';
import Redis from 'ioredis';
import { Summarizer, type ConversationMessage } from '../summarizer';

describe('Summarizer', () => {
  let summarizer: Summarizer;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSetex.mockResolvedValue('OK');
    const pool = new Pool();
    const redis = new (Redis as any)();
    summarizer = new Summarizer(pool, redis, {
      compactionThreshold: 50,
      preserveRecentCount: 10,
      sentenceBudget: 40,
      maxSummaryLength: 4000,
    });
  });

  describe('summarizeConversation', () => {
    it('should return empty string for no messages', async () => {
      const result = await summarizer.summarizeConversation([]);
      expect(result).toBe('');
    });

    it('should return formatted messages for 3 or fewer messages', async () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Hello', timestamp: new Date('2026-02-01T10:00:00Z') },
        { role: 'assistant', content: 'Hi there', timestamp: new Date('2026-02-01T10:01:00Z') },
      ];

      const result = await summarizer.summarizeConversation(messages);

      expect(result).toContain('[user] Hello');
      expect(result).toContain('[assistant] Hi there');
    });

    it('should produce a summary shorter than the input', async () => {
      const messages: ConversationMessage[] = Array.from({ length: 20 }, (_, i) => ({
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: `This is message number ${i} which contains a detailed discussion about the system architecture and design patterns. We decided to use a microservices approach for the backend. The API gateway will handle authentication and routing. Each service will have its own database for data isolation. We need to implement circuit breakers for resilience.`,
        timestamp: new Date(2026, 1, 1, 10, i),
      }));

      const totalInputLength = messages.reduce((sum, m) => sum + m.content.length, 0);
      const result = await summarizer.summarizeConversation(messages);

      expect(result.length).toBeLessThan(totalInputLength);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should preserve key information in summary', async () => {
      const messages: ConversationMessage[] = [
        {
          role: 'user',
          content: 'We need to implement the authentication module. Should we use JWT or session-based auth?',
          timestamp: new Date('2026-02-01T10:00:00Z'),
        },
        {
          role: 'assistant',
          agentId: 'architect',
          content: 'We decided to use JWT for stateless authentication. The tokens will be signed with RS256 algorithm.',
          timestamp: new Date('2026-02-01T10:01:00Z'),
        },
        {
          role: 'user',
          content: 'What about token refresh? We need a secure mechanism for long-lived sessions.',
          timestamp: new Date('2026-02-01T10:02:00Z'),
        },
        {
          role: 'assistant',
          agentId: 'architect',
          content: 'We will implement refresh tokens stored in the database. The access token TTL is 15 minutes. The refresh token will be rotated on each use to prevent replay attacks.',
          timestamp: new Date('2026-02-01T10:03:00Z'),
        },
      ];

      const result = await summarizer.summarizeConversation(messages);

      expect(result).toContain('Conversation Summary');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('checkAndCompact', () => {
    it('should trigger compaction when count exceeds threshold', async () => {
      mockPoolQuery
        .mockResolvedValueOnce({ rows: [{ count: '60' }] })
        .mockResolvedValueOnce({
          rows: Array.from({ length: 50 }, (_, i) => ({
            content: `Entry ${i} describes a design decision about the API layer. We should implement rate limiting. The database schema needs to be normalized.`,
            metadata: '{}',
            importance: 0.5,
            created_at: new Date(2026, 1, 1, 0, i).toISOString(),
          })),
        });

      const result = await summarizer.checkAndCompact('session-compact');

      expect(result.compacted).toBe(true);
      expect(result.summary).toBeDefined();
      expect(result.summary!.length).toBeGreaterThan(0);
    });

    it('should not trigger compaction below threshold', async () => {
      mockPoolQuery.mockResolvedValueOnce({ rows: [{ count: '30' }] });

      const result = await summarizer.checkAndCompact('session-small');

      expect(result.compacted).toBe(false);
      expect(result.summary).toBeUndefined();
      expect(mockPoolQuery).toHaveBeenCalledTimes(1);
    });

    it('should preserve recent messages during compaction', async () => {
      mockPoolQuery
        .mockResolvedValueOnce({ rows: [{ count: '55' }] })
        .mockResolvedValueOnce({
          rows: Array.from({ length: 45 }, (_, i) => ({
            content: `Old message ${i} with discussion about system requirements and testing strategies.`,
            metadata: '{}',
            importance: 0.5,
            created_at: new Date(2026, 1, 1, 0, i).toISOString(),
          })),
        });

      const result = await summarizer.checkAndCompact('session-preserve');

      expect(result.compacted).toBe(true);
      const secondCall = mockPoolQuery.mock.calls[1];
      const limitParam = secondCall[1][1];
      expect(limitParam).toBe(45);
    });

    it('should delegate to memoryManager.compact when provided', async () => {
      mockPoolQuery
        .mockResolvedValueOnce({ rows: [{ count: '55' }] })
        .mockResolvedValueOnce({
          rows: Array.from({ length: 45 }, (_, i) => ({
            content: `Entry ${i} about system architecture decisions and deployment pipeline configuration.`,
            metadata: '{}',
            importance: 0.5,
            created_at: new Date(2026, 1, 1, 0, i).toISOString(),
          })),
        });

      const mockMemoryManager = {
        compact: vi.fn().mockResolvedValue({
          originalCount: 55,
          compactedCount: 45,
          summaryId: 'compact-summary-id',
          removedIds: Array.from({ length: 45 }, (_, i) => `entry-${i}`),
        }),
      };

      const result = await summarizer.checkAndCompact(
        'session-delegate',
        mockMemoryManager as any,
      );

      expect(result.compacted).toBe(true);
      expect(result.summaryId).toBe('compact-summary-id');
      expect(mockMemoryManager.compact).toHaveBeenCalledWith('session-delegate', 50);
    });
  });

  describe('extractive summarization', () => {
    it('should score sentences by relevance', async () => {
      const messages: ConversationMessage[] = [
        {
          role: 'system',
          content: 'You are the architect agent responsible for design decisions.',
          timestamp: new Date('2026-02-01T10:00:00Z'),
        },
        {
          role: 'user',
          content: 'What is the weather today? I need to implement the authentication module for the API server. We decided to use PostgreSQL as our database.',
          timestamp: new Date('2026-02-01T10:01:00Z'),
        },
        {
          role: 'assistant',
          agentId: 'architect',
          content: 'The API server will use JWT for authentication. I had lunch. We must implement rate limiting on all endpoints.',
          timestamp: new Date('2026-02-01T10:02:00Z'),
        },
        {
          role: 'user',
          content: 'Agreed on the approach. Can you also create the database schema? We should configure the testing framework.',
          timestamp: new Date('2026-02-01T10:03:00Z'),
        },
      ];

      const result = await summarizer.summarizeConversation(messages);

      expect(result).toContain('Conversation Summary');
      expect(result).toContain('API');
    });

    it('should respect sentence budget', async () => {
      const longMessages: ConversationMessage[] = Array.from({ length: 10 }, (_, i) => ({
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: Array.from(
          { length: 20 },
          (_, j) => `Sentence ${j} of message ${i} talks about feature number ${j} in the system.`,
        ).join(' '),
        timestamp: new Date(2026, 1, 1, 10, i),
      }));

      const smallBudget = new Summarizer(new Pool(), new (Redis as any)(), {
        sentenceBudget: 5,
        maxSummaryLength: 4000,
      });

      const result = await smallBudget.summarizeConversation(longMessages);

      const sentenceCount = result
        .split(/(?<=[.!?])\s+/)
        .filter((s) => s.length > 10).length;

      expect(sentenceCount).toBeLessThanOrEqual(10);
    });
  });

  describe('incrementalSummary', () => {
    it('should merge existing and new content', async () => {
      const existing = 'The system uses microservices. Authentication is JWT-based.';
      const newContent = 'We added rate limiting to all API endpoints. The database was migrated to PostgreSQL.';

      const result = await summarizer.incrementalSummary(existing, newContent);

      expect(result.length).toBeGreaterThan(0);
      expect(result.length).toBeLessThanOrEqual(4000);
    });

    it('should return new content when existing is empty', async () => {
      const result = await summarizer.incrementalSummary('', 'New project started with React frontend.');

      expect(result).toBe('New project started with React frontend.');
    });

    it('should return existing when new content is empty', async () => {
      const result = await summarizer.incrementalSummary('Existing summary content.', '');

      expect(result).toBe('Existing summary content.');
    });
  });

  describe('summarizeProject', () => {
    it('should return empty summary when no entries exist', async () => {
      mockPoolQuery.mockResolvedValueOnce({ rows: [] });

      const result = await summarizer.summarizeProject('empty-project');

      expect(result.projectId).toBe('empty-project');
      expect(result.summary).toBe('No project data available yet.');
      expect(result.keyDecisions).toEqual([]);
      expect(result.techStack).toEqual([]);
      expect(result.messageCount).toBe(0);
    });

    it('should extract tech stack and decisions from entries', async () => {
      mockPoolQuery.mockResolvedValueOnce({
        rows: [
          {
            content: 'We decided to use TypeScript for the backend API. The framework will be NestJS with PostgreSQL.',
            metadata: '{}',
            tags: '["tech:typescript", "decision"]',
            importance: 0.9,
            created_at: '2026-02-01T00:00:00Z',
          },
          {
            content: 'The frontend will use React with TailwindCSS for styling. Docker for containerization.',
            metadata: '{}',
            tags: '["tech:react"]',
            importance: 0.8,
            created_at: '2026-02-02T00:00:00Z',
          },
        ],
      });

      const result = await summarizer.summarizeProject('tech-project');

      expect(result.projectId).toBe('tech-project');
      expect(result.messageCount).toBe(2);
      expect(result.techStack.length).toBeGreaterThan(0);
      expect(result.summary.length).toBeGreaterThan(0);
    });

    it('should use cached project summary when available', async () => {
      const cached: any = {
        id: 'cached-id',
        projectId: 'cached-project',
        summary: 'Cached project summary.',
        keyDecisions: ['Use TypeScript'],
        openQuestions: [],
        techStack: ['TypeScript'],
        milestones: [],
        generatedAt: '2026-02-28T00:00:00Z',
        messageCount: 10,
        tokenEstimate: 50,
      };
      mockRedisGet.mockResolvedValueOnce(JSON.stringify(cached));

      const result = await summarizer.summarizeProject('cached-project');

      expect(result.summary).toBe('Cached project summary.');
      expect(mockPoolQuery).not.toHaveBeenCalled();
    });
  });
});
