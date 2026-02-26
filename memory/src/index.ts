/**
 * Memory system entry point.
 * Exports all memory modules for the ForgeTeam system.
 */

export {
  MemoryManager,
  type HierarchicalScope,
  type MemoryEntry,
  type StoreOptions,
  type SearchFilters,
  type CompactionResult,
} from './memory-manager';

export {
  GeminiFileSearch,
  type FileStore,
  type UploadedDocument,
  type SearchCitation,
  type SearchResultEntry,
  type GeminiSearchResult,
  type GeminiFileSearchConfig,
} from './gemini-file-search';

export {
  VectorStore,
  type VectorEntry,
  type SimilarityResult,
  type VectorSearchFilters,
  type VectorStoreConfig,
} from './vector-store';

export {
  Summarizer,
  type ConversationMessage,
  type ProjectSummary,
  type MilestoneSummary,
  type SummarizerConfig,
} from './summarizer';
