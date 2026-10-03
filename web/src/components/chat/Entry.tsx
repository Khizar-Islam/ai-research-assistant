// One question and its answer in the transcript.
import { formatUploadedAt } from "@/lib/format";
import type { RetrievalInfo } from "@/lib/types";
import Link from "next/link";
import { AnswerText } from "./AnswerText";
import { Footnotes } from "./Footnotes";
import type { TranscriptEntry } from "./types";

export function Entry({ entry }: { entry: TranscriptEntry }) {
  return (
    <article aria-labelledby={`${entry.id}-question`} className="border-t border-rule py-8 first:border-t-0">
      <p className="font-mono text-[11px] text-ink-soft">{formatUploadedAt(entry.createdAt)}</p>
      <h2 id={`${entry.id}-question`} className="mt-1 font-serif text-2xl leading-snug italic">
        {entry.question}
      </h2>

      <div className="mt-4">
        {entry.answered ? (
          <>
            <AnswerText entryId={entry.id} text={entry.answer} citations={entry.citations} />
            {entry.truncated && (
              <p className="mt-2 font-mono text-[11px] text-ochre-ink">Cut off at the length limit.</p>
            )}
            {entry.citations.length > 0 && <Footnotes entryId={entry.id} citations={entry.citations} />}
          </>
        ) : (
          <NotAnswered text={entry.answer} retrieval={entry.retrieval} />
        )}
      </div>
    </article>
  );
}

// "Don't know": set as a margin note rather than an answer, so it never reads as one.
// No footnotes: nothing in the documents backed it.
function NotAnswered({ text, retrieval }: { text: string; retrieval?: RetrievalInfo }) {
  return (
    <div className="border-l-2 border-ochre pl-4">
      <p className="font-serif text-lg leading-relaxed text-ink-soft">{text}</p>
      <p className="mt-1.5 font-mono text-[11px] text-ochre-ink">
        <Reason retrieval={retrieval} />
      </p>
    </div>
  );
}

function Reason({ retrieval }: { retrieval?: RetrievalInfo }) {
  // History rows don't record why; live answers do.
  if (!retrieval) return <>Not answered from your documents.</>;
  switch (retrieval.skipped) {
    case "no_documents":
      return (
        <>
          No processed documents to search.{" "}
          <Link href="/dashboard" className="underline underline-offset-4 hover:text-ink">
            Upload one
          </Link>
        </>
      );
    case "below_threshold":
      return (
        <>
          Nothing in your documents was close to this question
          {retrieval.bestSimilarity !== null && <> (best match {retrieval.bestSimilarity.toFixed(2)} similarity)</>}.
        </>
      );
    case null:
      return <>The closest passages didn’t contain the answer.</>;
  }
}
