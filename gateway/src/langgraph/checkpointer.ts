import { BaseCheckpointSaver } from '@langchain/langgraph';
import type {
  Checkpoint,
  CheckpointMetadata,
  CheckpointTuple,
  PendingWrite,
  ChannelVersions,
  CheckpointListOptions,
} from '@langchain/langgraph-checkpoint';
import type { RunnableConfig } from '@langchain/core/runnables';
import pg from 'pg';

const { Pool } = pg;

export class PostgresCheckpointSaver extends BaseCheckpointSaver {
  private pool: InstanceType<typeof Pool>;
  private initialized = false;

  constructor(databaseUrl: string) {
    super();
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  private async ensureTable(): Promise<void> {
    if (this.initialized) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS workflow_checkpoints (
        id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
        instance_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        checkpoint_data JSONB NOT NULL DEFAULT '{}'::jsonb,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_wf_checkpoints_instance
        ON workflow_checkpoints (instance_id);
      CREATE INDEX IF NOT EXISTS idx_wf_checkpoints_thread
        ON workflow_checkpoints (thread_id);
    `);
    this.initialized = true;
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    await this.ensureTable();

    const threadId = config.configurable?.thread_id as string | undefined;
    if (!threadId) return undefined;

    const checkpointId = config.configurable?.checkpoint_id as string | undefined;

    let result;
    if (checkpointId) {
      result = await this.pool.query(
        `SELECT id, thread_id, checkpoint_data, metadata
         FROM workflow_checkpoints
         WHERE thread_id = $1 AND id = $2
         ORDER BY created_at DESC LIMIT 1`,
        [threadId, checkpointId]
      );
    } else {
      result = await this.pool.query(
        `SELECT id, thread_id, checkpoint_data, metadata
         FROM workflow_checkpoints
         WHERE thread_id = $1
         ORDER BY created_at DESC LIMIT 1`,
        [threadId]
      );
    }

    if (result.rows.length === 0) return undefined;

    const row = result.rows[0];
    const checkpoint = row.checkpoint_data as Checkpoint;
    const metadata = (row.metadata ?? {}) as CheckpointMetadata;

    return {
      config: {
        configurable: {
          thread_id: row.thread_id,
          checkpoint_id: row.id,
        },
      },
      checkpoint,
      metadata,
    };
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: ChannelVersions
  ): Promise<RunnableConfig> {
    await this.ensureTable();

    const threadId = (config.configurable?.thread_id as string) ?? 'default';
    const instanceId = (config.configurable?.instance_id as string) ?? threadId;

    const result = await this.pool.query(
      `INSERT INTO workflow_checkpoints (instance_id, thread_id, checkpoint_data, metadata)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [instanceId, threadId, JSON.stringify(checkpoint), JSON.stringify(metadata)]
    );

    const newId = result.rows[0].id as string;

    return {
      configurable: {
        thread_id: threadId,
        checkpoint_id: newId,
      },
    };
  }

  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions
  ): AsyncGenerator<CheckpointTuple> {
    await this.ensureTable();

    const threadId = config.configurable?.thread_id as string | undefined;
    if (!threadId) return;

    const limit = options?.limit ?? 100;
    const beforeConfig = options?.before;
    const beforeId = beforeConfig?.configurable?.checkpoint_id as string | undefined;

    let query: string;
    let params: unknown[];

    if (beforeId) {
      query = `
        SELECT id, thread_id, checkpoint_data, metadata, created_at
        FROM workflow_checkpoints
        WHERE thread_id = $1 AND created_at < (
          SELECT created_at FROM workflow_checkpoints WHERE id = $2
        )
        ORDER BY created_at DESC
        LIMIT $3
      `;
      params = [threadId, beforeId, limit];
    } else {
      query = `
        SELECT id, thread_id, checkpoint_data, metadata, created_at
        FROM workflow_checkpoints
        WHERE thread_id = $1
        ORDER BY created_at DESC
        LIMIT $2
      `;
      params = [threadId, limit];
    }

    const result = await this.pool.query(query, params);

    for (const row of result.rows) {
      yield {
        config: {
          configurable: {
            thread_id: row.thread_id,
            checkpoint_id: row.id,
          },
        },
        checkpoint: row.checkpoint_data as Checkpoint,
        metadata: (row.metadata ?? {}) as CheckpointMetadata,
      };
    }
  }

  async putWrites(
    _config: RunnableConfig,
    _writes: PendingWrite[],
    _taskId: string
  ): Promise<void> {
    // Writes are folded into the checkpoint via put(); no separate storage needed.
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.ensureTable();
    await this.pool.query(
      `DELETE FROM workflow_checkpoints WHERE thread_id = $1`,
      [threadId]
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
