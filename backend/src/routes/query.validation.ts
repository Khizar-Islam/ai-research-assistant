// Request validation for POST /api/query and GET /api/queries. No database or network
// imports, so it can be unit-tested on its own.
import { z } from "zod";
import { type Parsed, parseJsonBody, QuestionField } from "./search.validation.ts";

const QueryRequest = z.object({ question: QuestionField });

export const parseQueryRequest = (body: unknown): Parsed<{ question: string }> => parseJsonBody(QueryRequest, body);

export const DEFAULT_HISTORY_LIMIT = 20;
export const MAX_HISTORY_LIMIT = 50;

// ?limit=N from the query string (a string, or an array if repeated: ?limit=1&limit=2).
export function parseHistoryLimit(raw: unknown): Parsed<number> {
  if (raw === undefined) return { ok: true, value: DEFAULT_HISTORY_LIMIT };
  const n = typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > MAX_HISTORY_LIMIT) {
    return { ok: false, error: `limit must be a whole number between 1 and ${MAX_HISTORY_LIMIT}` };
  }
  return { ok: true, value: n };
}
