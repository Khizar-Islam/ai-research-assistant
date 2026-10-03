import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SignJWT } from "jose";
import { API_TOKEN_AUDIENCE, API_TOKEN_ISSUER, ApiTokenError, secretKey, signApiToken, verifyApiToken } from "./apiToken.ts";

const SECRET = secretKey("test-secret-that-is-at-least-32-characters-long");
const OTHER_SECRET = secretKey("a-different-secret-also-32-characters-or-more");
const IDENTITY = { sub: "google-123", provider: "google" as const, email: "Ada@Example.com", name: "Ada", picture: "https://lh3.googleusercontent.com/a/photo" };
const nowSeconds = () => Math.floor(Date.now() / 1000);

const rejectsWith = (promise: Promise<unknown>, reason: "expired" | "invalid") =>
  assert.rejects(promise, (error: Error) => error instanceof ApiTokenError && error.reason === reason);

// Builds a token by hand, to test claims the real signer would never produce.
const custom = (claims: Record<string, unknown>, { alg = "HS256", secret = SECRET, issuer = API_TOKEN_ISSUER, audience = API_TOKEN_AUDIENCE } = {}) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg })
    .setSubject("google-123")
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(secret);

describe("verifyApiToken", () => {
  it("accepts a token the web app would sign, and returns who it is", async () => {
    const identity = await verifyApiToken(await signApiToken(IDENTITY, SECRET), SECRET);
    assert.deepEqual(identity, {
      provider: "google",
      providerAccountId: "google-123",
      email: "ada@example.com", // emails are compared lowercased
      name: "Ada",
      image: "https://lh3.googleusercontent.com/a/photo",
    });
  });

  it("treats a missing name or picture as null", async () => {
    const identity = await verifyApiToken(await signApiToken({ sub: "d", provider: "dev", email: "dev@footnote.test" }, SECRET), SECRET);
    assert.equal(identity.name, null);
    assert.equal(identity.image, null);
  });

  it("reports an expired token as expired (the client fetches a new one)", async () => {
    const token = await signApiToken(IDENTITY, SECRET, { issuedAt: nowSeconds() - 120, expiresIn: nowSeconds() - 60 });
    await rejectsWith(verifyApiToken(token, SECRET), "expired");
  });

  it("rejects a token signed with another secret", async () => {
    await rejectsWith(verifyApiToken(await signApiToken(IDENTITY, OTHER_SECRET), SECRET), "invalid");
  });

  it("rejects the wrong issuer or audience (a token meant for something else)", async () => {
    const claims = { provider: "google", email: "a@b.co", email_verified: true };
    await rejectsWith(verifyApiToken(await custom(claims, { issuer: "someone-else" }), SECRET), "invalid");
    await rejectsWith(verifyApiToken(await custom(claims, { audience: "another-api" }), SECRET), "invalid");
  });

  it('rejects an unsigned token ("alg": "none")', async () => {
    const encode = (part: object) => Buffer.from(JSON.stringify(part)).toString("base64url");
    const unsigned = `${encode({ alg: "none" })}.${encode({ sub: "x", provider: "google", email: "a@b.co", email_verified: true, iss: API_TOKEN_ISSUER, aud: API_TOKEN_AUDIENCE, iat: nowSeconds(), exp: nowSeconds() + 600 })}.`;
    await rejectsWith(verifyApiToken(unsigned, SECRET), "invalid");
  });

  it("rejects any algorithm but HS256, even with the right secret", async () => {
    const claims = { provider: "google", email: "a@b.co", email_verified: true };
    await rejectsWith(verifyApiToken(await custom(claims, { alg: "HS512" }), SECRET), "invalid");
  });

  it("rejects an email the provider didn't verify (it could be anyone's)", async () => {
    await rejectsWith(verifyApiToken(await custom({ provider: "google", email: "a@b.co", email_verified: false }), SECRET), "invalid");
    await rejectsWith(verifyApiToken(await custom({ provider: "google", email: "a@b.co" }), SECRET), "invalid");
  });

  it("rejects missing or malformed identity claims", async () => {
    await rejectsWith(verifyApiToken(await custom({ provider: "google", email_verified: true }), SECRET), "invalid");
    await rejectsWith(verifyApiToken(await custom({ provider: "github", email: "a@b.co", email_verified: true }), SECRET), "invalid");
    await rejectsWith(verifyApiToken(await custom({ provider: "google", email: "not-an-email", email_verified: true }), SECRET), "invalid");
  });

  it("rejects a token issued to live longer than an hour", async () => {
    // Still unexpired, but issued 2 hours ago: no token the web app signs lives that long.
    const token = await signApiToken(IDENTITY, SECRET, { issuedAt: nowSeconds() - 7200, expiresIn: nowSeconds() + 600 });
    await rejectsWith(verifyApiToken(token, SECRET), "invalid");
  });

  it("rejects garbage", async () => {
    await rejectsWith(verifyApiToken("not.a.token", SECRET), "invalid");
    await rejectsWith(verifyApiToken("", SECRET), "invalid");
  });
});
