import { v4 as uuid } from 'uuid';
import type { AgentId, AgentConfig, AgentMessage } from '@forge-team/shared';
import type { AgentRunner, AgentRunnerResult } from './agent-runner';
import type { AgentManager } from './agent-manager';
import type { SessionManager } from './session-manager';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PartyModeConfig {
  minAgents: number;
  maxAgents: number;
  enableCrossTalk: boolean;
}

export interface AgentSelection {
  agentId: string;
  role: 'primary' | 'secondary' | 'tertiary';
  reason: string;
}

export interface PartyModeResult {
  selections: AgentSelection[];
  responses: Array<{
    agentId: string;
    content: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
  }>;
}

// ---------------------------------------------------------------------------
// Keyword -> Capability Mapping
// ---------------------------------------------------------------------------

const KEYWORD_CAPABILITY_MAP: Record<string, string[]> = {
  'architecture|system design|scalability|microservice|api design|database schema|cqrs|event.driven': ['system-design', 'architecture-review'],
  'frontend|ui|component|react|css|tailwind|responsive|rtl|layout': ['frontend-development', 'component-building'],
  'backend|api|endpoint|database|server|node|express|postgres': ['backend-development', 'api-design'],
  'requirement|user story|feature|priority|backlog|prd|stakeholder': ['product-vision', 'backlog-management', 'requirements-analysis'],
  'ux|user experience|wireframe|design|accessibility|figma|prototype': ['ui-design', 'ux-research'],
  'test|qa|quality|bug|regression|coverage|e2e|integration test': ['test-strategy', 'test-automation'],
  'deploy|ci.cd|docker|kubernetes|infrastructure|monitoring|pipeline': ['ci-cd', 'deployment'],
  'security|auth|owasp|vulnerability|penetration|compliance|encrypt': ['security-review', 'threat-modeling'],
  'sprint|standup|retro|velocity|story point|scrum|agile|ceremony': ['sprint-planning', 'ceremony-facilitation'],
  'doc|readme|api doc|guide|knowledge base|diagram': ['technical-writing', 'api-documentation'],
  'market|competitor|research|analysis|brief|domain|business': ['requirements-analysis', 'data-analysis'],
};

const DEFAULT_CONFIG: PartyModeConfig = {
  minAgents: 2,
  maxAgents: 3,
  enableCrossTalk: true,
};

// ---------------------------------------------------------------------------
// Party Mode Engine
// ---------------------------------------------------------------------------

export class PartyModeEngine {
  private config: PartyModeConfig;

