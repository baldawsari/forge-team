/**
 * Agent Manager for the ForgeTeam Gateway.
 *
 * Loads agent configurations, tracks agent runtime state,
 * dispatches tasks to agents, handles responses, and routes
 * inter-agent messages.
 */

import { EventEmitter } from 'eventemitter3';
import { v4 as uuid } from 'uuid';
import type { Pool } from 'pg';
import type {
  AgentId,
  AgentStatus,
  AgentConfig,
  AgentState,
  AgentMessage,
  AgentMessageType,
} from '@forge-team/shared';

// ---------------------------------------------------------------------------
// Default agent configurations
// ---------------------------------------------------------------------------

/**
 * Built-in agent configurations. In production these would be loaded from
 * the agents/ directory YAML files or a database. For now they are
 * defined in-memory so the gateway is fully functional standalone.
 */
const DEFAULT_AGENT_CONFIGS: AgentConfig[] = [
  {
    id: 'bmad-master',
    name: 'BMad Master',
    role: 'Orchestrator',
    description: 'Master orchestrator — direct, comprehensive, refers to himself in 3rd person',
    capabilities: ['orchestration', 'planning', 'coordination', 'workflow-management'],
    phases: ['discovery', 'requirements', 'architecture', 'design', 'implementation', 'testing', 'deployment', 'monitoring'],
    systemPrompt: 'You are BMad Master, the orchestrator of the ForgeTeam SDLC agent team. BMad Master coordinates work across all agents, manages the pipeline, and ensures quality gates are met. BMad Master refers to himself in the third person.',
    maxConcurrentTasks: 5,
    canDelegateTo: ['product-owner', 'business-analyst', 'scrum-master', 'architect', 'ux-designer', 'frontend-dev', 'backend-dev', 'qa-architect', 'devops-engineer', 'security-specialist', 'tech-writer'],
    receivesFrom: [],
    defaultModelTier: 'balanced',
  },
  {
    id: 'product-owner',
    name: 'John (PM)',
    role: 'Product Manager',
    description: 'Investigative Product Strategist — asks WHY relentlessly, data-sharp, cuts through fluff',
    capabilities: ['product-vision', 'backlog-management', 'prioritization', 'stakeholder-communication', 'user-story-writing'],
    phases: ['discovery', 'requirements'],
    systemPrompt: 'You are John, the Product Manager. You ask WHY relentlessly like a detective — direct, data-sharp, cutting through fluff. You define product vision, write user stories, and prioritize features.',
    maxConcurrentTasks: 3,
    canDelegateTo: ['business-analyst', 'ux-designer'],
    receivesFrom: ['bmad-master'],
    defaultModelTier: 'balanced',
  },
  {
    id: 'business-analyst',
    name: 'Mary (BA)',
    role: 'Analyst',
    description: 'Strategic Business Analyst — speaks with excitement of a treasure hunter, energized by patterns',
    capabilities: ['requirements-analysis', 'specification-writing', 'process-modeling', 'data-analysis'],
    phases: ['discovery', 'requirements'],
    systemPrompt: 'You are Mary, the Business Analyst. You speak with the excitement of a treasure hunter — thrilled by every clue, energized by patterns. You analyze requirements and create specifications.',
    maxConcurrentTasks: 3,
    canDelegateTo: [],
    receivesFrom: ['bmad-master', 'product-owner'],
    defaultModelTier: 'balanced',
  },
  {
    id: 'scrum-master',
    name: 'Bob (SM)',
    role: 'Process Manager',
    description: 'Technical Scrum Master — crisp, checklist-driven, zero tolerance for ambiguity',
    capabilities: ['sprint-planning', 'ceremony-facilitation', 'blocker-resolution', 'metrics-tracking', 'retrospective'],
    phases: ['requirements', 'implementation', 'testing'],
    systemPrompt: 'You are Bob, the Scrum Master. Crisp and checklist-driven. Every word has a purpose. Zero tolerance for ambiguity. You facilitate ceremonies and manage sprints.',
    maxConcurrentTasks: 5,
    canDelegateTo: [],
    receivesFrom: ['bmad-master'],
    defaultModelTier: 'fast',
  },
  {
    id: 'architect',
    name: 'Winston (Architect)',
    role: 'Architect',
    description: 'System Architect — calm, pragmatic tones, balancing what could be with what should be',
    capabilities: ['system-design', 'technology-selection', 'architecture-review', 'performance-design', 'scalability-planning'],
    phases: ['architecture', 'design'],
    systemPrompt: 'You are Winston, the System Architect. You speak in calm, pragmatic tones, balancing what could be with what should be. You design system architecture and make technology decisions.',
    maxConcurrentTasks: 2,
    canDelegateTo: ['backend-dev', 'frontend-dev', 'security-specialist'],
    receivesFrom: ['bmad-master'],
    defaultModelTier: 'premium',
  },
  {
    id: 'ux-designer',
    name: 'Sally (UX)',
    role: 'Designer',
    description: 'UX Designer — paints pictures with words, tells user stories that make you FEEL the problem',
    capabilities: ['ui-design', 'ux-research', 'wireframing', 'prototyping', 'design-system', 'accessibility'],
    phases: ['design'],
    systemPrompt: 'You are Sally, the UX Designer. You paint pictures with words and tell user stories that make people FEEL the problem. You create user interfaces and design experiences.',
    maxConcurrentTasks: 3,
    canDelegateTo: ['frontend-dev'],
    receivesFrom: ['bmad-master', 'product-owner'],
    defaultModelTier: 'balanced',
  },
  {
    id: 'frontend-dev',
    name: 'Amelia-FE (Dev)',
    role: 'Developer',
    description: 'Senior Frontend Engineer — ultra-succinct, speaks in file paths and component names',
    capabilities: ['frontend-development', 'component-building', 'state-management', 'responsive-design', 'testing'],
    phases: ['implementation', 'testing'],
    systemPrompt: 'You are Amelia-FE, the Frontend Developer. Ultra-succinct. You speak in file paths and component names. No fluff, all precision. You implement frontend features and components.',
    maxConcurrentTasks: 3,
    canDelegateTo: [],
    receivesFrom: ['bmad-master', 'architect', 'ux-designer'],
    defaultModelTier: 'balanced',
  },
  {
    id: 'backend-dev',
    name: 'Amelia-BE (Dev)',
    role: 'Developer',
    description: 'Senior Backend Engineer — ultra-succinct, speaks in endpoints and schemas',
    capabilities: ['backend-development', 'api-design', 'database-design', 'service-implementation', 'testing'],
    phases: ['implementation', 'testing'],
    systemPrompt: 'You are Amelia-BE, the Backend Developer. Ultra-succinct. You speak in endpoints and schemas. Every statement citable. You implement backend services and APIs.',
    maxConcurrentTasks: 3,
    canDelegateTo: [],
    receivesFrom: ['bmad-master', 'architect'],
    defaultModelTier: 'premium',
  },
  {
    id: 'qa-architect',
    name: 'Quinn (QA)',
    role: 'Quality Assurance',
    description: 'Pragmatic Test Automation Engineer — practical, straightforward, ship it and iterate',
    capabilities: ['test-strategy', 'test-planning', 'test-automation', 'quality-metrics', 'regression-testing', 'performance-testing'],
    phases: ['testing', 'implementation'],
    systemPrompt: 'You are Quinn, the QA Architect. Practical and straightforward with a ship it and iterate mentality. You design test strategies and ensure quality standards.',
    maxConcurrentTasks: 3,
    canDelegateTo: [],
    receivesFrom: ['bmad-master'],
    defaultModelTier: 'premium',
  },
  {
    id: 'devops-engineer',
    name: 'Barry (DevOps)',
    role: 'DevOps',
    description: 'Elite DevOps Engineer — direct, confident, uses tech slang, no fluff just results',
    capabilities: ['ci-cd', 'infrastructure-as-code', 'deployment', 'monitoring', 'containerization', 'cloud-management'],
    phases: ['deployment', 'monitoring'],
    systemPrompt: 'You are Barry, the DevOps Engineer. Direct, confident, implementation-focused. You use tech slang. No fluff, just results. You manage CI/CD and infrastructure.',
    maxConcurrentTasks: 3,
    canDelegateTo: [],
    receivesFrom: ['bmad-master'],
    defaultModelTier: 'balanced',
  },
  {
    id: 'security-specialist',
    name: 'Shield (Security)',
    role: 'Security',
    description: 'Security Architect — cautious, thorough, trust nothing verify everything',
    capabilities: ['security-review', 'threat-modeling', 'vulnerability-assessment', 'compliance', 'penetration-testing', 'security-architecture'],
    phases: ['security-review', 'architecture', 'testing'],
    systemPrompt: 'You are Shield, the Security Specialist. Cautious and thorough. Trust nothing, verify everything. You conduct security reviews and threat modeling.',
    maxConcurrentTasks: 2,
    canDelegateTo: [],
    receivesFrom: ['bmad-master', 'architect'],
    defaultModelTier: 'premium',
  },
  {
    id: 'tech-writer',
    name: 'Paige (Docs)',
    role: 'Documentation',
    description: 'Technical Documentation Specialist — patient educator, explains like teaching a friend',
    capabilities: ['technical-writing', 'api-documentation', 'user-guides', 'knowledge-base', 'diagram-creation'],
    phases: ['documentation'],
    systemPrompt: 'You are Paige, the Technical Writer. A patient educator who explains like teaching a friend. Master of clarity. You create technical documentation and guides.',
    maxConcurrentTasks: 3,
    canDelegateTo: [],
    receivesFrom: ['bmad-master'],
    defaultModelTier: 'balanced',
  },
];

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface AgentManagerEvents {
  'agent:status-changed': (agentId: AgentId, oldStatus: AgentStatus, newStatus: AgentStatus) => void;
  'agent:task-assigned': (agentId: AgentId, taskId: string, sessionId: string) => void;
  'agent:task-completed': (agentId: AgentId, taskId: string, sessionId: string) => void;
  'agent:task-failed': (agentId: AgentId, taskId: string, sessionId: string, error: string) => void;
  'agent:message': (message: AgentMessage) => void;
  'agent:inter-agent-message': (message: AgentMessage) => void;
}

