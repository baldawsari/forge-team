import type { AgentId, AgentConfig, AgentStatus, AgentMessage } from '@forge-team/shared';

// ---------------------------------------------------------------------------
// OpenClaw Core Types
// ---------------------------------------------------------------------------

export type OpenClawLifecycleEvent =
  | 'agent-joined'
  | 'agent-left'
  | 'session-paused'
  | 'session-resumed';

export type MessageBusChannel =
  | `session:${string}`
  | `agent:${string}`
  | 'dashboard'
  | 'system';

export interface OpenClawToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handlerRef: string;
}

export interface OpenClawToolResult {
  status: 'ok' | 'error' | 'not-implemented';
  name: string;
  output?: unknown;
  error?: string;
  message?: string;
  input?: Record<string, unknown>;
  timing: {
    startedAt: string;
    completedAt: string;
  };
}

export interface OpenClawAgentRecord {
  agentId: string;
  capabilities: string[];
  config?: AgentConfig;
  status: AgentStatus;
  lastHeartbeat: string;
}

export interface OpenClawMessage {
  type: string;
  payload: unknown;
  timestamp: string;
  sessionId: string;
  source?: string;
}

export interface OpenClawSessionData {
  id: string;
  agents: Map<string, { agentId: string; capabilities: string[] }>;
  tools: OpenClawToolDef[];
  lifecycleHandlers: Map<OpenClawLifecycleEvent, Set<Function>>;
}
