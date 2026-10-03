// The SSE handler over a real HTTP connection (Express on a random port, Node's fetch as
// the client), with a fake answerer: checks the wire format, not the RAG flow.
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import express from "express";
import { RequestCancelledError } from "../services/aiRetry.ts";
import type { AnswerResult, Answerer, StreamHooks } from "../services/answering.ts";
import { GenerationError } from "../services/generation.ts";
import { createQueryStreamHandler } from "./queryStream.ts";

type Behaviour = (hooks: StreamHooks) => Promise<AnswerResult>;

// The test sets `behaviour` before each request; the handler calls it.
let behaviour: Behaviour;
let lastHooks: StreamHooks | undefined;
const fakeAnswerer: Pick<Answerer, "streamQuestion"> = {
  streamQuestion: (_userId, _question, hooks) => {
    lastHooks = hooks;
    return behaviour(hooks);
  },
};

let baseUrl: string;
let server: ReturnType<ReturnType<typeof express>["listen"]>;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.userId = "user-1"; // stands in for the auth middleware
    next();
  });
  app.post("/stream", createQueryStreamHandler(fakeAnswerer, 50));
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => server.close());

const ask = (body: unknown, signal?: AbortSignal) =>
  fetch(`${baseUrl}/stream`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });

// Splits an SSE body into { event, data } pairs; comment lines (heartbeats) are counted.
function parse(body: string) {
  const events: { event: string; data: unknown }[] = [];
  let comments = 0;
  for (const block of body.split("\n\n").filter(Boolean)) {
    if (block.startsWith(":")) {
      comments++;
      continue;
    }
    const event = /^event: (.+)$/m.exec(block)?.[1];
    const data = /^data: (.+)$/m.exec(block)?.[1];
    assert.ok(event && data, `malformed event block: ${JSON.stringify(block)}`);
    events.push({ event, data: JSON.parse(data) });
  }
  return { events, comments };
}

const result = (answer: string): AnswerResult => ({
  id: "query-1",
  question: "q",
  answer,
  answered: true,
  citations: [],
  truncated: false,
  model: "test-model",
  retrieval: { candidates: 1, sourcesUsed: 1, bestSimilarity: 0.7, skipped: null },
  timings: { embedMs: 1, searchMs: 1, generateMs: 1, totalMs: 3 },
  createdAt: new Date("2026-10-03T00:00:00Z"),
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("POST /api/query/stream", () => {
  it("streams stage, sources and text events, then done with the checked answer", async () => {
    behaviour = async (hooks) => {
      hooks.onStage("searching");
      hooks.onSources([]);
      hooks.onStage("writing");
      await hooks.onDelta("Line one\nand two [1].");
      return result("Line one\nand two [1].");
    };
    const response = await ask({ question: "What?" });

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/event-stream/);
    assert.equal(response.headers.get("cache-control"), "no-cache, no-transform");
    assert.deepEqual(
      parse(await response.text()).events.map((e) => [e.event, e.data]),
      [
        ["stage", { stage: "searching" }],
        ["sources", []],
        ["stage", { stage: "writing" }],
        ["delta", { text: "Line one\nand two [1]." }], // a newline in the text stays inside one data line
        ["done", { ...result("Line one\nand two [1]."), createdAt: "2026-10-03T00:00:00.000Z" }],
      ],
    );
  });

  it("rejects an invalid question with a plain 400 before any streaming starts", async () => {
    behaviour = async () => assert.fail("should not be called");
    const response = await ask({ question: "" });
    assert.equal(response.status, 400);
    assert.match(response.headers.get("content-type") ?? "", /application\/json/);
    assert.ok(((await response.json()) as { error: string }).error);
  });

  it("reports an AI failure as an error event with the same status and message as the JSON route", async () => {
    behaviour = async (hooks) => {
      hooks.onStage("searching");
      throw new GenerationError("rate_limited", "Answer generation service is busy (rate limit).");
    };
    const { events } = parse(await (await ask({ question: "q" })).text());
    assert.deepEqual(events.at(-1), {
      event: "error",
      data: { status: 503, message: "Answering is busy right now. Try again in a moment.", retryAfterSeconds: 30 },
    });
  });

  it("reports an unexpected failure as a generic error event", async () => {
    behaviour = async () => {
      throw new TypeError("boom");
    };
    const original = console.error;
    console.error = () => {}; // expected log line; keep test output clean
    try {
      const { events } = parse(await (await ask({ question: "q" })).text());
      assert.deepEqual(events, [{ event: "error", data: { status: 500, message: "Internal server error" } }]);
    } finally {
      console.error = original;
    }
  });

  it("sends heartbeat comments while the answer is slow", async () => {
    behaviour = async () => {
      await sleep(180); // heartbeat is 50 ms in this test
      return result("Done.");
    };
    const { events, comments } = parse(await (await ask({ question: "q" })).text());
    assert.ok(comments >= 2, `expected heartbeats, got ${comments}`);
    assert.equal(events.at(-1)!.event, "done");
  });

  it("aborts the work when the client disconnects mid-stream", async () => {
    let sawAbort = false;
    behaviour = async (hooks) => {
      hooks.onStage("searching");
      // Wait until the client is gone; a real answerer would be streaming from Gemini here.
      await new Promise<void>((resolve) => hooks.signal!.addEventListener("abort", () => resolve(), { once: true }));
      sawAbort = true;
      throw new RequestCancelledError();
    };
    const client = new AbortController();
    const response = await ask({ question: "q" }, client.signal);
    const reader = response.body!.getReader();
    await reader.read(); // the first event arrived
    client.abort();

    for (let i = 0; i < 50 && !sawAbort; i++) await sleep(10);
    assert.equal(sawAbort, true, "the handler's signal was aborted");
    assert.equal(lastHooks!.signal!.aborted, true);
  });
});
