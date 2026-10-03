"use client";

import { AnimatePresence } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useDeleteDocument, useDocuments } from "@/lib/hooks/useDocuments";
import { plural } from "@/lib/format";
import type { DocumentListItem, DocumentStatus } from "@/lib/types";
import { ChunkPanel } from "./ChunkPanel";
import { DocumentRow } from "./DocumentRow";

export function DocumentList() {
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

  if (documents.isPending) return <LoadingRows />;

  // Nothing to show at all: the very first load failed.
  if (documents.isError && !documents.data) {
    return (
      <Notice>
        Couldn’t load your documents. {documents.error.message}{" "}
        <button type="button" onClick={() => documents.refetch()} className="font-medium underline underline-offset-4">
          Try again
        </button>
      </Notice>
    );
  }

  const list = documents.data;
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
      {documents.isRefetchError && (
        <Notice>Couldn’t refresh: {documents.error.message} Showing the last list received.</Notice>
      )}
      {deleteFailed && (
        <Notice onDismiss={() => remove.reset()}>
          Couldn’t remove “{remove.variables?.filename}”: {remove.error.message}
        </Notice>
      )}

      {list.length === 0 ? (
        <div className="mt-6 border-t border-ink py-12">
          <p className="font-serif text-2xl">No documents yet.</p>
          <p className="mt-2 text-ink-soft">Upload a PDF or text file to start asking questions about it.</p>
        </div>
      ) : (
        <ul className="mt-6 border-t border-ink">
          {/* popLayout: a removed row leaves the layout at once, so the rows below can
              slide up while it fades out, instead of waiting for it. */}
          <AnimatePresence mode="popLayout" initial={false}>
            {list.map((document) => (
              <DocumentRow key={document.id} document={document} onDelete={(d) => remove.mutate(d)} onOpen={openPanel} />
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
    <div aria-busy="true" aria-label="Loading documents" className="mt-10 border-t border-ink">
      {[62, 48, 55].map((width) => (
        <div key={width} className="animate-pulse border-b border-rule py-5">
          <div className="h-4 bg-rule" style={{ width: `${width}%` }} />
          <div className="mt-2 h-3 w-40 bg-rule/70" />
        </div>
      ))}
    </div>
  );
}

function Notice({ children, onDismiss }: { children: ReactNode; onDismiss?: () => void }) {
  return (
    <div role="alert" className="mt-4 flex items-start gap-4 border-l-2 border-mark bg-paper-deep px-4 py-3 text-sm">
      <p className="flex-1">{children}</p>
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="text-ink-soft hover:text-ink">
          Dismiss
        </button>
      )}
    </div>
  );
}
