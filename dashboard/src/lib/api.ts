const API_BASE = typeof window !== 'undefined'
  ? 'http://localhost:18789'  // Browser always talks to localhost, not Docker-internal hostname
  : (process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:18789');

// Typed fetch wrapper
async function fetchAPI<T>(endpoint: string): Promise<T> {
  const res = await fetch(`${API_BASE}${endpoint}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

async function postAPI<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// --- Types matching gateway responses ---

export interface GatewayAgent {
  id: string;
  name: string;
  role: string;
  status: string;
  currentTaskId: string | null;
  tasksCompleted: number;
  tasksFailed: number;
  lastActiveAt: string;
}

export interface GatewayTask {
  id: string;
  title: string;
  description: string;
  status: string;          // "backlog", "todo", "in-progress", "review", "done"
  priority: string;
  complexity?: string;
  assignedTo: string | null;
  createdBy?: string;
  createdAt: string;
  updatedAt?: string;
  startedAt?: string | null;
  completedAt?: string | null;
  dueAt?: string | null;
  sessionId?: string;
  parentTaskId?: string | null;
  subtaskIds?: string[];
  dependsOn?: string[];
  blocks?: string[];
  tags?: string[];
  phase?: string | null;
  storyPoints?: number | null;
  artifacts?: string[];
  delegationChain?: string[];
  metadata?: Record<string, unknown>;
}

export interface GatewayKanbanColumn {
  id: string;
  title: string;
  tasks: GatewayTask[];
}

export interface HealthResponse {
  status: string;
  uptime: number;
  services: {
    sessions: unknown;
    agents: unknown;
    connections: unknown;
    voice: unknown;
    viadp: unknown;
    costs: unknown;
  };
}

export interface ModelAssignment {
  agentId?: string;
  primary: string;
  fallback: string;
}

export interface CostsResponse {
  summary: {
    totalCost: number;
    totalRequests: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    perAgent: Record<string, { cost: number; requests: number; tokens: number }>;
    perModel: Record<string, { cost: number; requests: number }>;
    perProvider: Record<string, { cost: number; requests: number }>;
    perTier: Record<string, { cost: number; requests: number }>;
  };
}

export interface ViadpSummary {
  summary: {
    totalRequests: number;
    activeRequests: number;
    [key: string]: unknown;
  };
}

export interface ViadpDelegation {
  id: string;
  delegator: string;
  delegatee: string;
  task: string;
  taskAr?: string;
  trustScore: number;
  status: string;
  timestamp: string;
  proofChain: string[];
}

export interface ViadpTrust {
  trust: {
    score: number;
    alpha: number;
    beta: number;
    history: unknown[];
  };
}

export interface ViadpAuditEntry {
  id: string;
  [key: string]: unknown;
}

export interface ConnectionsResponse {
  connections: {
    total: number;
    users: number;
    agents: number;
    dashboards: number;
  };
}

// --- API functions ---

export async function fetchHealth(): Promise<HealthResponse> {
  return fetchAPI<HealthResponse>('/health');
}

export async function fetchAgents(): Promise<{ agents: GatewayAgent[] }> {
  return fetchAPI<{ agents: GatewayAgent[] }>('/api/agents');
}

export async function fetchAgent(agentId: string) {
  return fetchAPI<{ agent: GatewayAgent & Record<string, unknown> }>(`/api/agents/${agentId}`);
}

export async function fetchTasks(sessionId?: string): Promise<{ tasks: GatewayTask[] }> {
  const query = sessionId ? `?sessionId=${sessionId}` : '';
  return fetchAPI<{ tasks: GatewayTask[] }>(`/api/tasks${query}`);
}

export async function fetchKanban(sessionId: string): Promise<{ board: { columns: GatewayKanbanColumn[] } }> {
  return fetchAPI<{ board: { columns: GatewayKanbanColumn[] } }>(`/api/kanban/${sessionId}`);
}

export async function createTask(data: {
  sessionId: string;
  title: string;
  description: string;
  priority: string;
  assignedTo?: string;
}) {
  return postAPI('/api/tasks', data);
}

export async function updateTask(taskId: string, updates: Partial<{status: string; column: string; assignedTo: string; priority: string}>): Promise<void> {
  const res = await fetch(`${API_BASE}/api/tasks/${taskId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    console.warn('Failed to update task:', res.status);
  }
}

export async function fetchTaskStats(sessionId: string) {
  return fetchAPI<{
    stats: { total: number; completed: number; completionRate: number; [key: string]: unknown };
  }>(`/api/tasks/stats/${sessionId}`);
}

export async function fetchModelAssignments(): Promise<{
  assignments: Record<string, ModelAssignment>;
}> {
  return fetchAPI<{ assignments: Record<string, ModelAssignment> }>('/api/models/assignments');
}

export async function fetchModelCosts(agentId?: string): Promise<CostsResponse> {
  const query = agentId ? `?agentId=${agentId}` : '';
  return fetchAPI<CostsResponse>(`/api/models/costs${query}`);
}

export async function fetchViadpSummary(): Promise<ViadpSummary> {
  return fetchAPI<ViadpSummary>('/api/viadp/summary');
}

export async function fetchViadpDelegations(agentId?: string): Promise<{ delegations: ViadpDelegation[] }> {
  const query = agentId ? `?agentId=${agentId}` : '';
  return fetchAPI<{ delegations: ViadpDelegation[] }>(`/api/viadp/delegations${query}`);
}

export async function fetchViadpTrust(agentId: string): Promise<ViadpTrust> {
  return fetchAPI<ViadpTrust>(`/api/viadp/trust/${agentId}`);
}

export async function fetchViadpAudit(limit?: number): Promise<{ entries: ViadpAuditEntry[] }> {
  const query = limit ? `?limit=${limit}` : '';
  return fetchAPI<{ entries: ViadpAuditEntry[] }>(`/api/viadp/audit${query}`);
}

export async function fetchSessions(): Promise<{ sessions: unknown[] }> {
  return fetchAPI<{ sessions: unknown[] }>('/api/sessions');
}

export async function createSession(data: Record<string, unknown>) {
  return postAPI('/api/sessions', data);
}

export async function fetchConnections(): Promise<ConnectionsResponse> {
  return fetchAPI<ConnectionsResponse>('/api/connections');
}

// --- Voice API ---

export async function fetchVoiceStatus(): Promise<{
  status: {
    activeTranscriptions: number;
    activeSyntheses: number;
    configured: { stt: boolean; tts: boolean };
    arabicEnabled: boolean;
  };
}> {
  return fetchAPI('/api/voice/status');
}

export async function transcribeAudio(
  audioBase64: string,
  language: string = 'en'
): Promise<{
  result: {
    id: string;
    text: string;
    language: string;
    confidence: number;
    durationMs: number;
    words?: Array<{ word: string; start: number; end: number }>;
  };
}> {
  return postAPI('/api/voice/transcribe', { audioBase64, language });
}

export async function synthesizeText(
  text: string,
  language: string = 'en'
): Promise<{
  result: {
    id: string;
    audioBase64: string;
    mimeType: string;
    durationMs: number;
    language: string;
  };
}> {
  return postAPI('/api/voice/synthesize', { text, language });
}
