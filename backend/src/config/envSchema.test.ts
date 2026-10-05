// The environment rules, especially the production guards: a misconfigured server must
// refuse to start rather than run with dev sign-in allowed or CORS that can never match.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseEnv } from "./envSchema.ts";

// Just enough to pass the always-required variables (fake values).
const BASE = {
  DATABASE_URL: "postgresql://user:pass@localhost:6543/postgres",
  GEMINI_API_KEY: "x".repeat(39),
  API_JWT_SECRET: "y".repeat(32),
};
const PRODUCTION = { ...BASE, NODE_ENV: "production", CORS_ORIGIN: "https://footnote.vercel.app" };

function errorOf(source: Record<string, string | undefined>): string {
  const result = parseEnv(source);
  assert.ok("error" in result, "expected the environment to be rejected");
  return result.error;
}

describe("parseEnv", () => {
  it("defaults to local development, allowing the local web app", () => {
    const result = parseEnv(BASE);
    assert.ok("env" in result);
    assert.equal(result.env.NODE_ENV, "development");
    assert.equal(result.env.PORT, 4000);
    assert.deepEqual(result.env.CORS_ORIGIN, ["http://localhost:3000"]);
  });

  it("accepts a correct production setup, with Render's PORT", () => {
    const result = parseEnv({ ...PRODUCTION, RENDER: "true", PORT: "10000" });
    assert.ok("env" in result);
    assert.equal(result.env.PORT, 10000);
    assert.deepEqual(result.env.CORS_ORIGIN, ["https://footnote.vercel.app"]);
    assert.ok(!("RENDER" in result.env), "RENDER is only used for the check");
  });

  it("refuses to run on Render unless NODE_ENV is production", () => {
    assert.match(errorOf({ ...BASE, RENDER: "true", CORS_ORIGIN: "https://footnote.vercel.app" }), /NODE_ENV/);
    assert.match(errorOf({ ...PRODUCTION, NODE_ENV: "development", RENDER: "true" }), /NODE_ENV/);
  });

  it("requires CORS_ORIGIN in production", () => {
    const missing = errorOf({ ...PRODUCTION, CORS_ORIGIN: undefined });
    assert.match(missing, /required in production/);
    assert.match(missing, /at CORS_ORIGIN/);
    assert.match(errorOf({ ...PRODUCTION, CORS_ORIGIN: "  " }), /required in production/);
  });

  it("rejects origins the browser's Origin header could never match", () => {
    assert.match(errorOf({ ...PRODUCTION, CORS_ORIGIN: "https://footnote.vercel.app/" }), /no path or trailing slash/);
    assert.match(errorOf({ ...PRODUCTION, CORS_ORIGIN: "https://footnote.vercel.app/chat" }), /no path or trailing slash/);
    assert.match(errorOf({ ...PRODUCTION, CORS_ORIGIN: "footnote.vercel.app" }), /not a URL/);
  });

  it("requires https origins in production, but allows http locally", () => {
    assert.match(errorOf({ ...PRODUCTION, CORS_ORIGIN: "http://footnote.vercel.app" }), /https:\/\/ in production/);
    const local = parseEnv({ ...BASE, CORS_ORIGIN: "http://localhost:3000, http://127.0.0.1:3000" });
    assert.ok("env" in local);
    assert.deepEqual(local.env.CORS_ORIGIN, ["http://localhost:3000", "http://127.0.0.1:3000"]);
  });

  it("never prints secret values in its errors", () => {
    const secret = "postgresql://user:SUPERSECRET@db:6543/postgres";
    const error = errorOf({ ...BASE, DATABASE_URL: secret, API_JWT_SECRET: "tiny-JWT-XYZ" });
    assert.match(error, /API_JWT_SECRET/);
    assert.ok(!error.includes("SUPERSECRET"));
    assert.ok(!error.includes("tiny-JWT-XYZ"), error);
  });
});
