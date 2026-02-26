/**
 * Memory system type definitions for the ForgeTeam system.
 * Manages shared context, agent memories, and semantic search across the knowledge base.
 */

import type { AgentId } from './agent';

/** Scope levels for memory entries */
export type MemoryScope =
  | 'global'       // Available to all agents across all sessions
  | 'session'      // Scoped to a specific session
  | 'agent'        // Private to a specific agent
  | 'phase'        // Scoped to an SDLC phase
  | 'task';        // Scoped to a specific task

/** Type of content stored in memory */
export type MemoryContentType =
  | 'decision'
  | 'requirement'
  | 'architecture'
  | 'code-snippet'
  | 'test-result'
  | 'conversation'
  | 'artifact'
  | 'feedback'
  | 'lesson-learned'
  | 'config'
  | 'reference';

/** A single entry in the memory system */
export interface MemoryEntry {
  id: string;
  /** Content of the memory */
  content: string;
  /** Structured data associated with this memory */
  data?: Record<string, unknown>;
  /** Scope of this memory */
  scope: MemoryScope;
  /** Type of content */
  contentType: MemoryContentType;
  /** Agent that created this memory */
  createdBy: AgentId | 'user' | 'system';
  /** Session this memory belongs to (if session-scoped) */
  sessionId: string | null;
  /** Task this memory belongs to (if task-scoped) */
  taskId: string | null;
  /** Agent this memory belongs to (if agent-scoped) */
  agentId: AgentId | null;
  /** Phase this memory belongs to (if phase-scoped) */
  phase: string | null;
  /** Tags for filtering */
  tags: string[];
  /** Embedding vector for semantic search (stored separately, referenced here) */
  embeddingId: string | null;
  /** Importance score [0.0, 1.0] - higher means more important to retain */
  importance: number;
  /** Access count for frequency-based retrieval */
  accessCount: number;
  /** Timestamps */
  createdAt: string;
  updatedAt: string;
  /** Expiry time (null = never expires) */
  expiresAt: string | null;
  /** Whether this memory has been superseded by a newer one */
  supersededBy: string | null;
}

/** Input for creating a new memory entry */
export interface CreateMemoryInput {
  content: string;
  data?: Record<string, unknown>;
  scope: MemoryScope;
  contentType: MemoryContentType;
  createdBy: AgentId | 'user' | 'system';
  sessionId?: string;
  taskId?: string;
  agentId?: AgentId;
  phase?: string;
  tags?: string[];
  importance?: number;
  expiresAt?: string;
}

/** Result from a memory search */
export interface SearchResult {
  entry: MemoryEntry;
  /** Relevance score [0.0, 1.0] */
  relevanceScore: number;
  /** Which search criteria matched */
  matchedOn: ('semantic' | 'keyword' | 'tag' | 'scope' | 'type')[];
}

/** Query for searching memories */
export interface MemorySearchQuery {
  /** Natural language query for semantic search */
  query?: string;
  /** Filter by scope */
  scope?: MemoryScope;
  /** Filter by content type */
  contentType?: MemoryContentType;
  /** Filter by agent */
  agentId?: AgentId;
  /** Filter by session */
  sessionId?: string;
  /** Filter by task */
  taskId?: string;
  /** Filter by phase */
  phase?: string;
  /** Filter by tags (any match) */
  tags?: string[];
  /** Minimum importance score */
  minImportance?: number;
  /** Maximum number of results */
  limit?: number;
  /** Whether to include expired entries */
  includeExpired?: boolean;
  /** Sort order */
  sortBy?: 'relevance' | 'recency' | 'importance' | 'access-count';
}

/** Aggregated memory context provided to an agent before task execution */
export interface AgentContext {
  /** Relevant global memories */
  globalContext: MemoryEntry[];
  /** Session-specific context */
  sessionContext: MemoryEntry[];
  /** Agent's own memories */
  agentMemories: MemoryEntry[];
  /** Task-specific context */
  taskContext: MemoryEntry[];
  /** Phase-specific context */
  phaseContext: MemoryEntry[];
  /** Total token estimate for context window management */
  estimatedTokens: number;
}
