/**
 * Kanban Task Manager for the ForgeTeam Gateway.
 *
 * Provides CRUD operations on tasks, Kanban board management,
 * WIP limits, task assignment, and real-time updates via events.
 */
import { EventEmitter } from 'eventemitter3';
import type { AgentId, Task, TaskStatus, TaskPriority, CreateTaskInput, UpdateTaskInput, KanbanBoard, TaskEvent } from '@forge-team/shared';
export interface TaskManagerEvents {
    'task:created': (event: TaskEvent) => void;
    'task:updated': (event: TaskEvent) => void;
    'task:moved': (event: TaskEvent) => void;
    'task:assigned': (event: TaskEvent) => void;
    'task:completed': (event: TaskEvent) => void;
    'task:cancelled': (event: TaskEvent) => void;
}
export declare class TaskManager extends EventEmitter<TaskManagerEvents> {
    private tasks;
    /** Custom WIP limits (overridable per session) */
    private wipLimits;
    constructor();
    /**
     * Creates a new task and adds it to the backlog.
     */
    createTask(input: CreateTaskInput, sessionId: string): Task;
    /**
     * Returns a task by ID.
     */
    getTask(taskId: string): Task | undefined;
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
    }): Task[];
    /**
     * Updates a task with partial input.
     */
    updateTask(taskId: string, input: UpdateTaskInput, triggeredBy?: AgentId | 'user' | 'system'): Task | null;
    /**
     * Deletes a task (use sparingly - prefer cancelling).
     */
    deleteTask(taskId: string): boolean;
    /**
     * Moves a task to a new Kanban column with validation.
     */
    moveTask(taskId: string, newStatus: TaskStatus, triggeredBy?: AgentId | 'user' | 'system'): boolean;
    /**
     * Assigns a task to an agent.
     */
    assignTask(taskId: string, agentId: AgentId, triggeredBy?: AgentId | 'user' | 'system'): boolean;
    /**
     * Returns the full Kanban board for a session.
     */
    getKanbanBoard(sessionId: string): KanbanBoard;
    /**
     * Sets a custom WIP limit for a column.
     */
    setWipLimit(status: TaskStatus, limit: number | null): void;
    /**
     * Returns count of tasks in a specific status for a session.
     */
    private getTaskCountByStatus;
    /**
     * Creates subtasks for a parent task.
     */
    createSubtasks(parentTaskId: string, subtasks: CreateTaskInput[], sessionId: string): Task[];
    /**
     * Returns tasks that are blocked (have unfinished dependencies).
     */
    getBlockedTasks(sessionId?: string): Task[];
    /**
     * Returns tasks ready to be worked on (all dependencies met, in todo).
     */
    getReadyTasks(sessionId?: string): Task[];
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
    };
    /**
     * Returns a numeric priority order for sorting (lower = higher priority).
     */
    private priorityOrder;
    /**
     * Emits a typed task event.
     */
    private emitTaskEvent;
}
//# sourceMappingURL=task-manager.d.ts.map