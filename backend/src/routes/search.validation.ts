// Request validation and error mapping for POST /api/search. Kept free of database and
// network imports so it can be unit-tested on its own (search.validation.test.ts).
import { z } from "zod";
import type { EmbeddingError } from "../services/embeddings.ts";

// ~420 real tokens at the measured ~4.74 chars/token: generous for a question, far below
// the 8,192-token point where the embedding model silently truncates input, and it keeps
// Step 5's prompt size predictable.
export const MAX_QUESTION_CHARS = 2_000;
export const DEFAULT_TOP_K = 5;
export const MAX_TOP_K = 20;

export const SearchRequest = z.object({
  question: z
    .string({ error: "question is required and must be a string" })
    .trim()
    .min(1, "question must not be empty")
    .max(MAX_QUESTION_CHARS, `Question is too long (max ${MAX_QUESTION_CHARS.toLocaleString("en-US")} characters)`),
  topK: z
    .number({ error: `topK must be a whole number between 1 and ${MAX_TOP_K}` })
    .int(`topK must be a whole number between 1 and ${MAX_TOP_K}`)
    .min(1, `topK must be a whole number between 1 and ${MAX_TOP_K}`)
    .max(MAX_TOP_K, `topK must be a whole number between 1 and ${MAX_TOP_K}`)
    .default(DEFAULT_TOP_K),
});

export type SearchInput = z.infer<typeof SearchRequest>;

// One readable message for the client, e.g. "Question is too long (max 2,000 characters)".
export function parseSearchRequest(body: unknown): { ok: true; value: SearchInput } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: 'Send a JSON object like {"question": "..."} with Content-Type: application/json' };
  }
  const parsed = SearchRequest.safeParse(body);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: parsed.error.issues[0]!.message };
}

// How an embedding failure looks to the client. 503: the service we depend on is busy or
// down, the request itself was fine. 502: that service misbehaved. `log`: worth a server
// log line with the underlying cause.
export function embeddingErrorResponse(error: EmbeddingError): {
  status: 502 | 503;
  message: string;
  retryAfterSeconds?: number;
  log: boolean;
} {
  switch (error.code) {
    case "rate_limited":
      return { status: 503, message: "Search is busy right now. Try again in a moment.", retryAfterSeconds: 30, log: false };
    case "quota_exhausted":
      return { status: 503, message: "The daily search quota has been reached. Try again tomorrow.", log: true };
    case "unavailable":
      return { status: 503, message: "Search is temporarily unavailable. Try again later.", log: true };
    case "rejected":
    case "bad_response":
    case "too_large": // can't happen for a single question, but keep the switch exhaustive
      return { status: 502, message: "Search failed because of a problem with the embedding service.", log: true };
  }
}