  constructor(config?: Partial<PartyModeConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  selectAgents(message: string, agents: AgentConfig[], _recentHistory: any[]): AgentSelection[] {
    const lowerMessage = message.toLowerCase();

    // Score each agent based on keyword matches
    const scores: Array<{ agentId: string; score: number; matchedCapabilities: string[] }> = [];

    for (const agent of agents) {
      if (agent.id === 'bmad-master') continue; // bmad-master is fallback only

      let score = 0;
      const matchedCapabilities: string[] = [];

      for (const [keywordPattern, capabilities] of Object.entries(KEYWORD_CAPABILITY_MAP)) {
        const regex = new RegExp(keywordPattern, 'i');
        if (regex.test(lowerMessage)) {
          // Check if this agent has any of the mapped capabilities
          for (const cap of capabilities) {
            if (agent.capabilities.includes(cap)) {
              score += 2;
              matchedCapabilities.push(cap);
            }
          }
        }
      }

      // Bonus for agents whose role keywords appear in the message
      const roleLower = agent.role.toLowerCase();
      const nameLower = agent.name.toLowerCase();
      if (lowerMessage.includes(roleLower) || lowerMessage.includes(nameLower)) {
        score += 3;
      }

      if (score > 0) {
        scores.push({ agentId: agent.id, score, matchedCapabilities });
      }
    }

    // Sort by score descending
    scores.sort((a, b) => b.score - a.score);

    // Select top agents (min 2, max 3)
    const selected = scores.slice(0, this.config.maxAgents);

    // If we don't have enough, add bmad-master as fallback
    if (selected.length < this.config.minAgents) {
      const bmadMaster = agents.find((a) => a.id === 'bmad-master');
      if (bmadMaster && !selected.some((s) => s.agentId === 'bmad-master')) {
        selected.push({
          agentId: 'bmad-master',
          score: 0,
          matchedCapabilities: ['orchestration'],
        });
      }
    }

    // Still not enough? Add highest-capability agents
    if (selected.length < this.config.minAgents) {
      for (const agent of agents) {
        if (selected.some((s) => s.agentId === agent.id)) continue;
        selected.push({
          agentId: agent.id,
          score: 0,
          matchedCapabilities: [agent.capabilities[0] ?? 'general'],
        });
        if (selected.length >= this.config.minAgents) break;
      }
    }

    const roles: Array<'primary' | 'secondary' | 'tertiary'> = ['primary', 'secondary', 'tertiary'];

    return selected.slice(0, this.config.maxAgents).map((s, i) => ({
      agentId: s.agentId,
      role: roles[i] ?? 'tertiary',
      reason: s.matchedCapabilities.length > 0
        ? `Matched capabilities: ${s.matchedCapabilities.join(', ')}`
        : 'Fallback selection for broader perspective',
    }));
  }

  buildPartyModePrompt(agentSoulMd: string, partyContext: {
    topic: string;
    selectedAgents: AgentSelection[];
    previousResponses: Array<{ agentName: string; content: string }>;
    isFirst: boolean;
  }): string {
    const preamble =
      `You are participating in a BMAD Party Mode discussion. ` +
      `Multiple agents are weighing in on the user's question from their area of expertise.\n\n`;

    const topicLine = `TOPIC: ${partyContext.topic}\n\n`;

    const teamInfo =
      `PARTICIPATING AGENTS:\n` +
      partyContext.selectedAgents
        .map((a) => `- ${a.agentId} (${a.role}): ${a.reason}`)
        .join('\n') +
      '\n\n';

    let crossTalk = '';
    if (!partyContext.isFirst && partyContext.previousResponses.length > 0 && this.config.enableCrossTalk) {
      crossTalk =
        `PREVIOUS RESPONSES (you may reference, build upon, or respectfully disagree with these):\n` +
        partyContext.previousResponses
          .map((r) => `--- ${r.agentName} ---\n${r.content}`)
          .join('\n\n') +
        '\n\n';
    }

    const instructions =
      `INSTRUCTIONS:\n` +
      `- Respond in character based on your SOUL.md personality below\n` +
      `- Focus on your area of expertise\n` +
      `- Keep your response concise (2-4 paragraphs)\n` +
      `- If other agents have responded, you may reference their points\n` +
      `- If the user writes in Arabic, respond in Arabic\n\n`;

    const soulSection = agentSoulMd
      ? `YOUR IDENTITY:\n${agentSoulMd}\n\n`
      : '';

    return preamble + topicLine + teamInfo + crossTalk + instructions + soulSection;
  }

  async executePartyMode(
    userMessage: string,
    sessionId: string,
    agentRunner: AgentRunner,
    agentManager: AgentManager,
  ): Promise<PartyModeResult> {
    const allAgents = agentManager.getAllConfigs();

    // Get recent history from session for context
    const selections = this.selectAgents(userMessage, allAgents, []);

    const responses: PartyModeResult['responses'] = [];
    const previousResponses: Array<{ agentName: string; content: string }> = [];

    // Execute sequentially so each agent can reference previous responses
    for (let i = 0; i < selections.length; i++) {
      const selection = selections[i];
      const agentId = selection.agentId as AgentId;
      const agentConfig = agentManager.getConfig(agentId);
      if (!agentConfig) continue;

      const systemPrompt = this.buildPartyModePrompt('', {
        topic: userMessage,
        selectedAgents: selections,
        previousResponses,
        isFirst: i === 0,
      });

      agentManager.setAgentStatus(agentId, 'working');

      try {
        const result = await agentRunner.processUserMessage(
          agentId,
          userMessage,
          sessionId,
          systemPrompt,
        );

        responses.push({
          agentId: selection.agentId,
          content: result.content,
          model: result.model,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        });

        previousResponses.push({
          agentName: agentConfig.name,
          content: result.content,
        });
      } catch (error: any) {
        console.error(`[PartyMode] Agent ${agentId} failed:`, error?.message);
        responses.push({
          agentId: selection.agentId,
          content: `I encountered an error while formulating my response.`,
          model: 'unknown',
          inputTokens: 0,
          outputTokens: 0,
        });
      } finally {
        agentManager.setAgentStatus(agentId, 'idle');
      }
    }

    return { selections, responses };
  }
}
