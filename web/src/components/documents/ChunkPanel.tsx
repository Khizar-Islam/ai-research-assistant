"use client";

// Side panel listing a ready document's passages, exactly as they were indexed. The
// chunk strip at the top is a minimap: the passages on screen are marked in red, and
// clicking a cell jumps to that passage. Opened from an answer's citation, it starts at
// the cited passage (`focusChunkIndex`) and marks it.
import { motion } from "motion/react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useDocumentChunks } from "@/lib/hooks/useDocuments";
import { plural } from "@/lib/format";
import type { DocumentListItem } from "@/lib/types";
import { ChunkStrip } from "./ChunkStrip";

type Props = {
  document: DocumentListItem;
  onClose: () => void;
  focusChunkIndex?: number; // the passage an answer cited
};

export function ChunkPanel({ document, onClose, focusChunkIndex }: Props) {
  const chunks = useDocumentChunks(document.id);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState<ReadonlySet<number>>(new Set());

  // Focus goes into the dialog when it opens. Page scrolling is locked behind it.
  useEffect(() => {
    closeRef.current?.focus();
    const html = window.document.documentElement;
    const previous = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      html.style.overflow = previous;
    };
  }, []);

  // Track which passages are on screen, for the minimap.
  const list = chunks.data?.chunks;
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !list) return;
    const onScreen = new Set<number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const index = Number((entry.target as HTMLElement).dataset.index);
          if (entry.isIntersecting) onScreen.add(index);
          else onScreen.delete(index);
        }
        setVisible(new Set(onScreen));
      },
      { root },
    );
    root.querySelectorAll("article[data-index]").forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [list]);

  // Opened from a citation: go straight to the cited passage once the passages are in.
  // Instant, not animated: the panel is still sliding in, and the reader asked for this
  // passage, not a tour of the ones before it.
  useEffect(() => {
    if (!list || focusChunkIndex === undefined) return;
    scrollRef.current?.querySelector(`[data-index="${focusChunkIndex}"]`)?.scrollIntoView({ block: "start" });
  }, [list, focusChunkIndex]);

  function jumpTo(index: number) {
    // A jump can cover tens of thousands of pixels: animate it, unless the OS asks for
    // reduced motion, in which case go straight there.
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scrollRef.current
      ?.querySelector(`[data-index="${index}"]`)
      ?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  }

  // Escape closes; Tab stays inside the dialog while it's open.
  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !panelRef.current) return;
    const focusable = panelRef.current.querySelectorAll<HTMLElement>("button, [href], [tabindex]:not([tabindex='-1'])");
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && window.document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && window.document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  const averageTokens = list?.length
    ? Math.round(list.reduce((sum, chunk) => sum + chunk.tokenEstimate, 0) / list.length)
    : null;

  return (
    <div className="fixed inset-0 z-50" onKeyDown={handleKeyDown}>
      <motion.div
        aria-hidden="true"
        className="absolute inset-0 bg-ink/25"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="chunk-panel-title"
        className="absolute inset-y-0 right-0 flex w-full flex-col border-l border-ink bg-paper sm:w-[34rem]"
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "tween", duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
      >
        <header className="border-b border-rule px-5 pt-5 pb-4 sm:px-7">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="font-mono text-[11px] tracking-wide text-ink-soft uppercase">Passages</p>
              <h2 id="chunk-panel-title" className="mt-1 truncate font-serif text-2xl" title={document.filename}>
                {document.filename}
              </h2>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              className="link-underline shrink-0 pt-1 text-sm text-ink-soft hover:text-ink"
            >
              Close <span className="font-mono text-[11px] text-ink-faint">esc</span>
            </button>
          </div>
          <p className="mt-2 font-mono text-xs text-ink-soft">
            {plural(document.chunkCount, "passage")}
            {averageTokens !== null && <> · about {averageTokens} tokens each</>}
          </p>
          {list && list.length > 0 && (
            <div aria-hidden="true" className="mt-4">
              <ChunkStrip
                total={list.length}
                highlight={visible}
                onCellClick={jumpTo}
                maxCells={64}
                className="h-3"
              />
            </div>
          )}
        </header>

        <div
          ref={scrollRef}
          tabIndex={0} // focusable, so the keyboard can scroll it
          aria-label="Passage list"
          className="flex-1 overflow-y-auto overscroll-contain px-5 py-2 focus-visible:outline-offset-[-2px] sm:px-7"
        >
          {chunks.isPending && <p className="py-6 text-sm text-ink-soft">Loading passages…</p>}
          {chunks.isError && (
            <p role="alert" className="py-6 text-sm">
              Couldn’t load the passages. {chunks.error.message}{" "}
              <button type="button" onClick={() => chunks.refetch()} className="font-medium underline underline-offset-4">
                Try again
              </button>
            </p>
          )}
          {list?.map((chunk) => (
            <article
              key={chunk.id}
              data-index={chunk.chunkIndex}
              aria-current={chunk.chunkIndex === focusChunkIndex ? "true" : undefined}
              className={`scroll-mt-2 border-b border-rule py-5 last:border-b-0 ${
                chunk.chunkIndex === focusChunkIndex ? "-mx-3 border-l-2 border-l-mark bg-mark/5 px-3" : ""
              }`}
            >
              <p className="font-mono text-[11px] text-ink-soft">
                <span className="text-mark">§{chunk.chunkIndex + 1}</span> · ~{chunk.tokenEstimate} tokens ·{" "}
                {chunk.charCount.toLocaleString("en-US")} characters
                {chunk.chunkIndex === focusChunkIndex && <span className="text-mark"> · cited in the answer</span>}
              </p>
              <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap">{chunk.content}</p>
            </article>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
