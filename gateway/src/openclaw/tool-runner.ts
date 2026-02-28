import type { OpenClawToolDef, OpenClawToolResult } from './types';

export class ToolRunner {
  private tools: Map<string, OpenClawToolDef> = new Map();

  registerTool(def: OpenClawToolDef): void {
    this.tools.set(def.name, def);
  }

  listTools(): OpenClawToolDef[] {
    return Array.from(this.tools.values());
  }

  async executeTool(
    name: string,
    input: Record<string, unknown>,
    _context: { sessionId?: string; agentId?: string },
  ): Promise<OpenClawToolResult> {
    const startedAt = new Date().toISOString();

    const result: OpenClawToolResult = {
      status: 'not-implemented',
      name,
      message: 'Tool execution will be connected in Phase 6',
      input,
      timing: {
        startedAt,
        completedAt: new Date().toISOString(),
      },
    };

    return result;
  }

  getToolSchema(name: string): Record<string, unknown> | null {
    const tool = this.tools.get(name);
    if (!tool) return null;
    return tool.inputSchema;
  }
}
