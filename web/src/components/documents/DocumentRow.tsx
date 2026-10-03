"use client";

import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { FILE_TYPE_LABEL, formatUploadedAt, plural, STAGE_LABEL } from "@/lib/format";
import type { DocumentListItem } from "@/lib/types";

type Props = {
  document: DocumentListItem;
  onDelete: (document: DocumentListItem) => void;
};

export function DocumentRow({ document, onDelete }: Props) {
  const { filename, fileType, status, createdAt, chunkCount, errorMessage, stage } = document;

  return (
    <motion.li
      layout="position" // slide into place when a row above is added or removed
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -16, transition: { duration: 0.2 } }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-2 border-b border-rule py-5 sm:grid-cols-[minmax(0,1fr)_15rem_8.5rem] sm:items-baseline"
    >
      {/* Explicit grid positions at both sizes: phones put Remove beside the filename and
          the status underneath; wider screens use one row of filename · status · Remove. */}
      <div className="col-start-1 row-start-1 min-w-0">
        <h2 className="truncate font-medium" title={filename}>
          {filename}
        </h2>
        {/* Each item is unbreakable, so a narrow screen wraps between items, not inside one. */}
        <p className="mt-1 font-mono text-xs text-ink-soft [&>span]:whitespace-nowrap">
          <span>{FILE_TYPE_LABEL[fileType]}</span> · <span>{formatUploadedAt(createdAt)}</span>
          {status === "ready" && (
            <>
              {" "}
              · <span>{plural(chunkCount, "passage")}</span>
            </>
          )}
        </p>
      </div>

      <div className="col-span-2 row-start-2 sm:col-span-1 sm:col-start-2 sm:row-start-1">
        <StatusLine document={document} />
      </div>

      <div className="col-start-2 row-start-1 justify-self-end sm:col-start-3">
        <DeleteControl filename={filename} onConfirm={() => onDelete(document)} />
      </div>

      {status === "failed" && errorMessage && (
        <p className="col-span-full -mt-1 text-sm text-ink-soft">
          {stage ? `${STAGE_LABEL[stage]} failed: ` : ""}
          {errorMessage}
        </p>
      )}
    </motion.li>
  );
}

function StatusLine({ document }: { document: DocumentListItem }) {
  const { status, stage, chunksEmbedded, chunksTotal } = document;

  if (status === "ready") {
    return <Status swatch="bg-ready" className="text-ready" label="Ready" />;
  }
  if (status === "failed") {
    return <Status swatch="bg-mark" className="text-mark" label="Failed" />;
  }

  // Processing. Stage 4 replaces this text with the stage track and chunk strip.
  const detail =
    stage === "embedding" && chunksTotal !== null
      ? `Embedding · ${chunksEmbedded.toLocaleString("en-US")} of ${plural(chunksTotal, "passage")}`
      : `${STAGE_LABEL[stage ?? "extracting"]}…`;
  return <Status swatch="bg-ochre" className="text-ochre-ink" label={detail} pulse />;
}

function Status({ swatch, className, label, pulse }: { swatch: string; className: string; label: string; pulse?: boolean }) {
  return (
    <p className={`flex items-center gap-2 text-sm ${className}`}>
      <motion.span
        aria-hidden="true"
        className={`size-2 shrink-0 ${swatch}`}
        animate={pulse ? { opacity: [1, 0.3, 1] } : { opacity: 1 }}
        transition={pulse ? { duration: 1.6, repeat: Infinity, ease: "easeInOut" } : undefined}
      />
      {label}
    </p>
  );
}

// "Remove" turns into an inline confirmation, so a mis-click can't delete anything and
// there's no browser confirm() dialog.
function DeleteControl({ filename, onConfirm }: { filename: string; onConfirm: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);

  // Move focus into the confirmation when it opens, and back to "Remove" if cancelled,
  // so keyboard users never lose their place.
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
    else if (wasConfirming.current) triggerRef.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  if (!confirming) {
    return (
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setConfirming(true)}
        aria-label={`Remove ${filename}`}
        className="text-sm text-ink-soft underline-offset-4 hover:text-mark hover:underline"
      >
        Remove
      </button>
    );
  }

  return (
    <div
      role="group"
      aria-label={`Confirm removing ${filename}`}
      className="flex items-center gap-3 text-sm"
      onKeyDown={(event) => event.key === "Escape" && setConfirming(false)}
    >
      <button
        ref={confirmRef}
        type="button"
        onClick={onConfirm}
        className="bg-mark px-2.5 py-1 font-medium text-paper hover:bg-mark-deep"
      >
        Remove
      </button>
      <button type="button" onClick={() => setConfirming(false)} className="text-ink-soft hover:text-ink">
        Keep
      </button>
    </div>
  );
}
