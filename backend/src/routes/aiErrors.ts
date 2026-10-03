// How a failure of an AI service (embedding or answer generation) looks to the client.
// Shared by POST /api/search and POST /api/query. No database or network imports.
//
//   503: the service we depend on is busy or down; the request itself was fine.
//   502: that service misbehaved (rejected our request, returned garbage).
//   422: the model refused this particular content (safety filters); retrying won't help.
import type { AiServiceError } from "../services/aiRetry.ts";

export type AiErrorResponse = {
  status: 422 | 502 | 503;
  message: string;
  retryAfterSeconds?: number;
  log: boolean; // worth a server log line with the underlying cause
};

export function aiErrorResponse(error: AiServiceError, action: "Search" | "Answering"): AiErrorResponse {
  switch (error.code) {
    case "rate_limited":
      return { status: 503, message: `${action} is busy right now. Try again in a moment.`, retryAfterSeconds: 30, log: false };
    case "quota_exhausted":
      return { status: 503, message: `The daily ${action.toLowerCase()} quota has been reached. Try again tomorrow.`, log: true };
    case "unavailable":
      return { status: 503, message: `${action} is temporarily unavailable. Try again later.`, log: true };
    case "blocked":
      // The message was written for users ("...blocked by the model's safety filters.").
      return { status: 422, message: error.message, log: true };
    case "cancelled":
      // Only happens once the client has gone, so nobody receives this; it keeps the
      // switch exhaustive.
      return { status: 503, message: error.message, log: false };
    case "rejected":
    case "bad_response":
    case "too_large": // can't happen for a single question, but keep the switch exhaustive
      return { status: 502, message: `${action} failed because of a problem with the AI service.`, log: true };
  }
}
