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
import type { MemoryManager } from '@forge-team/memory';
import type { GeminiFileSearch } from '@forge-team/memory';
import type { VectorStore } from '@forge-team/memory';
import type { ToolRegistry } from './tools/tool-registry';
import type { SandboxManager } from './tools/sandbox-manager';
import type { ToolExecutionContext } from './tools/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of recent messages to include as context */
const MAX_HISTORY_MESSAGES = 20;

/** Maximum output tokens per API call */
const MAX_OUTPUT_TOKENS = 4096;

const MAX_TOOL_USE_ROUNDS = 5;

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
  memoryManager?: MemoryManager;
  geminiFileSearch?: GeminiFileSearch;
  vectorStore?: VectorStore;
  companyKBId?: string;
  toolRegistry?: ToolRegistry;
  sandboxManager?: SandboxManager;
}

// ---------------------------------------------------------------------------
// AgentRunner
// ---------------------------------------------------------------------------

export class AgentRunner {
  private modelRouter: ModelRouter;
  private agentManager: AgentManager;
  private sessionManager: SessionManager;
  private memoryManager: MemoryManager | null;
  private geminiFileSearch: GeminiFileSearch | null;
  private vectorStore: VectorStore | null;
  private companyKBId: string | null;
  private toolRegistry: ToolRegistry | null;
  private sandboxManager: SandboxManager | null;

  /** Cache for loaded SOUL.md files — keyed by agentId */
  private soulCache: Map<AgentId, string> = new Map();

