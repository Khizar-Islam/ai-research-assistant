import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RequestCancelledError } from "./aiRetry.ts";
import { type AnswerDeps, CANDIDATES, createAnswerer, NO_DOCUMENTS_ANSWER, type StreamHooks } from "./answering.ts";
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
    // Streams the same text word by word.
    generateStream: async (question, sources, onDelta) => {
      calls.generate.push([question, sources]);
      if (generatedText instanceof Error) throw generatedText;
      for (const word of generatedText.match(/\S+\s*/g) ?? []) await onDelta(word);
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

describe("streamQuestion", () => {
  // Records every hook call in order, as the client would receive them.
  function recorder(signal?: AbortSignal) {
    const events: string[] = [];
    const hooks: StreamHooks = {
      onStage: (stage) => events.push(`stage:${stage}`),
      onSources: (sources) => events.push(`sources:${sources.map((s) => `${s.marker}=${s.chunkId}`).join(",")}`),
      onDelta: (text) => void events.push(`delta:${text}`),
      signal,
    };
    return { events, hooks };
  }

  it("reports searching, every source, writing, then the text as it streams", async () => {
    const { answerer } = fakes([chunk(1, 0.75), chunk(2, 0.7)], "Fact one [1]. Fact two [2].");
    const { events, hooks } = recorder();
    const result = await answerer.streamQuestion("user-1", "What?", hooks);

    assert.deepEqual(events, [
      "stage:searching",
      "sources:1=chunk-1,2=chunk-2", // all sources the model sees, before the first word
      "stage:writing",
      "delta:Fact ",
      "delta:one ",
      "delta:[1]. ",
      "delta:Fact ",
      "delta:two ",
      "delta:[2].",
    ]);
    assert.equal(result.answer, "Fact one [1]. Fact two [2].");
  });

  it("returns the same checked result as answerQuestion (invalid markers removed)", async () => {
    const streamed = await fakes([chunk(1, 0.7)], "Real [1]. Invented [4].").answerer.streamQuestion("u", "q", recorder().hooks);
    const plain = await fakes([chunk(1, 0.7)], "Real [1]. Invented [4].").answerer.answerQuestion("u", "q");

    assert.equal(streamed.answer, "Real [1]. Invented.");
    const { timings: _a, ...streamedRest } = streamed;
    const { timings: _b, ...plainRest } = plain;
    assert.deepEqual(streamedRest, plainRest);
  });

  it("skips straight to the result when nothing relevant was found: no sources, no writing", async () => {
    const { calls, answerer } = fakes([chunk(1, 0.4)]);
    const { events, hooks } = recorder();
    const result = await answerer.streamQuestion("user-1", "q", hooks);

    assert.deepEqual(events, ["stage:searching"]);
    assert.equal(calls.generate.length, 0);
    assert.equal(result.retrieval.skipped, "below_threshold");
    assert.equal(calls.save.length, 1, "a don't-know answer is still history");
  });

  it("saves nothing when the client disconnected before the answer finished", async () => {
    const cancel = new AbortController();
    const { calls, answerer } = fakes([chunk(1, 0.7)], "Answer [1].");
    const { hooks } = recorder(cancel.signal);
    hooks.onDelta = () => cancel.abort(); // the client leaves while text is streaming

    await assert.rejects(answerer.streamQuestion("user-1", "q", hooks), (error: Error) => error instanceof RequestCancelledError);
    assert.equal(calls.save.length, 0);
  });

  it("stops before generating if the client left during the search", async () => {
    const cancel = new AbortController();
    const { calls, answerer } = fakes([chunk(1, 0.7)]);
    const { hooks } = recorder(cancel.signal);
    hooks.onStage = (stage) => stage === "searching" && cancel.abort();

    await assert.rejects(answerer.streamQuestion("user-1", "q", hooks), RequestCancelledError);
    assert.equal(calls.generate.length, 0);
    assert.equal(calls.save.length, 0);
  });
});
