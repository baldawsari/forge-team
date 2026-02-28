/**
 * Local vector store backed by pgvector (PostgreSQL).
 *
 * Provides embedding storage, similarity search, and CRUD operations
 * as a fallback when Gemini File Search is unavailable.
 */

import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { GoogleGenerativeAI } from '@google/generative-ai';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VectorEntry {
  id: string;
  content: string;
  embedding: number[];
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface SimilarityResult {
  entry: VectorEntry;
  score: number;
  distance: number;
}

export interface VectorSearchFilters {
  metadataFilter?: Record<string, unknown>;
  minScore?: number;
  namespace?: string;
}

export interface VectorStoreConfig {
  tableName?: string;
  dimensions?: number;
  distanceMetric?: 'cosine' | 'l2' | 'inner_product';
  apiKey?: string;
  embeddingModel?: string;
}

// ---------------------------------------------------------------------------
// Vector Store
// ---------------------------------------------------------------------------

export class VectorStore {
  private pool: Pool;
  private tableName: string;
  private dimensions: number;
  private distanceMetric: 'cosine' | 'l2' | 'inner_product';
  private genAI: GoogleGenerativeAI | null;
  private embeddingModel: string;

  constructor(pool: Pool, config: VectorStoreConfig = {}) {
    this.pool = pool;
    this.tableName = config.tableName ?? 'vector_entries';
    this.dimensions = config.dimensions ?? 768;
    this.distanceMetric = config.distanceMetric ?? 'cosine';
    this.embeddingModel = config.embeddingModel ?? 'text-embedding-004';

    const apiKey = config.apiKey ?? process.env.GOOGLE_AI_API_KEY;
    this.genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

    if (!this.genAI) {
      console.warn('[VectorStore] No GOOGLE_AI_API_KEY — using fallback hash embeddings');
    }
  }

  /**
   * Ensure the pgvector extension and table exist.
   */
  async initialize(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('CREATE EXTENSION IF NOT EXISTS vector');

      await client.query(`
        CREATE TABLE IF NOT EXISTS ${this.tableName} (
          id TEXT PRIMARY KEY,
          content TEXT NOT NULL,
          embedding vector(${this.dimensions}),
          metadata JSONB DEFAULT '{}',
          namespace TEXT DEFAULT 'default',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // Create an index for vector similarity search
      const indexName = `${this.tableName}_embedding_idx`;
      const operatorClass =
        this.distanceMetric === 'cosine'
          ? 'vector_cosine_ops'
          : this.distanceMetric === 'inner_product'
            ? 'vector_ip_ops'
            : 'vector_l2_ops';

      await client.query(`
        CREATE INDEX IF NOT EXISTS ${indexName}
        ON ${this.tableName}
        USING ivfflat (embedding ${operatorClass})
        WITH (lists = 100)
      `).catch(() => {
        // Index creation may fail on small datasets; that is okay
      });
    } finally {
      client.release();
    }
  }

  async embed(text: string): Promise<number[]> {
    if (!this.genAI) {
      return this.hashEmbed(text);
    }

    const model = this.genAI.getGenerativeModel({ model: this.embeddingModel });
    const result = await model.embedContent(text);
    return result.embedding.values;
  }

  private hashEmbed(text: string): number[] {
    const vector = new Array(this.dimensions).fill(0);
    const normalized = text.toLowerCase().trim();

    for (let i = 0; i < normalized.length; i++) {
      const code = normalized.charCodeAt(i);
      for (let d = 0; d < 8; d++) {
        const idx = ((code * 31 + i * 7 + d * 13) & 0x7fffffff) % this.dimensions;
        vector[idx] += Math.sin(code * (d + 1) + i) * 0.1;
      }
    }

    const magnitude = Math.sqrt(
      vector.reduce((sum: number, v: number) => sum + v * v, 0),
    );
    if (magnitude > 0) {
      for (let i = 0; i < vector.length; i++) {
        vector[i] /= magnitude;
      }
    }

    return vector;
  }

  /**
   * Upsert a vector entry. If the ID already exists, update it.
   */
  async upsert(
    id: string,
    content: string,
    embedding: number[],
    metadata: Record<string, unknown> = {},
    namespace: string = 'default',
  ): Promise<VectorEntry> {
    const now = new Date();

    // Format embedding as pgvector string: [0.1,0.2,...]
    const embeddingStr = `[${embedding.join(',')}]`;

    await this.pool.query(
      `INSERT INTO ${this.tableName} (id, content, embedding, metadata, namespace, created_at, updated_at)
       VALUES ($1, $2, $3::vector, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         content = EXCLUDED.content,
         embedding = EXCLUDED.embedding,
         metadata = EXCLUDED.metadata,
         namespace = EXCLUDED.namespace,
         updated_at = EXCLUDED.updated_at`,
      [
        id,
        content,
        embeddingStr,
        JSON.stringify(metadata),
        namespace,
        now.toISOString(),
        now.toISOString(),
      ],
    );

    return {
      id,
      content,
      embedding,
      metadata,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Convenience method: embed text and upsert in one call.
   */
  async embedAndUpsert(
    content: string,
    metadata: Record<string, unknown> = {},
    namespace: string = 'default',
    id?: string,
  ): Promise<VectorEntry> {
    const entryId = id ?? uuidv4();
    const embedding = await this.embed(content);
    return this.upsert(entryId, content, embedding, metadata, namespace);
  }

  /**
   * Search for similar vectors using the configured distance metric.
   */
  async similaritySearch(
    query: string,
    topK: number = 10,
    filters: VectorSearchFilters = {},
  ): Promise<SimilarityResult[]> {
    const queryEmbedding = await this.embed(query);
    return this.similaritySearchByVector(queryEmbedding, topK, filters);
  }

  /**
   * Search for similar vectors by providing a raw embedding vector.
   */
  async similaritySearchByVector(
    queryEmbedding: number[],
    topK: number = 10,
    filters: VectorSearchFilters = {},
  ): Promise<SimilarityResult[]> {
    const embeddingStr = `[${queryEmbedding.join(',')}]`;

    // Build distance expression based on metric
    let distanceExpr: string;
    let orderDirection: string;

    switch (this.distanceMetric) {
      case 'cosine':
        distanceExpr = `embedding <=> $1::vector`;
        orderDirection = 'ASC'; // Lower distance = more similar
        break;
      case 'inner_product':
        distanceExpr = `embedding <#> $1::vector`;
        orderDirection = 'ASC'; // pgvector uses negative inner product
        break;
      case 'l2':
      default:
        distanceExpr = `embedding <-> $1::vector`;
        orderDirection = 'ASC';
        break;
    }

    const conditions: string[] = [];
    const params: unknown[] = [embeddingStr];
    let paramIdx = 2;

    if (filters.namespace) {
      conditions.push(`namespace = $${paramIdx}`);
      params.push(filters.namespace);
      paramIdx++;
    }

    if (filters.metadataFilter) {
      for (const [key, value] of Object.entries(filters.metadataFilter)) {
        conditions.push(`metadata->>'${key}' = $${paramIdx}`);
        params.push(String(value));
        paramIdx++;
      }
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT
        id, content, embedding, metadata, created_at, updated_at,
        ${distanceExpr} as distance
      FROM ${this.tableName}
      ${whereClause}
      ORDER BY ${distanceExpr} ${orderDirection}
      LIMIT $${paramIdx}
    `;
    params.push(topK);

    const result = await this.pool.query(sql, params);

    return result.rows.map((row) => {
      const distance = Number(row.distance);
      // Convert distance to similarity score (0-1 range)
      let score: number;
      if (this.distanceMetric === 'cosine') {
        score = 1 - distance; // cosine distance to similarity
      } else if (this.distanceMetric === 'inner_product') {
        score = -distance; // negative inner product to positive
      } else {
        score = 1 / (1 + distance); // L2 distance to similarity
      }

      if (filters.minScore !== undefined && score < filters.minScore) {
        return null;
      }

      return {
        entry: this.rowToEntry(row),
        score: Math.max(0, Math.min(1, score)),
        distance,
      };
    }).filter((r): r is SimilarityResult => r !== null);
  }

  /**
   * Delete a vector entry by ID.
   */
  async delete(id: string): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM ${this.tableName} WHERE id = $1`,
      [id],
    );
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Delete multiple vector entries by IDs.
   */
  async deleteMany(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await this.pool.query(
      `DELETE FROM ${this.tableName} WHERE id = ANY($1)`,
      [ids],
    );
    return result.rowCount ?? 0;
  }

  /**
   * Delete all entries in a namespace.
   */
  async deleteNamespace(namespace: string): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM ${this.tableName} WHERE namespace = $1`,
      [namespace],
    );
    return result.rowCount ?? 0;
  }

  /**
   * Update the content and re-embed a vector entry.
   */
  async update(
    id: string,
    content: string,
    metadata?: Record<string, unknown>,
  ): Promise<VectorEntry | null> {
    const embedding = await this.embed(content);
    const embeddingStr = `[${embedding.join(',')}]`;
    const now = new Date();

    const result = await this.pool.query(
      `UPDATE ${this.tableName}
       SET content = $1, embedding = $2::vector, metadata = COALESCE($3, metadata), updated_at = $4
       WHERE id = $5
       RETURNING *`,
      [
        content,
        embeddingStr,
        metadata ? JSON.stringify(metadata) : null,
        now.toISOString(),
        id,
      ],
    );

    if (result.rows.length === 0) return null;
    return this.rowToEntry(result.rows[0]);
  }

  /**
   * Get a single entry by ID.
   */
  async getById(id: string): Promise<VectorEntry | null> {
    const result = await this.pool.query(
      `SELECT * FROM ${this.tableName} WHERE id = $1`,
      [id],
    );
    if (result.rows.length === 0) return null;
    return this.rowToEntry(result.rows[0]);
  }

  /**
   * Count total entries, optionally filtered by namespace.
   */
  async count(namespace?: string): Promise<number> {
    const sql = namespace
      ? `SELECT COUNT(*) FROM ${this.tableName} WHERE namespace = $1`
      : `SELECT COUNT(*) FROM ${this.tableName}`;
    const params = namespace ? [namespace] : [];
    const result = await this.pool.query(sql, params);
    return Number(result.rows[0].count);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private rowToEntry(row: Record<string, unknown>): VectorEntry {
    let embedding: number[] = [];
    if (row.embedding) {
      if (typeof row.embedding === 'string') {
        // pgvector returns strings like "[0.1,0.2,...]"
        embedding = JSON.parse(row.embedding.replace(/^\[/, '[').replace(/\]$/, ']'));
      } else if (Array.isArray(row.embedding)) {
        embedding = row.embedding as number[];
      }
    }

    return {
      id: row.id as string,
      content: row.content as string,
      embedding,
      metadata:
        typeof row.metadata === 'string'
          ? JSON.parse(row.metadata)
          : (row.metadata as Record<string, unknown>) ?? {},
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }
}
