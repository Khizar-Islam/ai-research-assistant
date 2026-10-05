"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useDeleteDocument, useDocuments } from "@/lib/hooks/useDocuments";
import { plural } from "@/lib/format";
import { DURATION, EASE, enter, exit, staggerDelay } from "@/lib/motion";
import type { DocumentListItem, DocumentStatus } from "@/lib/types";
import { ChunkPanel } from "./ChunkPanel";
import { DocumentRow } from "./DocumentRow";

// Past this many rows, rows no longer slide when one above them is added or removed.
const SLIDE_ROWS_UP_TO = 50;

// The skeleton crossfades into whatever replaces it (the list, or the error): the
// skeleton leaves the layout at once and fades out over the content fading in.
export function DocumentList() {
  const documents = useDocuments();
  const view = documents.isPending ? "loading" : documents.isError && !documents.data ? "error" : "list";

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
            <LoadingRows />
          ) : view === "error" ? (
            <Notice>
              Couldn’t load your documents. {documents.error?.message}{" "}
              <button type="button" onClick={() => documents.refetch()} className="font-medium underline underline-offset-4">
                Try again
              </button>
            </Notice>
          ) : (
            <Documents />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function Documents() {
  const documents = useDocuments();
  const remove = useDeleteDocument();
  const announcement = useStatusAnnouncements(documents.data);

  // The open chunk panel, and the button that opened it (focus returns there on close).
  const [openId, setOpenId] = useState<string | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const openDocument = documents.data?.find((d) => d.id === openId && d.status === "ready");

  function openPanel(document: DocumentListItem, element: HTMLElement) {
    trigger.current = element;
    setOpenId(document.id);
  }
  function closePanel() {
    setOpenId(null);
    trigger.current?.focus();
  }

  // The rows on screen when the list first appears come in one after another (the first
  // few; the rest arrive with the last of those). Rows added later just enter on their own.
  const reducedMotion = useReducedMotion();
  const list = documents.data;
  const [firstShown] = useState(() => new Set(list?.map((d) => d.id)));
  const enterDelay = (id: string, index: number) => (firstShown.has(id) && !reducedMotion ? staggerDelay(index) : 0);

  if (!list) return null; // DocumentList only renders this once the list has arrived
  const indexed = list.filter((d) => d.status === "ready");
  const passages = indexed.reduce((sum, d) => sum + d.chunkCount, 0);
  // A failed delete puts the row back (see useDeleteDocument); say why. A 404 just means
  // it was already gone, which needs no message.
  const deleteFailed = remove.isError && (remove.error as { status?: number }).status !== 404;

  return (
    <section aria-label="Your documents">
      {/* Screen readers hear when a document finishes; sighted users see the row change. */}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {list.length > 0 && (
        <p className="font-mono text-xs text-ink-soft">
          {plural(list.length, "document")} · {plural(passages, "passage")} searchable
        </p>
      )}

      {/* A background refresh failed but we still have the last good list: keep it on
          screen and say it may be out of date, instead of replacing it with an error. */}
      <AnimatePresence initial={false}>
        {documents.isRefetchError && (
          <Notice key="refresh" animated>
            Couldn’t refresh: {documents.error.message} Showing the last list received.
          </Notice>
        )}
        {deleteFailed && (
          <Notice key="delete" animated onDismiss={() => remove.reset()}>
            Couldn’t remove “{remove.variables?.filename}”: {remove.error.message}
          </Notice>
        )}
      </AnimatePresence>

      {list.length === 0 ? (
        <div className="mt-6 border-t border-ink py-12">
          <p className="font-serif text-2xl">No documents yet.</p>
          <p className="mt-2 text-ink-soft">Upload a PDF or text file to start asking questions about it.</p>
        </div>
      ) : (
        <ul className="mt-6 border-t border-ink">
          {/* popLayout: a removed row leaves the layout at once, so the rows below can
              slide up while it fades out, instead of waiting for it. */}
          <AnimatePresence mode="popLayout">
            {list.map((document, index) => (
              <DocumentRow
                key={document.id}
                document={document}
                onDelete={(d) => remove.mutate(d)}
                onOpen={openPanel}
                enterDelay={enterDelay(document.id, index)}
                slideOnReorder={list.length <= SLIDE_ROWS_UP_TO}
              />
            ))}
          </AnimatePresence>
        </ul>
      )}

      <AnimatePresence>
        {openDocument && <ChunkPanel key={openDocument.id} document={openDocument} onClose={closePanel} />}
      </AnimatePresence>
    </section>
  );
}

// "notes.pdf is ready" when a processing document finishes (or fails) while you watch.
function useStatusAnnouncements(list: DocumentListItem[] | undefined): string {
  const previous = useRef<Map<string, DocumentStatus> | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!list) return;
    const before = previous.current;
    previous.current = new Map(list.map((d) => [d.id, d.status]));
    if (!before) return; // first load: nothing has changed yet

    const finished = list.filter((d) => before.get(d.id) === "processing" && d.status !== "processing");
    if (finished.length > 0) {
      setMessage(
        finished
          .map((d) => (d.status === "ready" ? `${d.filename} is ready.` : `${d.filename} failed: ${d.errorMessage ?? ""}`))
          .join(" "),
      );
    }
  }, [list]);

  return message;
}

function LoadingRows() {
  return (
    // Its top rule sits where the list's will (summary line + mt-6 = mt-10), so nothing jumps.
    <div aria-busy="true" aria-label="Loading documents" className="mt-10 border-t border-ink">
      {[62, 48, 55].map((width) => (
        <div key={width} className="border-b border-rule py-5 motion-safe:animate-pulse">
          <div className="h-4 bg-rule" style={{ width: `${width}%` }} />
          <div className="mt-2 h-3 w-40 bg-rule/70" />
        </div>
      ))}
    </div>
  );
}

type NoticeProps = { children: ReactNode; onDismiss?: () => void; animated?: boolean };

// `animated`: rises in and fades out (inside an AnimatePresence). The 4px rise is a
// transform, so with reduced motion it's a plain fade.
function Notice({ children, onDismiss, animated }: NoticeProps) {
  const motionProps = animated
    ? { initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, transition: exit }, transition: enter() }
    : {};
  return (
    <motion.div role="alert" className="mt-4 flex items-start gap-4 border-l-2 border-mark bg-paper-deep px-4 py-3 text-sm" {...motionProps}>
      <p className="flex-1">{children}</p>
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="text-ink-soft hover:text-ink">
          Dismiss
        </button>
      )}
    </motion.div>
  );
}
