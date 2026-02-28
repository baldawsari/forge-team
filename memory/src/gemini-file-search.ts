/**
 * Gemini File Search RAG wrapper.
 *
 * Wraps the Google AI Gemini File Search API to provide retrieval-augmented
 * generation over uploaded documents. Supports store lifecycle management,
 * document upload, and similarity search with citation extraction.
 */

import { v4 as uuidv4 } from 'uuid';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileStore {
  id: string;
  name: string;
  projectId: string;
  documentCount: number;
  totalSizeBytes: number;
  createdAt: Date;
  updatedAt: Date;
  status: 'active' | 'indexing' | 'error' | 'deleted';
}

export interface UploadedDocument {
  id: string;
  storeId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  metadata: Record<string, unknown>;
  status: 'uploaded' | 'indexed' | 'error';
  uploadedAt: Date;
  indexedAt: Date | null;
}

export interface SearchCitation {
  documentId: string;
  filename: string;
  chunk: string;
  startIndex: number;
  endIndex: number;
  relevanceScore: number;
}

export interface SearchResultEntry {
  content: string;
  citations: SearchCitation[];
  relevanceScore: number;
}

export interface GeminiSearchResult {
  query: string;
  results: SearchResultEntry[];
  totalResults: number;
  searchTimeMs: number;
}

export interface GeminiFileSearchConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  maxRetries?: number;
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// In-memory store (backing data when API is unavailable)
// ---------------------------------------------------------------------------

interface InMemoryDoc {
  id: string;
  storeId: string;
  filename: string;
  content: string;
  mimeType: string;
  metadata: Record<string, unknown>;
  uploadedAt: Date;
}

// ---------------------------------------------------------------------------
// Gemini File Search
// ---------------------------------------------------------------------------

export class GeminiFileSearch {
  private config: Required<GeminiFileSearchConfig>;
  private stores: Map<string, FileStore> = new Map();
  private documents: Map<string, InMemoryDoc[]> = new Map();

  constructor(config: GeminiFileSearchConfig) {
    this.config = {
      apiKey: config.apiKey,
      baseUrl:
        config.baseUrl ??
        'https://generativelanguage.googleapis.com/v1beta',
      model: config.model ?? 'gemini-2.0-flash',
      maxRetries: config.maxRetries ?? 3,
      timeoutMs: config.timeoutMs ?? 30_000,
    };
  }

  /**
   * Create a Gemini File Search store scoped to a project.
   */
  async createStore(name: string, projectId: string): Promise<FileStore> {
    const storeId = uuidv4();
    const now = new Date();

    // Attempt to create via API; fall back to local tracking
    try {
      const response = await this.apiRequest('POST', '/corpora', {
        displayName: name,
        metadata: { projectId },
      });

      const store: FileStore = {
        id: (response?.name as string) ?? storeId,
        name,
        projectId,
        documentCount: 0,
        totalSizeBytes: 0,
        createdAt: now,
        updatedAt: now,
        status: 'active',
      };

      this.stores.set(store.id, store);
      this.documents.set(store.id, []);
      return store;
    } catch {
      // Fallback: track locally
      const store: FileStore = {
        id: storeId,
        name,
        projectId,
        documentCount: 0,
        totalSizeBytes: 0,
        createdAt: now,
        updatedAt: now,
        status: 'active',
      };

      this.stores.set(store.id, store);
      this.documents.set(store.id, []);
      return store;
    }
  }

  /**
   * Upload a document to a store.
   */
  async uploadDocument(
    storeId: string,
    content: string,
    metadata: Record<string, unknown> = {},
  ): Promise<UploadedDocument> {
    const store = this.stores.get(storeId);
    if (!store) {
      throw new Error(`Store ${storeId} not found`);
    }

    const docId = uuidv4();
    const filename =
      (metadata.filename as string) ?? `doc_${docId.slice(0, 8)}.txt`;
    const mimeType = (metadata.mimeType as string) ?? 'text/plain';
    const sizeBytes = Buffer.byteLength(content, 'utf-8');
    const now = new Date();

    // Attempt API upload
    let indexed = false;
    try {
      await this.apiRequest('POST', `/corpora/${storeId}/documents`, {
        displayName: filename,
        content: { parts: [{ text: content }] },
        metadata,
      });
      indexed = true;
    } catch {
      // Continue with local-only storage
    }

    const inMemDoc: InMemoryDoc = {
      id: docId,
      storeId,
      filename,
      content,
      mimeType,
      metadata,
      uploadedAt: now,
    };

    const storeDocs = this.documents.get(storeId) ?? [];
    storeDocs.push(inMemDoc);
    this.documents.set(storeId, storeDocs);

    // Update store stats
    store.documentCount += 1;
    store.totalSizeBytes += sizeBytes;
    store.updatedAt = now;

    const doc: UploadedDocument = {
      id: docId,
      storeId,
      filename,
      mimeType,
      sizeBytes,
      metadata,
      status: indexed ? 'indexed' : 'uploaded',
      uploadedAt: now,
      indexedAt: indexed ? now : null,
    };

    return doc;
  }

