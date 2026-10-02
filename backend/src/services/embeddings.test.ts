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
  MAX_CHUNKS_PER_DOCUMENT,
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

// A fake clock that only moves when the code under test sleeps.
function fakeTime() {
  let t = 0;
  const waits: number[] = [];
  return {
    waits,
    now: () => t,
    sleep: async (ms: number) => {
      waits.push(ms);
      t += ms;
    },
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
  it("sends formatted chunks in batches of 100 and returns vectors in order", async () => {
    const api = fakeApi();
    const vectors = await createEmbedder({ embedBatch: api.embedBatch }).embedDocumentChunks(chunks(250), "Doc");

    assert.deepEqual(api.calls.map((c) => c.length), [100, 100, 50]);
    assert.equal(api.calls[0]![0], "title: Doc | text: chunk 0");
    assert.equal(api.calls[2]![49], "title: Doc | text: chunk 249");
    assert.deepEqual(vectors.map((v) => v[0]), Array.from({ length: 250 }, (_, i) => i));
  });

  it(`rejects documents over ${MAX_CHUNKS_PER_DOCUMENT} chunks without calling the API`, async () => {
    const api = fakeApi();
    const embedder = createEmbedder({ embedBatch: api.embedBatch });
    await assert.rejects(embedder.embedDocumentChunks(chunks(MAX_CHUNKS_PER_DOCUMENT + 1), "Doc"), {
      name: "EmbeddingError",
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
      { name: "EmbeddingError", message: "Embedding quota exceeded. Try again later." },
    );
    assert.deepEqual(time.waits, []);
  });

  it("backs off 1s, 2s, 4s on server errors and network failures", async () => {
    const api = fakeApi((call) => [apiError(503), new TypeError("fetch failed"), apiError(500)][call - 1]);
    const time = fakeTime();
    await createEmbedder({ embedBatch: api.embedBatch, ...time }).embedDocumentChunks(chunks(1), "Doc");
    assert.deepEqual(time.waits, [1000, 2000, 4000]);
    assert.equal(api.calls.length, 4);
  });

  it("does not retry requests the API rejects (bad key, bad request)", async () => {
    for (const status of [400, 403, 404]) {
      const original = apiError(status);
      const api = fakeApi(() => original);
      const error = await createEmbedder({ embedBatch: api.embedBatch, ...fakeTime() })
        .embedDocumentChunks(chunks(1), "Doc")
        .catch((e: unknown) => e);
      assert.ok(error instanceof EmbeddingError);
      assert.equal(error.message, "The embedding service rejected the request");
      assert.equal(error.cause, original, "original error kept for the server log");
      assert.equal(api.calls.length, 1);
    }
  });

  it("stops after 6 attempts when the service stays down", async () => {
    const api = fakeApi(() => apiError(503));
    await assert.rejects(
      createEmbedder({ embedBatch: api.embedBatch, ...fakeTime() }).embedDocumentChunks(chunks(1), "Doc"),
      { message: "Embedding service is unavailable. Try again later." },
    );
    assert.equal(api.calls.length, 6);
  });

  it("keeps going across batches when every batch is rate-limited once (free tier)", async () => {
    // 1,000 chunks = 10 batches; each one hits the per-minute limit before succeeding.
    let lastBatch = 0;
    const api = fakeApi((call) => {
      if (call % 2 === 1) return rateLimited("45s");
      lastBatch++;
      return undefined;
    });
    const time = fakeTime();
    const vectors = await createEmbedder({ embedBatch: api.embedBatch, ...time }).embedDocumentChunks(chunks(1000), "Doc");
    assert.equal(vectors.length, 1000);
    assert.equal(lastBatch, 10);
    assert.equal(time.now(), 10 * 45_000); // 7.5 min of waiting, within the 20 min budget
  });

  it("gives up when the total time budget for a document runs out", async () => {
    // Each batch is rate-limited twice (85s each) before succeeding: no single batch comes
    // near the 6-attempt limit, but 10 batches would need 10 × 170s ≈ 28 min > 20 min.
    const api = fakeApi((call) => (call % 3 !== 0 ? rateLimited("85s") : undefined));
    const time = fakeTime();
    await assert.rejects(
      createEmbedder({ embedBatch: api.embedBatch, ...time }).embedDocumentChunks(chunks(1000), "Doc"),
      { message: "Embedding service is busy (rate limit). Try again in a few minutes." },
    );
    const batchesDone = Math.floor(api.calls.length / 3);
    assert.ok(batchesDone >= 6 && batchesDone < 10, `stopped after ${batchesDone} batches`);
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
