// First layer of "say I don't know instead of guessing": decide which retrieved chunks
// are worth showing the model, and whether to call the model at all.
//
// Not one hard threshold, because similarity scores aren't calibrated probabilities:
//   - skipBelow: if even the best chunk is this weak, the question is about something the
//     documents don't cover. Answer "couldn't find it" without calling the model.
//   - floor + window: otherwise keep chunks that are both above an absolute floor AND
//     close to the best one, so a weak chunk riding along with a strong one is dropped.
// The model's prompt and the citation check are the second and third layers.
//
// Values from Step 4 measurements (7 questions; revisit with more data): answerable
// questions' best chunk scored 0.66–0.77, unanswerable ones 0.54–0.59.

export type RelevanceSettings = {
  skipBelow: number;
  floor: number;
  window: number;
  maxSources: number;
};

export const RELEVANCE: RelevanceSettings = {
  skipBelow: 0.55, // ~0.11 below the weakest answerable question seen so far
  floor: 0.5,
  window: 0.1,
  maxSources: 5,
};

export type Selection<T> =
  | { skip: true; reason: "no_documents" | "below_threshold"; bestSimilarity: number | null; sources: [] }
  | { skip: false; bestSimilarity: number; sources: T[] };

// `results` must be sorted best first (as retrieveChunks returns them).
export function selectSources<T extends { similarity: number }>(
  results: T[],
  settings: RelevanceSettings = RELEVANCE,
): Selection<T> {
  const best = results[0];
  if (!best) return { skip: true, reason: "no_documents", bestSimilarity: null, sources: [] };
  if (best.similarity < settings.skipBelow) {
    return { skip: true, reason: "below_threshold", bestSimilarity: best.similarity, sources: [] };
  }

  // The tolerance absorbs floating-point error: 0.8 - 0.1 is 0.7000000000000001, which
  // would otherwise drop a chunk scoring exactly 0.7.
  const cutoff = Math.max(settings.floor, best.similarity - settings.window) - 1e-9;
  return {
    skip: false,
    bestSimilarity: best.similarity,
    sources: results.filter((result) => result.similarity >= cutoff).slice(0, settings.maxSources),
  };
}
