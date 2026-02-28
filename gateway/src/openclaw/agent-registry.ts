import type { AgentManager } from '../agent-manager';

export class OpenClawAgentRegistry {
  private heartbeats: Map<string, string> = new Map();

  constructor(private agentManager: AgentManager) {}

  register(agentId: string, config: { capabilities: string[] }): void {
    this.heartbeats.set(agentId, new Date().toISOString());
    // Underlying AgentManager already holds agent configs loaded at startup.
    // This method records the heartbeat so the agent appears in getHealthy().
  }

  heartbeat(agentId: string): void {
    this.heartbeats.set(agentId, new Date().toISOString());
  }

  getCapabilities(agentId: string): string[] | null {
    const config = this.agentManager.getConfig(agentId as any);
    if (!config) return null;
    return config.capabilities;
  }

  findByCapability(capability: string): string[] {
    const matches: string[] = [];
    for (const config of this.agentManager.getAllConfigs()) {
      if (config.capabilities.includes(capability)) {
        matches.push(config.id);
      }
    }
    return matches;
  }

  getHealthy(timeoutMs: number = 60_000): Array<{ agentId: string; lastHeartbeat: string }> {
    const now = Date.now();
    const healthy: Array<{ agentId: string; lastHeartbeat: string }> = [];

    for (const [agentId, timestamp] of this.heartbeats) {
      if (now - new Date(timestamp).getTime() < timeoutMs) {
        healthy.push({ agentId, lastHeartbeat: timestamp });
      }
    }

    return healthy;
  }

  getAllWithCapabilities(): Array<{ agentId: string; capabilities: string[]; status: string }> {
    const result: Array<{ agentId: string; capabilities: string[]; status: string }> = [];
    for (const config of this.agentManager.getAllConfigs()) {
      const state = this.agentManager.getState(config.id);
      result.push({
        agentId: config.id,
        capabilities: config.capabilities,
        status: state?.status ?? 'offline',
      });
    }
    return result;
  }
}
