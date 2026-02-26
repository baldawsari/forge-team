/**
 * Agent Manager for the ForgeTeam Gateway.
 *
 * Loads agent configurations, tracks agent runtime state,
 * dispatches tasks to agents, handles responses, and routes
 * inter-agent messages.
 */
import { EventEmitter } from 'eventemitter3';
import type { AgentId, AgentStatus, AgentConfig, AgentState, AgentMessage } from '@forge-team/shared';
export interface AgentManagerEvents {
    'agent:status-changed': (agentId: AgentId, oldStatus: AgentStatus, newStatus: AgentStatus) => void;
    'agent:task-assigned': (agentId: AgentId, taskId: string, sessionId: string) => void;
    'agent:task-completed': (agentId: AgentId, taskId: string, sessionId: string) => void;
    'agent:task-failed': (agentId: AgentId, taskId: string, sessionId: string, error: string) => void;
    'agent:message': (message: AgentMessage) => void;
    'agent:inter-agent-message': (message: AgentMessage) => void;
}
export declare class AgentManager extends EventEmitter<AgentManagerEvents> {
    private configs;
    private states;
    /** Queue of messages waiting to be delivered to agents */
    private messageQueue;
    constructor();
    /**
     * Loads the built-in agent configurations and initializes their states.
     */
    private loadDefaultConfigs;
    /**
     * Returns the configuration for a specific agent.
     */
    getConfig(agentId: AgentId): AgentConfig | undefined;
    /**
     * Returns all agent configurations.
     */
    getAllConfigs(): AgentConfig[];
    /**
     * Returns the runtime state of a specific agent.
     */
    getState(agentId: AgentId): AgentState | undefined;
    /**
     * Returns all agent states.
     */
    getAllStates(): AgentState[];
    /**
     * Returns agents filtered by status.
     */
    getAgentsByStatus(status: AgentStatus): AgentState[];
    /**
     * Updates the status of an agent with event emission.
     */
    setAgentStatus(agentId: AgentId, newStatus: AgentStatus): boolean;
    /**
     * Assigns a task to an agent. The agent's status transitions to 'working'.
     */
    assignTask(agentId: AgentId, taskId: string, sessionId: string): boolean;
    /**
     * Marks a task as completed by an agent. Transitions agent back to 'idle'.
     */
    completeTask(agentId: AgentId, taskId: string): boolean;
    /**
     * Marks a task as failed by an agent. Transitions agent to 'idle' or 'error'.
     */
    failTask(agentId: AgentId, taskId: string, error: string): boolean;
    /**
     * Dispatches a message to a target agent. If the target is another agent,
     * the message is queued and an inter-agent event is emitted.
     */
    dispatchMessage(message: AgentMessage): void;
    /**
     * Retrieves and clears the message queue for an agent.
     */
    drainMessageQueue(agentId: AgentId): AgentMessage[];
    /**
     * Finds the best available agent for a given capability.
     * Returns the agent with matching capability that is idle or has lowest load.
     */
    findAgentForCapability(capability: string, excludeAgents?: AgentId[]): AgentId | null;
    /**
     * Checks if an agent can delegate to another agent based on configuration.
     */
    canDelegate(from: AgentId, to: AgentId): boolean;
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
    }>;
}
//# sourceMappingURL=agent-manager.d.ts.map