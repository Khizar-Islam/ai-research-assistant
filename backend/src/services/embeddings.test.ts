import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiError } from "@google/genai";
import {
  classify,
  createEmbedder,
  EMBEDDING_DIMENSIONS,
  EmbeddingError,
  formatDocumentChunk,
  formatQuery,
  inBatches,
  DOCUMENT_BATCH_SIZE,
  MAX_CHUNKS_PER_DOCUMENT,
  MAX_ITEMS_PER_REQUEST,
  titleFromFilename,
  type EmbedBatch,
} from "./embeddings.ts";

// A vector whose first value records which input it was made for, so order is checkable.
const vectorFor = (n: number) => [n, ...Array<number>(EMBEDDING_DIMENSIONS - 1).fill(0.01)];

// A fake API: records every call; `fail` decides per call whether to throw instead.
function fakeApi(fail: (call: number) => unknown = () => undefined) {
  const calls: string[][] = [];
  let served = 0;
  const embedBatch: EmbedBatch = async (texts) => {
    calls.push(texts);
    const error = fail(calls.length);
    if (error) throw error;
    return texts.map(() => vectorFor(served++));
  };
  return { calls, embedBatch };
}

// A fake clock that only moves when the code under test sleeps; also captures log lines
// (so tests don't print to the console and can assert on them).
function fakeTime() {
  let t = 0;
  const waits: number[] = [];
  const logs: string[] = [];
  return {
    waits,
    logs,
    now: () => t,
    sleep: async (ms: number) => {
      waits.push(ms);
      t += ms;
    },
    log: (message: string) => logs.push(message),
  };
}

const apiError = (status: number, body: object = {}) =>
  new ApiError({ status, message: JSON.stringify({ error: { code: status, ...body } }) });
const rateLimited = (retryDelay?: string) =>
  apiError(429, retryDelay ? { details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay }] } : {});

const chunks = (n: number) => Array.from({ length: n }, (_, i) => `chunk ${i}`);

describe("prompt formats", () => {
  it("formats documents and queries the way gemini-embedding-2 expects", () => {
    assert.equal(formatDocumentChunk("My CV", "Hello."), "title: My CV | text: Hello.");
    assert.equal(formatDocumentChunk("", "Hello."), "title: none | text: Hello.");
    assert.equal(formatQuery("What is RAG?"), "task: search result | query: What is RAG?");
  });

  it("derives a readable title from the filename", () => {
    assert.equal(titleFromFilename("Khizar_Islam_Rathore_CV2.pdf"), "Khizar Islam Rathore CV2");
    assert.equal(titleFromFilename("notes|draft.md"), "notes draft");
    assert.equal(titleFromFilename(".pdf"), "");
  });
});

describe("inBatches", () => {
  it("splits into batches of at most the given size, keeping order", () => {
    assert.deepEqual(inBatches(chunks(250), 100).map((b) => b.length), [100, 100, 50]);
    assert.deepEqual(inBatches([], 100), []);
    assert.deepEqual(inBatches(chunks(3), 100)[0], ["chunk 0", "chunk 1", "chunk 2"]);
  });
});

