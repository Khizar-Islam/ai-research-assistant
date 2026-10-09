"use client";

// The /chat page's interactive part: the transcript, the answer in progress, and the
// question box, sharing one useAsk(); plus the citation state shared by every answer's
// markers and footnotes, and the passages panel they open.
import { AnimatePresence } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChunkPanel } from "@/components/documents/ChunkPanel";
import { useAsk } from "@/lib/hooks/useAsk";
import { stopSpeaking } from "@/lib/hooks/useSpeech";
import { useDocuments } from "@/lib/hooks/useDocuments";
import { useQueryHistory } from "@/lib/hooks/useQueries";
import { AskForm } from "./AskForm";
import { CitationContext, type CitationContextValue } from "./CitationContext";
import { Transcript } from "./Transcript";

// "At the bottom" with some slack, so a reader a few lines up still gets followed.
const FOLLOW_SLACK_PX = 160;

export function ChatView() {
  const { live, busy, ask, stop, dismiss, extras, justAnswered } = useAsk();
  const documents = useDocuments();
  const historyLoaded = useQueryHistory().isSuccess;
  const noDocuments = documents.isSuccess && !documents.data.some((d) => d.status === "ready");

  // Citations: which one is pointed at, and the passage open in the panel (if any).
  const [active, setActive] = useState<string | null>(null);
  const [open, setOpen] = useState<{ documentId: string; chunkIndex: number } | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const readyDocument = (id: string) => documents.data?.find((d) => d.id === id && d.status === "ready");
  const openDocument = open ? readyDocument(open.documentId) : undefined;

  const citations = useMemo<CitationContextValue>(
    () => ({
      active,
      setActive,
      canOpen: (citation) =>
        citation.available !== false && !!documents.data?.some((d) => d.id === citation.documentId && d.status === "ready"),
      openPassage: (citation, element) => {
        trigger.current = element;
        setOpen({ documentId: citation.documentId, chunkIndex: citation.chunkIndex });
      },
    }),
    [active, documents.data],
  );

  function closePanel() {
    setOpen(null);
    trigger.current?.focus();
  }

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

  // An answer being read aloud stops when you leave /chat (in-app navigation unmounts
  // this; closing or reloading the tab fires pagehide).
  useEffect(() => {
    window.addEventListener("pagehide", stopSpeaking);
    return () => {
      window.removeEventListener("pagehide", stopSpeaking);
      stopSpeaking();
    };
  }, []);

  function askQuestion(question: string) {
    following.current = true; // asking always brings the new answer into view
    stopSpeaking(); // a new question silences the old answer
    void ask(question);
  }

  return (
    <CitationContext.Provider value={citations}>
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
      <AnimatePresence>
        {openDocument && open && (
          <ChunkPanel
            key={`${open.documentId}:${open.chunkIndex}`}
            document={openDocument}
            focusChunkIndex={open.chunkIndex}
            onClose={closePanel}
          />
        )}
      </AnimatePresence>
    </CitationContext.Provider>
  );
}
