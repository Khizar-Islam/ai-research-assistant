import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT, parseHistoryLimit, parseQueryRequest } from "./query.validation.ts";

describe("parseQueryRequest", () => {
  it("accepts and trims a question, ignoring other fields (topK isn't used here)", () => {
    assert.deepEqual(parseQueryRequest({ question: "  What is RAG? ", topK: 3 }), { ok: true, value: { question: "What is RAG?" } });
  });

  it("applies the same question rules as /api/search", () => {
    assert.deepEqual(parseQueryRequest({}), { ok: false, error: "question is required and must be a string" });
    assert.deepEqual(parseQueryRequest({ question: "   " }), { ok: false, error: "question must not be empty" });
    assert.deepEqual(parseQueryRequest({ question: "x".repeat(2001) }), { ok: false, error: "Question is too long (max 2,000 characters)" });
    assert.equal(parseQueryRequest({ question: "x".repeat(2000) }).ok, true);
  });

  it("rejects a body that isn't a JSON object", () => {
    for (const body of [undefined, null, [], "question"]) {
      const result = parseQueryRequest(body);
      assert.ok(!result.ok && /Send a JSON object/.test(result.error));
    }
  });
});

describe("parseHistoryLimit", () => {
  const LIMIT_ERROR = `limit must be a whole number between 1 and ${MAX_HISTORY_LIMIT}`;

  it(`defaults to ${DEFAULT_HISTORY_LIMIT}`, () => {
    assert.deepEqual(parseHistoryLimit(undefined), { ok: true, value: DEFAULT_HISTORY_LIMIT });
  });

  it(`accepts 1..${MAX_HISTORY_LIMIT}`, () => {
    assert.deepEqual(parseHistoryLimit("1"), { ok: true, value: 1 });
    assert.deepEqual(parseHistoryLimit(" 50 "), { ok: true, value: 50 });
  });

  it("rejects anything else, including repeated ?limit= params", () => {
    for (const raw of ["0", "51", "-1", "2.5", "abc", "", "1e2", ["1", "2"]]) {
      assert.deepEqual(parseHistoryLimit(raw), { ok: false, error: LIMIT_ERROR }, JSON.stringify(raw));
    }
  });
});
