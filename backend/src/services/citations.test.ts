import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type CitableSource, markAvailability, markerGroups, processAnswer, SNIPPET_CHARS, snippetOf } from "./citations.ts";

const source = (n: number, content = `Content of source ${n}.`): CitableSource => ({
  chunkId: `chunk-${n}`,
  documentId: `doc-${n}`,
  filename: `file-${n}.pdf`,
  chunkIndex: n - 1,
  content,
  similarity: 0.7 + n / 1000 + 0.000049, // checks rounding to 4 dp
});
const sources = [source(1), source(2), source(3)];
const REFUSAL = "I couldn't find the answer to that in your documents.";

describe("processAnswer", () => {
  it("collects single markers and maps them to their sources", () => {
    const result = processAnswer("Fresnel designed it in 1822 [2].", sources);
    assert.equal(result.answered, true);
    assert.equal(result.answer, "Fresnel designed it in 1822 [2].");
    assert.deepEqual(result.citations, [
      { marker: 2, chunkId: "chunk-2", documentId: "doc-2", filename: "file-2.pdf", chunkIndex: 1, similarity: 0.702, snippet: "Content of source 2." },
    ]);
  });

  it("handles [1, 2], [1,3] and adjacent [1][3] groups, listing each source once", () => {
    const result = processAnswer("A [1, 2]. B [1,3]. C [1][3].", sources);
    assert.deepEqual(result.citations.map((c) => c.marker), [1, 2, 3]);
    assert.equal(result.answer, "A [1, 2]. B [1, 3]. C [1][3].");
  });

  it("orders citations by marker number, not by first appearance", () => {
    assert.deepEqual(processAnswer("X [3]. Y [1].", sources).citations.map((c) => c.marker), [1, 3]);
  });

  it("removes markers for sources the model wasn't given, and reports them", () => {
    const result = processAnswer("Real [1]. Invented [9]. Zero [0]. Mixed [2, 7].", sources);
    assert.equal(result.answer, "Real [1]. Invented. Zero. Mixed [2].");
    assert.deepEqual(result.invalidMarkers, [0, 7, 9]);
    assert.deepEqual(result.citations.map((c) => c.marker), [1, 2]);
  });

  it("de-duplicates repeats inside one group", () => {
    assert.equal(processAnswer("Twice [2, 2].", sources).answer, "Twice [2].");
  });

  it("treats an answer with no markers as not answered", () => {
    const result = processAnswer("Lighthouses are tall towers.", sources);
    assert.equal(result.answered, false);
    assert.deepEqual(result.citations, []);
  });

  it("treats the plain refusal as not answered", () => {
    assert.equal(processAnswer(REFUSAL, sources).answered, false);
  });

  it("treats a partial answer that reuses the refusal wording as answered (seen live in stage 1)", () => {
    const partial = "The French physicist Augustin Fresnel designed the Fresnel lens [2]. I couldn't find the answer to how much it cost to build in your documents.";
    const result = processAnswer(partial, sources);
    assert.equal(result.answered, true);
    assert.deepEqual(result.citations.map((c) => c.marker), [2]);
  });

  it("treats an answer whose only markers are invalid as not answered", () => {
    const result = processAnswer("Made up [5].", sources);
    assert.equal(result.answered, false);
    assert.equal(result.answer, "Made up.");
  });

  it("ignores bracketed text that isn't a marker", () => {
    const result = processAnswer("See [Figure 2] and [1-3] and [a] [2].", sources);
    assert.deepEqual(result.citations.map((c) => c.marker), [2]);
    assert.equal(result.answer, "See [Figure 2] and [1-3] and [a] [2].");
  });

  it("finds marker groups in text", () => {
    assert.deepEqual(markerGroups("a [1] b [2, 3][4] c [x]"), ["[1]", "[2, 3]", "[4]"]);
  });
});

describe("markAvailability", () => {
  it("marks each citation by whether its chunk still exists, keeping everything else", () => {
    const { citations } = processAnswer("A [1]. B [2]. C [3].", sources);
    const marked = markAvailability(citations, new Set(["chunk-1", "chunk-3"]));
    assert.deepEqual(marked.map((c) => [c.marker, c.available]), [[1, true], [2, false], [3, true]]);
    assert.deepEqual({ ...marked[1], available: undefined }, { ...citations[1], available: undefined });
  });

  it("handles no citations", () => {
    assert.deepEqual(markAvailability([], new Set(["chunk-1"])), []);
  });
});

describe("snippetOf", () => {
  it("returns short content unchanged, with whitespace collapsed", () => {
    assert.equal(snippetOf("Line one\n\nline   two."), "Line one line two.");
  });

  it(`cuts long content at a word boundary before ${SNIPPET_CHARS} chars and adds an ellipsis`, () => {
    const long = "word ".repeat(200);
    const snippet = snippetOf(long);
    assert.ok(snippet.length <= SNIPPET_CHARS + 1, `length ${snippet.length}`);
    assert.ok(snippet.endsWith("word…"));
  });

  it("hard-cuts a single giant word rather than returning almost nothing", () => {
    const snippet = snippetOf("x".repeat(1000));
    assert.equal(snippet, `${"x".repeat(SNIPPET_CHARS)}…`);
  });
});
