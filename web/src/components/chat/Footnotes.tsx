// The sources under an answer, set like printed footnotes: number, where the passage is,
// and the saved excerpt. A source whose document has since been deleted keeps its saved
// excerpt (the evidence is still readable) but is marked as gone.
import { footnoteId } from "./AnswerText";
import type { EntryCitation } from "./types";

type Props = { entryId: string; citations: EntryCitation[] };

export function Footnotes({ entryId, citations }: Props) {
  return (
    <section aria-label="Sources" className="mt-5 border-t border-rule pt-4">
      <ol className="space-y-4">
        {citations.map((citation) => {
          const gone = citation.available === false;
          return (
            <li
              key={citation.marker}
              id={footnoteId(entryId, citation.marker)}
              className="grid scroll-mt-24 grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2 text-sm"
            >
              <span className={`font-mono text-xs leading-5 ${gone ? "text-ink-faint" : "text-mark"}`}>{citation.marker}</span>
              <div className="min-w-0">
                <p className="leading-5 [&>span]:whitespace-nowrap">
                  <span
                    className={`font-medium break-all whitespace-normal ${gone ? "text-ink-soft line-through decoration-ink-faint" : ""}`}
                  >
                    {citation.filename}
                  </span>{" "}
                  <span className="font-mono text-xs text-ink-soft">· §{citation.chunkIndex + 1}</span>{" "}
                  {gone ? (
                    <span className="font-mono text-xs text-ochre-ink">· document deleted</span>
                  ) : (
                    <span className="font-mono text-xs text-ink-soft">· {citation.similarity.toFixed(2)} similarity</span>
                  )}
                </p>
                <p className="mt-1 text-ink-soft">
                  {gone && <span className="font-mono text-[11px] text-ink-faint">Saved excerpt: </span>}
                  {citation.snippet}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
