import type { AuthRole } from './auth';

type Permission =
  | 'session.create' | 'session.join' | 'session.leave' | 'session.list' | 'session.destroy'
  | 'chat.message'
  | 'agent.status' | 'agent.list' | 'agent.send'
  | 'task.create' | 'task.update' | 'task.move' | 'task.assign' | 'task.list'
  | 'kanban.board'
  | 'delegation.request' | 'delegation.accept' | 'delegation.reject'
  | 'model.route' | 'model.assignments' | 'model.costs'
  | 'voice.status' | 'voice.transcribe' | 'voice.synthesize' | 'voice.languages'
  | 'tool.list' | 'tool.execute'
  | 'workflow.list' | 'workflow.start' | 'workflow.pause' | 'workflow.resume' | 'workflow.progress' | 'workflow.cancel'
  | 'openclaw.agent.register' | 'openclaw.agent.heartbeat' | 'openclaw.agent.capabilities' | 'openclaw.tool.list' | 'openclaw.tool.execute'
  | 'ping'
  | '*';

const ROLE_PERMISSIONS: Record<AuthRole, Permission[]> = {
  admin: ['*'],
  agent: [
    'session.join', 'session.leave', 'session.list',
    'chat.message',
    'agent.status', 'agent.list', 'agent.send',
    'task.update', 'task.list',
    'kanban.board',
    'delegation.request', 'delegation.accept', 'delegation.reject',
    'model.route', 'model.assignments',
    'tool.list', 'tool.execute',
    'openclaw.agent.register', 'openclaw.agent.heartbeat', 'openclaw.agent.capabilities',
    'openclaw.tool.list', 'openclaw.tool.execute',
    'workflow.list', 'workflow.progress',
    'voice.status', 'voice.transcribe', 'voice.synthesize', 'voice.languages',
    'ping',
  ],
  'dashboard-viewer': [
    'session.list',
    'agent.list',
    'task.list',
    'kanban.board',
    'model.assignments', 'model.costs',
    'voice.status',
    'tool.list',
    'workflow.list', 'workflow.progress',
    'ping',
  ],
};

export function hasPermission(role: AuthRole | undefined, messageType: string): boolean {
  if (!role) return false;
  const perms = ROLE_PERMISSIONS[role];
  if (!perms) return false;
  if (perms.includes('*')) return true;
  return perms.includes(messageType as Permission);
}
