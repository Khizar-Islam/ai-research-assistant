"use client";

// The question being answered right now. Shows what the server is really doing (searching,
// then writing from N passages), the answer as it streams in, and what went wrong if it
// failed. Once the answer is done it leaves, and the finished entry takes its place.
import { motion } from "motion/react";
import type { LiveAnswer } from "@/lib/hooks/useAsk";
import { plural } from "@/lib/format";
import { AnswerText } from "./AnswerText";
import { QuestionHeading } from "./Entry";

type Props = { live: LiveAnswer; onRetry: () => void; onDismiss: () => void };

export const LIVE_ENTRY_ID = "live-answer";

export function LiveEntry({ live, onRetry, onDismiss }: Props) {
  const text = live.pieces.join("");
  const lastPiece = live.pieces.at(-1) ?? "";

  return (
    <article id={LIVE_ENTRY_ID} aria-labelledby="live-question" className="scroll-mt-24 border-t border-rule py-8 first:border-t-0">
      <QuestionHeading id="live-question" question={live.question} time="Now" />

      <div className="mt-4">
        {(live.phase === "searching" || live.phase === "writing") && (
          <>
            <Progress live={live} />
            {text && (
              <div className="mt-3">
                <AnswerText
                  entryId={LIVE_ENTRY_ID}
                  text={text}
                  citations={live.sources}
                  fadeFrom={text.length - lastPiece.length}
                  trailing={<Caret />}
                />
              </div>
            )}
          </>
        )}

        {live.phase === "error" && (
          <div role="alert" className="border-l-2 border-mark bg-paper-deep px-4 py-3 text-sm">
            <p>{live.error?.message}</p>
            <p className="mt-2 flex gap-4">
              <button type="button" onClick={onRetry} className="font-medium underline underline-offset-4 hover:text-mark">
                Try again
              </button>
              <button type="button" onClick={onDismiss} className="text-ink-soft hover:text-ink">
                Dismiss
              </button>
            </p>
          </div>
        )}

        {live.phase === "stopped" && (
          <p className="border-l-2 border-rule pl-4 text-sm text-ink-soft">
            Stopped. Nothing was saved.{" "}
            <button type="button" onClick={onRetry} className="text-ink underline underline-offset-4 hover:text-mark">
              Ask again
            </button>
          </p>
        )}
      </div>
    </article>
  );
}

// The two real stages the server reports. Announced politely to screen readers (the
// streaming text itself isn't: reading every piece aloud would be noise).
function Progress({ live }: { live: LiveAnswer }) {
  const writing = live.phase === "writing";
  const label = writing
    ? `Writing from ${plural(live.sources.length, "passage")}`
    : "Searching your documents";

  return (
    <p role="status" className="flex items-center gap-2.5 font-mono text-[11px] text-ochre-ink">
      <span className="flex items-center gap-1.5 text-ink">
        <span aria-hidden="true" className={`size-1.5 ${writing ? "bg-ink" : "bg-ochre motion-safe:animate-ripple"}`} />
        Search
      </span>
      <span aria-hidden="true" className="h-px w-4 bg-rule" />
      <span className={`flex items-center gap-1.5 ${writing ? "text-ochre-ink" : "text-ink-faint"}`}>
        <span
          aria-hidden="true"
          className={`size-1.5 ${writing ? "bg-ochre motion-safe:animate-ripple" : "border border-ink-faint"}`}
        />
        Write
      </span>
      <span className="text-ochre-ink">· {label}…</span>
    </p>
  );
}

// A thin blinking bar at the end of the text while the model is still writing.
function Caret() {
  return (
    <motion.span
      aria-hidden="true"
      className="ml-0.5 inline-block h-[1.1em] w-[2px] translate-y-[3px] bg-ink"
      animate={{ opacity: [1, 0, 1] }}
      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
    />
  );
}
