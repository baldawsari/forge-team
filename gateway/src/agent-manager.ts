/**
 * Agent Manager for the ForgeTeam Gateway.
 *
 * Loads agent configurations, tracks agent runtime state,
 * dispatches tasks to agents, handles responses, and routes
 * inter-agent messages.
 */

import { EventEmitter } from 'eventemitter3';
import { v4 as uuid } from 'uuid';
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
    description: 'Master orchestrator that coordinates all agents and manages the SDLC pipeline',
    capabilities: ['orchestration', 'planning', 'coordination', 'workflow-management'],
    phases: ['discovery', 'requirements', 'architecture', 'design', 'implementation', 'testing', 'deployment', 'monitoring'],
    systemPrompt: 'You are BMad Master, the orchestrator of the ForgeTeam SDLC agent team. You coordinate work across all agents, manage the pipeline, and ensure quality gates are met.',
    maxConcurrentTasks: 5,
    canDelegateTo: ['product-owner', 'business-analyst', 'scrum-master', 'architect', 'ux-designer', 'frontend-dev', 'backend-dev', 'qa-architect', 'devops-engineer', 'security-specialist', 'tech-writer'],
    receivesFrom: [],
    defaultModelTier: 'balanced',
  },
  {
    id: 'product-owner',
    name: 'Product Owner',
    role: 'Product Manager',
    description: 'Defines product vision, manages backlog, and prioritizes features',
    capabilities: ['product-vision', 'backlog-management', 'prioritization', 'stakeholder-communication', 'user-story-writing'],
    phases: ['discovery', 'requirements'],
    systemPrompt: 'You are the Product Owner agent. You define product vision, write user stories, manage the product backlog, and prioritize features based on business value.',
    maxConcurrentTasks: 3,
    canDelegateTo: ['business-analyst', 'ux-designer'],
    receivesFrom: ['bmad-master'],
    defaultModelTier: 'balanced',
  },
  {
    id: 'business-analyst',
    name: 'Business Analyst',
    role: 'Analyst',
    description: 'Analyzes requirements, creates specifications, and validates business logic',
    capabilities: ['requirements-analysis', 'specification-writing', 'process-modeling', 'data-analysis'],
    phases: ['discovery', 'requirements'],
    systemPrompt: 'You are the Business Analyst agent. You analyze business requirements, create detailed specifications, model processes, and validate that solutions meet business needs.',
    maxConcurrentTasks: 3,
    canDelegateTo: [],
    receivesFrom: ['bmad-master', 'product-owner'],
    defaultModelTier: 'balanced',
  },
  {
    id: 'scrum-master',
    name: 'Scrum Master',
    role: 'Process Manager',
    description: 'Facilitates agile ceremonies, manages sprints, and removes blockers',
    capabilities: ['sprint-planning', 'ceremony-facilitation', 'blocker-resolution', 'metrics-tracking', 'retrospective'],
    phases: ['requirements', 'implementation', 'testing'],
    systemPrompt: 'You are the Scrum Master agent. You facilitate agile ceremonies, manage sprint planning, track velocity, remove blockers, and ensure the team follows agile best practices.',
    maxConcurrentTasks: 5,
    canDelegateTo: [],
    receivesFrom: ['bmad-master'],
    defaultModelTier: 'fast',
  },
  {
    id: 'architect',
    name: 'Software Architect',
    role: 'Architect',
    description: 'Designs system architecture, makes technology decisions, and ensures technical quality',
    capabilities: ['system-design', 'technology-selection', 'architecture-review', 'performance-design', 'scalability-planning'],
    phases: ['architecture', 'design'],
    systemPrompt: 'You are the Software Architect agent. You design system architecture, select technologies, review technical designs, and ensure the system meets quality attributes like scalability, performance, and maintainability.',
    maxConcurrentTasks: 2,
    canDelegateTo: ['backend-dev', 'frontend-dev', 'security-specialist'],
    receivesFrom: ['bmad-master'],
    defaultModelTier: 'premium',
  },
  {
    id: 'ux-designer',
    name: 'UX/UI Designer',
    role: 'Designer',
    description: 'Creates user interfaces, designs user experiences, and maintains design systems',
    capabilities: ['ui-design', 'ux-research', 'wireframing', 'prototyping', 'design-system', 'accessibility'],
    phases: ['design'],
    systemPrompt: 'You are the UX/UI Designer agent. You create user interfaces, conduct UX research, build wireframes and prototypes, maintain the design system, and ensure accessibility compliance.',
    maxConcurrentTasks: 3,
    canDelegateTo: ['frontend-dev'],
    receivesFrom: ['bmad-master', 'product-owner'],
    defaultModelTier: 'balanced',
  },
  {
    id: 'frontend-dev',
    name: 'Frontend Developer',
    role: 'Developer',
    description: 'Implements frontend features, components, and user-facing functionality',
    capabilities: ['frontend-development', 'component-building', 'state-management', 'responsive-design', 'testing'],
    phases: ['implementation', 'testing'],
    systemPrompt: 'You are the Frontend Developer agent. You implement frontend features using modern frameworks, build reusable components, manage application state, ensure responsive design, and write frontend tests.',
    maxConcurrentTasks: 3,
    canDelegateTo: [],
    receivesFrom: ['bmad-master', 'architect', 'ux-designer'],
    defaultModelTier: 'balanced',
  },
  {
    id: 'backend-dev',
    name: 'Backend Developer',
    role: 'Developer',
    description: 'Implements backend services, APIs, databases, and server-side logic',
    capabilities: ['backend-development', 'api-design', 'database-design', 'service-implementation', 'testing'],
    phases: ['implementation', 'testing'],
    systemPrompt: 'You are the Backend Developer agent. You implement backend services, design and build APIs, manage databases, implement business logic, and write backend tests.',
    maxConcurrentTasks: 3,
    canDelegateTo: [],
    receivesFrom: ['bmad-master', 'architect'],
    defaultModelTier: 'premium',
  },
  {
    id: 'qa-architect',
    name: 'QA/Test Architect',
    role: 'Quality Assurance',
    description: 'Designs test strategies, writes test plans, and ensures quality standards',
    capabilities: ['test-strategy', 'test-planning', 'test-automation', 'quality-metrics', 'regression-testing', 'performance-testing'],
    phases: ['testing', 'implementation'],
    systemPrompt: 'You are the QA/Test Architect agent. You design test strategies, write comprehensive test plans, implement test automation, track quality metrics, and ensure all acceptance criteria are met.',
    maxConcurrentTasks: 3,
    canDelegateTo: [],
    receivesFrom: ['bmad-master'],
    defaultModelTier: 'premium',
  },
  {
    id: 'devops-engineer',
    name: 'DevOps Engineer',
    role: 'DevOps',
    description: 'Manages CI/CD pipelines, infrastructure, deployments, and monitoring',
    capabilities: ['ci-cd', 'infrastructure-as-code', 'deployment', 'monitoring', 'containerization', 'cloud-management'],
    phases: ['deployment', 'monitoring'],
    systemPrompt: 'You are the DevOps Engineer agent. You manage CI/CD pipelines, provision infrastructure, handle deployments, set up monitoring and alerting, and ensure system reliability.',
    maxConcurrentTasks: 3,
    canDelegateTo: [],
    receivesFrom: ['bmad-master'],
    defaultModelTier: 'balanced',
  },
  {
    id: 'security-specialist',
    name: 'Security Specialist',
    role: 'Security',
    description: 'Conducts security reviews, threat modeling, and ensures security compliance',
    capabilities: ['security-review', 'threat-modeling', 'vulnerability-assessment', 'compliance', 'penetration-testing', 'security-architecture'],
    phases: ['security-review', 'architecture', 'testing'],
    systemPrompt: 'You are the Security Specialist agent. You conduct security reviews, perform threat modeling, assess vulnerabilities, ensure compliance with security standards, and design secure architectures.',
    maxConcurrentTasks: 2,
    canDelegateTo: [],
    receivesFrom: ['bmad-master', 'architect'],
    defaultModelTier: 'premium',
  },
  {
    id: 'tech-writer',
    name: 'Technical Writer',
    role: 'Documentation',
    description: 'Creates technical documentation, API docs, user guides, and knowledge base articles',
    capabilities: ['technical-writing', 'api-documentation', 'user-guides', 'knowledge-base', 'diagram-creation'],
    phases: ['documentation'],
    systemPrompt: 'You are the Technical Writer agent. You create comprehensive technical documentation, API references, user guides, architecture diagrams, and maintain the project knowledge base.',
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

  constructor() {
    super();
    this.loadDefaultConfigs();
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
}
