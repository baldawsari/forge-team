export interface MetricSample {
  delegationId: string;
  agentId: string;
  metric: string;
  value: number;
  timestamp: Date;
}

export interface AnomalyResult {
  isAnomaly: boolean;
  metric: string;
  value: number;
  zScore: number;
  mean: number;
  stdDev: number;
  threshold: number;
}

export interface MonitoringContext {
  delegationId: string;
  token: { token: string; caveats: string[]; signature: string };
  trustScore: number;
  riskScore: number;
}

const SLIDING_WINDOW_SIZE = 100;
const ANOMALY_CHECK_WINDOW = 20;
const DEFAULT_THRESHOLD = 2.5;

const metricStore = new Map<string, MetricSample[]>();
const anomalyHistory = new Map<string, boolean[]>();
const activeMonitors = new Map<string, ReturnType<typeof setInterval>>();

export function recordMetric(sample: MetricSample): void {
  const key = `${sample.agentId}:${sample.metric}`;
  const window = metricStore.get(key) ?? [];
  window.push(sample);
  if (window.length > SLIDING_WINDOW_SIZE) {
    window.shift();
  }
  metricStore.set(key, window);
}

function getAdaptiveThreshold(agentId: string): number {
  const history = anomalyHistory.get(agentId) ?? [];
  if (history.length < ANOMALY_CHECK_WINDOW) return DEFAULT_THRESHOLD;

  const recent = history.slice(-ANOMALY_CHECK_WINDOW);
  const anomalyRate = recent.filter(Boolean).length / recent.length;

  if (anomalyRate > 0.3) return 3.0;
  if (anomalyRate < 0.05) return 2.0;
  return DEFAULT_THRESHOLD;
}

export function detectAnomaly(agentId: string, metric: string, value: number): AnomalyResult {
  const key = `${agentId}:${metric}`;
  const window = metricStore.get(key) ?? [];

  if (window.length < 2) {
    return {
      isAnomaly: false,
      metric,
      value,
      zScore: 0,
      mean: value,
      stdDev: 0,
      threshold: DEFAULT_THRESHOLD,
    };
  }

  const values = window.map(s => s.value);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) {
    return { isAnomaly: false, metric, value, zScore: 0, mean, stdDev: 0, threshold: DEFAULT_THRESHOLD };
  }

  const zScore = (value - mean) / stdDev;
  const threshold = getAdaptiveThreshold(agentId);
  const isAnomaly = Math.abs(zScore) > threshold;

  const history = anomalyHistory.get(agentId) ?? [];
  history.push(isAnomaly);
  if (history.length > ANOMALY_CHECK_WINDOW) {
    history.shift();
  }
  anomalyHistory.set(agentId, history);

  return { isAnomaly, metric, value, zScore, mean, stdDev, threshold };
}

export async function checkAgentHealth(agentId: string): Promise<number> {
  const metrics = ['response_time_ms', 'error_rate', 'progress_rate'];
  let totalScore = 0;
  let metricCount = 0;

  for (const metric of metrics) {
    const window = metricStore.get(`${agentId}:${metric}`);
    if (!window || window.length === 0) continue;

    const recent = window.slice(-10);
    const avgRecent = recent.reduce((s, v) => s + v.value, 0) / recent.length;

    let score: number;
    if (metric === 'error_rate') {
      score = Math.max(0, 1 - avgRecent);
    } else if (metric === 'response_time_ms') {
      score = Math.max(0, 1 - avgRecent / 60000);
    } else {
      score = Math.min(1, avgRecent);
    }

    totalScore += score;
    metricCount++;
  }

  return metricCount > 0 ? totalScore / metricCount : 0.5;
}

export async function triggerReDelegation(delegationId: string): Promise<void> {
  console.log(`[VIADP] Re-delegation triggered for ${delegationId}`);
}

export function startMonitoring(delegationId: string, context: MonitoringContext): void {
  const existing = activeMonitors.get(delegationId);
  if (existing) clearInterval(existing);

  const timer = setInterval(async () => {
    const health = await checkAgentHealth(delegationId);

    recordMetric({
      delegationId,
      agentId: delegationId,
      metric: 'progress_rate',
      value: health,
      timestamp: new Date(),
    });

    const anomaly = detectAnomaly(delegationId, 'progress_rate', health);
    if (anomaly.isAnomaly) {
      console.log(`[VIADP] Anomaly detected for ${delegationId}: z=${anomaly.zScore.toFixed(2)}, threshold=${anomaly.threshold}`);
    }

    if (health < 0.3) {
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
