// The only place the frontend talks to the Express API. Every request goes through
// request(), so cross-cutting concerns (base URL, errors, the signed-in user's token)
// live here once.
import { getApiToken } from "./apiTokenClient";
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

// Sends a request as the signed-in user; returns the response if it succeeded, throws
// ApiError otherwise.
//
// A 401 means the token was refused (normally: it expired since it was cached). The token
// is fetched fresh and the request retried once.
//   - No fresh token: nobody is signed in any more → off to sign in, then back here.
//   - A fresh token that's refused too: the user IS signed in, but the API won't accept
//     their tokens (e.g. API_JWT_SECRET differs between web and API). Sending them to sign
//     in would loop forever (sign-in sends signed-in users straight back), so it's
//     reported as an error on the page instead.
async function request(path: string, init: RequestInit = {}): Promise<Response> {
  let response = await send(path, init, await getApiToken());
  if (response.status === 401) {
    const fresh = await getApiToken({ forceRefresh: true });
    if (!fresh) {
      goToSignIn();
      throw new ApiError(401, "You're signed out. Sign in to continue.");
    }
    response = await send(path, init, fresh);
    if (response.status === 401) {
      throw new ApiError(401, "The server didn't accept your sign-in. Try signing out and in again; if it keeps happening, the app's auth settings are out of sync.");
    }
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

async function send(path: string, init: RequestInit, token: string | null): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  try {
    return await fetch(`${API_URL}${path}`, { ...init, headers });
  } catch (error) {
    // fetch only rejects when no HTTP response arrived at all. A cancelled request
    // (TanStack Query aborts outdated ones) is passed through untouched.
    if (isAbort(error)) throw error;
    throw new ApiError(0, `Can't reach the server at ${API_URL}. Is the backend running?`);
  }
}

// Off to sign in, coming back to this page afterwards. Guarded so a burst of parallel
// 401s navigates once.
let redirecting = false;
function goToSignIn() {
  if (redirecting || typeof window === "undefined") return;
  redirecting = true;
  const here = window.location.pathname + window.location.search;
  // A full page load on purpose (not router.push, which this plain module doesn't have
  // anyway): it also drops the in-memory token and every cached query of the old session.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(`/signin?callbackUrl=${encodeURIComponent(here)}`);
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
