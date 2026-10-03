"use client";

// Drag files in, or click (or Tab + Enter) to choose them. A <label> wrapping a real file
// input, so keyboard and screen-reader users get the native file picker for free.
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import type { UploadProblem } from "@/lib/hooks/useDocuments";
import { ACCEPTED_EXTENSIONS } from "@/lib/pipeline";
import { plural } from "@/lib/format";

type Props = {
  onFiles: (files: File[]) => void;
  uploading: string[];
  problems: UploadProblem[];
  onDismiss: (id: string) => void;
};

// The little "page into passages" mark: bars that pull apart while a file is held over
// the zone, the same idea as the chunk strip.
const BARS = [100, 92, 97, 60, 95, 88, 74];

export function Dropzone({ onFiles, uploading, problems, onDismiss }: Props) {
  const [dragging, setDragging] = useState(false);
  const reducedMotion = useReducedMotion(); // margins aren't covered by MotionConfig
  // dragenter/dragleave fire for every child element crossed, so count them instead of
  // trusting a single leave event (which would make the highlight flicker).
  const depth = useRef(0);

  // A file dropped anywhere else on the page would make the browser navigate away to
  // open it. While the dashboard is open, ignore drops outside the zone.
  useEffect(() => {
    const ignore = (event: globalThis.DragEvent) => event.preventDefault();
    window.addEventListener("dragover", ignore);
    window.addEventListener("drop", ignore);
    return () => {
      window.removeEventListener("dragover", ignore);
      window.removeEventListener("drop", ignore);
    };
  }, []);

  const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes("Files");

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    depth.current = 0;
    setDragging(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) onFiles(files);
  }

  return (
    <div>
      <label
        onDragEnter={(event) => {
          if (!hasFiles(event)) return;
          depth.current += 1;
          setDragging(true);
        }}
        onDragLeave={() => {
          depth.current -= 1;
          if (depth.current <= 0) setDragging(false);
        }}
        onDragOver={(event) => {
          if (!hasFiles(event)) return;
          event.preventDefault(); // required for the drop event to fire
          event.dataTransfer.dropEffect = "copy";
        }}
        onDrop={handleDrop}
        className={`flex cursor-pointer items-center gap-6 border border-dashed px-6 py-7 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-3 has-[:focus-visible]:outline-mark sm:gap-8 sm:px-8 ${
          dragging ? "border-mark bg-mark/5" : "border-ink-faint hover:border-ink hover:bg-paper-deep/60 active:bg-paper-deep"
        }`}
      >
        <input
          type="file"
          multiple
          accept={ACCEPTED_EXTENSIONS.join(",")}
          className="sr-only"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = ""; // so choosing the same file again still fires onChange
            if (files.length > 0) onFiles(files);
          }}
        />

        <div aria-hidden="true" className="hidden w-14 shrink-0 sm:block">
          {BARS.map((width, i) => (
            <motion.div
              key={i}
              className={`h-[3px] origin-left ${dragging ? "bg-mark" : "bg-ink/30"}`}
              style={{ width: `${width}%` }}
              // Held over the zone, the "page" splits into three passages.
              animate={{ marginTop: i === 0 ? 0 : dragging && (i === 3 || i === 5) ? 9 : 4 }}
              transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 400, damping: 28 }}
            />
          ))}
        </div>

        <div>
          <p className="font-serif text-xl">
            {dragging ? (
              "Drop to upload"
            ) : (
              <>
                Drop PDFs or text files here, or <span className="text-mark underline underline-offset-4">choose files</span>
              </>
            )}
          </p>
          <p className="mt-1.5 font-mono text-xs text-ink-soft">.pdf · .txt · .md, up to 10 MB each</p>
        </div>
      </label>

      <div aria-live="polite" className="mt-3 space-y-2 text-sm empty:hidden">
        {uploading.length > 0 && (
          <p className="flex items-center gap-2 font-mono text-xs text-ochre-ink">
            <span aria-hidden="true" className="size-1.5 bg-ochre motion-safe:animate-ripple" />
            Uploading {uploading.length === 1 ? uploading[0] : plural(uploading.length, "file")}…
          </p>
        )}
        <AnimatePresence initial={false}>
          {problems.map((problem) => (
            <motion.div
              key={problem.id}
              role="alert"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex items-start gap-4 border-l-2 border-mark bg-paper-deep px-4 py-2.5"
            >
              <p className="min-w-0 flex-1">
                <span className="font-medium break-words">{problem.filename}</span>{" "}
                <span className="text-ink-soft">— {problem.message}</span>
              </p>
              <button type="button" onClick={() => onDismiss(problem.id)} className="text-ink-soft hover:text-ink">
                Dismiss
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
