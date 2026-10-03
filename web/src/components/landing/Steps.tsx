"use client";

// "How it works": each step rises into place the first time it scrolls into view, in
// reading order, so the four steps read as a sequence rather than a block of text.
// Below the fold, so not waiting for JavaScript costs nothing anyone sees.
import { motion } from "motion/react";
import { enter, staggerDelay } from "@/lib/motion";

type Step = { number: string; title: string; body: string };

export function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol className="mt-8 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
      {steps.map((step, i) => (
        <motion.li
          key={step.number}
          className="border-t border-rule pt-4"
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.6 }}
          transition={enter(staggerDelay(i) * 2)}
        >
          <p className="font-mono text-xs text-mark">{step.number}</p>
          <h3 className="mt-2 font-serif text-xl">{step.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">{step.body}</p>
        </motion.li>
      ))}
    </ol>
  );
}
