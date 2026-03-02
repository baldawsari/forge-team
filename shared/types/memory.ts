/**
 * Memory system type definitions for the ForgeTeam system.
 * Manages shared context, agent memories, and semantic search across the knowledge base.
 */

import type { AgentId } from './agent';

/** Scope levels for memory entries */
export type MemoryScope =
  | 'company'     // Available to all agents across all projects (was 'global')
  | 'team'        // Scoped to a team of agents
  | 'project'     // Scoped to a specific project
  | 'agent'       // Private to a specific agent
  | 'thread';     // Scoped to a specific conversation thread (was 'session')

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
  /** Thread this memory belongs to (if thread-scoped) */
  threadId: string | null;
  /** Project this memory belongs to (if project-scoped) */
  projectId: string | null;
  /** Team this memory belongs to (if team-scoped) */
  teamId: string | null;
  /** Agent this memory belongs to (if agent-scoped) */
  agentId: AgentId | null;
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
  threadId?: string;
  projectId?: string;
  teamId?: string;
  agentId?: AgentId;
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
  /** Filter by thread */
  threadId?: string;
  /** Filter by project */
  projectId?: string;
  /** Filter by team */
  teamId?: string;
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

