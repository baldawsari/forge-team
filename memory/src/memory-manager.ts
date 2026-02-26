/**
 * Hierarchical Memory Manager for the ForgeTeam system.
 *
 * Scopes: Company -> Team -> Project -> Agent -> Thread
 *
 * Provides store, search, summarize, context retrieval, and compaction
 * across the full memory hierarchy. Backed by Postgres with Redis caching.
 */

import { Pool, PoolClient } from 'pg';
import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HierarchicalScope =
  | 'company'
  | 'team'
  | 'project'
  | 'agent'
  | 'thread';

export interface MemoryEntry {
  id: string;
  scope: HierarchicalScope;
  agentId: string | null;
  projectId: string | null;
  teamId: string | null;
  threadId: string | null;
  content: string;
  embedding: number[] | null;
  metadata: Record<string, unknown>;
  tags: string[];
  importance: number;
  accessCount: number;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
  supersededBy: string | null;
}

export interface StoreOptions {
  agentId?: string;
  projectId?: string;
  teamId?: string;
  threadId?: string;
  tags?: string[];
  importance?: number;
  expiresAt?: Date;
}

export interface SearchFilters {
  scope?: HierarchicalScope;
  agentId?: string;
  projectId?: string;
  teamId?: string;
  threadId?: string;
  tags?: string[];
  minImportance?: number;
  limit?: number;
  includeExpired?: boolean;
}

export interface CompactionResult {
  originalCount: number;
  compactedCount: number;
  summaryId: string;
  removedIds: string[];
}

// ---------------------------------------------------------------------------
// Memory Manager
// ---------------------------------------------------------------------------

export class MemoryManager {
  private pool: Pool;
  private redis: Redis;
  private cachePrefix = 'forgeteam:memory:';
  private cacheTTL = 300; // 5 minutes

  constructor(pool: Pool, redis: Redis) {
    this.pool = pool;
    this.redis = redis;
  }

