/**
 * Kanban Task Manager for the ForgeTeam Gateway.
 *
 * Provides CRUD operations on tasks, Kanban board management,
 * WIP limits, task assignment, and real-time updates via events.
 */

import { EventEmitter } from 'eventemitter3';
import { v4 as uuid } from 'uuid';
import type { Pool } from 'pg';
import type {
  AgentId,
  Task,
  TaskStatus,
  TaskPriority,
  TaskComplexity,
  CreateTaskInput,
  UpdateTaskInput,
  KanbanColumn,
  KanbanBoard,
  TaskEvent,
} from '@forge-team/shared';

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface TaskManagerEvents {
  'task:created': (event: TaskEvent) => void;
  'task:updated': (event: TaskEvent) => void;
  'task:moved': (event: TaskEvent) => void;
  'task:assigned': (event: TaskEvent) => void;
  'task:completed': (event: TaskEvent) => void;
  'task:cancelled': (event: TaskEvent) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Kanban column definitions with default WIP limits */
const KANBAN_COLUMNS: { id: TaskStatus; label: string; wipLimit: number | null }[] = [
  { id: 'backlog', label: 'Backlog', wipLimit: null },
  { id: 'todo', label: 'To Do', wipLimit: 20 },
  { id: 'in-progress', label: 'In Progress', wipLimit: 10 },
  { id: 'review', label: 'Review', wipLimit: 8 },
  { id: 'done', label: 'Done', wipLimit: null },
  { id: 'cancelled', label: 'Cancelled', wipLimit: null },
];

/** Valid status transitions for tasks */
const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  'backlog': ['todo', 'cancelled'],
  'todo': ['in-progress', 'backlog', 'cancelled'],
  'in-progress': ['review', 'todo', 'cancelled'],
  'review': ['done', 'in-progress', 'cancelled'],
  'done': ['in-progress'], // Allow reopening
  'cancelled': ['backlog'], // Allow uncancelling
};

// ---------------------------------------------------------------------------
// Task Manager
// ---------------------------------------------------------------------------

export class TaskManager extends EventEmitter<TaskManagerEvents> {
  private tasks: Map<string, Task> = new Map();
  /** Custom WIP limits (overridable per session) */
  private wipLimits: Map<TaskStatus, number | null> = new Map();
  private pool: Pool | null = null;

  constructor(pool?: Pool) {
    super();
    this.pool = pool ?? null;
    // Initialize default WIP limits
    for (const col of KANBAN_COLUMNS) {
      this.wipLimits.set(col.id, col.wipLimit);
    }
  }

  /**
   * Loads tasks from PostgreSQL into the in-memory Map on startup.
   */
  async loadFromDB(): Promise<void> {
    if (!this.pool) return;
    try {
      const result = await this.pool.query('SELECT * FROM tasks ORDER BY created_at ASC');
      for (const row of result.rows) {
        const task: Task = {
          id: row.id,
          title: row.title,
          description: row.description ?? '',
          status: row.status,
          priority: row.priority,
          complexity: row.complexity,
          assignedTo: row.assigned_agent ?? null,
          createdBy: row.created_by ?? 'system',
          parentTaskId: row.parent_task_id ?? null,
          subtaskIds: [],
          dependsOn: row.depends_on ?? [],
          blocks: [],
          tags: row.tags ?? [],
          phase: row.phase ?? '',
          sessionId: row.session_id ?? '',
          storyPoints: row.story_points ?? null,
          artifacts: row.artifacts ?? [],
          delegationChain: row.delegation_chain ?? [],
          createdAt: new Date(row.created_at).toISOString(),
          updatedAt: new Date(row.updated_at).toISOString(),
          startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
          completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
          dueAt: row.due_at ? new Date(row.due_at).toISOString() : null,
          metadata: row.metadata ?? {},
        };
        this.tasks.set(task.id, task);
      }

      // Rebuild subtaskIds and blocks references
      for (const task of this.tasks.values()) {
        if (task.parentTaskId) {
          const parent = this.tasks.get(task.parentTaskId);
          if (parent && !parent.subtaskIds.includes(task.id)) {
            parent.subtaskIds.push(task.id);
          }
        }
        for (const depId of task.dependsOn) {
          const dep = this.tasks.get(depId);
          if (dep && !dep.blocks.includes(task.id)) {
            dep.blocks.push(task.id);
          }
        }
      }

      console.log(`[TaskManager] Loaded ${result.rows.length} tasks from DB`);
    } catch (err: any) {
      console.warn('[TaskManager] Failed to load tasks from DB:', err?.message);
    }
  }

  /** Fire-and-forget DB write helper */
  private dbWrite(sql: string, params: unknown[]): void {
    if (!this.pool) return;
    this.pool.query(sql, params).catch((err: any) => {
      console.warn('[TaskManager] DB write failed:', err?.message);
    });
  }