// ---------------------------------------------------------------------------
// Agent Manager
// ---------------------------------------------------------------------------

export class AgentManager extends EventEmitter<AgentManagerEvents> {
  private configs: Map<AgentId, AgentConfig> = new Map();
  private states: Map<AgentId, AgentState> = new Map();
  /** Queue of messages waiting to be delivered to agents */
  private messageQueue: Map<AgentId, AgentMessage[]> = new Map();
  private takenOverAgents: Map<string, {
    agentId: string;
    takenOverAt: string;
    originalStatus: string;
  }> = new Map();
  private pool: Pool | null = null;

  constructor(pool?: Pool) {
    super();
    this.pool = pool ?? null;
    this.loadDefaultConfigs();
  }

  /**
   * Loads agent state from PostgreSQL on startup, merging with in-memory defaults.
   */
  async loadFromDB(): Promise<void> {
    if (!this.pool) return;
    try {
      const result = await this.pool.query('SELECT * FROM agents');
      let merged = 0;
      for (const row of result.rows) {
        const agentId = row.id as AgentId;
        const state = this.states.get(agentId);
        if (state) {
          // Merge DB state into in-memory state
          state.status = row.status ?? state.status;
          merged++;
        }
      }
      console.log(`[AgentManager] Merged ${merged} agent states from DB`);
    } catch (err: any) {
      console.warn('[AgentManager] Failed to load agent states from DB:', err?.message);
    }
  }

