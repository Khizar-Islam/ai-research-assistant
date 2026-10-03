"use client";

// The chunk strip: a document drawn as a bar of its passages. The app's signature
// visual, used three ways:
//   - "progress": while embedding. Embedded cells are ink; the batch Gemini is working on
//     right now ripples in ochre (so the strip never looks frozen between the ~1-minute
//     progress updates); the rest wait in rule grey.
//   - "static": a finished document's passages.
//   - with `highlight` / `onCellClick`: the chunk panel's minimap.
//   - `muted` with `highlight`: an answer's footnote, where the point is *where* the cited
//     passage sits, so the other passages recede and the red one stands out.
// Big documents would make 1-chunk cells sub-pixel, so above `maxCells` each cell stands
// for a few consecutive chunks.
import { EMBED_BATCH_SIZE } from "@/lib/pipeline";

type Props = {
  total: number;
  embedded?: number; // progress mode only; omit for a finished document
  highlight?: ReadonlySet<number>; // chunk indices to mark in red
  onCellClick?: (firstChunkIndex: number) => void;
  maxCells?: number;
  muted?: boolean;
  className?: string;
};

type CellState = "done" | "working" | "waiting";

export function ChunkStrip({ total, embedded, highlight, onCellClick, maxCells = 96, muted = false, className = "h-2" }: Props) {
  const cells = Math.max(1, Math.min(total, maxCells));
  const perCell = total / cells;
  const inProgress = embedded !== undefined;
  const workingUntil = inProgress ? Math.min(embedded + EMBED_BATCH_SIZE, total) : 0;

  return (
    <div className={`flex gap-px ${className}`}>
      {Array.from({ length: cells }, (_, i) => {
        const first = Math.floor(i * perCell);
        const end = Math.max(first + 1, Math.floor((i + 1) * perCell)); // exclusive
        const state: CellState = !inProgress || end <= embedded ? "done" : first < workingUntil ? "working" : "waiting";
        const marked = highlight ? rangeHits(highlight, first, end) : false;
        const done = muted ? "bg-ink/20" : "bg-ink";
        const color = marked ? "bg-mark" : state === "done" ? done : state === "working" ? "bg-ochre" : "bg-rule";
        const style = {
          // When a batch lands its cells turn ink left to right, a short sweep instead of a jump.
          transitionDelay: inProgress ? `${Math.min(i * 10, 600)}ms` : undefined,
          // The working batch ripples: same animation, offset per cell.
          animationDelay: state === "working" ? `${(i % 24) * 70}ms` : undefined,
        };
        const cellClass = `flex-1 transition-colors duration-500 ${color} ${state === "working" ? "motion-safe:animate-ripple" : ""}`;

        return onCellClick ? (
          // Mouse shortcut only (tabIndex -1): 64 extra Tab stops would bury the panel's
          // real controls. Keyboard users scroll the passage list itself.
          <button
            key={i}
            type="button"
            tabIndex={-1}
            onClick={() => onCellClick(first)}
            aria-label={end - first > 1 ? `Passages ${first + 1}–${end}` : `Passage ${first + 1}`}
            className={`${cellClass} cursor-pointer hover:opacity-70`}
            style={style}
          />
        ) : (
          <span key={i} className={cellClass} style={style} />
        );
      })}
    </div>
  );
}

function rangeHits(set: ReadonlySet<number>, first: number, end: number): boolean {
  for (let index = first; index < end; index++) if (set.has(index)) return true;
  return false;
}
