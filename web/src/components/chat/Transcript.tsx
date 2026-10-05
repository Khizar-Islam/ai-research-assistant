"use client";

// The questions asked so far and their answers, oldest first (newest at the bottom, next
// to where the next question is typed).
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { plural } from "@/lib/format";
import { DURATION, EASE, exit } from "@/lib/motion";
import { useDocuments } from "@/lib/hooks/useDocuments";
import type { AnswerExtras, LiveAnswer } from "@/lib/hooks/useAsk";
import { HISTORY_LIMIT, useQueryHistory } from "@/lib/hooks/useQueries";
import { Entry } from "./Entry";
import { LiveEntry } from "./LiveEntry";

type Props = {
  live: LiveAnswer | null;
  extras: ReadonlyMap<string, AnswerExtras>; // retrieval info for answers given on this page
  justAnswered: string | null;
  onRetry: () => void;
  onDismiss: () => void;
};

// The skeleton crossfades into whatever replaces it (the transcript, or the error): it
// leaves the layout at once and fades out over the content fading in.
export function Transcript(props: Props) {
  const history = useQueryHistory();
  const view = history.isPending ? "loading" : history.isError ? "error" : "entries";

  return (
    <div className="relative">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={view}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: DURATION.swap, ease: EASE.out } }}
          exit={{ opacity: 0, transition: exit }}
        >
          {view === "loading" ? (
            <LoadingEntries />
          ) : view === "error" ? (
            <div role="alert" className="border-l-2 border-mark bg-paper-deep px-4 py-3 text-sm">
              Couldn’t load your earlier questions. {history.error?.message}{" "}
              <button type="button" onClick={() => history.refetch()} className="font-medium underline underline-offset-4">
                Try again
              </button>
            </div>
          ) : (
            <Entries {...props} />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function Entries({ live, extras, justAnswered, onRetry, onDismiss }: Props) {
  const history = useQueryHistory();
  if (!history.data) return null; // Transcript only renders this once history has arrived

  const entries = [...history.data].reverse(); // the API sends newest first

  return (
    <section aria-label="Questions and answers">
      {entries.length === 0 && !live ? (
        <div className="py-10">
          <p className="font-serif text-2xl">No questions yet.</p>
          <p className="mt-2 text-ink-soft">Ask something below. Answers come only from your documents.</p>
        </div>
      ) : (
        <>
          {entries.length === HISTORY_LIMIT && (
            <p className="pb-4 font-mono text-[11px] text-ink-soft">Showing your last {HISTORY_LIMIT} questions.</p>
          )}
          {entries.map((query) => (
            <Entry key={query.id} entry={{ ...query, ...extras.get(query.id) }} revealFootnotes={query.id === justAnswered} />
          ))}
        </>
      )}
      {/* Keyed per attempt, so each new question (or "Ask again") enters fresh. */}
      {live && <LiveEntry key={live.startedAt} live={live} onRetry={onRetry} onDismiss={onDismiss} />}
    </section>
  );
}

// What the answers are drawn from. Each question is answered on its own: there is no
// conversation memory, so the page says so instead of looking like a chat that has one.
export function SearchScope() {
  const documents = useDocuments();
  const ready = documents.data?.filter((d) => d.status === "ready") ?? [];
  const passages = ready.reduce((sum, d) => sum + d.chunkCount, 0);

  if (documents.isPending) return <p className="h-4" />;
  if (ready.length === 0) {
    return (
      <p className="text-ink-soft">
        You have no processed documents yet.{" "}
        <Link href="/dashboard" className="text-ink underline underline-offset-4 hover:text-mark">
          Upload one
        </Link>{" "}
        to start asking.
      </p>
    );
  }
  return (
    <p className="text-ink-soft">
      Answers come only from your {plural(ready.length, "document")} ({plural(passages, "passage")}). Each question is
      answered on its own, without memory of earlier ones.
    </p>
  );
}

function LoadingEntries() {
  return (
    <div aria-busy="true" aria-label="Loading earlier questions">
      {[70, 52].map((width) => (
        <div key={width} className="border-t border-rule py-8 first:border-t-0 motion-safe:animate-pulse">
          <div className="h-3 w-28 bg-rule/70" />
          <div className="mt-3 h-6 bg-rule" style={{ width: `${width}%` }} />
          <div className="mt-5 h-4 w-full bg-rule/60" />
          <div className="mt-2 h-4 w-4/5 bg-rule/60" />
        </div>
      ))}
    </div>
  );
}
