import type { SessionManager } from '../session-manager';
import type { OpenClawToolDef, OpenClawLifecycleEvent } from './types';

export class OpenClawSession {
  private agents: Map<string, { agentId: string; capabilities: string[] }> = new Map();
  private tools: OpenClawToolDef[] = [];
  private lifecycleHandlers: Map<OpenClawLifecycleEvent, Set<Function>> = new Map();

  constructor(private sessionManager: SessionManager) {}

  registerAgent(agentId: string, capabilities: string[]): void {
    this.agents.set(agentId, { agentId, capabilities });
    this.fireLifecycle('agent-joined', agentId);
  }

  deregisterAgent(agentId: string): void {
    this.agents.delete(agentId);
    this.fireLifecycle('agent-left', agentId);
  }

  getActiveAgents(): Array<{ agentId: string; capabilities: string[] }> {
    return Array.from(this.agents.values());
  }

  addToolContext(tools: OpenClawToolDef[]): void {
    this.tools.push(...tools);
  }

  getToolContext(): OpenClawToolDef[] {
    return this.tools;
  }

  onLifecycle(
    event: OpenClawLifecycleEvent,
    handler: Function,
  ): () => void {
    let handlers = this.lifecycleHandlers.get(event);
    if (!handlers) {
      handlers = new Set();
      this.lifecycleHandlers.set(event, handlers);
    }
    handlers.add(handler);

    return () => {
      handlers!.delete(handler);
    };
  }

  private fireLifecycle(event: OpenClawLifecycleEvent, ...args: unknown[]): void {
    const handlers = this.lifecycleHandlers.get(event);
    if (!handlers) return;
    for (const handler of handlers) {
      handler(...args);
    }
  }
}
