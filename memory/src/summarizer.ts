/**
 * Auto-summarization module for the ForgeTeam memory system.
 *
 * Provides conversation compression, project summarization, and
 * incremental summary updates. Designed to be called every 50 turns
 * or on task close to keep memory compact and relevant.
 */

import { Pool } from 'pg';
import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system' | 'agent';
  agentId?: string;
  content: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface ProjectSummary {
  id: string;
  projectId: string;
  summary: string;
  keyDecisions: string[];
  openQuestions: string[];
  techStack: string[];
  milestones: MilestoneSummary[];
  generatedAt: Date;
  messageCount: number;
  tokenEstimate: number;
}

export interface MilestoneSummary {
  name: string;
  status: 'completed' | 'in-progress' | 'planned';
  description: string;
  completedAt?: Date;
}

export interface SummarizerConfig {
  maxSummaryLength: number;
  compactionThreshold: number;
  preserveRecentCount: number;
  sentenceBudget: number;
}

// ---------------------------------------------------------------------------
// Summarizer
// ---------------------------------------------------------------------------

export class Summarizer {
  private pool: Pool;
  private redis: Redis;
  private config: SummarizerConfig;
  private cachePrefix = 'forgeteam:summary:';

  constructor(
    pool: Pool,
    redis: Redis,
    config: Partial<SummarizerConfig> = {},
  ) {
    this.pool = pool;
    this.redis = redis;
    this.config = {
      maxSummaryLength: config.maxSummaryLength ?? 4000,
      compactionThreshold: config.compactionThreshold ?? 50,
      preserveRecentCount: config.preserveRecentCount ?? 10,
      sentenceBudget: config.sentenceBudget ?? 40,
    };
  }

  /**
   * Summarize a conversation into a compressed representation.
   *
   * Uses extractive summarization: scores sentences by importance signals
   * (position, keyword density, speaker transitions, question/decision markers),
   * then selects the top sentences within the token budget.
   */
  async summarizeConversation(
    messages: ConversationMessage[],
    maxLength: number = this.config.maxSummaryLength,
  ): Promise<string> {
    if (messages.length === 0) return '';
    if (messages.length <= 3) {
      return messages.map((m) => `[${m.role}] ${m.content}`).join('\n');
    }

    // Phase 1: Extract all sentences with metadata
    const scoredSentences = this.extractAndScoreSentences(messages);

    // Phase 2: Select top sentences within budget
    scoredSentences.sort((a, b) => b.score - a.score);

    const selected: typeof scoredSentences = [];
    let currentLength = 0;

    for (const sentence of scoredSentences) {
      if (currentLength + sentence.text.length > maxLength) continue;
      if (selected.length >= this.config.sentenceBudget) break;
      selected.push(sentence);
      currentLength += sentence.text.length;
    }

    // Phase 3: Reorder by original position for coherence
    selected.sort((a, b) => a.position - b.position);

    // Phase 4: Build summary with section markers
    const sections: string[] = [];
    let currentSpeaker = '';

    for (const sentence of selected) {
      if (sentence.speaker !== currentSpeaker) {
        currentSpeaker = sentence.speaker;
        sections.push(`\n[${currentSpeaker}]:`);
      }
      sections.push(sentence.text);
    }

    // Phase 5: Add header with stats
    const header = `[Conversation Summary | ${messages.length} messages | ${new Date().toISOString()}]`;
    const summary = `${header}\n${sections.join(' ').trim()}`;

    return summary.slice(0, maxLength);
  }

