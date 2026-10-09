"use client";

// The question being answered right now. Shows what the server is really doing (searching,
// then writing from N passages), the answer as it streams in, and what went wrong if it
// failed. Once the answer is done it leaves, and the finished entry takes its place.
import { motion, useReducedMotion } from "motion/react";
import type { LiveAnswer } from "@/lib/hooks/useAsk";
import { enter, loop } from "@/lib/motion";
import { AnswerText } from "./AnswerText";
import { QuestionHeading } from "./Entry";
import { StageLine } from "./StageLine";

type Props = { live: LiveAnswer; onRetry: () => void; onDismiss: () => void };

export const LIVE_ENTRY_ID = "live-answer";

export function LiveEntry({ live, onRetry, onDismiss }: Props) {
  const text = live.pieces.join("");
  const lastPiece = live.pieces.at(-1) ?? "";

  return (
    // Rises out of the question box below it into the transcript. Remounted per attempt
    // (Transcript keys it), so "Ask again" rises too. A transform, so reduced motion fades.
    <motion.article
      id={LIVE_ENTRY_ID}
      aria-labelledby="live-question"
      className="scroll-mt-24 border-t border-rule py-8 first:border-t-0"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={enter()}
    >
      <QuestionHeading id="live-question" question={live.question} time="Now" />

      <div className="mt-4">
        {(live.phase === "searching" || live.phase === "writing") && (
          <>
            <StageLine writing={live.phase === "writing"} passages={live.sources.length} />
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
          <motion.div role="alert" className="border-l-2 border-mark bg-paper-deep px-4 py-3 text-sm" {...noteEntrance}>
            <p>{live.error?.message}</p>
            <p className="mt-2 flex gap-4">
              <button type="button" onClick={onRetry} className="font-medium underline underline-offset-4 hover:text-mark">
                Try again
              </button>
              <button type="button" onClick={onDismiss} className="text-ink-soft hover:text-ink">
                Dismiss
              </button>
            </p>
          </motion.div>
        )}

        {live.phase === "stopped" && (
          <motion.p className="border-l-2 border-rule pl-4 text-sm text-ink-soft" {...noteEntrance}>
            Stopped. Nothing was saved.{" "}
            <button type="button" onClick={onRetry} className="text-ink underline underline-offset-4 hover:text-mark">
              Ask again
            </button>
          </motion.p>
        )}
      </div>
    </motion.article>
  );
}

// How the error and "Stopped" notes arrive: a short rise (a plain fade with reduced motion).
const noteEntrance = { initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 }, transition: enter() };

// A thin bar at the end of the text while the model is still writing: blinking, or steady
// when the user has asked for reduced motion.
function Caret() {
  const blink = loop(useReducedMotion(), { opacity: [1, 0, 1] }, 1);
  return <motion.span aria-hidden="true" className="ml-0.5 inline-block h-[1.1em] w-[2px] translate-y-[3px] bg-ink" {...blink} />;
}
