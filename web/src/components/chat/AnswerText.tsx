// An answer's text with its [n] markers drawn as footnote numbers. Each number links to
// its footnote under the answer. Markers with no matching citation (possible mid-stream,
// before the server's checks remove them) stay as plain text.
import { Fragment, type ReactNode } from "react";
import type { EntryCitation } from "./types";

// The backend's marker syntax (citations.ts): [1]  [1, 2]  [1,2,3]; [1][3] is two groups.
// Includes the spaces before a group: footnote numbers sit right against the word.
const MARKER_GROUP = /[ \t]*\[\s*\d+\s*(?:,\s*\d+\s*)*\]/g;

type Props = { entryId: string; text: string; citations: EntryCitation[] };

export function AnswerText({ entryId, text, citations }: Props) {
  const byMarker = new Map(citations.map((citation) => [citation.marker, citation]));
  const parts: ReactNode[] = [];
  let last = 0;

  for (const match of text.matchAll(MARKER_GROUP)) {
    const numbers = match[0].trim().slice(1, -1).split(",").map((n) => Number(n.trim()));
    if (!numbers.every((n) => byMarker.has(n))) continue; // not (yet) a real citation
    parts.push(text.slice(last, match.index));
    parts.push(
      <Fragment key={match.index}>
        {numbers.map((n, i) => (
          <Marker key={n} entryId={entryId} citation={byMarker.get(n)!} separator={i > 0} />
        ))}
      </Fragment>,
    );
    last = match.index + match[0].length;
  }
  parts.push(text.slice(last));

  return <p className="font-serif text-lg leading-relaxed whitespace-pre-line">{parts}</p>;
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
