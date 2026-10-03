"use client";

// The /chat page's interactive part: the transcript, the answer in progress, and the
// question box, sharing one useAsk().
import { useEffect, useRef } from "react";
import { useAsk } from "@/lib/hooks/useAsk";
import { useDocuments } from "@/lib/hooks/useDocuments";
import { useQueryHistory } from "@/lib/hooks/useQueries";
import { AskForm } from "./AskForm";
import { Transcript } from "./Transcript";

// "At the bottom" with some slack, so a reader a few lines up still gets followed.
const FOLLOW_SLACK_PX = 160;

export function ChatView() {
  const { live, busy, ask, stop, dismiss, extras, justAnswered } = useAsk();
  const documents = useDocuments();
  const historyLoaded = useQueryHistory().isSuccess;
  const noDocuments = documents.isSuccess && !documents.data.some((d) => d.status === "ready");

  // Follow the answer as it grows, but only if the reader is already at the bottom:
  // someone who scrolled up to reread an earlier answer is left where they are.
  const following = useRef(true);
  useEffect(() => {
    const onScroll = () => {
      following.current = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - FOLLOW_SLACK_PX;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  // Also once when history arrives: the page opens at the newest answer, by the question box.
  const growth = `${historyLoaded}:${live?.phase}:${live?.pieces.length}:${justAnswered}`;
  useEffect(() => {
    if (following.current) window.scrollTo({ top: document.documentElement.scrollHeight });
  }, [growth]);

  function askQuestion(question: string) {
    following.current = true; // asking always brings the new answer into view
    void ask(question);
  }

  return (
    <>
      <div className="mt-10 border-t border-ink">
        <Transcript
          live={live}
          extras={extras}
          justAnswered={justAnswered}
          onRetry={() => live && askQuestion(live.question)}
          onDismiss={dismiss}
        />
      </div>
      <AskForm busy={busy} disabled={noDocuments} onAsk={askQuestion} onStop={stop} />
    </>
  );
}
