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
import { MARKER_GROUP } from "@/lib/citations";
import { citationKey, useCitations } from "./CitationContext";
import type { EntryCitation } from "./types";

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
  const textNodes = (start: number, end: number): ReactNode[] => {
    if (fadeFrom === undefined || end <= fadeFrom) return [text.slice(start, end)];
    if (start >= fadeFrom) return [fresh(text.slice(start, end), `t${start}`)];
    return [text.slice(start, fadeFrom), fresh(text.slice(fadeFrom, end), `t${fadeFrom}`)];
  };

  for (const match of text.matchAll(MARKER_GROUP)) {
    const numbers = match[0].trim().slice(1, -1).split(",").map((n) => Number(n.trim()));
    if (!numbers.every((n) => byMarker.has(n))) continue; // not (yet) a real citation
    // The end of the word before the markers stays on one line with them: browsers may
    // break before a button as if at a space, which on a phone left a lone "1" starting
    // the next line. At most its last 12 characters, so a long URL can still break
    // (wrap-anywhere) before that tail.
    const wordOffset = text.slice(last, match.index).search(/\S*$/);
    const wordStart = Math.max(last + wordOffset, match.index - 12);
    parts.push(...textNodes(last, wordStart));
    const markers = numbers.map((n, i) => <Marker key={n} entryId={entryId} citation={byMarker.get(n)!} separator={i > 0} />);
    parts.push(
      <span key={`w${match.index}`} className="whitespace-nowrap">
        {textNodes(wordStart, match.index)}
        {fadeFrom !== undefined && match.index >= fadeFrom ? (
          fresh(markers, `m${match.index}`)
        ) : (
          <Fragment key={`m${match.index}`}>{markers}</Fragment>
        )}
      </span>,
    );
    last = match.index + match[0].length;
  }
  parts.push(...textNodes(last, text.length));

  return (
    // wrap-anywhere: a quoted URL or email may break mid-token rather than widen the page.
    <p className="font-serif text-lg leading-relaxed wrap-anywhere whitespace-pre-line">
      {parts}
      {trailing}
    </p>
  );
}

// Pointing at a marker (hover or keyboard focus) lights up its footnote, and the other
// way round. Clicking opens the cited passage; a source whose document was deleted can't
// be opened, so its marker jumps to the footnote (and its saved excerpt) instead.
function Marker({ entryId, citation, separator }: { entryId: string; citation: EntryCitation; separator: boolean }) {
  const { active, setActive, openPassage, canOpen } = useCitations();
  const key = citationKey(entryId, citation.marker);
  const gone = citation.available === false;
  const pointing = {
    onMouseEnter: () => setActive(key),
    onMouseLeave: () => setActive(null),
    onFocus: () => setActive(key),
    onBlur: () => setActive(null),
  };
  const className = `ml-px px-0.5 transition-colors ${gone ? "text-ink-faint" : "text-mark"} ${
    active === key ? (gone ? "bg-ink/10" : "bg-mark/15") : ""
  }`;

  return (
    <sup className="font-mono text-[11px] leading-none">
      {separator && <span className="text-ink-faint">,</span>}
      {canOpen(citation) ? (
        <button
          type="button"
          {...pointing}
          onClick={(event) => openPassage(citation, event.currentTarget)}
          aria-label={`Source ${citation.marker}: ${citation.filename}, passage ${citation.chunkIndex + 1}. Open passage`}
          className={`${className} cursor-pointer`}
        >
          {citation.marker}
        </button>
      ) : (
        <a
          href={`#${footnoteId(entryId, citation.marker)}`}
          {...pointing}
          aria-label={`Source ${citation.marker}: ${citation.filename}${gone ? " (deleted)" : ""}`}
          className={`${className} no-underline`}
        >
          {citation.marker}
        </a>
      )}
    </sup>
  );
}

export const footnoteId = (entryId: string, marker: number) => `${entryId}-source-${marker}`;