  constructor(deps: AgentRunnerDeps) {
    this.modelRouter = deps.modelRouter;
    this.agentManager = deps.agentManager;
    this.sessionManager = deps.sessionManager;
    this.memoryManager = deps.memoryManager ?? null;
    this.geminiFileSearch = deps.geminiFileSearch ?? null;
    this.vectorStore = deps.vectorStore ?? null;
    this.companyKBId = deps.companyKBId ?? null;
    this.toolRegistry = deps.toolRegistry ?? null;
    this.sandboxManager = deps.sandboxManager ?? null;
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
    systemPromptOverride?: string,
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

    // 2. Build system prompt (use override if provided, e.g. party mode)
    let systemPrompt: string;
    if (systemPromptOverride) {
      systemPrompt = systemPromptOverride;
    } else {
      const soulContent = this.loadSoulMd(agentId);
      systemPrompt = this.buildSystemPrompt(
        agentConfig.name,
        agentConfig.role,
        soulContent,
      );
    }

    // 3. Retrieve memory context via RAG
    const ragContext = await this.retrieveContext(agentId, userMessage, sessionId);
    if (ragContext.length > 0) {
      systemPrompt += '\n\n---\n\n' + ragContext;
    }

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

    // 7. Determine tools for this agent
    const agentTools = this.toolRegistry ? this.toolRegistry.listForAgent(agentId) : [];
    const hasTools = agentTools.length > 0 && routingResult.model.supportsTools;

    const toolContext: ToolExecutionContext = {
      agentId,
      sessionId,
      taskId: null,
      workingDir: '/workspace',
      timeout: 300,
    };

    // 8. Call the appropriate provider API
    let result: { content: string; inputTokens: number; outputTokens: number };

    try {
      if (provider === 'anthropic') {
        const tools = hasTools && this.toolRegistry
          ? this.toolRegistry.toAnthropicTools(agentId)
          : undefined;
        result = await this.callAnthropic(systemPrompt, messages, modelId, tools, toolContext);
      } else if (provider === 'google') {
        const tools = hasTools && this.toolRegistry
          ? this.toolRegistry.toGeminiTools(agentId)
          : undefined;
        result = await this.callGemini(systemPrompt, messages, modelId, tools, toolContext);
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

    // 9. Store exchange in memory for future RAG retrieval
    if (this.memoryManager) {
      try {
        await this.memoryManager.store('thread', userMessage, {
          role: 'user',
          agentId,
          sessionId,
        }, {
          agentId,
          threadId: sessionId,
          importance: 0.5,
        });

        await this.memoryManager.store('thread', result.content, {
          role: 'agent',
          agentId,
          model: modelId,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        }, {
          agentId,
          threadId: sessionId,
          importance: 0.6,
        });
      } catch (err: any) {
        console.warn(`[AgentRunner] Failed to store memory for ${agentId}:`, err?.message);
      }
    }

    // Also index in VectorStore for semantic search (TASK 10)
    if (this.vectorStore) {
      try {
        await this.vectorStore.embedAndUpsert(
          `[user] ${userMessage}\n[${agentId}] ${result.content}`,
          {
            agentId,
            sessionId,
            model: modelId,
            timestamp: new Date().toISOString(),
          },
          agentId,
        );
      } catch (err: any) {
        console.warn(`[AgentRunner] Failed to index in VectorStore:`, err?.message);
      }
    }

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
    tools?: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>,
    toolContext?: ToolExecutionContext,
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
    const apiModelId = ANTHROPIC_MODEL_MAP[modelId] ?? modelId;

    let anthropicMessages: Array<{ role: 'user' | 'assistant'; content: any }> =
      messages.map((m) => ({ role: m.role, content: m.content }));

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let finalContent = '[No text response]';

    for (let round = 0; round < MAX_TOOL_USE_ROUNDS; round++) {
      const createParams: any = {
        model: apiModelId,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: systemPrompt,
        messages: anthropicMessages,
      };

      if (tools && tools.length > 0) {
        createParams.tools = tools;
      }

      const response = await client.messages.create(createParams);

      totalInputTokens += response.usage.input_tokens;
      totalOutputTokens += response.usage.output_tokens;

      const toolUseBlock = response.content.find((b: any) => b.type === 'tool_use');

      if (toolUseBlock && toolUseBlock.type === 'tool_use' && this.toolRegistry && toolContext) {
        const toolDef = this.toolRegistry.get(toolUseBlock.name);
        let toolResultContent: string;

        if (toolDef) {
          try {
            const toolResult = await toolDef.execute(toolUseBlock.input as Record<string, unknown>, toolContext);
            toolResultContent = toolResult.success
              ? toolResult.output
              : `Error: ${toolResult.error ?? 'Tool execution failed'}`;
          } catch (err: any) {
            toolResultContent = `Error executing tool: ${err?.message ?? 'Unknown error'}`;
          }
        } else {
          toolResultContent = `Unknown tool: ${toolUseBlock.name}`;
        }

        anthropicMessages = [
          ...anthropicMessages,
          { role: 'assistant', content: response.content },
          {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: toolUseBlock.id, content: toolResultContent }],
          },
        ];
        continue;
      }

      const textBlock = response.content.find((b: any) => b.type === 'text');
      finalContent = textBlock && textBlock.type === 'text' ? textBlock.text : '[No text response]';
      break;
    }

    return {
      content: finalContent,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
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
    tools?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>,
    toolContext?: ToolExecutionContext,
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
    const apiModelId = GOOGLE_MODEL_MAP[modelId] ?? modelId;

    const modelConfig: any = {
      model: apiModelId,
      systemInstruction: systemPrompt,
    };

    if (tools && tools.length > 0) {
      modelConfig.tools = [{
        functionDeclarations: tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      }];
    }

    const model = genAI.getGenerativeModel(modelConfig);

    const lastMessage = messages[messages.length - 1];
    const historyMessages = messages.slice(0, -1);

    const geminiHistory = historyMessages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const chat = model.startChat({
      history: geminiHistory.length > 0 ? geminiHistory : undefined,
    });

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let currentMessage: string | Array<{ functionResponse: { name: string; response: any } }> = lastMessage.content;

    for (let round = 0; round < MAX_TOOL_USE_ROUNDS; round++) {
      const result = await chat.sendMessage(currentMessage as any);
      const response = result.response;

      const usageMetadata = response.usageMetadata;
      totalInputTokens += usageMetadata?.promptTokenCount ?? 0;
      totalOutputTokens += usageMetadata?.candidatesTokenCount ?? 0;

      const candidate = response.candidates?.[0];
      const functionCallPart = candidate?.content?.parts?.find((p: any) => p.functionCall);

      if (functionCallPart && 'functionCall' in functionCallPart && this.toolRegistry && toolContext) {
        const fc = (functionCallPart as any).functionCall as { name: string; args: Record<string, unknown> };
        const toolDef = this.toolRegistry.get(fc.name);
        let functionResponse: any;

        if (toolDef) {
          try {
            const toolResult = await toolDef.execute(fc.args as Record<string, unknown>, toolContext);
            functionResponse = { result: toolResult.success ? toolResult.output : toolResult.error };
          } catch (err: any) {
            functionResponse = { error: err?.message ?? 'Tool execution failed' };
          }
        } else {
          functionResponse = { error: `Unknown tool: ${fc.name}` };
        }

        currentMessage = [{ functionResponse: { name: fc.name, response: functionResponse } }];
        continue;
      }

      const content = response.text() || '[No text response]';
      return { content, inputTokens: totalInputTokens, outputTokens: totalOutputTokens };
    }

    return {
      content: '[Max tool use rounds exceeded]',
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
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

  private async retrieveContext(
    agentId: AgentId,
    userMessage: string,
    sessionId: string,
  ): Promise<string> {
    const contextParts: string[] = [];

    // 1. Get hierarchical memory context from MemoryManager
    if (this.memoryManager) {
      try {
        const recentEntries = await this.memoryManager.getRecentContext(agentId, 15);
        if (recentEntries.length > 0) {
          const memoryText = recentEntries
            .map(e => `[${e.scope}] ${e.content}`)
            .join('\n');
          contextParts.push(`## Relevant Memories\n${memoryText}`);
        }
      } catch (err: any) {
        console.warn(`[AgentRunner] Memory retrieval failed for ${agentId}:`, err?.message);
      }
    }

    // 2. Search for project knowledge — Gemini File Search with pgvector fallback (TASK 8)
    const agentConfig = this.agentManager.getConfig(agentId);
    let storeId = (agentConfig as any)?.fileSearchStoreId as string | undefined;

    // Auto-create per-agent corpus on first use (TASK 7)
    if (!storeId && this.geminiFileSearch) {
      try {
        const store = await this.geminiFileSearch.createStore(
          `agent-${agentId}`,
          'agent',
        );
        (agentConfig as any).fileSearchStoreId = store.id;
        storeId = store.id;
        console.log(`[AgentRunner] Created file search store for ${agentId}: ${store.id}`);
      } catch (err: any) {
        console.warn(`[AgentRunner] Failed to create store for ${agentId}:`, err?.message);
      }
    }

    let fileSearchResults: string[] = [];

    if (this.geminiFileSearch && storeId) {
      try {
        const searchResult = await this.geminiFileSearch.search(storeId, userMessage, 3);
        fileSearchResults = searchResult.results.map(r => r.content);
      } catch (err: any) {
        console.warn(`[AgentRunner] Gemini File Search failed, falling back to pgvector:`, err?.message);
        if (this.vectorStore) {
          try {
            const vectorResults = await this.vectorStore.similaritySearch(userMessage, 3, {
              namespace: agentId,
              minScore: 0.3,
            });
            fileSearchResults = vectorResults.map(r => r.entry.content);
          } catch (vecErr: any) {
            console.warn(`[AgentRunner] pgvector fallback also failed:`, vecErr?.message);
          }
        }
      }
    } else if (!storeId && this.companyKBId && this.geminiFileSearch) {
      // Fall back to company-wide KB
      try {
        const searchResult = await this.geminiFileSearch.search(this.companyKBId, userMessage, 3);
        fileSearchResults = searchResult.results.map(r => r.content);
      } catch (err: any) {
        console.warn(`[AgentRunner] Company KB search failed:`, err?.message);
      }
    } else if (this.vectorStore) {
      try {
        const vectorResults = await this.vectorStore.similaritySearch(userMessage, 3, {
          namespace: agentId,
          minScore: 0.3,
        });
        fileSearchResults = vectorResults.map(r => r.entry.content);
      } catch (err: any) {
        console.warn(`[AgentRunner] pgvector search failed:`, err?.message);
      }
    }

    if (fileSearchResults.length > 0) {
      contextParts.push(`## Project Knowledge Base\n${fileSearchResults.join('\n---\n')}`);
    }

    return contextParts.join('\n\n');
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