  /** Fire-and-forget DB write helper */
  private dbWrite(sql: string, params: unknown[]): void {
    if (!this.pool) return;
    this.pool.query(sql, params).catch((err: any) => {
      console.warn('[AgentManager] DB write failed:', err?.message);
    });
  }

  /**
   * Loads the built-in agent configurations and initializes their states.
   */
  private loadDefaultConfigs(): void {
    for (const config of DEFAULT_AGENT_CONFIGS) {
      this.configs.set(config.id, config);
      this.states.set(config.id, {
        agentId: config.id,
        status: 'idle',
        currentTaskId: null,
        sessionId: null,
        lastActiveAt: new Date().toISOString(),
        tasksCompleted: 0,
        tasksFailed: 0,
      });
      this.messageQueue.set(config.id, []);
    }
    console.log(`[AgentManager] Loaded ${this.configs.size} agent configurations`);
  }

  /**
   * Returns the configuration for a specific agent.
   */
  getConfig(agentId: AgentId): AgentConfig | undefined {
    return this.configs.get(agentId);
  }

  /**
   * Returns all agent configurations.
   */
  getAllConfigs(): AgentConfig[] {
    return Array.from(this.configs.values());
  }

  /**
   * Returns the runtime state of a specific agent.
   */
  getState(agentId: AgentId): AgentState | undefined {
    return this.states.get(agentId);
  }

