import type { AgentId } from '@forge-team/shared';
import type { ToolDefinition } from './types';

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  listForAgent(agentId: AgentId): ToolDefinition[] {
    const result: ToolDefinition[] = [];
    for (const tool of this.tools.values()) {
      if (tool.agentWhitelist.includes(agentId)) {
        result.push(tool);
      }
    }
    return result;
  }

  listAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  toAnthropicTools(agentId: AgentId): Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }> {
    return this.listForAgent(agentId).map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }));
  }

  toGeminiTools(agentId: AgentId): Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }> {
    return this.listForAgent(agentId).map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    }));
  }
}
