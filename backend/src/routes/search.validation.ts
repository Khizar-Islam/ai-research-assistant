// Request validation for POST /api/search (and the question rules POST /api/query reuses).
// Kept free of database and network imports so it can be unit-tested on its own.
import { z } from "zod";

// ~420 real tokens at the measured ~4.74 chars/token: generous for a question, far below
// the 8,192-token point where the embedding model silently truncates input, and it keeps
// Step 5's prompt size predictable.
export const MAX_QUESTION_CHARS = 2_000;
export const DEFAULT_TOP_K = 5;
export const MAX_TOP_K = 20;

// Shared by /api/search and /api/query, so the two can't drift apart on length limits.
export const QuestionField = z
  .string({ error: "question is required and must be a string" })
  .trim()
  .min(1, "question must not be empty")
  .max(MAX_QUESTION_CHARS, `Question is too long (max ${MAX_QUESTION_CHARS.toLocaleString("en-US")} characters)`);

export const SearchRequest = z.object({
  question: QuestionField,
  topK: z
    .number({ error: `topK must be a whole number between 1 and ${MAX_TOP_K}` })
    .int(`topK must be a whole number between 1 and ${MAX_TOP_K}`)
    .min(1, `topK must be a whole number between 1 and ${MAX_TOP_K}`)
    .max(MAX_TOP_K, `topK must be a whole number between 1 and ${MAX_TOP_K}`)
    .default(DEFAULT_TOP_K),
});

export type SearchInput = z.infer<typeof SearchRequest>;

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

// One readable message for the client, e.g. "Question is too long (max 2,000 characters)".
export function parseJsonBody<T>(schema: z.ZodType<T>, body: unknown): Parsed<T> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: 'Send a JSON object like {"question": "..."} with Content-Type: application/json' };
  }
  const parsed = schema.safeParse(body);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: parsed.error.issues[0]!.message };
}

export const parseSearchRequest = (body: unknown): Parsed<SearchInput> => parseJsonBody(SearchRequest, body);