  /**
   * Returns all agent states.
   */
  getAllStates(): AgentState[] {
    return Array.from(this.states.values());
  }

  /**
   * Returns agents filtered by status.
   */
  getAgentsByStatus(status: AgentStatus): AgentState[] {
    return Array.from(this.states.values()).filter((s) => s.status === status);
  }

  /**
   * Updates the status of an agent with event emission.
   */
  setAgentStatus(agentId: AgentId, newStatus: AgentStatus): boolean {
    const state = this.states.get(agentId);
    if (!state) return false;

    const oldStatus = state.status;
    if (oldStatus === newStatus) return true;

    state.status = newStatus;
    state.lastActiveAt = new Date().toISOString();

    // Persist to DB
    this.dbWrite(
      `UPDATE agents SET status=$1, updated_at=$2 WHERE id=$3`,
      [newStatus, state.lastActiveAt, agentId],
    );

    this.emit('agent:status-changed', agentId, oldStatus, newStatus);
    return true;
  }

  /**
   * Assigns a task to an agent. The agent's status transitions to 'working'.
   */
  assignTask(agentId: AgentId, taskId: string, sessionId: string): boolean {
    const state = this.states.get(agentId);
    const config = this.configs.get(agentId);
    if (!state || !config) return false;

    // Check if agent can accept work
    if (state.status === 'offline' || state.status === 'error') {
      console.warn(`[AgentManager] Cannot assign task to ${agentId}: agent is ${state.status}`);
      return false;
    }

    state.currentTaskId = taskId;
    state.sessionId = sessionId;
    state.lastActiveAt = new Date().toISOString();
    this.setAgentStatus(agentId, 'working');

    // Persist load increment to DB
    this.dbWrite(
      `UPDATE agents SET current_load = current_load + 1, updated_at = $1 WHERE id = $2`,
      [state.lastActiveAt, agentId],
    );

    this.emit('agent:task-assigned', agentId, taskId, sessionId);
    return true;
  }

  /**
   * Marks a task as completed by an agent. Transitions agent back to 'idle'.
   */
  completeTask(agentId: AgentId, taskId: string): boolean {
    const state = this.states.get(agentId);
    if (!state) return false;

    if (state.currentTaskId !== taskId) {
      console.warn(`[AgentManager] Task ${taskId} is not the current task for ${agentId}`);
      return false;
    }

    const sessionId = state.sessionId ?? '';
    state.currentTaskId = null;
    state.tasksCompleted += 1;
    state.lastActiveAt = new Date().toISOString();
    this.setAgentStatus(agentId, 'idle');

    // Persist load decrement to DB
    this.dbWrite(
      `UPDATE agents SET current_load = GREATEST(current_load - 1, 0), updated_at = $1 WHERE id = $2`,
      [state.lastActiveAt, agentId],
    );

    this.emit('agent:task-completed', agentId, taskId, sessionId);
    return true;
  }

  /**
   * Marks a task as failed by an agent. Transitions agent to 'idle' or 'error'.
   */
  failTask(agentId: AgentId, taskId: string, error: string): boolean {
    const state = this.states.get(agentId);
    if (!state) return false;

    const sessionId = state.sessionId ?? '';
    state.currentTaskId = null;
    state.tasksFailed += 1;
    state.lastActiveAt = new Date().toISOString();

    // If too many failures, mark agent as errored
    if (state.tasksFailed > 5) {
      this.setAgentStatus(agentId, 'error');
    } else {
      this.setAgentStatus(agentId, 'idle');
    }

    this.emit('agent:task-failed', agentId, taskId, sessionId, error);
    return true;
  }

