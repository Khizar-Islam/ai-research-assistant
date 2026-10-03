// requireAuth over a real HTTP connection (Express on a random port, fetch as the client),
// with a fake user resolver: checks what a client sees, not the database.
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import express from "express";
import { type ApiIdentity, secretKey, signApiToken } from "../lib/apiToken.ts";
import { errorHandler } from "./errorHandler.ts";
import { createRequireAuth } from "./requireAuth.ts";

const SECRET = secretKey("test-secret-that-is-at-least-32-characters-long");
const resolved: ApiIdentity[] = [];
let failResolve = false;

let baseUrl: string;
let server: ReturnType<ReturnType<typeof express>["listen"]>;

before(async () => {
  const resolveUser = async (identity: ApiIdentity) => {
    if (failResolve) throw new Error("database down");
    resolved.push(identity);
    return `user-for-${identity.providerAccountId}`;
  };
  const app = express();
  // Production-like: dev identities refused.
  app.get("/prod", createRequireAuth({ secret: SECRET, resolveUser, allowDevIdentities: false }), (req, res) => {
    res.json({ userId: req.userId });
  });
  app.get("/dev", createRequireAuth({ secret: SECRET, resolveUser, allowDevIdentities: true }), (req, res) => {
    res.json({ userId: req.userId });
  });
  app.use(errorHandler);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => server.close());

const call = async (path: string, authorization?: string) => {
  const response = await fetch(`${baseUrl}${path}`, { headers: authorization ? { Authorization: authorization } : {} });
  return { status: response.status, challenge: response.headers.get("www-authenticate"), body: (await response.json()) as Record<string, string> };
};
const google = { sub: "g-1", provider: "google" as const, email: "ada@example.com", name: "Ada" };
const dev = { sub: "dev-tester", provider: "dev" as const, email: "dev-tester@footnote.test" };

describe("requireAuth", () => {
  it("lets a valid token through and sets req.userId from the resolved user", async () => {
    const { status, body } = await call("/prod", `Bearer ${await signApiToken(google, SECRET)}`);
    assert.equal(status, 200);
    assert.equal(body.userId, "user-for-g-1");
    assert.equal(resolved.at(-1)!.email, "ada@example.com");
  });

  it("asks for sign-in when there's no Authorization header", async () => {
    const { status, challenge, body } = await call("/prod");
    assert.equal(status, 401);
    assert.equal(challenge, 'Bearer realm="footnote-api"');
    assert.deepEqual(body, { error: "Sign in to continue.", code: "unauthenticated" });
  });

  it("rejects headers that aren't a Bearer JWT", async () => {
    for (const header of ["Basic dXNlcjpwYXNz", "Bearer", "Bearer not-a-jwt", `Token ${await signApiToken(google, SECRET)}`]) {
      const { status, challenge, body } = await call("/prod", header);
      assert.equal(status, 401, header);
      assert.equal(body.code, "invalid_token", header);
      assert.match(challenge ?? "", /error="invalid_token"/);
    }
  });

  it('says "token_expired" for an expired token, so the client can refresh and retry', async () => {
    const now = Math.floor(Date.now() / 1000);
    const expired = await signApiToken(google, SECRET, { issuedAt: now - 120, expiresIn: now - 60 });
    const { status, body } = await call("/prod", `Bearer ${expired}`);
    assert.equal(status, 401);
    assert.equal(body.code, "token_expired");
  });

  it("rejects a token signed with the wrong secret", async () => {
    const forged = await signApiToken(google, secretKey("an-attacker-guessed-this-secret-0123456789"));
    assert.equal((await call("/prod", `Bearer ${forged}`)).body.code, "invalid_token");
  });

  it("refuses development sign-in identities unless explicitly allowed", async () => {
    const token = await signApiToken(dev, SECRET);
    const prod = await call("/prod", `Bearer ${token}`);
    assert.equal(prod.status, 401);
    assert.equal(prod.body.code, "invalid_token");

    const devAllowed = await call("/dev", `Bearer ${token}`);
    assert.equal(devAllowed.status, 200);
    assert.equal(devAllowed.body.userId, "user-for-dev-tester");
  });

  it("reports a database failure as a 500, not as a sign-in problem", async () => {
    failResolve = true;
    const original = console.error;
    console.error = () => {}; // the error handler logs it; keep test output clean
    try {
      const { status, body } = await call("/prod", `Bearer ${await signApiToken(google, SECRET)}`);
      assert.equal(status, 500);
      assert.equal(body.error, "Internal server error");
    } finally {
      console.error = original;
      failResolve = false;
    }
  });
});
