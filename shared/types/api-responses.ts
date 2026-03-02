/**
 * API Response wrapper types for ForgeTeam REST endpoints.
 * These define the exact shape of every JSON response so that
 * both the gateway (producer) and the dashboard (consumer) agree.
 */

import type { AgentId, AgentConfig, AgentState, AgentStatus } from './agent';
import type { Task, TaskStatus, TaskPriority, KanbanColumn } from './task';
import type { DelegationRequest, TrustScore, DelegationAuditEntry } from './viadp';
import type { ModelConfig, CostSummary, AgentModelAssignment } from './models';

// ---------------------------------------------------------------------------
// Agent endpoints
// ---------------------------------------------------------------------------

/** GET /api/agents */
export interface AgentsResponse {
  agents: AgentSummary[];
  timestamp: string;
}

/** Summary shape returned by agentManager.getAgentSummary() */
export interface AgentSummary {
  id: AgentId;
  name: string;
  role: string;
  status: AgentStatus;
  currentTaskId: string | null;
  tasksCompleted: number;
  tasksFailed: number;
  lastActiveAt: string;
}

/** GET /api/agents/:agentId */
export interface AgentDetailResponse {
  config: AgentConfig;
  state: AgentState;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Task endpoints
// ---------------------------------------------------------------------------

/** GET /api/tasks */
export interface TasksResponse {
  tasks: Task[];
  timestamp: string;
}

/** GET /api/kanban/:sessionId */
export interface KanbanResponse {
  board: {
    sessionId: string;
    columns: KanbanColumn[];
    totalTasks: number;
    lastUpdated: string;
  };
  timestamp: string;
}

/** GET /api/tasks/stats/:sessionId */
export interface TaskStatsResponse {
  stats: {
    total: number;
    completed: number;
    completionRate: number;
    byStatus: Record<TaskStatus, number>;
    byPriority: Record<TaskPriority, number>;
  };
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Model / cost endpoints
// ---------------------------------------------------------------------------

/** GET /api/models/assignments */
export interface ModelAssignmentsResponse {
  assignments: Record<string, AgentModelAssignment>;
  timestamp: string;
}

/** GET /api/models/costs */
export interface ModelCostsResponse {
  summary: CostSummary;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// VIADP endpoints
// ---------------------------------------------------------------------------

/** GET /api/viadp/delegations */
export interface ViadpDelegationsResponse {
  delegations: DelegationRequest[];
  timestamp: string;
}

/** GET /api/viadp/trust/:agentId */
export interface ViadpTrustResponse {
  agentId: AgentId;
  scores: TrustScore[];
  timestamp: string;
}

/** GET /api/viadp/audit */
export interface ViadpAuditResponse {
  entries: DelegationAuditEntry[];
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Connection endpoint
// ---------------------------------------------------------------------------

/** GET /api/connections */
export interface ConnectionsResponse {
  stats: {
    total: number;
    users: number;
    agents: number;
    dashboards: number;
    connectedAgents: string[];
  };
  timestamp: string;
}
