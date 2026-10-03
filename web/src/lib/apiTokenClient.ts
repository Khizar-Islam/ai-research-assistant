// The browser's copy of the API token (see app/api/token/route.ts). Kept in memory only,
// never in localStorage, so it's gone when the tab closes and other tabs can't read it.

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
  const response = await fetch("/api/token", { cache: "no-store" });
  if (response.status === 401) {
    current = null;
    return null; // signed out
  }
  if (!response.ok) throw new Error(`Couldn't get an API token (${response.status})`);
  current = (await response.json()) as { token: string; expiresAt: number };
  return current.token;
}

// On sign-out: the token stays valid at the API until it expires (it's stateless), but
// this tab stops using it immediately.
export function forgetApiToken() {
  current = null;
}
