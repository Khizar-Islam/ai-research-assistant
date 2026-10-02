import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_TOP_K,
  MAX_QUESTION_CHARS,
  MAX_TOP_K,
  parseSearchRequest,
} from "./search.validation.ts";

const ok = (body: unknown) => {
  const result = parseSearchRequest(body);
  assert.ok(result.ok, `expected valid, got: ${!result.ok && result.error}`);
  return result.value;
};
const rejected = (body: unknown) => {
  const result = parseSearchRequest(body);
  assert.ok(!result.ok, `expected invalid: ${JSON.stringify(body)?.slice(0, 80)}`);
  return result.error;
};

const TOP_K_ERROR = `topK must be a whole number between 1 and ${MAX_TOP_K}`;

describe("parseSearchRequest", () => {
  it("accepts a question and defaults topK to 5", () => {
    assert.deepEqual(ok({ question: "What is RAG?" }), { question: "What is RAG?", topK: DEFAULT_TOP_K });
  });

  it("trims the question and ignores unknown fields", () => {
    assert.deepEqual(ok({ question: "  What is RAG?\n", topK: 3, extra: true }), { question: "What is RAG?", topK: 3 });
  });

  it("rejects a missing, non-string, empty or whitespace-only question", () => {
    assert.equal(rejected({}), "question is required and must be a string");
    assert.equal(rejected({ question: 42 }), "question is required and must be a string");
    assert.equal(rejected({ question: "" }), "question must not be empty");
    assert.equal(rejected({ question: " \n\t " }), "question must not be empty");
  });

  it(`allows exactly ${MAX_QUESTION_CHARS} characters, rejects one more`, () => {
    assert.equal(ok({ question: "x".repeat(MAX_QUESTION_CHARS) }).question.length, MAX_QUESTION_CHARS);
    assert.equal(rejected({ question: "x".repeat(MAX_QUESTION_CHARS + 1) }), "Question is too long (max 2,000 characters)");
  });

  it("measures length after trimming, so surrounding whitespace doesn't count", () => {
    assert.ok(parseSearchRequest({ question: `   ${"x".repeat(MAX_QUESTION_CHARS)}   ` }).ok);
  });

  it(`accepts topK 1..${MAX_TOP_K}, rejects anything else`, () => {
    assert.equal(ok({ question: "q", topK: 1 }).topK, 1);
    assert.equal(ok({ question: "q", topK: MAX_TOP_K }).topK, MAX_TOP_K);
    for (const topK of [0, MAX_TOP_K + 1, 2.5, -3, "5", null]) {
      assert.equal(rejected({ question: "q", topK }), TOP_K_ERROR, `topK=${JSON.stringify(topK)}`);
    }
  });

  it("rejects a body that isn't a JSON object (no Content-Type, array, string)", () => {
    for (const body of [undefined, null, [], "What is RAG?"]) {
      assert.match(rejected(body), /Send a JSON object/);
    }
  });
});
