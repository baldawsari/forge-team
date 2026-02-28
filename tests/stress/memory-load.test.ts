/**
 * Stress Test: Memory Manager — High Volume Operations
 *
 * Tests the MemoryManager under heavy load with mocked pg and ioredis.
 * Verifies stability under 10,000 insertions and concurrent read/write pressure.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock pg and ioredis BEFORE importing MemoryManager
// ---------------------------------------------------------------------------

const mockQueryFn = vi.fn();
const mockClientQuery = vi.fn();
const mockClientRelease = vi.fn();

vi.mock('pg', () => {
  return {
    Pool: class MockPool {
      query = mockQueryFn;
      connect = vi.fn().mockResolvedValue({
        query: mockClientQuery,
        release: mockClientRelease,
      });
    },
  };
});

vi.mock('ioredis', () => {
  const store = new Map<string, string>();
  return {
    default: class MockRedis {
      get = vi.fn().mockImplementation(async (key: string) => store.get(key) ?? null);
      setex = vi.fn().mockImplementation(async (key: string, _ttl: number, value: string) => {
        store.set(key, value);
        return 'OK';
      });
      del = vi.fn().mockImplementation(async (key: string) => {
        store.delete(key);
        return 1;
      });
    },
  };
});

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { MemoryManager } from '../../memory/src/memory-manager';
import { Pool } from 'pg';
import Redis from 'ioredis';

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('Memory Manager — Stress Tests', () => {
  let memoryManager: MemoryManager;
  let insertedCount: number;

  beforeEach(() => {
    vi.clearAllMocks();
    insertedCount = 0;

    // Configure mock to track insertions and return success
    mockClientQuery.mockImplementation(async (sql: string, _params?: unknown[]) => {
      if (typeof sql === 'string' && sql.trim().toUpperCase().startsWith('INSERT')) {
        insertedCount++;
      }
      return { rows: [], rowCount: 1 };
    });

    mockQueryFn.mockImplementation(async (_sql: string, _params?: unknown[]) => {
      return { rows: [], rowCount: 0 };
    });

    const pool = new Pool();
    const redis = new Redis();
    memoryManager = new MemoryManager(pool, redis);
  });

  // -----------------------------------------------------------------------
  // 1. 10,000 memory entry insertions
  // -----------------------------------------------------------------------

  it('should handle 10,000 memory entry insertions without crashing', async () => {
    const TOTAL_ENTRIES = 10_000;
    const BATCH_SIZE = 500;
    const batches = Math.ceil(TOTAL_ENTRIES / BATCH_SIZE);
    const errors: Error[] = [];

    for (let batch = 0; batch < batches; batch++) {
      const promises: Promise<unknown>[] = [];
      const start = batch * BATCH_SIZE;
      const end = Math.min(start + BATCH_SIZE, TOTAL_ENTRIES);

      for (let i = start; i < end; i++) {
        const promise = memoryManager
          .store(
            'thread',
            `Memory entry #${i}: This is test content for stress testing the memory system with entry number ${i}.`,
            { index: i, batch, testRun: 'stress-10k' },
            {
              agentId: `agent-${i % 12}`,
              projectId: 'stress-test-project',
              threadId: `thread-${i % 100}`,
              tags: [`batch-${batch}`, 'stress-test'],
              importance: (i % 10) / 10,
            },
          )
          .catch((err: Error) => {
            errors.push(err);
          });
        promises.push(promise);
      }

      await Promise.all(promises);
    }

    // No errors should have occurred
    expect(errors).toHaveLength(0);

    // All 10,000 insertions should have been attempted
    expect(insertedCount).toBe(TOTAL_ENTRIES);
  }, 60_000); // 60-second timeout for this heavy test

  // -----------------------------------------------------------------------
  // 2. Concurrent reads and writes
  // -----------------------------------------------------------------------

  it('should handle concurrent reads and writes', async () => {
    const CONCURRENT_OPS = 200;
    const errors: Error[] = [];

    // Configure search mock to return results
    mockQueryFn.mockImplementation(async (sql: string, _params?: unknown[]) => {
      if (typeof sql === 'string' && sql.includes('SELECT')) {
        return {
          rows: Array.from({ length: 5 }, (_, i) => ({
            id: `result-${i}`,
            scope: 'thread',
            agent_id: 'bmad-master',
            project_id: 'stress-project',
            team_id: null,
            thread_id: 'thread-1',
            content: `Mock memory content ${i}`,
            embedding: null,
            metadata: JSON.stringify({ test: true }),
            tags: JSON.stringify(['stress']),
            importance: 0.5,
            access_count: i,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            expires_at: null,
            superseded_by: null,
          })),
          rowCount: 5,
        };
      }
      return { rows: [], rowCount: 1 };
    });

    // Mix of writes and reads running concurrently
    const operations: Promise<unknown>[] = [];

    for (let i = 0; i < CONCURRENT_OPS; i++) {
      if (i % 3 === 0) {
        // Every 3rd operation is a search (read)
        const readOp = memoryManager
          .search(`query-${i}`, {
            scope: 'thread',
            agentId: 'bmad-master',
            limit: 10,
          })
          .catch((err: Error) => errors.push(err));
        operations.push(readOp);
      } else {
        // Other operations are writes
        const writeOp = memoryManager
          .store(
            'agent',
            `Concurrent write #${i}: testing mixed read/write load`,
            { index: i },
            {
              agentId: 'bmad-master',
              projectId: 'concurrent-test',
              tags: ['concurrent'],
            },
          )
          .catch((err: Error) => errors.push(err));
        operations.push(writeOp);
      }
    }

    const results = await Promise.allSettled(operations);

    // All operations should have settled (fulfilled or rejected)
    expect(results).toHaveLength(CONCURRENT_OPS);

    // No errors should have occurred
    expect(errors).toHaveLength(0);

    // Count fulfilled operations
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled.length).toBe(CONCURRENT_OPS);

    // Verify writes went through — approximately 2/3 of operations are writes
    const expectedWrites = CONCURRENT_OPS - Math.floor(CONCURRENT_OPS / 3);
    expect(insertedCount).toBeGreaterThanOrEqual(expectedWrites - 1);
    expect(insertedCount).toBeLessThanOrEqual(expectedWrites + 1);
  }, 30_000); // 30-second timeout
});
