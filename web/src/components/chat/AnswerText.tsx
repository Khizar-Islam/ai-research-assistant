"use client";

// An answer's text with its [n] markers drawn as footnote numbers. Each number links to
// its footnote under the answer. Markers with no matching citation (possible mid-stream,
// before the server's checks remove them) stay as plain text.
//
// While an answer streams, the whole text so far is parsed on every update (a marker can
// be split across two pieces, "[" then "1]"), and only text from `fadeFrom` on, the newest
// piece, fades in.
import { motion } from "motion/react";
import { Fragment, type ReactNode } from "react";
import type { EntryCitation } from "./types";

// The backend's marker syntax (citations.ts): [1]  [1, 2]  [1,2,3]; [1][3] is two groups.
// Includes the spaces before a group: footnote numbers sit right against the word.
const MARKER_GROUP = /[ \t]*\[\s*\d+\s*(?:,\s*\d+\s*)*\]/g;

type Props = {
  entryId: string;
  text: string;
  citations: EntryCitation[];
  fadeFrom?: number; // index where the newest streamed piece starts
  trailing?: ReactNode; // e.g. the typing caret
};

export function AnswerText({ entryId, text, citations, fadeFrom, trailing }: Props) {
  const byMarker = new Map(citations.map((citation) => [citation.marker, citation]));
  const parts: ReactNode[] = [];
  let last = 0;

  // Text before fadeFrom is settled; text after it fades in. Keyed by fadeFrom, so each
  // new piece gets a fresh element (and a fresh fade) while settled text stays put.
  const fresh = (node: ReactNode, key: string) => (
    <motion.span key={`${key}-${fadeFrom}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.35 }}>
      {node}
    </motion.span>
  );
  const pushText = (start: number, end: number) => {
    if (fadeFrom === undefined || end <= fadeFrom) parts.push(text.slice(start, end));
    else if (start >= fadeFrom) parts.push(fresh(text.slice(start, end), `t${start}`));
    else parts.push(text.slice(start, fadeFrom), fresh(text.slice(fadeFrom, end), `t${fadeFrom}`));
  };

  for (const match of text.matchAll(MARKER_GROUP)) {
    const numbers = match[0].trim().slice(1, -1).split(",").map((n) => Number(n.trim()));
    if (!numbers.every((n) => byMarker.has(n))) continue; // not (yet) a real citation
    pushText(last, match.index);
    const markers = numbers.map((n, i) => <Marker key={n} entryId={entryId} citation={byMarker.get(n)!} separator={i > 0} />);
    parts.push(
      fadeFrom !== undefined && match.index >= fadeFrom ? (
        fresh(markers, `m${match.index}`)
      ) : (
        <Fragment key={`m${match.index}`}>{markers}</Fragment>
      ),
    );
    last = match.index + match[0].length;
  }
  pushText(last, text.length);

  return (
    <p className="font-serif text-lg leading-relaxed whitespace-pre-line">
      {parts}
      {trailing}
    </p>
  );
}

function Marker({ entryId, citation, separator }: { entryId: string; citation: EntryCitation; separator: boolean }) {
  const gone = citation.available === false;
  return (
    <sup className="font-mono text-[11px] leading-none">
      {separator && <span className="text-ink-faint">,</span>}
      <a
        href={`#${footnoteId(entryId, citation.marker)}`}
        aria-label={`Source ${citation.marker}: ${citation.filename}${gone ? " (deleted)" : ""}`}
        className={`ml-px px-px no-underline hover:underline ${gone ? "text-ink-faint" : "text-mark"}`}
      >
        {citation.marker}
      </a>
    </sup>
  );
}

export const footnoteId = (entryId: string, marker: number) => `${entryId}-source-${marker}`;