  /**
   * Store a memory entry at a given scope with content and metadata.
   */
  async store(
    scope: HierarchicalScope,
    content: string,
    metadata: Record<string, unknown> = {},
    options: StoreOptions = {},
  ): Promise<MemoryEntry> {
    const id = uuidv4();
    const now = new Date();
    const tags = options.tags ?? [];
    const importance = options.importance ?? 0.5;

    const entry: MemoryEntry = {
      id,
      scope,
      agentId: options.agentId ?? null,
      projectId: options.projectId ?? null,
      teamId: options.teamId ?? null,
      threadId: options.threadId ?? null,
      content,
      embedding: null,
      metadata,
      tags,
      importance,
      accessCount: 0,
      createdAt: now,
      updatedAt: now,
      expiresAt: options.expiresAt ?? null,
      supersededBy: null,
    };

    const client = await this.pool.connect();
    try {
      await client.query(
        `INSERT INTO memory_entries
           (id, scope, agent_id, project_id, team_id, thread_id, content, embedding, metadata, tags, importance, access_count, created_at, updated_at, expires_at, superseded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          entry.id,
          entry.scope,
          entry.agentId,
          entry.projectId,
          entry.teamId,
          entry.threadId,
          entry.content,
          entry.embedding ? JSON.stringify(entry.embedding) : null,
          JSON.stringify(entry.metadata),
          JSON.stringify(entry.tags),
          entry.importance,
          entry.accessCount,
          entry.createdAt.toISOString(),
          entry.updatedAt.toISOString(),
          entry.expiresAt ? entry.expiresAt.toISOString() : null,
          entry.supersededBy,
        ],
      );

      // Invalidate relevant caches
      await this.invalidateScopeCache(scope, options);

      return entry;
    } finally {
      client.release();
    }
  }

  /**
   * Search memories with a text query and optional scope/filters.
   * Uses keyword matching (ILIKE) and scope filtering.
   * When an embedding-based search is needed, use VectorStore.similaritySearch directly.
   */
  async search(
    query: string,
    filters: SearchFilters = {},
  ): Promise<MemoryEntry[]> {
    const cacheKey = this.buildCacheKey('search', { query, ...filters });
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as MemoryEntry[];
    }

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    // Full-text keyword search
    if (query.trim().length > 0) {
      conditions.push(`content ILIKE $${paramIdx}`);
      params.push(`%${query}%`);
      paramIdx++;
    }

    if (filters.scope) {
      conditions.push(`scope = $${paramIdx}`);
      params.push(filters.scope);
      paramIdx++;
    }

    if (filters.agentId) {
      conditions.push(`agent_id = $${paramIdx}`);
      params.push(filters.agentId);
      paramIdx++;
    }

    if (filters.projectId) {
      conditions.push(`project_id = $${paramIdx}`);
      params.push(filters.projectId);
      paramIdx++;
    }

    if (filters.teamId) {
      conditions.push(`team_id = $${paramIdx}`);
      params.push(filters.teamId);
      paramIdx++;
    }

    if (filters.threadId) {
      conditions.push(`thread_id = $${paramIdx}`);
      params.push(filters.threadId);
      paramIdx++;
    }

    if (filters.tags && filters.tags.length > 0) {
      conditions.push(`tags::jsonb ?| $${paramIdx}`);
      params.push(filters.tags);
      paramIdx++;
    }

    if (filters.minImportance !== undefined) {
      conditions.push(`importance >= $${paramIdx}`);
      params.push(filters.minImportance);
      paramIdx++;
    }

    if (!filters.includeExpired) {
      conditions.push(`(expires_at IS NULL OR expires_at > NOW())`);
    }

    conditions.push(`superseded_by IS NULL`);

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filters.limit ?? 50;

    const sql = `
      SELECT * FROM memory_entries
      ${whereClause}
      ORDER BY importance DESC, updated_at DESC
      LIMIT ${limit}
    `;

    const result = await this.pool.query(sql, params);
    const entries = result.rows.map((row) => this.rowToEntry(row));

    // Update access counts in the background
    this.batchUpdateAccessCount(entries.map((e) => e.id)).catch(() => {});

    // Cache results
    await this.redis.setex(cacheKey, this.cacheTTL, JSON.stringify(entries));

    return entries;
  }

  /**
   * Summarize a batch of entries into a single condensed content string.
   * Uses a simple extractive approach: picks top sentences by importance,
   * deduplicates, and joins them.
   */
  async summarize(entries: MemoryEntry[]): Promise<string> {
    if (entries.length === 0) return '';
    if (entries.length === 1) return entries[0].content;

    // Sort by importance descending, then recency
    const sorted = [...entries].sort((a, b) => {
      if (b.importance !== a.importance) return b.importance - a.importance;
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    });

    // Extract unique sentences across all entries
    const seenSentences = new Set<string>();
    const sentences: string[] = [];

    for (const entry of sorted) {
      const entSentences = entry.content
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 10);

      for (const sentence of entSentences) {
        const normalized = sentence.toLowerCase().replace(/\s+/g, ' ');
        if (!seenSentences.has(normalized)) {
          seenSentences.add(normalized);
          sentences.push(sentence);
        }
      }
    }

    // Take the top sentences, capped at a reasonable length
    const maxSentences = Math.min(sentences.length, 30);
    const summary = sentences.slice(0, maxSentences).join(' ');

    return summary;
  }

  /**
   * Get recent relevant context for a specific agent.
   * Walks the scope hierarchy: agent -> project -> team -> company.
   */
  async getRecentContext(
    agentId: string,
    limit: number = 20,
  ): Promise<MemoryEntry[]> {
    const cacheKey = this.buildCacheKey('context', { agentId, limit });
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as MemoryEntry[];
    }

    // Gather entries from the agent scope first, then broaden
    const perScopeLimit = Math.ceil(limit / 4);

    const sql = `
      (
        SELECT *, 1 as scope_priority FROM memory_entries
        WHERE agent_id = $1 AND scope = 'agent' AND superseded_by IS NULL
          AND (expires_at IS NULL OR expires_at > NOW())
        ORDER BY updated_at DESC LIMIT $2
      )
      UNION ALL
      (
        SELECT *, 2 as scope_priority FROM memory_entries
        WHERE scope = 'thread' AND agent_id = $1 AND superseded_by IS NULL
          AND (expires_at IS NULL OR expires_at > NOW())
        ORDER BY updated_at DESC LIMIT $2
      )
      UNION ALL
      (
        SELECT *, 3 as scope_priority FROM memory_entries
        WHERE scope = 'project' AND superseded_by IS NULL
          AND (expires_at IS NULL OR expires_at > NOW())
        ORDER BY importance DESC, updated_at DESC LIMIT $2
      )
      UNION ALL
      (
        SELECT *, 4 as scope_priority FROM memory_entries
        WHERE scope IN ('team','company') AND superseded_by IS NULL
          AND (expires_at IS NULL OR expires_at > NOW())
        ORDER BY importance DESC, updated_at DESC LIMIT $2
      )
      ORDER BY scope_priority, importance DESC, updated_at DESC
      LIMIT $3
    `;

    const result = await this.pool.query(sql, [agentId, perScopeLimit, limit]);
    const entries = result.rows.map((row) => this.rowToEntry(row));

    await this.redis.setex(cacheKey, this.cacheTTL, JSON.stringify(entries));

    return entries;
  }

  /**
   * Compact old entries for a given session/thread.
   * Summarizes entries older than a threshold, stores the summary as a new
   * entry, and marks originals as superseded. (OpenClaw /compact style)
   */
  async compact(
    sessionId: string,
    maxAge: number = 50,
  ): Promise<CompactionResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Find entries in this session/thread scope that are old enough to compact
      const oldEntriesResult = await client.query(
        `SELECT * FROM memory_entries
         WHERE thread_id = $1 AND superseded_by IS NULL
           AND (expires_at IS NULL OR expires_at > NOW())
         ORDER BY created_at ASC`,
        [sessionId],
      );

      const allEntries = oldEntriesResult.rows.map((row) =>
        this.rowToEntry(row),
      );

      // Only compact if we have more than maxAge entries
      if (allEntries.length <= maxAge) {
        await client.query('COMMIT');
        return {
          originalCount: allEntries.length,
          compactedCount: 0,
          summaryId: '',
          removedIds: [],
        };
      }

      // Entries to compact: all but the most recent `maxAge` entries
      const toKeep = allEntries.slice(-maxAge);
      const toCompact = allEntries.slice(0, allEntries.length - maxAge);

      // Generate summary of entries to compact
      const summaryContent = await this.summarize(toCompact);

      // Gather metadata union
      const mergedTags = [
        ...new Set(toCompact.flatMap((e) => e.tags)),
      ];
      const maxImportance = Math.max(...toCompact.map((e) => e.importance));

      // Store compacted summary
      const summaryId = uuidv4();
      const now = new Date();

      await client.query(
        `INSERT INTO memory_entries
           (id, scope, agent_id, project_id, team_id, thread_id, content, embedding, metadata, tags, importance, access_count, created_at, updated_at, expires_at, superseded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          summaryId,
          'thread',
          toCompact[0].agentId,
          toCompact[0].projectId,
          toCompact[0].teamId,
          sessionId,
          summaryContent,
          null,
          JSON.stringify({
            compaction: true,
            originalCount: toCompact.length,
            dateRange: {
              from: toCompact[0].createdAt.toISOString(),
              to: toCompact[toCompact.length - 1].createdAt.toISOString(),
            },
          }),
          JSON.stringify(mergedTags),
          maxImportance,
          0,
          now.toISOString(),
          now.toISOString(),
          null,
          null,
        ],
      );

      // Mark compacted entries as superseded
      const compactedIds = toCompact.map((e) => e.id);
      await client.query(
        `UPDATE memory_entries SET superseded_by = $1, updated_at = $2
         WHERE id = ANY($3)`,
        [summaryId, now.toISOString(), compactedIds],
      );

      await client.query('COMMIT');

      // Invalidate caches
      await this.redis.del(
        this.buildCacheKey('context', {
          agentId: toCompact[0].agentId ?? '',
        }),
      );

      return {
        originalCount: allEntries.length,
        compactedCount: toCompact.length,
        summaryId,
        removedIds: compactedIds,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Delete a specific memory entry by ID.
   */
  async delete(id: string): Promise<boolean> {
    const result = await this.pool.query(
      'DELETE FROM memory_entries WHERE id = $1',
      [id],
    );
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Update an existing entry's content and metadata.
   */
  async update(
    id: string,
    content: string,
    metadata?: Record<string, unknown>,
  ): Promise<MemoryEntry | null> {
    const now = new Date();
    const result = await this.pool.query(
      `UPDATE memory_entries
       SET content = $1, metadata = COALESCE($2, metadata), updated_at = $3
       WHERE id = $4
       RETURNING *`,
      [content, metadata ? JSON.stringify(metadata) : null, now.toISOString(), id],
    );

    if (result.rows.length === 0) return null;
    return this.rowToEntry(result.rows[0]);
  }

  /**
   * Get a single entry by ID.
   */
  async getById(id: string): Promise<MemoryEntry | null> {
    const result = await this.pool.query(
      'SELECT * FROM memory_entries WHERE id = $1',
      [id],
    );
    if (result.rows.length === 0) return null;

    // Increment access count
    await this.pool
      .query(
        'UPDATE memory_entries SET access_count = access_count + 1 WHERE id = $1',
        [id],
      )
      .catch(() => {});

    return this.rowToEntry(result.rows[0]);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private rowToEntry(row: Record<string, unknown>): MemoryEntry {
    return {
      id: row.id as string,
      scope: row.scope as HierarchicalScope,
      agentId: (row.agent_id as string) ?? null,
      projectId: (row.project_id as string) ?? null,
      teamId: (row.team_id as string) ?? null,
      threadId: (row.thread_id as string) ?? null,
      content: row.content as string,
      embedding: row.embedding
        ? (typeof row.embedding === 'string'
            ? JSON.parse(row.embedding)
            : row.embedding)
        : null,
      metadata:
        typeof row.metadata === 'string'
          ? JSON.parse(row.metadata)
          : (row.metadata as Record<string, unknown>) ?? {},
      tags:
        typeof row.tags === 'string'
          ? JSON.parse(row.tags)
          : (row.tags as string[]) ?? [],
      importance: Number(row.importance ?? 0.5),
      accessCount: Number(row.access_count ?? 0),
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
      expiresAt: row.expires_at ? new Date(row.expires_at as string) : null,
      supersededBy: (row.superseded_by as string) ?? null,
    };
  }

  private buildCacheKey(
    prefix: string,
    params: Record<string, unknown>,
  ): string {
    const hash = JSON.stringify(params);
    return `${this.cachePrefix}${prefix}:${Buffer.from(hash).toString('base64').slice(0, 64)}`;
  }

  private async invalidateScopeCache(
    scope: HierarchicalScope,
    options: StoreOptions,
  ): Promise<void> {
    const patterns = [
      this.buildCacheKey('search', { scope }),
      this.buildCacheKey('context', { agentId: options.agentId ?? '' }),
    ];
    for (const key of patterns) {
      await this.redis.del(key).catch(() => {});
    }
  }

  private async batchUpdateAccessCount(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.pool
      .query(
        `UPDATE memory_entries SET access_count = access_count + 1 WHERE id = ANY($1)`,
        [ids],
      )
      .catch(() => {});
  }
}
