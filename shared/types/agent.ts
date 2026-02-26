/**
 * Agent type definitions for the ForgeTeam system.
 * Defines all agent identifiers, statuses, configurations, and message formats.
 */

/** All recognized agent identifiers in the ForgeTeam SDLC pipeline */
export type AgentId =
  | 'bmad-master'
  | 'product-owner'
  | 'business-analyst'
  | 'scrum-master'
  | 'architect'
  | 'ux-designer'
  | 'frontend-dev'
  | 'backend-dev'
  | 'qa-architect'
  | 'devops-engineer'
  | 'security-specialist'
  | 'tech-writer';

/** Current operational status of an agent */
export type AgentStatus =
  | 'idle'
  | 'working'
  | 'reviewing'
  | 'blocked'
  | 'offline'
  | 'error';

/** Human-readable agent role descriptor */
export interface AgentRole {
  id: AgentId;
  name: string;
  description: string;
  capabilities: string[];
  /** Which SDLC phases this agent participates in */
  phases: string[];
}

/** Full agent configuration loaded from the agents/ directory */
export interface AgentConfig {
  id: AgentId;
  name: string;
  role: string;
  description: string;
  capabilities: string[];
  phases: string[];
  /** System prompt or persona definition */
  systemPrompt: string;
  /** Maximum concurrent tasks this agent can handle */
  maxConcurrentTasks: number;
  /** Agents this one can delegate to */
  canDelegateTo: AgentId[];
  /** Agents this one receives delegations from */
  receivesFrom: AgentId[];
  /** Default model tier preference */
  defaultModelTier: 'premium' | 'balanced' | 'fast';
}

/** Runtime state of an agent within a session */
export interface AgentState {
  agentId: AgentId;
  status: AgentStatus;
  currentTaskId: string | null;
  sessionId: string | null;
  lastActiveAt: string;
  /** Number of tasks completed in current session */
  tasksCompleted: number;
  /** Number of tasks that failed or were escalated */
  tasksFailed: number;
}

/** Message sent to or from an agent */
export interface AgentMessage {
  id: string;
  type: AgentMessageType;
  from: AgentId | 'user' | 'system' | 'gateway';
  to: AgentId | 'user' | 'dashboard' | 'broadcast';
  payload: AgentMessagePayload;
  sessionId: string;
  timestamp: string;
  /** Optional correlation ID for request/response tracking */
  correlationId?: string;
  /** Optional metadata for routing and processing */
  metadata?: Record<string, unknown>;
}

/** Types of messages that flow through the system */
export type AgentMessageType =
  | 'task.assign'
  | 'task.complete'
  | 'task.fail'
  | 'task.progress'
  | 'delegation.request'
  | 'delegation.response'
  | 'delegation.revoke'
  | 'agent.status'
  | 'agent.heartbeat'
  | 'chat.message'
  | 'chat.response'
  | 'system.notification'
  | 'system.error'
  | 'workflow.step'
  | 'workflow.complete'
  | 'review.request'
  | 'review.response';

/** Payload carried by an agent message */
export interface AgentMessagePayload {
  /** Human-readable text content */
  content?: string;
  /** Structured data (task details, delegation tokens, etc.) */
  data?: Record<string, unknown>;
  /** File attachments or artifact references */
  artifacts?: ArtifactReference[];
  /** Error information if applicable */
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/** Reference to an artifact produced or consumed by an agent */
export interface ArtifactReference {
  id: string;
  name: string;
  type: 'document' | 'code' | 'diagram' | 'test' | 'config' | 'other';
  path?: string;
  url?: string;
  mimeType?: string;
  sizeBytes?: number;
}
