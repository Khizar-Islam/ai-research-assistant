// Step 2 of ingestion: plain text → ordered, overlapping chunks. Pure function, no I/O,
// so it can be unit-tested directly (chunk.test.ts).
//
// How it works:
//   1. Split the text into paragraphs (blank-line separated), then each paragraph into
//      sentences with Intl.Segmenter. A sentence too long to fit in any chunk is split on
//      word boundaries — the only place a cut can land mid-sentence.
//   2. Greedily pack sentences into a chunk until the next one would push it past the
//      target size.
//   3. Start the next chunk with the last sentence or two of the previous one (the
//      overlap), so a fact that straddles a boundary still appears whole in one chunk.

// There's no offline Gemini tokenizer, so sizes are estimated: ~4 characters per token
// is the usual rule of thumb for English text.
export const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export type ChunkOptions = {
  targetTokens: number; // stop adding sentences once a chunk reaches about this size
  maxTokens: number; // hard upper bound for any chunk
  overlapTokens: number; // roughly how much of the previous chunk to repeat
  minTokens: number; // below this, keep adding past the target; also the trailing-merge threshold
};

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  targetTokens: 600,
  maxTokens: 800,
  overlapTokens: 80,
  minTokens: 150,
};

export type TextChunk = {
  chunkIndex: number; // position in the document, 0-based and contiguous
  content: string;
  tokenEstimate: number;
  overlapChars: number; // content.slice(0, overlapChars) repeats the end of the previous chunk
};

// One sentence, or one piece of an over-long sentence. `continuesWord` marks a piece
// that was cut out of the middle of a single giant word, so it's rejoined without a space.
type Unit = { text: string; startsParagraph: boolean; continuesWord?: boolean };

export function chunkText(text: string, options: Partial<ChunkOptions> = {}): TextChunk[] {
  const opts = { ...DEFAULT_CHUNK_OPTIONS, ...options };
  if (
    !(opts.minTokens <= opts.targetTokens && opts.targetTokens <= opts.maxTokens) ||
    opts.overlapTokens >= opts.targetTokens
  ) {
    throw new RangeError("chunkText: need minTokens <= targetTokens <= maxTokens and overlapTokens < targetTokens");
  }

  const target = opts.targetTokens * CHARS_PER_TOKEN;
  const max = opts.maxTokens * CHARS_PER_TOKEN;
  const overlap = opts.overlapTokens * CHARS_PER_TOKEN;
  const min = opts.minTokens * CHARS_PER_TOKEN;

  // Pieces of a split sentence are capped at the target (not the max), leaving room for
  // the overlap in front of them without breaking the max.
  const units = toUnits(text, max, target);

  type Draft = { units: Unit[]; newFrom: number }; // units[newFrom..] are not overlap
  const drafts: Draft[] = [];
  let current: Draft = { units: [], newFrom: 0 };
  let currentLength = 0;

  for (const unit of units) {
    const nextLength = joinedLength([...current.units, unit]);
    const fits = nextLength <= target || (currentLength < min && nextLength <= max);

    if (current.units.length === 0 || fits) {
      current.units.push(unit);
      currentLength = nextLength;
      continue;
    }

    // Close the current chunk and start the next with the overlap + this unit. If the
    // overlap would push that past the max (big incoming sentence), drop it from the front.
    drafts.push(current);
    const carried = takeOverlap(current.units, overlap);
    while (carried.length > 0 && joinedLength([...carried, unit]) > max) carried.shift();

    current = { units: [...carried, unit], newFrom: carried.length };
    currentLength = joinedLength(current.units);
  }
  if (current.units.length > 0) drafts.push(current);

  // A tiny last chunk (a few leftover sentences) retrieves poorly on its own, so fold
  // its new sentences into the previous chunk when that still fits.
  const last = drafts.at(-1);
  const prev = drafts.at(-2);
  if (last && prev && joinedLength(last.units.slice(last.newFrom)) < min) {
    const merged = [...prev.units, ...last.units.slice(last.newFrom)];
    if (joinedLength(merged) <= max) {
      prev.units = merged;
      drafts.pop();
    }
  }

  return drafts.map((draft, chunkIndex) => {
    const content = join(draft.units);
    return {
      chunkIndex,
      content,
      tokenEstimate: estimateTokens(content),
      overlapChars: draft.newFrom === 0 ? 0 : join(draft.units.slice(0, draft.newFrom)).length,
    };
  });
}

