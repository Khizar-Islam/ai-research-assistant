// Response shapes of the Express API, mirrored by hand from backend/src/routes. If a
// route's response changes, change it here too. Dates arrive as ISO strings in JSON.

export type DocumentStatus = "processing" | "ready" | "failed";
export type DocumentFileType = "pdf" | "text";
// Where ingestion is while status = "processing" (kept after a failure, null once ready).
export type IngestStage = "extracting" | "chunking" | "embedding" | "saving";

export type DocumentSummary = {
  id: string;
  filename: string;
  fileType: DocumentFileType;
  status: DocumentStatus;
  errorMessage: string | null;
  stage: IngestStage | null;
  chunksTotal: number | null; // known once chunking finishes
  chunksEmbedded: number;
  createdAt: string;
};

// GET /api/documents also counts each document's stored chunks.
export type DocumentListItem = DocumentSummary & { chunkCount: number };

export type DocumentChunk = {
  id: string;
  chunkIndex: number;
  content: string;
  charCount: number;
  tokenEstimate: number;
};

export type DocumentWithChunks = { document: DocumentSummary; chunks: DocumentChunk[] };

// ── Questions and answers (backend/src/services/citations.ts, answering.ts) ──────────

// One source an answer cites: [marker] in the answer text → a chunk of a document.
export type Citation = {
  marker: number;
  chunkId: string;
  documentId: string;
  filename: string;
  chunkIndex: number;
  similarity: number; // cosine similarity of the chunk to the question, 0–1
  snippet: string; // the first ~300 characters of the chunk, saved with the answer
};

// History citations also say whether the chunk still exists (its document may have
// been deleted since the answer was given).
export type HistoryCitation = Citation & { available: boolean };

// GET /api/queries
export type HistoryQuery = {
  id: string;
  question: string;
  answer: string;
  answered: boolean; // false: the documents didn't contain the answer
  citations: HistoryCitation[];
  createdAt: string;
};

export type RetrievalInfo = {
  candidates: number;
  sourcesUsed: number;
  bestSimilarity: number | null;
  skipped: null | "no_documents" | "below_threshold";
};

// The final answer of POST /api/query (and the `done` event of /api/query/stream).
export type AnswerResult = {
  id: string;
  question: string;
  answer: string;
  answered: boolean;
  citations: Citation[];
  truncated: boolean;
  model: string | null;
  retrieval: RetrievalInfo;
  timings: { embedMs: number; searchMs: number; generateMs: number; totalMs: number };
  createdAt: string;
};
