"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { FILE_TYPE_LABEL, formatUploadedAt, plural, STAGE_LABEL } from "@/lib/format";
import { loop } from "@/lib/motion";
import { EMBED_BATCH_SIZE, STAGES } from "@/lib/pipeline";
import type { DocumentListItem, IngestStage } from "@/lib/types";
import { ChunkStrip } from "./ChunkStrip";

type Props = {
  document: DocumentListItem;
  onDelete: (document: DocumentListItem) => void;
  onOpen: (document: DocumentListItem, trigger: HTMLElement) => void; // show its passages
};

export function DocumentRow({ document, onDelete, onOpen }: Props) {
  const reducedMotion = useReducedMotion();
  const { filename, fileType, status, createdAt, chunkCount, errorMessage, stage } = document;

  return (
    <motion.li
      layout="position" // slide into place when a row above is added or removed
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -16, transition: { duration: 0.2 } }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-2 border-b border-rule py-5 transition-colors duration-150 hover:bg-paper-deep/40 sm:grid-cols-[minmax(0,1fr)_15rem_8.5rem] sm:items-baseline"
    >
      {/* Explicit grid positions at both sizes: phones put Remove beside the filename and
          the status underneath; wider screens use one row of filename · status · Remove. */}
      <div className="col-start-1 row-start-1 min-w-0">
        <h2 className="truncate font-medium" title={filename}>
          {status === "ready" ? (
            <button
              type="button"
              onClick={(event) => onOpen(document, event.currentTarget)}
              aria-haspopup="dialog"
              className="link-underline max-w-full truncate text-left hover:text-mark"
            >
              {filename}
            </button>
          ) : (
            filename
          )}
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
        {status === "ready" && chunkCount > 0 && (
          // A finished document's passages at a glance; the full view is one click away.
          <div aria-hidden="true" className="mt-3 max-w-56">
            <ChunkStrip total={chunkCount} className="h-1.5" />
          </div>
        )}
      </div>

      <div className="col-span-2 row-start-2 sm:col-span-1 sm:col-start-2 sm:row-start-1">
        <StatusLine document={document} />
      </div>

      <div className="col-start-2 row-start-1 justify-self-end sm:col-start-3">
        <DeleteControl filename={filename} onConfirm={() => onDelete(document)} />
      </div>

      <AnimatePresence initial={false}>
        {status === "processing" && (
          <motion.div
            key="progress"
            className="col-span-full overflow-hidden"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            // Height isn't covered by MotionConfig's reduced-motion handling, and the rows
            // below would glide with it: with reduced motion it opens and closes at once.
            transition={reducedMotion ? { duration: 0 } : undefined}
            exit={{ opacity: 0, height: 0, transition: reducedMotion ? { duration: 0 } : { duration: 0.35, delay: 0.6 } }} // let the last fill finish first
          >
            <Progress document={document} />
          </motion.div>
        )}
      </AnimatePresence>

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
  const { status } = document;

  if (status === "ready") {
    return <Status swatch="bg-ready" className="text-ready" label="Ready" />;
  }
  if (status === "failed") {
    return <Status swatch="bg-mark" className="text-mark" label="Failed" />;
  }

  // The details (stage track, strip) are in <Progress> under the row.
  return <Status swatch="bg-ochre" className="text-ochre-ink" label="Processing" pulse />;
}

// Where a processing document is: the four pipeline stages, then its passages as a chunk
// strip filling in as Gemini embeds them.
function Progress({ document }: { document: DocumentListItem }) {
  const stage = document.stage ?? "extracting";
  const total = document.chunksTotal;
  const embedded = stage === "saving" && total !== null ? total : document.chunksEmbedded;
  const workingUntil = total === null ? 0 : Math.min(embedded + EMBED_BATCH_SIZE, total);

  const valueText =
    total === null
      ? `${STAGE_LABEL[stage]}`
      : stage === "saving"
        ? `Saving ${plural(total, "passage")}`
        : `Embedding: ${embedded} of ${plural(total, "passage")} done`;

  return (
    <div className="pt-1 pb-1">
      <StageTrack current={stage} embedded={embedded} total={total} />
      <div
        role="progressbar"
        aria-label={`Processing ${document.filename}`}
        aria-valuemin={0}
        aria-valuemax={total ?? 1}
        aria-valuenow={total === null ? undefined : embedded}
        aria-valuetext={valueText}
        className="mt-3"
      >
        {/* Before chunking finishes the passage count is unknown: one rippling bar. */}
        {total === null ? <ChunkStrip total={1} embedded={0} /> : <ChunkStrip total={total} embedded={embedded} />}
      </div>
      {stage === "embedding" && total !== null && embedded < total && (
        // Batches land about a minute apart; this says what is happening in between.
        <p className="mt-2 font-mono text-[11px] text-ochre-ink">
          Embedding passages {embedded + 1}–{workingUntil} of {total.toLocaleString("en-US")}
        </p>
      )}
    </div>
  );
}

const STAGE_SHORT: Record<IngestStage, string> = {
  extracting: "Extract",
  chunking: "Chunk",
  embedding: "Embed",
  saving: "Save",
};

function StageTrack({ current, embedded, total }: { current: IngestStage; embedded: number; total: number | null }) {
  const currentIndex = STAGES.indexOf(current);

  return (
    <ol aria-label="Processing stages" className="flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[11px]">
      {STAGES.map((stage, index) => {
        const state = index < currentIndex ? "done" : index === currentIndex ? "current" : "waiting";
        const count = stage === "embedding" && total !== null && state !== "waiting" ? ` ${embedded}/${total}` : "";
        return (
          <li
            key={stage}
            aria-current={state === "current" ? "step" : undefined}
            className={`flex items-center gap-2.5 ${state === "done" ? "text-ink" : state === "current" ? "text-ochre-ink" : "text-ink-faint"}`}
          >
            {index > 0 && <span aria-hidden="true" className="h-px w-4 bg-rule" />}
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={`size-1.5 ${state === "done" ? "bg-ink" : state === "current" ? "bg-ochre motion-safe:animate-ripple" : "border border-ink-faint"}`}
              />
              {STAGE_SHORT[stage]}
              {count}
              <span className="sr-only">{state === "done" ? " (done)" : state === "current" ? " (in progress)" : ""}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Status({ swatch, className, label, pulse }: { swatch: string; className: string; label: string; pulse?: boolean }) {
  // The pulse says "still working"; with reduced motion the ochre dot and the label say it.
  const pulsing = loop(useReducedMotion() || !pulse, { opacity: [1, 0.3, 1] }, 1.6);
  return (
    <p className={`flex items-center gap-2 text-sm ${className}`}>
      <motion.span aria-hidden="true" className={`size-2 shrink-0 ${swatch}`} {...pulsing} />
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
        className="link-underline text-sm text-ink-soft hover:text-mark"
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
        className="press bg-mark px-2.5 py-1 font-medium text-paper hover:bg-mark-deep"
      >
        Remove
      </button>
      <button type="button" onClick={() => setConfirming(false)} className="text-ink-soft hover:text-ink">
        Keep
      </button>
    </div>
  );
}
