/**
 * Task and Kanban board type definitions for the ForgeTeam system.
 * Manages the flow of work items through the SDLC pipeline.
 */

import type { AgentId } from './agent';

/** Kanban column status representing task lifecycle */
export type TaskStatus =
  | 'backlog'
  | 'todo'
  | 'in-progress'
  | 'review'
  | 'done'
  | 'cancelled';

/** Priority levels for task scheduling */
export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';

/** Complexity classification that influences model routing */
export type TaskComplexity = 'trivial' | 'simple' | 'moderate' | 'complex' | 'critical';

/** A work item in the ForgeTeam system */
export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  complexity: TaskComplexity;
  /** The agent currently assigned to this task */
  assignedTo: AgentId | null;
  /** The agent or user who created this task */
  createdBy: AgentId | 'user' | 'system';
  /** Parent task ID for subtasks */
  parentTaskId: string | null;
  /** Child subtask IDs */
  subtaskIds: string[];
  /** IDs of tasks that must complete before this one */
  dependsOn: string[];
  /** IDs of tasks blocked by this one */
  blocks: string[];
  /** Tags for filtering and categorization */
  tags: string[];
  /** Which SDLC phase this task belongs to */
  phase: string;
  /** Session this task is active in */
  sessionId: string;
  /** Estimated effort in story points */
  storyPoints: number | null;
  /** Artifacts produced by this task */
  artifacts: string[];
  /** Delegation chain if this was delegated */
  delegationChain: AgentId[];
  /** Timestamps */
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  /** Deadline if applicable */
  dueAt: string | null;
  /** Free-form metadata */
  metadata: Record<string, unknown>;
}

/** Input for creating a new task */
export interface CreateTaskInput {
  title: string;
  description: string;
  priority?: TaskPriority;
  complexity?: TaskComplexity;
  assignedTo?: AgentId;
  parentTaskId?: string;
  dependsOn?: string[];
  tags?: string[];
  phase?: string;
  storyPoints?: number;
  dueAt?: string;
  metadata?: Record<string, unknown>;
}

/** Input for updating an existing task */
export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  complexity?: TaskComplexity;
  assignedTo?: AgentId | null;
  tags?: string[];
  storyPoints?: number | null;
  dueAt?: string | null;
  metadata?: Record<string, unknown>;
}

/** A Kanban column containing tasks */
export interface KanbanColumn {
  id: TaskStatus;
  label: string;
  tasks: Task[];
  /** Maximum tasks allowed in this column (WIP limit) */
  wipLimit: number | null;
}

/** Full Kanban board state */
export interface KanbanBoard {
  sessionId: string;
  columns: KanbanColumn[];
  /** Total tasks across all columns */
  totalTasks: number;
  /** Timestamp of last board change */
  lastUpdated: string;
}

/** Event emitted when a task changes */
export interface TaskEvent {
  type: 'task.created' | 'task.updated' | 'task.moved' | 'task.assigned' | 'task.completed' | 'task.cancelled';
  taskId: string;
  sessionId: string;
  timestamp: string;
  /** Previous state for diff tracking */
  previousStatus?: TaskStatus;
  /** Current state */
  currentStatus: TaskStatus;
  /** Who triggered the change */
  triggeredBy: AgentId | 'user' | 'system';
  /** Additional event data */
  data?: Record<string, unknown>;
}
