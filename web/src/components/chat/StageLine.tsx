"use client";

// The two real stages the server reports while answering: Search, then Write. Used by the
// answer in progress on /chat and by the landing page's demo, so the two always match.
// Announced politely to screen readers (`announce`); the demo is decorative, so it isn't.
import { motion } from "motion/react";
import { plural } from "@/lib/format";
import { enter } from "@/lib/motion";

type Props = { writing: boolean; passages: number; announce?: boolean };

export function StageLine({ writing, passages, announce = true }: Props) {
  const label = writing ? `Writing from ${plural(passages, "passage")}` : "Searching your documents";

  return (
    <p role={announce ? "status" : undefined} className="flex items-center gap-2.5 font-mono text-[11px] text-ochre-ink">
      <span className="flex items-center gap-1.5 text-ink">
        <span aria-hidden="true" className={`size-1.5 ${writing ? "bg-ink" : "bg-ochre motion-safe:animate-ripple"}`} />
        Search
      </span>
      {/* The connector fills in, left to right, as the search hands over to writing.
          scaleX is a transform, so with reduced motion it's simply filled. */}
      <span aria-hidden="true" className="relative h-px w-4 bg-rule">
        <motion.span
          className="absolute inset-0 origin-left bg-ink"
          initial={false}
          animate={{ scaleX: writing ? 1 : 0 }}
          transition={enter()}
        />
      </span>
      <span className={`flex items-center gap-1.5 ${writing ? "text-ochre-ink" : "text-ink-faint"}`}>
        <span
          aria-hidden="true"
          className={`size-1.5 ${writing ? "bg-ochre motion-safe:animate-ripple" : "border border-ink-faint"}`}
        />
        Write
      </span>
      <span className="text-ochre-ink">· {label}…</span>
    </p>
  );
}
