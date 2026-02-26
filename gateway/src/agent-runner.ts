/**
 * Agent Runner for the ForgeTeam Gateway.
 *
 * The CORE module that makes agents actually respond to user chat messages
 * by calling AI APIs (Anthropic Claude or Google Gemini).
 *
 * Responsibilities:
 * - Loads agent SOUL.md identity files from disk (cached)
 * - Builds rich system prompts combining personality + preamble
 * - Converts session message history to provider-specific formats
 * - Routes to the correct AI provider based on model assignments
 * - Tracks token usage and cost via ModelRouter
 */

import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as fs from 'fs';
import * as path from 'path';
import type { AgentId, AgentMessage, ModelId } from '@forge-team/shared';
import type { ModelRouter } from './model-router';
import type { AgentManager } from './agent-manager';
import type { SessionManager } from './session-manager';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of recent messages to include as context */
const MAX_HISTORY_MESSAGES = 20;

/** Maximum output tokens per API call */
const MAX_OUTPUT_TOKENS = 4096;

/**
 * Map internal model IDs to the actual API model identifiers.
 * Our catalog uses friendly names; the providers expect specific strings.
 */
const ANTHROPIC_MODEL_MAP: Record<string, string> = {
  'claude-opus-4-6': 'claude-opus-4-6',
  'claude-sonnet-4-6': 'claude-sonnet-4-6',
  'claude-haiku-4-5': 'claude-haiku-4-5-20251001',
};

