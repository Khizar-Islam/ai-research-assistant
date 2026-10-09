"use client";

// The sources under an answer, set like printed footnotes: number, where the passage is,
// the saved excerpt, and a chunk strip of the whole document with the cited passage in
// red, so you can see where in the document the answer came from. A source whose
// document has since been deleted keeps its saved excerpt (the evidence is still
// readable) but is marked as gone and can't be opened.
import { ChunkStrip } from "@/components/documents/ChunkStrip";
import { useDocuments } from "@/lib/hooks/useDocuments";
import { footnoteId } from "./AnswerText";
import { citationKey, useCitations } from "./CitationContext";
import type { EntryCitation } from "./types";

type Props = { entryId: string; citations: EntryCitation[] };

export function Footnotes({ entryId, citations }: Props) {
  const { active, setActive, openPassage, canOpen } = useCitations();
  const documents = useDocuments();
  const chunkCountOf = (documentId: string) => documents.data?.find((d) => d.id === documentId)?.chunkCount;

  return (
    <section aria-label="Sources" className="mt-5 border-t border-rule pt-4">
      <ol className="space-y-2">
        {citations.map((citation) => {
          const gone = citation.available === false;
          const key = citationKey(entryId, citation.marker);
          const isActive = active === key;
          const total = gone ? undefined : chunkCountOf(citation.documentId);

          return (
            <li
              key={citation.marker}
              id={footnoteId(entryId, citation.marker)}
              // Pointing at a footnote lights up its marker(s) in the text, and vice versa.
              onMouseEnter={() => setActive(key)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(key)}
              onBlur={() => setActive(null)}
              className={`-mx-3 grid scroll-mt-24 grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2 border-l-2 px-3 py-2 text-sm transition-colors ${
                isActive ? (gone ? "border-l-ink-faint bg-paper-deep" : "border-l-mark bg-paper-deep") : "border-l-transparent"
              }`}
            >
              <span className={`font-mono text-xs leading-5 ${gone ? "text-ink-faint" : "text-mark"}`}>{citation.marker}</span>
              <div className="min-w-0">
                {/* The filename may break anywhere (a long one mustn't widen the page); each
                    "· …" item after it stays whole. Set per span: a parent [&>span] rule would
                    outrank the filename's own wrapping. */}
                <p className="leading-5">
                  <span
                    className={`font-medium wrap-anywhere ${gone ? "text-ink-soft line-through decoration-ink-faint" : ""}`}
                  >
                    {citation.filename}
                  </span>{" "}
                  <span className="font-mono text-xs whitespace-nowrap text-ink-soft">· §{citation.chunkIndex + 1}</span>{" "}
                  {gone ? (
                    <span className="font-mono text-xs whitespace-nowrap text-ochre-ink">· document deleted</span>
                  ) : (
                    <span className="font-mono text-xs whitespace-nowrap text-ink-soft">· {citation.similarity.toFixed(2)} similarity</span>
                  )}
                </p>
                <p className="mt-1 wrap-anywhere text-ink-soft">
                  {gone && <span className="font-mono text-[11px] text-ink-faint">Saved excerpt: </span>}
                  {citation.snippet}
                </p>

                {!gone && (total !== undefined || canOpen(citation)) && (
                  <div className="mt-2 flex items-center gap-4">
                    {total !== undefined && (
                      // Where in the document: one cell per passage, the cited one red. It
                      // ripples while its marker or footnote is pointed at.
                      <div
                        aria-hidden="true"
                        className={`w-40 max-w-[45%] ${isActive ? "[&_.bg-mark]:motion-safe:animate-ripple" : ""}`}
                      >
                        <ChunkStrip total={total} highlight={new Set([citation.chunkIndex])} maxCells={48} muted className="h-2" />
                      </div>
                    )}
                    {canOpen(citation) && (
                      <button
                        type="button"
                        onClick={(event) => openPassage(citation, event.currentTarget)}
                        className="link-underline font-mono text-[11px] text-ink-soft hover:text-mark"
                      >
                        Open passage <span aria-hidden="true">→</span>
                        <span className="sr-only"> {citation.chunkIndex + 1} of {citation.filename}</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
