"use strict";
/**
 * Kanban Task Manager for the ForgeTeam Gateway.
 *
 * Provides CRUD operations on tasks, Kanban board management,
 * WIP limits, task assignment, and real-time updates via events.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskManager = void 0;
const eventemitter3_1 = require("eventemitter3");
const uuid_1 = require("uuid");
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
/** Kanban column definitions with default WIP limits */
const KANBAN_COLUMNS = [
    { id: 'backlog', label: 'Backlog', wipLimit: null },
    { id: 'todo', label: 'To Do', wipLimit: 20 },
    { id: 'in-progress', label: 'In Progress', wipLimit: 10 },
    { id: 'review', label: 'Review', wipLimit: 8 },
    { id: 'done', label: 'Done', wipLimit: null },
    { id: 'cancelled', label: 'Cancelled', wipLimit: null },
];
/** Valid status transitions for tasks */
const VALID_TRANSITIONS = {
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
class TaskManager extends eventemitter3_1.EventEmitter {
    tasks = new Map();
    /** Custom WIP limits (overridable per session) */
    wipLimits = new Map();
    constructor() {
        super();
        // Initialize default WIP limits
        for (const col of KANBAN_COLUMNS) {
            this.wipLimits.set(col.id, col.wipLimit);
        }
    }
    // =========================================================================
    // CRUD Operations
    // =========================================================================
    /**
     * Creates a new task and adds it to the backlog.
     */
    createTask(input, sessionId) {
        const now = new Date().toISOString();
        const task = {
            id: (0, uuid_1.v4)(),
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
    getTask(taskId) {
        return this.tasks.get(taskId);
    }
    /**
     * Returns all tasks, optionally filtered.
     */
    getTasks(filters) {
        let tasks = Array.from(this.tasks.values());
        if (filters?.sessionId)
            tasks = tasks.filter((t) => t.sessionId === filters.sessionId);
        if (filters?.status)
            tasks = tasks.filter((t) => t.status === filters.status);
        if (filters?.assignedTo)
            tasks = tasks.filter((t) => t.assignedTo === filters.assignedTo);
        if (filters?.priority)
            tasks = tasks.filter((t) => t.priority === filters.priority);
        if (filters?.phase)
            tasks = tasks.filter((t) => t.phase === filters.phase);
        if (filters?.tags) {
            tasks = tasks.filter((t) => filters.tags.some((tag) => t.tags.includes(tag)));
        }
        return tasks;
    }
    /**
     * Updates a task with partial input.
     */
    updateTask(taskId, input, triggeredBy = 'system') {
        const task = this.tasks.get(taskId);
        if (!task)
            return null;
        const previousStatus = task.status;
        // Apply updates
        if (input.title !== undefined)
            task.title = input.title;
        if (input.description !== undefined)
            task.description = input.description;
        if (input.priority !== undefined)
            task.priority = input.priority;
        if (input.complexity !== undefined)
            task.complexity = input.complexity;
        if (input.tags !== undefined)
            task.tags = input.tags;
        if (input.storyPoints !== undefined)
            task.storyPoints = input.storyPoints;
        if (input.dueAt !== undefined)
            task.dueAt = input.dueAt;
        if (input.metadata !== undefined)
            task.metadata = { ...task.metadata, ...input.metadata };
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
        this.emitTaskEvent('task:updated', task, triggeredBy);
        return task;
    }
    /**
     * Deletes a task (use sparingly - prefer cancelling).
     */
    deleteTask(taskId) {
        const task = this.tasks.get(taskId);
        if (!task)
            return false;
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
        return true;
    }
    // =========================================================================
    // Kanban Operations
    // =========================================================================
    /**
     * Moves a task to a new Kanban column with validation.
     */
    moveTask(taskId, newStatus, triggeredBy = 'system') {
        const task = this.tasks.get(taskId);
        if (!task)
            return false;
        // Validate transition
        const validTargets = VALID_TRANSITIONS[task.status];
        if (!validTargets.includes(newStatus)) {
            console.warn(`[TaskManager] Invalid transition: ${task.status} -> ${newStatus} for task ${taskId}`);
            return false;
        }
        // Check WIP limit
        const wipLimit = this.wipLimits.get(newStatus);
        if (wipLimit !== null && wipLimit !== undefined) {
            const currentCount = this.getTaskCountByStatus(newStatus, task.sessionId);
            if (currentCount >= wipLimit) {
                console.warn(`[TaskManager] WIP limit reached for column ${newStatus}: ${currentCount}/${wipLimit}`);
                return false;
            }
        }
        // Check dependencies (can't move to in-progress if dependencies aren't done)
        if (newStatus === 'in-progress') {
            for (const depId of task.dependsOn) {
                const dep = this.tasks.get(depId);
                if (dep && dep.status !== 'done') {
                    console.warn(`[TaskManager] Cannot start task ${taskId}: dependency ${depId} is not done`);
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
    assignTask(taskId, agentId, triggeredBy = 'system') {
        const task = this.tasks.get(taskId);
        if (!task)
            return false;
        task.assignedTo = agentId;
        task.updatedAt = new Date().toISOString();
        this.emitTaskEvent('task:assigned', task, triggeredBy);
        return true;
    }
    /**
     * Returns the full Kanban board for a session.
     */
    getKanbanBoard(sessionId) {
        const columns = KANBAN_COLUMNS.map((col) => ({
            id: col.id,
            label: col.label,
            tasks: this.getTasks({ sessionId, status: col.id }).sort((a, b) => this.priorityOrder(a.priority) - this.priorityOrder(b.priority)),
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
    setWipLimit(status, limit) {
        this.wipLimits.set(status, limit);
    }
    /**
     * Returns count of tasks in a specific status for a session.
     */
    getTaskCountByStatus(status, sessionId) {
        return Array.from(this.tasks.values()).filter((t) => t.status === status && t.sessionId === sessionId).length;
    }
    // =========================================================================
    // Bulk Operations
    // =========================================================================
    /**
     * Creates subtasks for a parent task.
     */
    createSubtasks(parentTaskId, subtasks, sessionId) {
        const parent = this.tasks.get(parentTaskId);
        if (!parent)
            return [];
        return subtasks.map((input) => this.createTask({ ...input, parentTaskId }, sessionId));
    }
    /**
     * Returns tasks that are blocked (have unfinished dependencies).
     */
    getBlockedTasks(sessionId) {
        return Array.from(this.tasks.values()).filter((task) => {
            if (sessionId && task.sessionId !== sessionId)
                return false;
            if (task.status === 'done' || task.status === 'cancelled')
                return false;
            return task.dependsOn.some((depId) => {
                const dep = this.tasks.get(depId);
                return dep && dep.status !== 'done';
            });
        });
    }
    /**
     * Returns tasks ready to be worked on (all dependencies met, in todo).
     */
    getReadyTasks(sessionId) {
        return Array.from(this.tasks.values()).filter((task) => {
            if (sessionId && task.sessionId !== sessionId)
                return false;
            if (task.status !== 'todo')
                return false;
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
    getStats(sessionId) {
        const tasks = this.getTasks({ sessionId });
        const byStatus = {};
        const byPriority = {};
        const byAgent = {};
        const cycleTimes = [];
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
    priorityOrder(priority) {
        const order = {
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
    emitTaskEvent(type, task, triggeredBy, previousStatus) {
        const event = {
            type: type.replace(':', '.'),
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
exports.TaskManager = TaskManager;
//# sourceMappingURL=task-manager.js.map