// The only place the frontend talks to the Express API. Every request goes through
// apiFetch, so cross-cutting concerns (base URL, errors, and auth in Step 8) live here once.
import { API_URL } from "./config";
import type { DocumentListItem, DocumentSummary, DocumentWithChunks, HistoryQuery } from "./types";

// A failed request, with a message that is safe to show the user. status 0 means the
// API never answered (server down, wrong URL, CORS rejection).
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// Sends a request; returns the response if it succeeded, throws ApiError otherwise.
async function request(path: string, init: RequestInit = {}): Promise<Response> {
  // Step 8: attach the signed-in user's credentials here.
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, init);
  } catch (error) {
    // fetch only rejects when no HTTP response arrived at all. A cancelled request
    // (TanStack Query aborts outdated ones) is passed through untouched.
    if (isAbort(error)) throw error;
    throw new ApiError(0, `Can't reach the server at ${API_URL}. Is the backend running?`);
  }
  if (response.ok) return response;

  // Every API error is JSON { error: string }; anything else (e.g. a proxy's HTML error
  // page) falls back to a generic message instead of leaking markup into the UI.
  const body: unknown = await response.json().catch(() => null);
  const message =
    body && typeof body === "object" && "error" in body && typeof body.error === "string"
      ? body.error
      : `Request failed (${response.status})`;
  throw new ApiError(response.status, message);
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await request(path, init);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const isAbort = (error: unknown) => error instanceof DOMException && error.name === "AbortError";

// POST /api/query/stream: resolves once the server has accepted the question, with the
// body still streaming (read it with readServerEvents). An invalid question is rejected
// up front with a normal ApiError.
export async function askStream(question: string, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
  const response = await request("/api/query/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
    signal,
  });
  if (!response.body) throw new ApiError(0, "The server sent no answer stream.");
  return response.body;
}

export function listDocuments(signal?: AbortSignal): Promise<DocumentListItem[]> {
  return apiFetch<{ documents: DocumentListItem[] }>("/api/documents", { signal }).then((r) => r.documents);
}

// Resolves as soon as the file is stored (202); processing continues on the server and
// shows up in listDocuments.
export function uploadDocument(file: File): Promise<DocumentSummary> {
  const form = new FormData();
  form.append("file", file);
  // No Content-Type header: the browser sets multipart/form-data with the right boundary.
  return apiFetch<DocumentSummary>("/api/documents/upload", { method: "POST", body: form });
}

export function deleteDocument(id: string): Promise<void> {
  return apiFetch<void>(`/api/documents/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function getDocumentChunks(id: string, signal?: AbortSignal): Promise<DocumentWithChunks> {
  return apiFetch<DocumentWithChunks>(`/api/documents/${encodeURIComponent(id)}/chunks`, { signal });
}

// The user's past questions and answers, newest first (at most 50).
export function listQueries(limit = 20, signal?: AbortSignal): Promise<HistoryQuery[]> {
  return apiFetch<{ queries: HistoryQuery[] }>(`/api/queries?limit=${limit}`, { signal }).then((r) => r.queries);
}