  /**
   * Generate a comprehensive project summary from all memory entries.
   */
  async summarizeProject(projectId: string): Promise<ProjectSummary> {
    // Check cache first
    const cacheKey = `${this.cachePrefix}project:${projectId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as ProjectSummary;
    }

    // Fetch all project-scoped memory entries
    const entriesResult = await this.pool.query(
      `SELECT content, metadata, tags, importance, created_at
       FROM memory_entries
       WHERE project_id = $1 AND superseded_by IS NULL
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY importance DESC, created_at DESC
       LIMIT 500`,
      [projectId],
    );

    const entries = entriesResult.rows;
    if (entries.length === 0) {
      const emptySummary: ProjectSummary = {
        id: uuidv4(),
        projectId,
        summary: 'No project data available yet.',
        keyDecisions: [],
        openQuestions: [],
        techStack: [],
        milestones: [],
        generatedAt: new Date(),
        messageCount: 0,
        tokenEstimate: 0,
      };
      return emptySummary;
    }

    // Extract key elements from entries
    const allContent = entries.map((e) => e.content as string);
    const allMetadata = entries.map((e) =>
      typeof e.metadata === 'string'
        ? JSON.parse(e.metadata)
        : (e.metadata ?? {}),
    );
    const allTags = entries.flatMap((e) =>
      typeof e.tags === 'string' ? JSON.parse(e.tags) : (e.tags ?? []),
    );

    // Extract decisions (entries containing decision-related keywords)
    const keyDecisions = this.extractByPattern(
      allContent,
      /(?:decided|decision|agreed|chosen|selected|approved|will use|going with)[\s:]+(.+?)(?:\.|$)/gi,
    );

    // Extract open questions
    const openQuestions = this.extractByPattern(
      allContent,
      /(?:question|unclear|need to|should we|how do we|todo|tbd|open item)[\s:]+(.+?)(?:\.|$)/gi,
    );

    // Extract tech stack mentions
    const techStack = this.extractTechStack(allContent, allTags);

    // Extract milestones from metadata
    const milestones = this.extractMilestones(allMetadata);

    // Build overall summary from top-importance entries
    const topEntries = allContent.slice(
      0,
      Math.min(20, allContent.length),
    );
    const summaryText = this.compressTexts(
      topEntries,
      this.config.maxSummaryLength,
    );

    const tokenEstimate = Math.ceil(summaryText.length / 4);

    const summary: ProjectSummary = {
      id: uuidv4(),
      projectId,
      summary: summaryText,
      keyDecisions: [...new Set(keyDecisions)].slice(0, 20),
      openQuestions: [...new Set(openQuestions)].slice(0, 15),
      techStack: [...new Set(techStack)].slice(0, 30),
      milestones,
      generatedAt: new Date(),
      messageCount: entries.length,
      tokenEstimate,
    };

    // Cache for 10 minutes
    await this.redis.setex(cacheKey, 600, JSON.stringify(summary));

    return summary;
  }

  /**
   * Incrementally update an existing summary with new content.
   * Avoids reprocessing the entire history.
   */
  async incrementalSummary(
    existingSummary: string,
    newContent: string,
  ): Promise<string> {
    if (!existingSummary.trim()) return newContent;
    if (!newContent.trim()) return existingSummary;

    // Parse existing summary into sentences
    const existingSentences = this.splitSentences(existingSummary);
    const newSentences = this.splitSentences(newContent);

    // Score new sentences for importance
    const scoredNew = newSentences.map((sentence, idx) => ({
      text: sentence,
      score: this.scoreSentence(sentence, idx, newSentences.length, 'new'),
      isNew: true,
    }));

    // Score existing sentences (with slight decay)
    const scoredExisting = existingSentences.map((sentence, idx) => ({
      text: sentence,
      score:
        this.scoreSentence(
          sentence,
          idx,
          existingSentences.length,
          'existing',
        ) * 0.9, // Slight decay for older content
      isNew: false,
    }));

    // Merge and deduplicate
    const allScored = [...scoredExisting, ...scoredNew];
    const deduped = this.deduplicateSentences(allScored);

    // Sort by score and select within budget
    deduped.sort((a, b) => b.score - a.score);
    const selected = deduped.slice(0, this.config.sentenceBudget);

    // Rebuild summary preserving some order
    // New content at the end for chronological sense
    const oldParts = selected
      .filter((s) => !s.isNew)
      .map((s) => s.text);
    const newParts = selected
      .filter((s) => s.isNew)
      .map((s) => s.text);

    const combined = [...oldParts, ...newParts].join(' ');
    return combined.slice(0, this.config.maxSummaryLength);
  }

  /**
   * Check if compaction is needed for a session and trigger if so.
   * Called after message processing to maintain memory hygiene.
   */
  async checkAndCompact(
    sessionId: string,
  ): Promise<{ compacted: boolean; summary?: string }> {
    const countResult = await this.pool.query(
      `SELECT COUNT(*) FROM memory_entries
       WHERE thread_id = $1 AND superseded_by IS NULL`,
      [sessionId],
    );

    const count = Number(countResult.rows[0].count);

    if (count < this.config.compactionThreshold) {
      return { compacted: false };
    }

    // Fetch entries beyond the preserve window
    const entriesResult = await this.pool.query(
      `SELECT content, metadata, importance, created_at
       FROM memory_entries
       WHERE thread_id = $1 AND superseded_by IS NULL
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY created_at ASC
       LIMIT $2`,
      [sessionId, count - this.config.preserveRecentCount],
    );

    const entriesToCompact = entriesResult.rows;
    if (entriesToCompact.length === 0) {
      return { compacted: false };
    }

    const messages: ConversationMessage[] = entriesToCompact.map((e) => ({
      role: 'assistant' as const,
      content: e.content as string,
      timestamp: new Date(e.created_at as string),
    }));

    const summary = await this.summarizeConversation(messages);

    return { compacted: true, summary };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private extractAndScoreSentences(
    messages: ConversationMessage[],
  ): Array<{ text: string; score: number; position: number; speaker: string }> {
    const results: Array<{
      text: string;
      score: number;
      position: number;
      speaker: string;
    }> = [];

    let globalPosition = 0;

    for (let msgIdx = 0; msgIdx < messages.length; msgIdx++) {
      const msg = messages[msgIdx];
      const sentences = this.splitSentences(msg.content);

      for (let sIdx = 0; sIdx < sentences.length; sIdx++) {
        const sentence = sentences[sIdx];
        if (sentence.length < 10) continue;

        const score = this.scoreSentence(
          sentence,
          globalPosition,
          messages.length * 3, // Rough total sentence estimate
          msg.role,
        );

        // Boost first and last messages
        const positionBoost =
          msgIdx === 0 || msgIdx === messages.length - 1 ? 0.15 : 0;

        // Boost speaker transitions
        const transitionBoost =
          msgIdx > 0 && messages[msgIdx - 1].role !== msg.role ? 0.1 : 0;

        results.push({
          text: sentence,
          score: score + positionBoost + transitionBoost,
          position: globalPosition,
          speaker: msg.agentId ?? msg.role,
        });

        globalPosition++;
      }
    }

    return results;
  }

  private scoreSentence(
    sentence: string,
    position: number,
    totalPositions: number,
    role: string,
  ): number {
    let score = 0.3; // Base score

    const lower = sentence.toLowerCase();

    // Decision/action markers are high value
    const decisionPatterns = [
      /\b(decided|decision|agreed|approved|selected|chosen)\b/,
      /\b(will|shall|must|should)\b/,
      /\b(implement|create|build|deploy|configure)\b/,
      /\b(requirement|specification|constraint)\b/,
    ];
    for (const pattern of decisionPatterns) {
      if (pattern.test(lower)) score += 0.15;
    }

    // Questions are valuable for context
    if (lower.includes('?')) score += 0.1;

    // Technical content is valuable
    const techPatterns = [
      /\b(api|database|server|client|component|module|function|class|interface)\b/,
      /\b(error|bug|fix|issue|vulnerability|security)\b/,
      /\b(test|testing|coverage|assertion)\b/,
      /\b(performance|latency|throughput|scaling)\b/,
    ];
    for (const pattern of techPatterns) {
      if (pattern.test(lower)) score += 0.1;
    }

    // Enumerated items or structured content
    if (/^\d+[.)]/.test(sentence) || /^[-*]/.test(sentence)) {
      score += 0.05;
    }

    // Longer sentences tend to carry more information
    const wordCount = sentence.split(/\s+/).length;
    if (wordCount > 10 && wordCount < 50) score += 0.05;

    // Position-based scoring: beginning and end of conversation are more important
    const relativePosition = position / Math.max(totalPositions, 1);
    if (relativePosition < 0.1 || relativePosition > 0.9) {
      score += 0.1;
    }

    // System messages are often high-value context
    if (role === 'system') score += 0.1;

    return Math.min(1.0, score);
  }

  private splitSentences(text: string): string[] {
    return text
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  private deduplicateSentences(
    sentences: Array<{ text: string; score: number; isNew: boolean }>,
  ): Array<{ text: string; score: number; isNew: boolean }> {
    const seen = new Map<string, (typeof sentences)[0]>();

    for (const sentence of sentences) {
      const normalized = sentence.text
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();

      const existing = seen.get(normalized);
      if (!existing || sentence.score > existing.score) {
        seen.set(normalized, sentence);
      }
    }

    return Array.from(seen.values());
  }

  private extractByPattern(texts: string[], pattern: RegExp): string[] {
    const matches: string[] = [];

    for (const text of texts) {
      let match: RegExpExecArray | null;
      const localPattern = new RegExp(pattern.source, pattern.flags);
      while ((match = localPattern.exec(text)) !== null) {
        const captured = (match[1] ?? match[0]).trim();
        if (captured.length > 5 && captured.length < 500) {
          matches.push(captured);
        }
      }
    }

    return matches;
  }

  private extractTechStack(texts: string[], tags: string[]): string[] {
    const techKeywords = new Set<string>();

    // Known tech patterns
    const patterns = [
      /\b(React|Next\.js|Vue|Angular|Svelte|Remix)\b/gi,
      /\b(Node\.js|Express|Fastify|NestJS|Hono)\b/gi,
      /\b(PostgreSQL|Redis|MongoDB|SQLite|MySQL|Qdrant)\b/gi,
      /\b(TypeScript|JavaScript|Python|Rust|Go|Java)\b/gi,
      /\b(Docker|Kubernetes|Terraform|AWS|GCP|Azure)\b/gi,
      /\b(GraphQL|REST|gRPC|WebSocket|SSE)\b/gi,
      /\b(TailwindCSS|Prisma|Drizzle|Zod|tRPC)\b/gi,
      /\b(pgvector|Gemini|Claude|OpenAI|Anthropic)\b/gi,
    ];

    for (const text of texts) {
      for (const pattern of patterns) {
        const localPattern = new RegExp(pattern.source, pattern.flags);
        let match: RegExpExecArray | null;
        while ((match = localPattern.exec(text)) !== null) {
          techKeywords.add(match[0]);
        }
      }
    }

    // Also include relevant tags
    for (const tag of tags) {
      if (
        tag.startsWith('tech:') ||
        tag.startsWith('lang:') ||
        tag.startsWith('framework:')
      ) {
        techKeywords.add(tag.split(':')[1]);
      }
    }

    return Array.from(techKeywords);
  }

  private extractMilestones(
    metadataEntries: Record<string, unknown>[],
  ): MilestoneSummary[] {
    const milestones: MilestoneSummary[] = [];

    for (const meta of metadataEntries) {
      if (meta.milestone && typeof meta.milestone === 'object') {
        const m = meta.milestone as Record<string, unknown>;
        milestones.push({
          name: (m.name as string) ?? 'Unknown',
          status: (m.status as MilestoneSummary['status']) ?? 'planned',
          description: (m.description as string) ?? '',
          completedAt: m.completedAt
            ? new Date(m.completedAt as string)
            : undefined,
        });
      }

      if (meta.phase === 'completed' && meta.phaseName) {
        milestones.push({
          name: `Phase: ${meta.phaseName as string}`,
          status: 'completed',
          description: (meta.summary as string) ?? '',
          completedAt: meta.completedAt
            ? new Date(meta.completedAt as string)
            : undefined,
        });
      }
    }

    return milestones;
  }

  private compressTexts(texts: string[], maxLength: number): string {
    const allSentences: Array<{ text: string; score: number }> = [];

    for (const text of texts) {
      const sentences = this.splitSentences(text);
      for (let i = 0; i < sentences.length; i++) {
        allSentences.push({
          text: sentences[i],
          score: this.scoreSentence(sentences[i], i, sentences.length, 'content'),
        });
      }
    }

    // Deduplicate
    const deduped = this.deduplicateSentences(
      allSentences.map((s) => ({ ...s, isNew: false })),
    );

    // Sort by score
    deduped.sort((a, b) => b.score - a.score);

    // Select within budget
    let result = '';
    for (const sentence of deduped) {
      if (result.length + sentence.text.length + 1 > maxLength) continue;
      result += (result.length > 0 ? ' ' : '') + sentence.text;
    }

    return result;
  }
}
