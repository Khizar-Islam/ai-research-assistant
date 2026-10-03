// Signs the short-lived token the browser sends to the Express API. Server-only: the
// secret must never reach browser code (the import below makes that a build error).
//
// Must produce exactly what the API verifies (backend/src/lib/apiToken.ts): HS256,
// issuer "footnote-web", audience "footnote-api", sub = the provider's stable user id,
// claims provider / email / email_verified / name / picture, and a lifetime under an hour.
import "server-only";
import { SignJWT } from "jose";

const ISSUER = "footnote-web";
const AUDIENCE = "footnote-api";
export const API_TOKEN_LIFETIME_SECONDS = 15 * 60;

export type TokenSubject = {
  provider: "google" | "dev";
  providerAccountId: string;
  email: string;
  name?: string | null;
  picture?: string | null;
};

function secret(): Uint8Array {
  const value = process.env.API_JWT_SECRET;
  if (!value || value.length < 32) {
    throw new Error("API_JWT_SECRET is missing or shorter than 32 characters (see web/.env.example).");
  }
  return new TextEncoder().encode(value);
}

export async function signApiToken(subject: TokenSubject): Promise<{ token: string; expiresAt: number }> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + API_TOKEN_LIFETIME_SECONDS;
  const token = await new SignJWT({
    provider: subject.provider,
    email: subject.email,
    // Only signed for verified addresses: Google sign-ins with an unverified email are
    // refused in auth.ts, and the dev user's address is ours.
    email_verified: true,
    ...(subject.name && { name: subject.name }),
    ...(subject.picture && { picture: subject.picture }),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(subject.providerAccountId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .sign(secret());
  return { token, expiresAt: expiresAt * 1000 }; // ms, for the browser's clock
}