const GOOGLE_MODEL_MAP: Record<string, string> = {
  'gemini-3.1-pro': 'gemini-2.5-pro',
  'gemini-flash-3': 'gemini-2.5-flash',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Simplified message format used when calling AI provider APIs */
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Result returned from processUserMessage */
export interface AgentRunnerResult {
  content: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/** Dependencies injected into the AgentRunner */
interface AgentRunnerDeps {
  modelRouter: ModelRouter;
  agentManager: AgentManager;
  sessionManager: SessionManager;
}

// ---------------------------------------------------------------------------
// AgentRunner
// ---------------------------------------------------------------------------

export class AgentRunner {
  private modelRouter: ModelRouter;
  private agentManager: AgentManager;
  private sessionManager: SessionManager;

  /** Cache for loaded SOUL.md files — keyed by agentId */
  private soulCache: Map<AgentId, string> = new Map();

  constructor(deps: AgentRunnerDeps) {
    this.modelRouter = deps.modelRouter;
    this.agentManager = deps.agentManager;
    this.sessionManager = deps.sessionManager;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Processes a user's chat message by routing it to the appropriate AI model,
   * calling the provider API, and returning the agent's response with usage info.
   */
  async processUserMessage(
    agentId: AgentId,
    userMessage: string,
    sessionId: string,
  ): Promise<AgentRunnerResult> {
    // 1. Get agent config
    const agentConfig = this.agentManager.getConfig(agentId);
    if (!agentConfig) {
      console.error(`[AgentRunner] No config found for agent: ${agentId}`);
      return {
        content: `I'm sorry, I couldn't find the configuration for agent "${agentId}". Please check the agent ID and try again.`,
        model: 'unknown',
        inputTokens: 0,
        outputTokens: 0,
      };
    }

    // 2. Load SOUL.md (cached)
    const soulContent = this.loadSoulMd(agentId);

    // 3. Build the full system prompt
    const systemPrompt = this.buildSystemPrompt(
      agentConfig.name,
      agentConfig.role,
      soulContent,
    );

    // 4. Get session message history and convert to chat format
    const history = this.getConversationHistory(agentId, sessionId);

    // 5. Route to the right model
    const routingResult = this.modelRouter.route({
      agentId,
      taskContent: userMessage,
      sessionId,
    });

    const modelId = routingResult.model.id;
    const provider = routingResult.model.provider;

    console.log(
      `[AgentRunner] ${agentId} -> ${modelId} (${provider}, reason=${routingResult.reason}, tier=${routingResult.classifiedTier})`,
    );

    // 6. Append the current user message to the history
    const messages: ChatMessage[] = [
      ...history,
      { role: 'user', content: userMessage },
    ];

    // 7. Call the appropriate provider API
    let result: { content: string; inputTokens: number; outputTokens: number };

    try {
      if (provider === 'anthropic') {
        result = await this.callAnthropic(systemPrompt, messages, modelId);
      } else if (provider === 'google') {
        result = await this.callGemini(systemPrompt, messages, modelId);
      } else {
        throw new Error(`Unsupported provider: ${provider}`);
      }
    } catch (error: any) {
      console.error(`[AgentRunner] API call failed for ${agentId}:`, error?.message ?? error);
      return {
        content: `I encountered an error processing your message. Error: ${error?.message ?? 'Unknown error'}`,
        model: modelId,
        inputTokens: 0,
        outputTokens: 0,
      };
    }

    // 8. Record cost
    this.modelRouter.recordCost(
      agentId,
      sessionId,
      null, // taskId — not tied to a specific task in chat context
      modelId as ModelId,
      result.inputTokens,
      result.outputTokens,
      routingResult.classifiedTier,
    );

    console.log(
      `[AgentRunner] ${agentId} response: ${result.content.length} chars, ` +
      `${result.inputTokens} in / ${result.outputTokens} out tokens`,
    );

    return {
      content: result.content,
      model: modelId,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    };
  }

  // -------------------------------------------------------------------------
  // Provider: Anthropic Claude
  // -------------------------------------------------------------------------

  /**
   * Calls the Anthropic Claude API with the given system prompt and messages.
   * Returns the assistant's text response along with token usage.
   */
  private async callAnthropic(
    systemPrompt: string,
    messages: ChatMessage[],
    modelId: string,
  ): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.warn('[AgentRunner] ANTHROPIC_API_KEY is not set');
      return {
        content:
          "I'm not configured yet — please set the ANTHROPIC_API_KEY environment variable.",
        inputTokens: 0,
        outputTokens: 0,
      };
    }

    const client = new Anthropic({ apiKey });

    // Resolve to the actual API model identifier
    const apiModelId = ANTHROPIC_MODEL_MAP[modelId] ?? modelId;

    const response = await client.messages.create({
      model: apiModelId,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: systemPrompt,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });

    // Extract text from the first content block
    const textBlock = response.content[0];
    const content =
      textBlock?.type === 'text' ? textBlock.text : '[No text response]';

    return {
      content,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }

  // -------------------------------------------------------------------------
  // Provider: Google Generative AI (Gemini)
  // -------------------------------------------------------------------------

  /**
   * Calls the Google Generative AI (Gemini) API with the given system prompt
   * and conversation history. Uses startChat() for multi-turn conversations.
   */
  private async callGemini(
    systemPrompt: string,
    messages: ChatMessage[],
    modelId: string,
  ): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
    const apiKey = process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) {
      console.warn('[AgentRunner] GOOGLE_AI_API_KEY is not set');
      return {
        content:
          "I'm not configured yet — please set the GOOGLE_AI_API_KEY environment variable.",
        inputTokens: 0,
        outputTokens: 0,
      };
    }

    const genAI = new GoogleGenerativeAI(apiKey);

    // Resolve to the actual API model identifier
    const apiModelId = GOOGLE_MODEL_MAP[modelId] ?? modelId;

    const model = genAI.getGenerativeModel({
      model: apiModelId,
      systemInstruction: systemPrompt,
    });

    // Separate the last user message from the history
    const lastMessage = messages[messages.length - 1];
    const historyMessages = messages.slice(0, -1);

    // Convert history to Gemini format
    const geminiHistory = historyMessages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    // Start a multi-turn chat with the history
    const chat = model.startChat({
      history: geminiHistory.length > 0 ? geminiHistory : undefined,
    });

    // Send the latest user message
    const result = await chat.sendMessage(lastMessage.content);
    const response = result.response;

    const content = response.text() || '[No text response]';

    // Extract token usage from the response metadata
    const usageMetadata = response.usageMetadata;
    const inputTokens = usageMetadata?.promptTokenCount ?? 0;
    const outputTokens = usageMetadata?.candidatesTokenCount ?? 0;

    return {
      content,
      inputTokens,
      outputTokens,
    };
  }

  // -------------------------------------------------------------------------
  // SOUL.md Loading
  // -------------------------------------------------------------------------

  /**
   * Loads the SOUL.md file for a given agent from disk.
   * Tries two relative paths since the gateway may run from different CWDs:
   *   1. ../agents/{agentId}/SOUL.md  (running from gateway/)
   *   2. ./agents/{agentId}/SOUL.md   (running from project root)
   *
   * Results are cached in memory so each SOUL.md is read only once.
   */
  private loadSoulMd(agentId: AgentId): string {
    // Check cache first
    const cached = this.soulCache.get(agentId);
    if (cached !== undefined) {
      return cached;
    }

    const candidatePaths = [
      path.join(process.cwd(), '..', 'agents', agentId, 'SOUL.md'),
      path.join(process.cwd(), 'agents', agentId, 'SOUL.md'),
    ];

    for (const filePath of candidatePaths) {
      try {
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, 'utf-8');
          this.soulCache.set(agentId, content);
          console.log(`[AgentRunner] Loaded SOUL.md for ${agentId} from ${filePath}`);
          return content;
        }
      } catch (error: any) {
        console.warn(
          `[AgentRunner] Failed to read SOUL.md at ${filePath}: ${error?.message}`,
        );
      }
    }

    // SOUL.md not found — use empty string and cache it to avoid retrying
    console.warn(
      `[AgentRunner] SOUL.md not found for ${agentId}. Tried: ${candidatePaths.join(', ')}`,
    );
    this.soulCache.set(agentId, '');
    return '';
  }

  // -------------------------------------------------------------------------
  // System Prompt Builder
  // -------------------------------------------------------------------------

  /**
   * Builds a full system prompt by combining a preamble with the agent's
   * SOUL.md personality definition.
   */
  private buildSystemPrompt(
    agentName: string,
    role: string,
    soulContent: string,
  ): string {
    const preamble =
      `You are ${agentName}, a ${role} on the ForgeTeam autonomous SDLC team. ` +
      `You are having a conversation with the user (the human project stakeholder). ` +
      `Respond in character, drawing on your expertise and personality as defined below. ` +
      `Keep responses concise but helpful. If you need to respond in Arabic, detect the ` +
      `user's language and match it.\n\n`;

    if (soulContent) {
      return preamble + soulContent;
    }

    return preamble;
  }

  // -------------------------------------------------------------------------
  // Message History Conversion
  // -------------------------------------------------------------------------

  /**
   * Extracts and converts the session's message history into the simplified
   * ChatMessage[] format expected by the AI provider APIs.
   *
   * Only messages between the user and the specific agent are included.
   * Messages from other agents are filtered out since they belong to
   * different conversation threads.
   */
  private getConversationHistory(
    agentId: AgentId,
    sessionId: string,
  ): ChatMessage[] {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      return [];
    }

    const allMessages = session.messageHistory;

    // Take only the last N messages for context
    const recentMessages = allMessages.slice(-MAX_HISTORY_MESSAGES * 2); // over-fetch to account for filtering

    const chatMessages: ChatMessage[] = [];

    for (const msg of recentMessages) {
      const content = msg.payload?.content;
      if (!content) continue;

      // Messages from the user TO this agent (or broadcast)
      if (msg.from === 'user' && (msg.to === agentId || msg.to === 'broadcast')) {
        chatMessages.push({ role: 'user', content });
      }
      // Messages from this agent back to the user
      else if (msg.from === agentId && (msg.to === 'user' || msg.to === 'dashboard')) {
        chatMessages.push({ role: 'assistant', content });
      }
      // Skip messages from other agents — not part of this conversation
    }

    // Limit to the most recent N messages
    return chatMessages.slice(-MAX_HISTORY_MESSAGES);
  }
}
