// The API token: how a request proves which signed-in user it's from.
//
// The Next.js app signs one for its signed-in user (web/src/app/api/token/route.ts), the
// browser sends it as `Authorization: Bearer <token>`, and requireAuth checks it here.
// HS256 with API_JWT_SECRET, which only the two servers know. The Next.js signer must
// produce exactly these claims; keep both sides in sync.
import { errors, jwtVerify, SignJWT } from "jose";
import { z } from "zod";

export const API_TOKEN_ISSUER = "footnote-web";
export const API_TOKEN_AUDIENCE = "footnote-api";
// The web app asks for ~15-minute tokens. Anything claiming to live longer than this is
// rejected, so a leaked token can't be minted to last for days.
const MAX_TOKEN_AGE = "1h";

// Who signed in, and with what. "dev" is the development-only sign-in (never accepted in
// production: see requireAuth).
export type ApiIdentity = {
  provider: "google" | "dev";
  providerAccountId: string; // Google's stable user id ("sub"); survives email changes
  email: string;
  name: string | null;
  image: string | null;
};

const Claims = z.object({
  sub: z.string().min(1).max(255),
  provider: z.enum(["google", "dev"]),
  email: z.email().max(320),
  // Users are linked by email when they first arrive, which is only safe if the provider
  // verified that the address is theirs. Google says so in its profile; the web app
  // copies it here and doesn't sign tokens for unverified addresses.
  email_verified: z.literal(true),
  name: z.string().max(200).optional(),
  picture: z.url().max(2000).optional(),
});

export class ApiTokenError extends Error {
  override name = "ApiTokenError";
  constructor(readonly reason: "expired" | "invalid") {
    super(reason === "expired" ? "API token expired" : "API token invalid");
  }
}

export const secretKey = (secret: string) => new TextEncoder().encode(secret);

export async function verifyApiToken(token: string, secret: Uint8Array): Promise<ApiIdentity> {
  let payload: unknown;
  try {
    ({ payload } = await jwtVerify(token, secret, {
      algorithms: ["HS256"], // never "none", never an algorithm the token picks for itself
      issuer: API_TOKEN_ISSUER,
      audience: API_TOKEN_AUDIENCE,
      requiredClaims: ["exp", "iat", "sub"],
      maxTokenAge: MAX_TOKEN_AGE,
    }));
  } catch (error) {
    // jose uses JWTExpired both for a passed `exp` and for a token older than
    // maxTokenAge (claim "iat"). Only the first is a normal expiry worth refreshing; a
    // token that claims to have lived over an hour was never signed by the web app.
    const expired = error instanceof errors.JWTExpired && error.claim === "exp";
    throw new ApiTokenError(expired ? "expired" : "invalid");
  }

  const claims = Claims.safeParse(payload);
  if (!claims.success) throw new ApiTokenError("invalid");
  const { sub, provider, email, name, picture } = claims.data;
  return { provider, providerAccountId: sub, email: email.toLowerCase(), name: name ?? null, image: picture ?? null };
}

// Signs a token with the same claims the web app uses. For tests and for minting a token
// to call the API by hand (scripts/mint-token.ts); the running app never signs tokens.
export async function signApiToken(
  identity: { sub: string; provider: "google" | "dev"; email: string; name?: string; picture?: string },
  secret: Uint8Array,
  { expiresIn = "15m", issuedAt }: { expiresIn?: string | number; issuedAt?: number } = {},
): Promise<string> {
  const { sub, ...claims } = identity;
  return new SignJWT({ ...claims, email_verified: true })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setIssuer(API_TOKEN_ISSUER)
    .setAudience(API_TOKEN_AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresIn)
    .sign(secret);
}
