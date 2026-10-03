// Requires a signed-in user on every request: checks the `Authorization: Bearer <token>`
// header (see lib/apiToken.ts), turns the identity into our user id, and sets req.userId,
// which every route scopes its queries by. No valid token → 401, and nothing runs.
//
// The 401 body's `code` tells the web app what to do: "token_expired" → fetch a fresh
// token and retry; anything else → send the user to sign in.
import type { RequestHandler, Response } from "express";
import { ApiTokenError, verifyApiToken } from "../lib/apiToken.ts";
import type { ResolveUser } from "../services/users.ts";

type Options = {
  secret: Uint8Array;
  resolveUser: ResolveUser;
  // The development-only sign-in's identities. Refused unless this is true, so even a
  // correctly signed dev token is useless against a production API.
  allowDevIdentities: boolean;
};

const BEARER = /^Bearer\s+([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)$/;

export function createRequireAuth({ secret, resolveUser, allowDevIdentities }: Options): RequestHandler {
  return async (req, res, next) => {
    const header = req.get("authorization");
    if (!header) {
      unauthorized(res, "unauthenticated", "Sign in to continue.");
      return;
    }
    const token = BEARER.exec(header.trim())?.[1];
    if (!token) {
      unauthorized(res, "invalid_token", "Your sign-in isn't valid. Sign in again.");
      return;
    }

    let identity;
    try {
      identity = await verifyApiToken(token, secret);
    } catch (error) {
      if (error instanceof ApiTokenError && error.reason === "expired") {
        unauthorized(res, "token_expired", "Your sign-in expired. Sign in again.");
      } else {
        unauthorized(res, "invalid_token", "Your sign-in isn't valid. Sign in again.");
      }
      return;
    }
    if (identity.provider === "dev" && !allowDevIdentities) {
      unauthorized(res, "invalid_token", "Your sign-in isn't valid. Sign in again.");
      return;
    }

    // A database failure here is a server error (500), not a sign-in problem.
    req.userId = await resolveUser(identity);
    next();
  };
}

function unauthorized(res: Response, code: "unauthenticated" | "invalid_token" | "token_expired", message: string) {
  // RFC 6750: tell the client it's a Bearer-token API, and (for a bad token) why.
  const challenge = code === "unauthenticated" ? 'Bearer realm="footnote-api"' : `Bearer realm="footnote-api", error="invalid_token"`;
  res.status(401).set("WWW-Authenticate", challenge).json({ error: message, code });
}