  // =========================================================================
  // CRUD Operations
  // =========================================================================

  /**
   * Creates a new task and adds it to the backlog.
   */
  createTask(input: CreateTaskInput, sessionId: string): Task {
    const now = new Date().toISOString();
    const task: Task = {
      id: uuid(),
      title: input.title,
      description: input.description,
      status: 'backlog',
      priority: input.priority ?? 'medium',
      complexity: input.complexity ?? 'moderate',
      assignedTo: input.assignedTo ?? null,
      createdBy: 'user',
      parentTaskId: input.parentTaskId ?? null,
      subtaskIds: [],
      dependsOn: input.dependsOn ?? [],
      blocks: [],
      tags: input.tags ?? [],
      phase: input.phase ?? 'discovery',
      sessionId,
      storyPoints: input.storyPoints ?? null,
      artifacts: [],
      delegationChain: [],
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
      dueAt: input.dueAt ?? null,
      metadata: input.metadata ?? {},
    };

    this.tasks.set(task.id, task);

    // Persist to DB
    this.dbWrite(
      `INSERT INTO tasks (id, title, description, status, priority, complexity, assigned_agent, created_by, parent_task_id, depends_on, tags, phase, session_id, story_points, artifacts, delegation_chain, metadata, kanban_column, created_at, updated_at, started_at, completed_at, due_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
      [task.id, task.title, task.description, task.status, task.priority, task.complexity, task.assignedTo, task.createdBy, task.parentTaskId, JSON.stringify(task.dependsOn), JSON.stringify(task.tags), task.phase, task.sessionId, task.storyPoints, JSON.stringify(task.artifacts), JSON.stringify(task.delegationChain), JSON.stringify(task.metadata), task.status, task.createdAt, task.updatedAt, task.startedAt, task.completedAt, task.dueAt],
    );

    // Link to parent if specified
    if (input.parentTaskId) {
      const parent = this.tasks.get(input.parentTaskId);
      if (parent) {
        parent.subtaskIds.push(task.id);
        parent.updatedAt = now;
      }
    }

    // Update "blocks" references for dependencies
    for (const depId of task.dependsOn) {
      const dep = this.tasks.get(depId);
      if (dep) {
        dep.blocks.push(task.id);
        dep.updatedAt = now;
      }
    }

    this.emitTaskEvent('task:created', task, 'user');
    return task;
  }

  /**
   * Returns a task by ID.
   */
  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Returns all tasks, optionally filtered.
   */
  getTasks(filters?: {
    sessionId?: string;
    status?: TaskStatus;
    assignedTo?: AgentId;
    priority?: TaskPriority;
    phase?: string;
    tags?: string[];
  }): Task[] {
    let tasks = Array.from(this.tasks.values());

    if (filters?.sessionId) tasks = tasks.filter((t) => t.sessionId === filters.sessionId);
    if (filters?.status) tasks = tasks.filter((t) => t.status === filters.status);
    if (filters?.assignedTo) tasks = tasks.filter((t) => t.assignedTo === filters.assignedTo);
    if (filters?.priority) tasks = tasks.filter((t) => t.priority === filters.priority);
    if (filters?.phase) tasks = tasks.filter((t) => t.phase === filters.phase);
    if (filters?.tags) {
      tasks = tasks.filter((t) => filters.tags!.some((tag) => t.tags.includes(tag)));
    }

    return tasks;
  }

  /**
   * Updates a task with partial input.
   */
  updateTask(taskId: string, input: UpdateTaskInput, triggeredBy: AgentId | 'user' | 'system' = 'system'): Task | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    const previousStatus = task.status;

    // Apply updates
    if (input.title !== undefined) task.title = input.title;
    if (input.description !== undefined) task.description = input.description;
    if (input.priority !== undefined) task.priority = input.priority;
    if (input.complexity !== undefined) task.complexity = input.complexity;
    if (input.tags !== undefined) task.tags = input.tags;
    if (input.storyPoints !== undefined) task.storyPoints = input.storyPoints;
    if (input.dueAt !== undefined) task.dueAt = input.dueAt;
    if (input.metadata !== undefined) task.metadata = { ...task.metadata, ...input.metadata };

    // Handle status change separately (with validation)
    if (input.status !== undefined && input.status !== task.status) {
      const moved = this.moveTask(taskId, input.status, triggeredBy);
      if (!moved) {
        // Revert - status transition not allowed
        console.warn(`[TaskManager] Invalid transition from ${task.status} to ${input.status}`);
      }
    }

    // Handle assignment change
    if (input.assignedTo !== undefined) {
      task.assignedTo = input.assignedTo;
      if (input.assignedTo) {
        this.emitTaskEvent('task:assigned', task, triggeredBy);
      }
    }

    task.updatedAt = new Date().toISOString();

    // Persist to DB
    this.dbWrite(
      `UPDATE tasks SET title=$1, description=$2, priority=$3, complexity=$4, tags=$5, story_points=$6, due_at=$7, metadata=$8, assigned_agent=$9, updated_at=$10 WHERE id=$11`,
      [task.title, task.description, task.priority, task.complexity, JSON.stringify(task.tags), task.storyPoints, task.dueAt, JSON.stringify(task.metadata), task.assignedTo, task.updatedAt, task.id],
    );

    this.emitTaskEvent('task:updated', task, triggeredBy);
    return task;
  }

  /**
   * Adds an artifact key to a task's artifacts array.
   */
  addArtifact(taskId: string, artifactKey: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    task.artifacts.push(artifactKey);
    task.updatedAt = new Date().toISOString();
    this.dbWrite(
      `UPDATE tasks SET artifacts=$1, updated_at=$2 WHERE id=$3`,
      [JSON.stringify(task.artifacts), task.updatedAt, task.id],
    );
    this.emitTaskEvent('task:updated', task, 'system');
    return true;
  }

  /**
   * Deletes a task (use sparingly - prefer cancelling).
   */
  deleteTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    // Remove from parent's subtask list
    if (task.parentTaskId) {
      const parent = this.tasks.get(task.parentTaskId);
      if (parent) {
        parent.subtaskIds = parent.subtaskIds.filter((id) => id !== taskId);
      }
    }

    // Remove from dependency references
    for (const depId of task.dependsOn) {
      const dep = this.tasks.get(depId);
      if (dep) {
        dep.blocks = dep.blocks.filter((id) => id !== taskId);
      }
    }

    this.tasks.delete(taskId);
    this.dbWrite('DELETE FROM tasks WHERE id=$1', [taskId]);
    return true;
  }

  // =========================================================================
  // Kanban Operations
  // =========================================================================

  /**
   * Moves a task to a new Kanban column with validation.
   */
  moveTask(taskId: string, newStatus: TaskStatus, triggeredBy: AgentId | 'user' | 'system' = 'system'): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    // Validate transition
    const validTargets = VALID_TRANSITIONS[task.status];
    if (!validTargets.includes(newStatus)) {
      console.warn(
        `[TaskManager] Invalid transition: ${task.status} -> ${newStatus} for task ${taskId}`
      );
      return false;
    }

    // Check WIP limit
    const wipLimit = this.wipLimits.get(newStatus);
    if (wipLimit !== null && wipLimit !== undefined) {
      const currentCount = this.getTaskCountByStatus(newStatus, task.sessionId);
      if (currentCount >= wipLimit) {
        console.warn(
          `[TaskManager] WIP limit reached for column ${newStatus}: ${currentCount}/${wipLimit}`
        );
        return false;
      }
    }

    // Check dependencies (can't move to in-progress if dependencies aren't done)
    if (newStatus === 'in-progress') {
      for (const depId of task.dependsOn) {
        const dep = this.tasks.get(depId);
        if (dep && dep.status !== 'done') {
          console.warn(
            `[TaskManager] Cannot start task ${taskId}: dependency ${depId} is not done`
          );
          return false;
        }
      }
    }

    const previousStatus = task.status;
    task.status = newStatus;
    task.updatedAt = new Date().toISOString();

    // Set timestamps based on status
    if (newStatus === 'in-progress' && !task.startedAt) {
      task.startedAt = task.updatedAt;
    }
    if (newStatus === 'done') {
      task.completedAt = task.updatedAt;
    }

    // Persist to DB
    this.dbWrite(
      `UPDATE tasks SET status=$1, kanban_column=$2, updated_at=$3, started_at=$4, completed_at=$5 WHERE id=$6`,
      [task.status, task.status, task.updatedAt, task.startedAt, task.completedAt, task.id],
    );

    this.emitTaskEvent('task:moved', task, triggeredBy, previousStatus);

    if (newStatus === 'done') {
      this.emitTaskEvent('task:completed', task, triggeredBy, previousStatus);
    }
    if (newStatus === 'cancelled') {
      this.emitTaskEvent('task:cancelled', task, triggeredBy, previousStatus);
    }

    return true;
  }

  /**
   * Assigns a task to an agent.
   */
  assignTask(taskId: string, agentId: AgentId, triggeredBy: AgentId | 'user' | 'system' = 'system'): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    task.assignedTo = agentId;
    task.updatedAt = new Date().toISOString();

    // Persist to DB
    this.dbWrite(
      `UPDATE tasks SET assigned_agent=$1, updated_at=$2 WHERE id=$3`,
      [agentId, task.updatedAt, task.id],
    );

    this.emitTaskEvent('task:assigned', task, triggeredBy);
    return true;
  }

  /**
   * Returns the full Kanban board for a session.
   */
  getKanbanBoard(sessionId: string): KanbanBoard {
    const columns: KanbanColumn[] = KANBAN_COLUMNS.map((col) => ({
      id: col.id,
      label: col.label,
      tasks: this.getTasks({ sessionId, status: col.id }).sort(
        (a, b) => this.priorityOrder(a.priority) - this.priorityOrder(b.priority)
      ),
      wipLimit: this.wipLimits.get(col.id) ?? col.wipLimit,
    }));

    const totalTasks = columns.reduce((sum, col) => sum + col.tasks.length, 0);

    return {
      sessionId,
      columns,
      totalTasks,
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Sets a custom WIP limit for a column.
   */
  setWipLimit(status: TaskStatus, limit: number | null): void {
    this.wipLimits.set(status, limit);
  }

  /**
   * Returns count of tasks in a specific status for a session.
   */
  private getTaskCountByStatus(status: TaskStatus, sessionId: string): number {
    return Array.from(this.tasks.values()).filter(
      (t) => t.status === status && t.sessionId === sessionId
    ).length;
  }

  // =========================================================================
  // Bulk Operations
  // =========================================================================

  /**
   * Creates subtasks for a parent task.
   */
  createSubtasks(parentTaskId: string, subtasks: CreateTaskInput[], sessionId: string): Task[] {
    const parent = this.tasks.get(parentTaskId);
    if (!parent) return [];

    return subtasks.map((input) =>
      this.createTask({ ...input, parentTaskId }, sessionId)
    );
  }

  /**
   * Returns tasks that are blocked (have unfinished dependencies).
   */
  getBlockedTasks(sessionId?: string): Task[] {
    return Array.from(this.tasks.values()).filter((task) => {
      if (sessionId && task.sessionId !== sessionId) return false;
      if (task.status === 'done' || task.status === 'cancelled') return false;

      return task.dependsOn.some((depId) => {
        const dep = this.tasks.get(depId);
        return dep && dep.status !== 'done';
      });
    });
  }

  /**
   * Returns tasks ready to be worked on (all dependencies met, in todo).
   */
  getReadyTasks(sessionId?: string): Task[] {
    return Array.from(this.tasks.values()).filter((task) => {
      if (sessionId && task.sessionId !== sessionId) return false;
      if (task.status !== 'todo') return false;

      return task.dependsOn.every((depId) => {
        const dep = this.tasks.get(depId);
        return dep && dep.status === 'done';
      });
    });
  }

  // =========================================================================
  // Statistics
  // =========================================================================

  /**
   * Returns task statistics for a session.
   */
  getStats(sessionId: string): {
    total: number;
    byStatus: Record<TaskStatus, number>;
    byPriority: Record<TaskPriority, number>;
    byAgent: Record<string, number>;
    completionRate: number;
    avgCycleTimeMs: number | null;
  } {
    const tasks = this.getTasks({ sessionId });
    const byStatus = {} as Record<TaskStatus, number>;
    const byPriority = {} as Record<TaskPriority, number>;
    const byAgent = {} as Record<string, number>;
    const cycleTimes: number[] = [];

    for (const task of tasks) {
      byStatus[task.status] = (byStatus[task.status] || 0) + 1;
      byPriority[task.priority] = (byPriority[task.priority] || 0) + 1;
      if (task.assignedTo) {
        byAgent[task.assignedTo] = (byAgent[task.assignedTo] || 0) + 1;
      }
      if (task.startedAt && task.completedAt) {
        const cycleTime = new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime();
        cycleTimes.push(cycleTime);
      }
    }

    const doneCount = byStatus['done'] || 0;
    const total = tasks.length;
    const completionRate = total > 0 ? doneCount / total : 0;
    const avgCycleTimeMs = cycleTimes.length > 0
      ? cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length
      : null;

    return { total, byStatus, byPriority, byAgent, completionRate, avgCycleTimeMs };
  }

  // =========================================================================
  // Internal Helpers
  // =========================================================================

  /**
   * Returns a numeric priority order for sorting (lower = higher priority).
   */
  private priorityOrder(priority: TaskPriority): number {
    const order: Record<TaskPriority, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    };
    return order[priority];
  }

  /**
   * Emits a typed task event.
   */
  private emitTaskEvent(
    type: keyof TaskManagerEvents,
    task: Task,
    triggeredBy: AgentId | 'user' | 'system',
    previousStatus?: TaskStatus
  ): void {
    const event: TaskEvent = {
      type: type.replace(':', '.') as TaskEvent['type'],
      taskId: task.id,
      sessionId: task.sessionId,
      timestamp: new Date().toISOString(),
      previousStatus,
      currentStatus: task.status,
      triggeredBy,
      data: {
        title: task.title,
        assignedTo: task.assignedTo,
        priority: task.priority,
      },
    };
    this.emit(type, event);
  }
}
