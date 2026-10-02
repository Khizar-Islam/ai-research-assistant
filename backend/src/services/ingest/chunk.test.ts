import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chunkText, DEFAULT_CHUNK_OPTIONS, estimateTokens, type TextChunk } from "./chunk.ts";

const { targetTokens, maxTokens, overlapTokens, minTokens } = DEFAULT_CHUNK_OPTIONS;

// Every sentence starts with "Sentence", so "does this chunk start at a sentence
// boundary?" is a simple startsWith check. ~75 chars ≈ 19 tokens each.
function makeText(paragraphs: number, sentencesPerParagraph: number): string {
  const out: string[] = [];
  for (let p = 1; p <= paragraphs; p++) {
    const sentences: string[] = [];
    for (let s = 1; s <= sentencesPerParagraph; s++) {
      sentences.push(`Sentence ${p}-${s} explains one more detail about the subject in plain words.`);
    }
    out.push(sentences.join(" "));
  }
  return out.join("\n\n");
}

const words = (text: string) => text.split(/\s+/).filter(Boolean);

// The part of each chunk that isn't repeated from the previous chunk.
const newPart = (chunk: TextChunk) => chunk.content.slice(chunk.overlapChars);

// ~40 × 8 × 19 ≈ 6,000 tokens → about ten chunks.
const longText = makeText(40, 8);
const longChunks = chunkText(longText);

describe("chunkText", () => {
  it("returns no chunks for empty or whitespace-only text", () => {
    assert.deepEqual(chunkText(""), []);
    assert.deepEqual(chunkText("  \n\n \t "), []);
  });

  it("keeps a short text as a single chunk, whitespace normalized", () => {
    const chunks = chunkText("First   sentence.\nStill the same paragraph.\n\n\nSecond paragraph.");
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0]!.content, "First sentence. Still the same paragraph.\n\nSecond paragraph.");
    assert.equal(chunks[0]!.overlapChars, 0);
  });

  it("produces several chunks for a long text", () => {
    assert.ok(longChunks.length >= 8, `expected >= 8 chunks, got ${longChunks.length}`);
  });

  it("numbers chunks 0..n-1 in order", () => {
    assert.deepEqual(
      longChunks.map((c) => c.chunkIndex),
      longChunks.map((_, i) => i),
    );
  });

  it("keeps every chunk within the size bounds", () => {
    for (const chunk of longChunks) {
      assert.equal(chunk.tokenEstimate, estimateTokens(chunk.content));
      assert.ok(chunk.tokenEstimate <= maxTokens, `chunk ${chunk.chunkIndex} has ${chunk.tokenEstimate} tokens`);
    }
    // All but the last should be filled close to the target (within one sentence of it).
    for (const chunk of longChunks.slice(0, -1)) {
      assert.ok(chunk.tokenEstimate >= targetTokens - 25, `chunk ${chunk.chunkIndex} is only ${chunk.tokenEstimate} tokens`);
    }
    assert.ok(estimateTokens(newPart(longChunks.at(-1)!)) >= minTokens, "tiny trailing chunk was not merged");
  });

  it("starts each chunk with the end of the previous one (whole sentences)", () => {
    for (let i = 1; i < longChunks.length; i++) {
      const prev = longChunks[i - 1]!;
      const chunk = longChunks[i]!;
      const overlap = chunk.content.slice(0, chunk.overlapChars);

      assert.ok(chunk.overlapChars > 0, `chunk ${i} has no overlap`);
      assert.ok(prev.content.endsWith(overlap), `chunk ${i} overlap is not the end of chunk ${i - 1}`);
      assert.ok(overlap.startsWith("Sentence "), `chunk ${i} overlap starts mid-sentence`);
      assert.ok(estimateTokens(overlap) <= overlapTokens * 2, `chunk ${i} overlap too long`);
    }
  });

  it("never starts a chunk mid-sentence", () => {
    for (const chunk of longChunks) assert.ok(chunk.content.startsWith("Sentence "), chunk.content.slice(0, 40));
  });

  it("loses and duplicates nothing once overlaps are removed", () => {
    assert.deepEqual(words(longChunks.map(newPart).join(" ")), words(longText));
  });

  it("keeps paragraph breaks inside chunks", () => {
    assert.ok(longChunks[0]!.content.includes("\n\n"));
  });

  it("does not split sentences after common abbreviations", () => {
    // Tiny sizes force one sentence per chunk, so a wrong split would show up as its own chunk.
    const tiny = { targetTokens: 5, maxTokens: 50, overlapTokens: 1, minTokens: 1 };
    const chunks = chunkText("Dr. Smith ran the test. It used tools, e.g. Python. See Fig. 2 now.", tiny);
    assert.deepEqual(
      chunks.map((c) => c.content),
      ["Dr. Smith ran the test.", "It used tools, e.g. Python.", "See Fig. 2 now."],
    );
  });

  it("merges a tiny trailing chunk into the previous one", () => {
    const options = { targetTokens: 20, maxTokens: 40, overlapTokens: 2, minTokens: 5 };
    const first = "This opening sentence is long enough on its own to fill the whole target size.";
    const chunks = chunkText(`${first} Tail end.`, options);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0]!.content, `${first} Tail end.`);
  });

  describe("sentences longer than a chunk", () => {
    // One ~2,500-token sentence with normal sentences around it.
    const runOn = Array.from({ length: 1400 }, (_, i) => `word${i}`).join(" ") + ".";
    const text = `${makeText(1, 5)} ${runOn} ${makeText(1, 5)}`;
    const chunks = chunkText(text);

    it("splits them so no chunk exceeds the max", () => {
      assert.ok(chunks.length >= 4);
      for (const chunk of chunks) assert.ok(chunk.tokenEstimate <= maxTokens, `${chunk.tokenEstimate} tokens`);
    });

    it("cuts only on word boundaries and keeps every word in order", () => {
      assert.deepEqual(words(chunks.map(newPart).join(" ")), words(text));
    });

    it("hard-cuts a single word longer than a chunk", () => {
      const blob = "x".repeat(10_000);
      const blobChunks = chunkText(blob);
      for (const chunk of blobChunks) assert.ok(chunk.tokenEstimate <= maxTokens);
      assert.equal(blobChunks.map(newPart).join(""), blob);
    });
  });

  it("rejects inconsistent options", () => {
    assert.throws(() => chunkText("x", { targetTokens: 900 }), RangeError); // > maxTokens
    assert.throws(() => chunkText("x", { overlapTokens: 600 }), RangeError); // >= targetTokens
  });
});
