import type { AgentId } from '@forge-team/shared';

export type ToolCategory = 'code-execution' | 'git' | 'terminal' | 'ci' | 'browser' | 'api';

export interface ToolDefinition {
  name: string;
  description: string;
  category: ToolCategory;
  inputSchema: Record<string, unknown>;
  agentWhitelist: AgentId[];
  execute: (input: Record<string, unknown>, context: ToolExecutionContext) => Promise<ToolExecutionResult>;
}

export interface ToolExecutionContext {
  agentId: AgentId;
  sessionId: string;
  taskId: string | null;
  workingDir: string;
  timeout: number;
}

export interface ToolExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  artifacts: string[];
  duration: number;
  containerId?: string;
}

export interface SandboxConfig {
  image: string;
  memoryLimit: string;
  cpuLimit: number;
  networkMode: 'none' | 'forgeteam-network' | 'forgeteam-sandbox';
  timeoutMs: number;
  volumeMounts: string[];
  workingDir: string;
}