describe("embedDocumentChunks", () => {
  it("sends formatted chunks in batches of 90 and returns vectors in order", async () => {
    // 90, not the API's 100: leaves free-tier headroom for questions during big uploads.
    assert.ok(DOCUMENT_BATCH_SIZE <= MAX_ITEMS_PER_REQUEST);
    const api = fakeApi();
    const vectors = await createEmbedder({ embedBatch: api.embedBatch }).embedDocumentChunks(chunks(250), "Doc");

    assert.deepEqual(api.calls.map((c) => c.length), [90, 90, 70]);
    assert.equal(api.calls[0]![0], "title: Doc | text: chunk 0");
    assert.equal(api.calls[2]![69], "title: Doc | text: chunk 249");
    assert.deepEqual(vectors.map((v) => v[0]), Array.from({ length: 250 }, (_, i) => i));
  });

  it("reports progress after each batch, only once that batch has succeeded", async () => {
    const progress: number[] = [];
    // Batch 2 fails once with a 500 and is retried: progress must not count it twice.
    const api = fakeApi((call) => (call === 2 ? apiError(500) : undefined));
    await createEmbedder({ embedBatch: api.embedBatch, ...fakeTime() }).embedDocumentChunks(
      chunks(250),
      "Doc",
      (count) => void progress.push(count),
    );

    assert.deepEqual(progress, [90, 180, 250]);
  });

  it("waits for an async progress callback before starting the next batch", async () => {
    const events: string[] = [];
    const api = fakeApi();
    const embedBatch: EmbedBatch = async (texts) => {
      events.push(`embed ${texts.length}`);
      return api.embedBatch(texts);
    };
    await createEmbedder({ embedBatch }).embedDocumentChunks(chunks(100), "Doc", async (count) => {
      await new Promise((resolve) => setImmediate(resolve));
      events.push(`progress ${count}`);
    });

    assert.deepEqual(events, ["embed 90", "progress 90", "embed 10", "progress 100"]);
  });

  it(`rejects documents over ${MAX_CHUNKS_PER_DOCUMENT} chunks without calling the API`, async () => {
    const api = fakeApi();
    const embedder = createEmbedder({ embedBatch: api.embedBatch });
    await assert.rejects(embedder.embedDocumentChunks(chunks(MAX_CHUNKS_PER_DOCUMENT + 1), "Doc"), {
      name: "EmbeddingError",
      code: "too_large",
      message: "Document is too large to index (1,001 chunks; the limit is 1,000)",
    });
    assert.equal(api.calls.length, 0);
    assert.equal((await embedder.embedDocumentChunks(chunks(MAX_CHUNKS_PER_DOCUMENT), "Doc")).length, 1000);
  });

  it("rejects malformed responses instead of storing them", async () => {
    const respond = (vectors: number[][]) => createEmbedder({ embedBatch: async () => vectors });
    const badResponses = [
      [vectorFor(0)], // 1 vector for 2 inputs
      [vectorFor(0), [1, 2, 3]], // wrong dimensions
      [vectorFor(0), [NaN, ...vectorFor(1).slice(1)]], // not a number
    ];
    for (const response of badResponses) {
      await assert.rejects(respond(response).embedDocumentChunks(chunks(2), "Doc"), {
        name: "EmbeddingError",
        code: "bad_response",
        message: "The embedding service returned an unexpected response",
      });
    }
  });
});

