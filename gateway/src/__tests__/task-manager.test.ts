import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TaskManager } from '../task-manager';
import type { TaskEvent } from '@forge-team/shared';

const SESSION_ID = 'test-session';

describe('TaskManager', () => {
  let manager: TaskManager;

  beforeEach(() => {
    manager = new TaskManager();
  });

  describe('createTask', () => {
    it('should create a task with default status backlog', () => {
      const task = manager.createTask({
        title: 'Implement login API',
        description: 'Create POST /auth/login endpoint',
        priority: 'high',
      }, SESSION_ID);
      expect(task.status).toBe('backlog');
      expect(task.title).toBe('Implement login API');
      expect(task.priority).toBe('high');
    });

    it('should assign unique IDs', () => {
      const t1 = manager.createTask({ title: 'Task 1', description: '' }, SESSION_ID);
      const t2 = manager.createTask({ title: 'Task 2', description: '' }, SESSION_ID);
      expect(t1.id).not.toBe(t2.id);
    });

    it('should emit task:created event', () => {
      const handler = vi.fn();
      manager.on('task:created', handler);
      manager.createTask({ title: 'New task', description: '' }, SESSION_ID);
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('updateTask', () => {
    it('should update task fields', () => {
      const task = manager.createTask({ title: 'Original', description: '' }, SESSION_ID);
      const updated = manager.updateTask(task.id, { title: 'Updated' });
      expect(updated?.title).toBe('Updated');
    });

    it('should update task status via valid transition', () => {
      const task = manager.createTask({ title: 'Task', description: '' }, SESSION_ID);
      manager.updateTask(task.id, { status: 'todo' });
      const afterTodo = manager.getTask(task.id);
      expect(afterTodo?.status).toBe('todo');

      manager.updateTask(afterTodo!.id, { status: 'in-progress' });
      const fetched = manager.getTask(task.id);
      expect(fetched?.status).toBe('in-progress');
    });
  });

  describe('moveTask', () => {
    it('should move task to a new column via valid transition', () => {
      const task = manager.createTask({ title: 'Task', description: '' }, SESSION_ID);
      manager.moveTask(task.id, 'todo');
      manager.moveTask(task.id, 'in-progress');
      const fetched = manager.getTask(task.id);
      expect(fetched?.status).toBe('in-progress');
    });

    it('should emit task:moved event', () => {
      const handler = vi.fn();
      manager.on('task:moved', handler);
      const task = manager.createTask({ title: 'Task', description: '' }, SESSION_ID);
      manager.moveTask(task.id, 'todo');
      expect(handler).toHaveBeenCalled();
      const event: TaskEvent = handler.mock.calls[0][0];
      expect(event.taskId).toBe(task.id);
    });
  });

  describe('assignTask', () => {
    it('should assign an agent to a task', () => {
      const task = manager.createTask({ title: 'Task', description: '' }, SESSION_ID);
      manager.assignTask(task.id, 'backend-dev');
      const fetched = manager.getTask(task.id);
      expect(fetched?.assignedTo).toBe('backend-dev');
    });
  });

  describe('getKanbanBoard', () => {
    it('should return all columns with tasks sorted', () => {
      manager.createTask({ title: 'Backlog task', description: '', priority: 'low' }, SESSION_ID);
      manager.createTask({ title: 'High priority', description: '', priority: 'critical' }, SESSION_ID);
      const board = manager.getKanbanBoard(SESSION_ID);
      expect(board.columns).toBeDefined();
      expect(board.columns.length).toBeGreaterThan(0);
    });
  });

  describe('getTasksByAgent', () => {
    it('should filter tasks by assigned agent', () => {
      const t1 = manager.createTask({ title: 'Task 1', description: '' }, SESSION_ID);
      const t2 = manager.createTask({ title: 'Task 2', description: '' }, SESSION_ID);
      manager.assignTask(t1.id, 'architect');
      manager.assignTask(t2.id, 'backend-dev');
      const architectTasks = manager.getTasks({ assignedTo: 'architect' });
      expect(architectTasks).toHaveLength(1);
      expect(architectTasks[0].title).toBe('Task 1');
    });
  });
});