// ── Splitting ────────────────────────────────────────────────────────────────────────

function toUnits(text: string, maxChars: number, pieceChars: number): Unit[] {
  const units: Unit[] = [];

  for (const rawParagraph of text.split(/\n\s*\n/)) {
    // Inside a paragraph, line breaks are just wrapping; normalize all whitespace.
    const paragraph = rawParagraph.replace(/\s+/g, " ").trim();
    if (!paragraph) continue;

    let startsParagraph = true;
    for (const sentence of splitSentences(paragraph)) {
      const pieces = sentence.length > maxChars ? splitOnWords(sentence, pieceChars) : [{ text: sentence }];
      for (const piece of pieces) {
        units.push({ ...piece, startsParagraph });
        startsParagraph = false;
      }
    }
  }
  return units;
}

const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });

// Intl.Segmenter breaks after an abbreviation followed by a capital ("Dr." | "Smith").
// When a segment ends in one of these, glue it to the next segment. Case-sensitive on
// purpose, so a sentence ending in the word "no." isn't mistaken for "No." (number).
const ABBREVIATION = /(?:^|[\s(])(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|Fig|Figs|Eq|No|Vol|Inc|Ltd|Co|Corp|vs|etc|al|cf|pp|approx|e\.g|i\.e)\.$/;

function splitSentences(paragraph: string): string[] {
  const sentences: string[] = [];
  let pending = "";

  for (const { segment } of segmenter.segment(paragraph)) {
    const sentence = segment.trim();
    if (!sentence) continue;
    pending = pending ? `${pending} ${sentence}` : sentence;
    if (!ABBREVIATION.test(pending)) {
      sentences.push(pending);
      pending = "";
    }
  }
  if (pending) sentences.push(pending);
  return sentences;
}

// Fallback for a sentence longer than a whole chunk (tables, run-on PDF text). Packs
// words into pieces of at most `pieceChars`; a single "word" longer than that (a URL,
// base64 blob) is cut by characters.
type Piece = { text: string; continuesWord?: boolean };

function splitOnWords(sentence: string, pieceChars: number): Piece[] {
  const pieces: Piece[] = [];
  let piece = "";
  let continuesWord = false; // does `piece` begin with the tail of a hard-cut word?

  for (let word of sentence.split(" ")) {
    if (word.length > pieceChars) {
      if (piece) pieces.push({ text: piece, continuesWord });
      let first = true;
      while (word.length > pieceChars) {
        pieces.push({ text: word.slice(0, pieceChars), continuesWord: !first });
        word = word.slice(pieceChars);
        first = false;
      }
      piece = word; // the rest of the word starts the next piece
      continuesWord = true;
      continue;
    }
    if (piece && piece.length + 1 + word.length > pieceChars) {
      pieces.push({ text: piece, continuesWord });
      piece = word;
      continuesWord = false;
    } else {
      piece = piece ? `${piece} ${word}` : word;
    }
  }
  if (piece) pieces.push({ text: piece, continuesWord });
  return pieces;
}

// ── Joining ──────────────────────────────────────────────────────────────────────────

// Sentences in the same paragraph are joined with a space; a new paragraph gets a blank
// line, so chunk content keeps the document's paragraph structure.
function separator(unit: Unit): string {
  if (unit.startsParagraph) return "\n\n";
  return unit.continuesWord ? "" : " ";
}

function join(units: Unit[]): string {
  return units.map((unit, i) => (i === 0 ? "" : separator(unit)) + unit.text).join("");
}

function joinedLength(units: Unit[]): number {
  return units.reduce((length, unit, i) => length + unit.text.length + (i === 0 ? 0 : separator(unit).length), 0);
}

// Whole sentences from the end of a chunk, up to `overlapChars` in total. If even the
// last sentence is over budget, it's still taken when it's at most twice the budget, so
// one long sentence doesn't wipe out the overlap; anything longer means no overlap.
function takeOverlap(units: Unit[], overlapChars: number): Unit[] {
  const taken: Unit[] = [];
  for (let i = units.length - 1; i >= 0; i--) {
    const candidate = [units[i]!, ...taken];
    const budget = taken.length === 0 ? overlapChars * 2 : overlapChars;
    if (joinedLength(candidate) > budget) break;
    taken.unshift(units[i]!);
  }
  // Never carry the whole previous chunk forward — that's duplication, not overlap.
  return taken.length === units.length ? taken.slice(1) : taken;
}
