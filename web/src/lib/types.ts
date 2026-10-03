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
