import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RELEVANCE, selectSources } from "./relevance.ts";

const scored = (...similarities: number[]) => similarities.map((similarity, id) => ({ id, similarity }));
const ids = (selection: ReturnType<typeof selectSources<{ id: number; similarity: number }>>) =>
  selection.sources.map((s) => s.id);

describe("selectSources", () => {
  it("skips the model when there are no embedded chunks at all", () => {
    assert.deepEqual(selectSources([]), { skip: true, reason: "no_documents", bestSimilarity: null, sources: [] });
  });

  it("skips the model when even the best chunk is below 0.55", () => {
    // Step 4's "capital of Australia" case: best 0.5424.
    const selection = selectSources(scored(0.5424, 0.505, 0.5044));
    assert.equal(selection.skip, true);
    assert.equal(selection.skip && selection.reason, "below_threshold");
    assert.equal(selection.bestSimilarity, 0.5424);
  });

  it("calls the model at exactly the threshold", () => {
    assert.equal(selectSources(scored(RELEVANCE.skipBelow)).skip, false);
  });

  it("keeps chunks within 0.10 of the best and drops the rest", () => {
    // Step 4's "Fresnel lens" case: 0.7736, 0.7421 keep; CV chunks at ~0.50 drop.
    assert.deepEqual(ids(selectSources(scored(0.7736, 0.7421, 0.4998, 0.4992))), [0, 1]);
    // Boundary: exactly best − window stays in.
    assert.deepEqual(ids(selectSources(scored(0.8, 0.7, 0.6999))), [0, 1]);
  });

  it("never keeps anything below the 0.50 floor, even inside the window", () => {
    // best 0.56 → window would allow 0.46; the floor stops at 0.50.
    assert.deepEqual(ids(selectSources(scored(0.56, 0.52, 0.5, 0.49, 0.47))), [0, 1, 2]);
  });

  it("keeps at most 5 sources", () => {
    assert.deepEqual(ids(selectSources(scored(0.8, 0.79, 0.78, 0.77, 0.76, 0.75, 0.74))), [0, 1, 2, 3, 4]);
  });

  it("keeps the input order (best first) and the original objects", () => {
    const results = scored(0.7, 0.68, 0.65);
    const selection = selectSources(results);
    assert.equal(selection.sources[0], results[0]);
    assert.deepEqual(ids(selection), [0, 1, 2]);
  });
});
