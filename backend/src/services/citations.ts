// Turns the model's inline markers ("... in 1822 [2].") into a validated citations list.
//
// This is the third layer of "don't guess": an answer with no valid citation is treated
// as not answered, because nothing in the user's documents backs it up. That's decided
// from the markers, never by matching a refusal sentence: partial answers reuse the
// refusal wording ("I couldn't find ... the cost") next to properly cited facts.

export type CitableSource = {
  chunkId: string;
  documentId: string;
  filename: string;
  chunkIndex: number;
  content: string;
  similarity: number;
};

// Stored in Query.citations (JSON) and returned to the client. A superset of CLAUDE.md's
// {documentId, filename, chunkContent snippet}; chunkId/chunkIndex let the UI highlight
// the exact source chunk when a marker is hovered.
export type Citation = {
  marker: number; // the [n] used in the answer text
  chunkId: string;
  documentId: string;
  filename: string;
  chunkIndex: number;
  similarity: number;
  snippet: string;
};

export type ProcessedAnswer = {
  answer: string; // with any invalid markers removed
  answered: boolean;
  citations: Citation[]; // only sources actually cited, by marker number
  invalidMarkers: number[]; // numbers the model used that weren't among the sources
};

// [1]  [1, 2]  [1,2,3]  — and [1][3] is simply two groups. Ranges like [1-3] aren't
// produced by the current prompt and aren't recognized.
const MARKER_GROUP = /\[\s*\d+\s*(?:,\s*\d+\s*)*\]/g;
// The same, plus any spaces before it (removed together when a group is dropped).
const MARKER_GROUP_WITH_SPACE = new RegExp(`[ \\t]*(${MARKER_GROUP.source})`, "g");

export const SNIPPET_CHARS = 300;

// `sources[i]` is the source the model saw as number i + 1.
export function processAnswer(rawAnswer: string, sources: CitableSource[]): ProcessedAnswer {
  const cited = new Set<number>();
  const invalid = new Set<number>();

  const answer = rawAnswer
    .replace(MARKER_GROUP_WITH_SPACE, (whole, group: string) => {
      const numbers = group.slice(1, -1).split(",").map((n) => Number(n.trim()));
      const valid = numbers.filter((n) => Number.isInteger(n) && n >= 1 && n <= sources.length);
      for (const n of numbers) (valid.includes(n) ? cited : invalid).add(n);

      if (valid.length === 0) return ""; // drop the whole group, and the space before it
      const kept = [...new Set(valid)];
      return whole.slice(0, whole.length - group.length) + `[${kept.join(", ")}]`;
    })
    .trim();

  const citations = [...cited]
    .sort((a, b) => a - b)
    .map((marker) => {
      const source = sources[marker - 1]!;
      return {
        marker,
        chunkId: source.chunkId,
        documentId: source.documentId,
        filename: source.filename,
        chunkIndex: source.chunkIndex,
        similarity: Math.round(source.similarity * 10_000) / 10_000,
        snippet: snippetOf(source.content),
      };
    });

  return { answer, answered: citations.length > 0, citations, invalidMarkers: [...invalid].sort((a, b) => a - b) };
}

// The first ~300 characters, cut at a word boundary.
export function snippetOf(content: string): string {
  const text = content.replace(/\s+/g, " ").trim();
  if (text.length <= SNIPPET_CHARS) return text;
  const cut = text.slice(0, SNIPPET_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > SNIPPET_CHARS * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

// A citation as shown in history. Saved answers keep their citations even after the cited
// document is deleted (the snippet and filename still read fine), but the chunk itself is
// gone, so the UI can't jump to or highlight it: `available: false` says so.
export type HistoryCitation = Citation & { available: boolean };

export function markAvailability(citations: Citation[], existingChunkIds: ReadonlySet<string>): HistoryCitation[] {
  return citations.map((citation) => ({ ...citation, available: existingChunkIds.has(citation.chunkId) }));
}

// Exported for tests: every marker group in a text.
export const markerGroups = (text: string) => text.match(MARKER_GROUP) ?? [];
