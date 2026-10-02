import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type AnswerDeps, CANDIDATES, createAnswerer, NO_DOCUMENTS_ANSWER } from "./answering.ts";
import { GenerationError, REFUSAL } from "./generation.ts";
import type { RetrievedChunk } from "./retrieval.ts";

const chunk = (n: number, similarity: number, content = `Fact number ${n}.`): RetrievedChunk => ({
  chunkId: `chunk-${n}`,
  documentId: `doc-${n}`,
  filename: `file-${n}.pdf`,
  chunkIndex: n,
  content,
  similarity,
});

// Fakes for every dependency; records what the flow did.
function fakes(results: RetrievedChunk[], generatedText: string | Error = "Answer [1].") {
  const calls = { retrieve: [] as unknown[][], generate: [] as unknown[][], save: [] as Parameters<AnswerDeps["save"]>[0][], logs: [] as string[] };
  const deps: AnswerDeps = {
    retrieve: async (...args) => {
      calls.retrieve.push(args);
      return { results, timings: { embedMs: 5, searchMs: 3 } };
    },
    generate: async (...args) => {
      calls.generate.push(args);
      if (generatedText instanceof Error) throw generatedText;
      return { text: generatedText, truncated: false, model: "test-model" };
    },
    save: async (row) => {
      calls.save.push(row);
      return { id: "query-1", createdAt: new Date("2026-10-03T00:00:00Z") };
    },
    log: (message) => calls.logs.push(message),
  };
  return { calls, answerer: createAnswerer(deps) };
}

describe("answerQuestion", () => {
  it(`retrieves ${CANDIDATES} candidates for the user's question`, async () => {
    const { calls, answerer } = fakes([chunk(1, 0.7)]);
    await answerer.answerQuestion("user-1", "What?");
    assert.deepEqual(calls.retrieve, [["user-1", "What?", CANDIDATES]]);
  });

  it("answers from the filtered sources, with citations, and saves the row", async () => {
    // 0.75 and 0.70 are within the window; 0.52 is dropped before the model sees it.
    const { calls, answerer } = fakes([chunk(1, 0.75), chunk(2, 0.7), chunk(3, 0.52)], "Fact one [1]. Fact two [2].");
    const result = await answerer.answerQuestion("user-1", "What?");

    assert.deepEqual((calls.generate[0]![1] as RetrievedChunk[]).map((s) => s.chunkId), ["chunk-1", "chunk-2"]);
    assert.equal(result.answer, "Fact one [1]. Fact two [2].");
    assert.equal(result.answered, true);
    assert.deepEqual(result.citations.map((c) => [c.marker, c.chunkId]), [[1, "chunk-1"], [2, "chunk-2"]]);
    assert.equal(result.model, "test-model");
    assert.deepEqual(result.retrieval, { candidates: 3, sourcesUsed: 2, bestSimilarity: 0.75, skipped: null });

    assert.equal(calls.save.length, 1);
    assert.deepEqual(calls.save[0], { userId: "user-1", question: "What?", answer: result.answer, citations: result.citations });
    assert.equal(result.id, "query-1");
  });

  it("doesn't call the model when the user has no embedded documents, and still saves", async () => {
    const { calls, answerer } = fakes([]);
    const result = await answerer.answerQuestion("user-1", "What?");
    assert.equal(calls.generate.length, 0);
    assert.equal(result.answer, NO_DOCUMENTS_ANSWER);
    assert.equal(result.answered, false);
    assert.equal(result.model, null);
    assert.equal(result.retrieval.skipped, "no_documents");
    assert.equal(result.timings.generateMs, 0);
    assert.equal(calls.save.length, 1);
  });

  it("doesn't call the model when nothing is relevant enough, and saves the refusal", async () => {
    const { calls, answerer } = fakes([chunk(1, 0.54), chunk(2, 0.5)]);
    const result = await answerer.answerQuestion("user-1", "Capital of Australia?");
    assert.equal(calls.generate.length, 0);
    assert.equal(result.answer, REFUSAL);
    assert.equal(result.answered, false);
    assert.deepEqual(result.retrieval, { candidates: 2, sourcesUsed: 0, bestSimilarity: 0.54, skipped: "below_threshold" });
    assert.deepEqual(calls.save[0]!.citations, []);
  });

  it("saves the model's own refusal as not answered", async () => {
    const { calls, answerer } = fakes([chunk(1, 0.6)], REFUSAL);
    const result = await answerer.answerQuestion("user-1", "Sourdough?");
    assert.equal(calls.generate.length, 1);
    assert.equal(result.answered, false);
    assert.equal(calls.save.length, 1);
  });

  it("removes and logs citations of sources the model wasn't given", async () => {
    const { calls, answerer } = fakes([chunk(1, 0.7)], "Real [1]. Invented [4].");
    const result = await answerer.answerQuestion("user-1", "q");
    assert.equal(result.answer, "Real [1]. Invented.");
    assert.ok(calls.logs.some((l) => l.includes("cited sources it wasn't given: 4")));
  });

  it("saves nothing when generation fails, and lets the error through", async () => {
    const failure = new GenerationError("unavailable", "Answer generation service is unavailable. Try again later.");
    const { calls, answerer } = fakes([chunk(1, 0.7)], failure);
    await assert.rejects(answerer.answerQuestion("user-1", "q"), failure);
    assert.equal(calls.save.length, 0);
  });

  it("logs one summary line per question", async () => {
    const { calls, answerer } = fakes([chunk(1, 0.7)], "Yes [1].");
    await answerer.answerQuestion("user-1", "q");
    assert.match(calls.logs.at(-1)!, /^\[query\] query-1: answered by test-model, best 0\.700, 1 citation\(s\), \d+ ms$/);
  });
});
