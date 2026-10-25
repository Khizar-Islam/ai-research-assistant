// Runs notFound and errorHandler on a tiny Express app (no database, no Gemini, no real
// env) with the same JSON body limit as app.ts, to check what a client sees when things
// go wrong: always JSON, a fixed message for server errors, and never the error's own text.
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, describe, it } from "node:test";
import express, { type Response } from "express";
import { errorHandler, notFound } from "./errorHandler.ts";

const FAKE_SECRET = "postgres://user:hunter2-not-real@db.example.com:5432/postgres";

// An Error with extra fields, the way libraries attach them.
const errorWith = (message: string, fields: Record<string, unknown>) => Object.assign(new Error(message), fields);

const app = express();
app.use(express.json({ limit: "1mb" }));
app.post("/echo", (req, res) => res.json(req.body));
app.get("/throws/plain", () => {
  throw new Error(`connect failed: ${FAKE_SECRET}`);
});
// Like a Gemini or Prisma SDK error: the upstream service's status, no statusCode.
app.get("/throws/status-only", () => {
  throw errorWith("upstream said forbidden", { status: 403 });
});
app.get("/throws/exposed-409", () => {
  throw errorWith("Document is already being processed", { statusCode: 409, expose: true });
});
app.get("/throws/hidden-409", () => {
  throw errorWith("internal detail about the conflict", { statusCode: 409 });
});
app.use(notFound);
app.use(errorHandler);

const server = app.listen(0);
after(() => server.close());
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

// Captures console.error while `run` executes, so the test can check what was logged.
async function capturingErrors<T>(run: () => Promise<T>): Promise<{ result: T; logged: string }> {
  const original = console.error;
  const lines: string[] = [];
  console.error = (...args: unknown[]) => {
    lines.push(args.map((arg) => (arg instanceof Error ? `${arg.message}\n${arg.stack}` : String(arg))).join(" "));
  };
  try {
    return { result: await run(), logged: lines.join("\n") };
  } finally {
    console.error = original;
  }
}

async function getJson(path: string, init?: RequestInit) {
  const response = await fetch(`${base}${path}`, init);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/);
  return { status: response.status, body: (await response.json()) as { error: string } };
}

describe("notFound", () => {
  it("answers an unknown route with 404 JSON", async () => {
    const { status, body } = await getJson("/api/does-not-exist");
    assert.equal(status, 404);
    assert.equal(body.error, "Not found: GET /api/does-not-exist");
  });
});

describe("errorHandler", () => {
  it("answers invalid JSON with 400 Malformed JSON body", async () => {
    const { status, body } = await getJson("/echo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"question": ',
    });
    assert.equal(status, 400);
    assert.equal(body.error, "Malformed JSON body");
  });

  it("answers a JSON body over 1 MB with 413 JSON", async () => {
    const { status, body } = await getJson("/echo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "x".repeat(1024 * 1024 + 1) }),
    });
    assert.equal(status, 413);
    assert.equal(body.error, "request entity too large"); // body-parser's own, marked safe to show
  });

  it("answers a thrown Error with a fixed 500 and logs the real error on the server only", async () => {
    const { result, logged } = await capturingErrors(async () => {
      const response = await fetch(`${base}/throws/plain`);
      return { status: response.status, text: await response.text() };
    });
    assert.equal(result.status, 500);
    assert.deepEqual(JSON.parse(result.text), { error: "Internal server error" });
    assert.ok(!result.text.includes("hunter2"), "the secret must not reach the client");
    assert.ok(logged.includes("hunter2"), "the real error should be in the server log");
  });

  it("ignores err.status: an SDK-style error with status 403 and no statusCode is a 500", async () => {
    const { result } = await capturingErrors(() => getJson("/throws/status-only"));
    assert.equal(result.status, 500);
    assert.equal(result.body.error, "Internal server error");
  });

  it("passes on a 4xx message only when the error marks it safe (expose: true)", async () => {
    const exposed = await getJson("/throws/exposed-409");
    assert.equal(exposed.status, 409);
    assert.equal(exposed.body.error, "Document is already being processed");

    const hidden = await getJson("/throws/hidden-409");
    assert.equal(hidden.status, 409);
    assert.equal(hidden.body.error, "Bad request");
  });

  it("hands the error to Express (next) once headers are sent, without replying again", () => {
    const err = new Error("failed mid-stream");
    let replied = false;
    const res = {
      headersSent: true,
      status: () => {
        replied = true;
        return res;
      },
      json: () => {
        replied = true;
        return res;
      },
    } as unknown as Response;
    const passedOn: unknown[] = [];

    errorHandler(err, {} as never, res, (e?: unknown) => passedOn.push(e));

    assert.deepEqual(passedOn, [err]);
    assert.equal(replied, false);
  });
});