describe("retries", () => {
  it("waits as long as a 429 asks (retryDelay), then succeeds", async () => {
    const api = fakeApi((call) => (call === 1 ? rateLimited("38s") : undefined));
    const time = fakeTime();
    const vectors = await createEmbedder({ embedBatch: api.embedBatch, ...time }).embedDocumentChunks(chunks(3), "Doc");
    assert.equal(vectors.length, 3);
    assert.deepEqual(time.waits, [38_000]);
    assert.equal(api.calls.length, 2);
    assert.deepEqual(time.logs, ["[embeddings] rate limited, waiting 38s (attempt 2/6)"]);
  });

  it("waits 20s on a 429 that gives no retryDelay", async () => {
    const api = fakeApi((call) => (call === 1 ? rateLimited() : undefined));
    const time = fakeTime();
    await createEmbedder({ embedBatch: api.embedBatch, ...time }).embedDocumentChunks(chunks(1), "Doc");
    assert.deepEqual(time.waits, [20_000]);
  });

  it("gives up immediately when the daily quota is exhausted (very long retryDelay)", async () => {
    const api = fakeApi(() => rateLimited("3600s"));
    const time = fakeTime();
    await assert.rejects(
      createEmbedder({ embedBatch: api.embedBatch, ...time }).embedDocumentChunks(chunks(1), "Doc"),
      { name: "EmbeddingError", code: "quota_exhausted", message: "Embedding quota exceeded. Try again later." },
    );
    assert.deepEqual(time.waits, []);
    assert.deepEqual(time.logs, [], "no wait, so nothing to log");
  });

  it("backs off 1s, 2s, 4s on server errors and network failures", async () => {
    const api = fakeApi((call) => [apiError(503), new TypeError("fetch failed"), apiError(500)][call - 1]);
    const time = fakeTime();
    await createEmbedder({ embedBatch: api.embedBatch, ...time }).embedDocumentChunks(chunks(1), "Doc");
    assert.deepEqual(time.waits, [1000, 2000, 4000]);
    assert.equal(api.calls.length, 4);
    assert.deepEqual(time.logs, [
      "[embeddings] service error (503), waiting 1s (attempt 2/6)",
      "[embeddings] request failed (TypeError: fetch failed), waiting 2s (attempt 3/6)",
      "[embeddings] service error (500), waiting 4s (attempt 4/6)",
    ]);
  });

  it("does not retry requests the API rejects (bad key, bad request)", async () => {
    for (const status of [400, 403, 404]) {
      const original = apiError(status);
      const api = fakeApi(() => original);
      const error = await createEmbedder({ embedBatch: api.embedBatch, ...fakeTime() })
        .embedDocumentChunks(chunks(1), "Doc")
        .catch((e: unknown) => e);
      assert.ok(error instanceof EmbeddingError);
      assert.equal(error.code, "rejected");
      assert.equal(error.message, "The embedding service rejected the request");
      assert.equal(error.cause, original, "original error kept for the server log");
      assert.equal(api.calls.length, 1);
    }
  });

  it("stops after 6 attempts when the service stays down", async () => {
    const api = fakeApi(() => apiError(503));
    await assert.rejects(
      createEmbedder({ embedBatch: api.embedBatch, ...fakeTime() }).embedDocumentChunks(chunks(1), "Doc"),
      { code: "unavailable", message: "Embedding service is unavailable. Try again later." },
    );
    assert.equal(api.calls.length, 6);
  });

  it("keeps going across batches when every batch is rate-limited once (free tier)", async () => {
    // 1,000 chunks = 12 batches of up to 90; each hits the per-minute limit before succeeding.
    let lastBatch = 0;
    const api = fakeApi((call) => {
      if (call % 2 === 1) return rateLimited("45s");
      lastBatch++;
      return undefined;
    });
    const time = fakeTime();
    const vectors = await createEmbedder({ embedBatch: api.embedBatch, ...time }).embedDocumentChunks(chunks(1000), "Doc");
    assert.equal(vectors.length, 1000);
    assert.equal(lastBatch, 12);
    assert.equal(time.now(), 12 * 45_000); // 9 min of waiting, within the 20 min budget
  });

  it("gives up when the total time budget for a document runs out", async () => {
    // Each batch is rate-limited twice (85s each) before succeeding: no single batch comes
    // near the 6-attempt limit, but 12 batches would need 12 × 170s ≈ 34 min > 20 min.
    const api = fakeApi((call) => (call % 3 !== 0 ? rateLimited("85s") : undefined));
    const time = fakeTime();
    await assert.rejects(
      createEmbedder({ embedBatch: api.embedBatch, ...time }).embedDocumentChunks(chunks(1000), "Doc"),
      { code: "rate_limited", message: "Embedding service is busy (rate limit). Try again in a few minutes." },
    );
    const batchesDone = Math.floor(api.calls.length / 3);
    assert.ok(batchesDone >= 6 && batchesDone < 12, `stopped after ${batchesDone} batches`);
    assert.ok(time.now() <= 20 * 60_000, `waited ${time.now()} ms, past the budget`);
  });
});

describe("embedQuery", () => {
  it("formats the question as a query and returns one vector", async () => {
    const api = fakeApi();
    const vector = await createEmbedder({ embedBatch: api.embedBatch }).embedQuery("What is RAG?");
    assert.deepEqual(api.calls, [["task: search result | query: What is RAG?"]]);
    assert.equal(vector.length, EMBEDDING_DIMENSIONS);
  });

  it("fails fast with 'busy' (not 'quota exceeded') on a normal per-minute 429", async () => {
    // A user is waiting for an answer: don't sit through a 38s wait, and don't claim the
    // daily quota is gone when it's only the per-minute limit.
    const api = fakeApi(() => rateLimited("38s"));
    const time = fakeTime();
    await assert.rejects(createEmbedder({ embedBatch: api.embedBatch, ...time }).embedQuery("hi"), {
      code: "rate_limited",
      message: "Embedding service is busy (rate limit). Try again in a few minutes.",
    });
    assert.deepEqual(time.waits, []);
  });

  it("retries a brief server error", async () => {
    const api = fakeApi((call) => (call === 1 ? apiError(500) : undefined));
    const time = fakeTime();
    await createEmbedder({ embedBatch: api.embedBatch, ...time }).embedQuery("hi");
    assert.deepEqual(time.waits, [1000]);
  });
});

describe("classify", () => {
  it("reads status and retryDelay from the SDK's real ApiError", () => {
    assert.deepEqual(classify(rateLimited("38s")), { kind: "rate-limit", retryAfterMs: 38_000 });
    assert.deepEqual(classify(rateLimited("1.5s")), { kind: "rate-limit", retryAfterMs: 1_500 });
    assert.deepEqual(classify(apiError(503)), { kind: "transient" });
    assert.deepEqual(classify(apiError(403)), { kind: "fatal" });
    assert.deepEqual(classify(new DOMException("timed out", "TimeoutError")), { kind: "transient" });
  });
});
