/**
 * ForgeTeam Agent Registry
 *
 * Central module for loading and querying all BMAD agent configurations.
 * Provides typed access to agent configs, lookup by ID, and filtering
 * by capability.
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentModel {
  primary: string;
  fallbacks: string[];
  temperature: number;
  maxTokens: number;
}

export interface AgentConfig {
  id: string;
  name: string;
  role: string;
  avatar: string;
  model: AgentModel;
  systemPromptTemplate: string;
  capabilities: string[];
  canDelegate: boolean;
  canSpawnSubAgents: boolean;
  approvalRequired: boolean;
  memoryScope: "private" | "team" | "project";
  viadpRole: "delegator" | "delegatee" | "both";
}

// ---------------------------------------------------------------------------
// Internal loader
// ---------------------------------------------------------------------------

const AGENTS_DIR =
  typeof __dirname !== "undefined"
    ? __dirname
    : dirname(fileURLToPath(import.meta.url));

function loadAllConfigs(): AgentConfig[] {
  const configs: AgentConfig[] = [];

  const entries = readdirSync(AGENTS_DIR);

  for (const entry of entries) {
    const fullPath = join(AGENTS_DIR, entry);
    if (!statSync(fullPath).isDirectory()) continue;

    const configPath = join(fullPath, "config.json");
    try {
      const raw = readFileSync(configPath, "utf-8");
      const parsed: AgentConfig = JSON.parse(raw);
      configs.push(parsed);
    } catch {
      // Directory exists but has no config.json — skip silently.
    }
  }

  return configs;
}

// Eagerly load once on import so consumers get fast access.
const agentRegistry: AgentConfig[] = loadAllConfigs();

// Build an id-keyed lookup map for O(1) access.
const agentMap = new Map<string, AgentConfig>(
  agentRegistry.map((a) => [a.id, a])
);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Retrieve a single agent configuration by its unique ID.
 *
 * @param id - The agent slug (e.g. "bmad-master", "frontend-dev").
 * @returns The matching AgentConfig or undefined if not found.
 */
export function getAgent(id: string): AgentConfig | undefined {
  return agentMap.get(id);
}

/**
 * Return every registered agent configuration.
 */
export function getAllAgents(): AgentConfig[] {
  return [...agentRegistry];
}

/**
 * Find all agents that possess a given capability.
 *
 * @param capability - The capability string to match (e.g. "code-review", "api-design").
 * @returns An array of AgentConfig objects whose capabilities list includes the value.
 */
export function getAgentsByCapability(capability: string): AgentConfig[] {
  return agentRegistry.filter((a) => a.capabilities.includes(capability));
}

/**
 * Find all agents that can delegate tasks to other agents.
 */
export function getDelegators(): AgentConfig[] {
  return agentRegistry.filter((a) => a.canDelegate);
}

/**
 * Find all agents that can receive delegated tasks.
 */
export function getDelegatees(): AgentConfig[] {
  return agentRegistry.filter(
    (a) => a.viadpRole === "delegatee" || a.viadpRole === "both"
  );
}

/**
 * Find all agents that can spawn sub-agents for parallel work.
 */
export function getSpawners(): AgentConfig[] {
  return agentRegistry.filter((a) => a.canSpawnSubAgents);
}

/**
 * Find all agents whose actions require human approval.
 */
export function getApprovalRequired(): AgentConfig[] {
  return agentRegistry.filter((a) => a.approvalRequired);
}

/**
 * Reload all configs from disk (useful after hot-editing config files).
 */
export function reloadRegistry(): void {
  agentRegistry.length = 0;
  agentMap.clear();

  const fresh = loadAllConfigs();
  for (const config of fresh) {
    agentRegistry.push(config);
    agentMap.set(config.id, config);
  }
}

// ---------------------------------------------------------------------------
// Default export for convenience
// ---------------------------------------------------------------------------

export default {
  getAgent,
  getAllAgents,
  getAgentsByCapability,
  getDelegators,
  getDelegatees,
  getSpawners,
  getApprovalRequired,
  reloadRegistry,
};
