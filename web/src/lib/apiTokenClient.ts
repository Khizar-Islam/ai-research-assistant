// The browser's copy of the API token (see app/api/token/route.ts). Kept in memory only,
// never in localStorage, so it's gone when the tab closes and other tabs can't read it.
// ApiError comes from api.ts, which imports this module too; that's fine because neither
// uses the other's exports until a request runs.
import { ApiError } from "./api";

const REFRESH_EARLY_MS = 60_000; // renew a minute before expiry, not at the last second

let current: { token: string; expiresAt: number } | null = null;
let inFlight: Promise<string | null> | null = null;

// A valid token for the signed-in user, or null if nobody is signed in. Parallel callers
// (a page load fires several requests at once) share one request to /api/token.
export async function getApiToken({ forceRefresh = false } = {}): Promise<string | null> {
  if (!forceRefresh && current && current.expiresAt - Date.now() > REFRESH_EARLY_MS) return current.token;
  inFlight ??= fetchToken().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function fetchToken(): Promise<string | null> {
  let response: Response;
  try {
    response = await fetch("/api/token", { cache: "no-store" });
  } catch {
    // No response at all (offline, connection dropped): not the browser's "Failed to fetch".
    throw new ApiError(0, "Couldn't check your sign-in. Check your connection and try again.");
  }
  if (response.status === 401) {
    current = null;
    return null; // signed out
  }
  if (!response.ok) throw new ApiError(response.status, `Couldn't check your sign-in (${response.status}). Try again.`);
  try {
    current = (await response.json()) as { token: string; expiresAt: number };
  } catch {
    throw new ApiError(response.status, `Couldn't check your sign-in (${response.status}). Try again.`);
  }
  return current.token;
}

// On sign-out: the token stays valid at the API until it expires (it's stateless), but
// this tab stops using it immediately.
export function forgetApiToken() {
  current = null;
}