  /**
   * Search a store using RAG-style retrieval with citations.
   */
  async search(
    storeId: string,
    query: string,
    topK: number = 5,
  ): Promise<GeminiSearchResult> {
    const store = this.stores.get(storeId);
    if (!store) {
      throw new Error(`Store ${storeId} not found`);
    }

    const startTime = Date.now();

    // Attempt Gemini API grounded search
    try {
      const response = await this.apiRequest('POST', '/models/' + this.config.model + ':generateContent', {
        contents: [{ parts: [{ text: query }] }],
        tools: [
          {
            retrieval: {
              source: { corpus: `corpora/${storeId}` },
              maxChunks: topK,
            },
          },
        ],
      });

      if ((response?.candidates as any)?.[0]) {
        const candidate = (response.candidates as any[])[0];
        const groundingMetadata = candidate.groundingMetadata;
        const textContent =
          candidate.content?.parts?.[0]?.text ?? '';

        const citations: SearchCitation[] = (
          groundingMetadata?.groundingChunks ?? []
        ).map((chunk: Record<string, unknown>, idx: number) => ({
          documentId: (chunk as Record<string, unknown>).source ?? '',
          filename: '',
          chunk:
            (chunk as Record<string, Record<string, string>>).text?.text ??
            '',
          startIndex: idx * 100,
          endIndex: (idx + 1) * 100,
          relevanceScore:
            (
              groundingMetadata?.groundingSupports?.[idx] as
                | Record<string, number>
                | undefined
            )?.score ?? 0.8,
        }));

        return {
          query,
          results: [
            {
              content: textContent,
              citations,
              relevanceScore: 0.9,
            },
          ],
          totalResults: 1,
          searchTimeMs: Date.now() - startTime,
        };
      }
    } catch {
      // Fallback to local search
    }

    // Local fallback: simple keyword search across stored documents
    return this.localSearch(storeId, query, topK, startTime);
  }

  /**
   * List all stores.
   */
  async listStores(): Promise<FileStore[]> {
    // Attempt to fetch from API
    try {
      const response = await this.apiRequest('GET', '/corpora');
      if (response?.corpora && Array.isArray(response.corpora)) {
        // Merge API stores with local tracking
        for (const apiCorpus of response.corpora) {
          const id = apiCorpus.name as string;
          if (!this.stores.has(id)) {
            this.stores.set(id, {
              id,
              name: (apiCorpus.displayName as string) ?? id,
              projectId: '',
              documentCount: 0,
              totalSizeBytes: 0,
              createdAt: new Date(apiCorpus.createTime as string),
              updatedAt: new Date(apiCorpus.updateTime as string),
              status: 'active',
            });
          }
        }
      }
    } catch {
      // Return local stores only
    }

    return Array.from(this.stores.values()).filter(
      (s) => s.status !== 'deleted',
    );
  }

  /**
   * Delete a store and all its documents.
   */
  async deleteStore(storeId: string): Promise<boolean> {
    const store = this.stores.get(storeId);
    if (!store) return false;

    try {
      await this.apiRequest('DELETE', `/corpora/${storeId}`, {
        force: true,
      });
    } catch {
      // Continue with local deletion
    }

    store.status = 'deleted';
    store.updatedAt = new Date();
    this.documents.delete(storeId);

    return true;
  }

  /**
   * Get a specific store by ID.
   */
  async getStore(storeId: string): Promise<FileStore | null> {
    return this.stores.get(storeId) ?? null;
  }

  /**
   * Get all documents in a store.
   */
  async getDocuments(storeId: string): Promise<InMemoryDoc[]> {
    return this.documents.get(storeId) ?? [];
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async apiRequest(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const url = `${this.config.baseUrl}${path}?key=${this.config.apiKey}`;

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs,
    );

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        const options: RequestInit = {
          method,
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
        };

        if (body && method !== 'GET') {
          options.body = JSON.stringify(body);
        }

        const response = await fetch(url, options);

        clearTimeout(timeout);

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(
            `Gemini API error ${response.status}: ${errorText}`,
          );
        }

        const data = await response.json();
        return data as Record<string, unknown>;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < this.config.maxRetries - 1) {
          // Exponential backoff
          await new Promise((resolve) =>
            setTimeout(resolve, Math.pow(2, attempt) * 500),
          );
        }
      }
    }

    clearTimeout(timeout);
    throw lastError ?? new Error('Gemini API request failed');
  }

  private localSearch(
    storeId: string,
    query: string,
    topK: number,
    startTime: number,
  ): GeminiSearchResult {
    const docs = this.documents.get(storeId) ?? [];
    const queryLower = query.toLowerCase();
    const queryTerms = queryLower.split(/\s+/).filter((t) => t.length > 2);

    // Score each document by keyword overlap
    const scored = docs.map((doc) => {
      const contentLower = doc.content.toLowerCase();
      let score = 0;
      const matchedTerms: string[] = [];

      for (const term of queryTerms) {
        const occurrences = (
          contentLower.match(new RegExp(term, 'g')) ?? []
        ).length;
        if (occurrences > 0) {
          score += occurrences;
          matchedTerms.push(term);
        }
      }

      // Normalize score
      const normalizedScore =
        queryTerms.length > 0 ? matchedTerms.length / queryTerms.length : 0;

      return { doc, score, normalizedScore };
    });

    // Sort by score and take topK
    scored.sort((a, b) => b.score - a.score);
    const topResults = scored.slice(0, topK).filter((s) => s.score > 0);

    const results: SearchResultEntry[] = topResults.map((item) => {
      // Extract relevant chunks (sentences containing query terms)
      const sentences = item.doc.content.split(/(?<=[.!?])\s+/);
      const relevantChunks = sentences.filter((s) =>
        queryTerms.some((t) => s.toLowerCase().includes(t)),
      );
      const chunk =
        relevantChunks.slice(0, 3).join(' ') ||
        item.doc.content.slice(0, 500);

      return {
        content: chunk,
        citations: [
          {
            documentId: item.doc.id,
            filename: item.doc.filename,
            chunk,
            startIndex: 0,
            endIndex: chunk.length,
            relevanceScore: item.normalizedScore,
          },
        ],
        relevanceScore: item.normalizedScore,
      };
    });

    return {
      query,
      results,
      totalResults: results.length,
      searchTimeMs: Date.now() - startTime,
    };
  }
}
