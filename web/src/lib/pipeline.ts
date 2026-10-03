// Facts about the backend's ingestion pipeline that the UI needs. Mirrored by hand from
// backend/src (middleware/upload.ts, services/embeddings.ts): keep them in sync.
import type { IngestStage } from "./types";

export const STAGES: readonly IngestStage[] = ["extracting", "chunking", "embedding", "saving"];

// Chunks the backend embeds per Gemini request (DOCUMENT_BATCH_SIZE). Lets the UI show
// which passages are being embedded right now, between progress updates.
export const EMBED_BATCH_SIZE = 90;

export const ACCEPTED_EXTENSIONS = [".pdf", ".txt", ".md"] as const;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// The same checks the server makes, done first so an obviously wrong file fails
// instantly. The server still has the final say (it also checks the file's contents).
export function checkUpload(file: File): string | null {
  const name = file.name.toLowerCase();
  if (!ACCEPTED_EXTENSIONS.some((extension) => name.endsWith(extension))) {
    return "Only .pdf, .txt and .md files can be uploaded";
  }
  if (file.size === 0) return "The file is empty";
  if (file.size > MAX_UPLOAD_BYTES) return "Larger than the 10 MB limit";
  return null;
}
