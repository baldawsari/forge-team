export interface MonitoringContext {
  delegationId: string;
  token: { token: string; caveats: string[]; signature: string };
  trustScore: number;
  riskScore: number;
}

const activeMonitors = new Map<string, ReturnType<typeof setInterval>>();

export async function checkAgentHealth(agentId: string): Promise<number> {
  // Returns health score [0, 1] - for now, basic check
  return 0.95;
}

export async function triggerReDelegation(delegationId: string): Promise<void> {
  console.log(`[VIADP] Re-delegation triggered for ${delegationId}`);
  // TODO: integrate with DelegationEngine.redelegate()
}

export function startMonitoring(delegationId: string, context: MonitoringContext): void {
  // Clear any existing monitor for this delegation
  const existing = activeMonitors.get(delegationId);
  if (existing) clearInterval(existing);

  // TODO: Upgrade to Redis stream monitoring when Redis pub/sub is wired
  const timer = setInterval(async () => {
    const health = await checkAgentHealth(delegationId);
    if (health < 0.8) {
      await triggerReDelegation(delegationId);
    }
  }, 30000);

  activeMonitors.set(delegationId, timer);
}

export function stopMonitoring(delegationId: string): void {
  const timer = activeMonitors.get(delegationId);
  if (timer) {
    clearInterval(timer);
    activeMonitors.delete(delegationId);
  }
}