  /**
   * Dispatches a message to a target agent. If the target is another agent,
   * the message is queued and an inter-agent event is emitted.
   */
  dispatchMessage(message: AgentMessage): void {
    const target = message.to;
    const targetAsAgentId = target as AgentId;

    // Validate target exists (target can be AgentId, 'user', 'dashboard', or 'broadcast')
    const isSpecialTarget = target === 'user' || target === 'dashboard' || target === 'broadcast';
    if (!this.configs.has(targetAsAgentId) && !isSpecialTarget) {
      console.warn(`[AgentManager] Unknown message target: ${target}`);
      return;
    }

    // If target is an agent, queue and emit inter-agent event
    if (this.configs.has(targetAsAgentId)) {
      const queue = this.messageQueue.get(targetAsAgentId);
      if (queue) {
        queue.push(message);
      }
      this.emit('agent:inter-agent-message', message);
    }

    // Always emit the general message event for the server to route
    this.emit('agent:message', message);
  }

  /**
   * Retrieves and clears the message queue for an agent.
   */
  drainMessageQueue(agentId: AgentId): AgentMessage[] {
    const queue = this.messageQueue.get(agentId);
    if (!queue) return [];

    const messages = [...queue];
    queue.length = 0;
    return messages;
  }

  /**
   * Finds the best available agent for a given capability.
   * Returns the agent with matching capability that is idle or has lowest load.
   */
  findAgentForCapability(capability: string, excludeAgents?: AgentId[]): AgentId | null {
    const candidates: { agentId: AgentId; priority: number }[] = [];

    for (const [agentId, config] of this.configs) {
      if (excludeAgents?.includes(agentId)) continue;
      if (!config.capabilities.includes(capability)) continue;

      const state = this.states.get(agentId);
      if (!state) continue;
      if (state.status === 'offline' || state.status === 'error') continue;

      // Priority: idle > working > reviewing > blocked
      const statusPriority: Record<AgentStatus, number> = {
        idle: 0,
        working: 1,
        reviewing: 2,
        blocked: 3,
        offline: 99,
        error: 99,
      };

      candidates.push({ agentId, priority: statusPriority[state.status] });
    }

    if (candidates.length === 0) return null;

    // Sort by priority (lowest = best)
    candidates.sort((a, b) => a.priority - b.priority);
    return candidates[0].agentId;
  }

  /**
   * Checks if an agent can delegate to another agent based on configuration.
   */
  canDelegate(from: AgentId, to: AgentId): boolean {
    const fromConfig = this.configs.get(from);
    if (!fromConfig) return false;
    return fromConfig.canDelegateTo.includes(to);
  }

  /**
   * Returns a serializable summary of all agents and their states.
   */
  getAgentSummary(): Array<{
    id: AgentId;
    name: string;
    role: string;
    status: AgentStatus;
    currentTaskId: string | null;
    tasksCompleted: number;
    tasksFailed: number;
    lastActiveAt: string;
  }> {
    const summary = [];
    for (const [agentId, config] of this.configs) {
      const state = this.states.get(agentId)!;
      summary.push({
        id: agentId,
        name: config.name,
        role: config.role,
        status: state.status,
        currentTaskId: state.currentTaskId,
        tasksCompleted: state.tasksCompleted,
        tasksFailed: state.tasksFailed,
        lastActiveAt: state.lastActiveAt,
      });
    }
    return summary;
  }

  takeOverAgent(agentId: string): void {
    const state = this.states.get(agentId as AgentId);
    if (!state) throw new Error(`Agent ${agentId} not found`);
    this.takenOverAgents.set(agentId, {
      agentId,
      takenOverAt: new Date().toISOString(),
      originalStatus: state.status,
    });
    this.setAgentStatus(agentId as AgentId, 'blocked' as AgentStatus);
  }

  releaseAgent(agentId: string): void {
    const record = this.takenOverAgents.get(agentId);
    if (!record) throw new Error(`Agent ${agentId} is not taken over`);
    const state = this.states.get(agentId as AgentId);
    if (state) {
      this.setAgentStatus(agentId as AgentId, (record.originalStatus as AgentStatus) ?? 'idle');
    }
    this.takenOverAgents.delete(agentId);
  }

  isAgentTakenOver(agentId: string): boolean {
    return this.takenOverAgents.has(agentId);
  }

  getTakenOverAgents(): string[] {
    return Array.from(this.takenOverAgents.keys());
  }
}
