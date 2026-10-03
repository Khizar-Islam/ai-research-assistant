"use client";

// "Fig. 1": the pipeline drawn in the app's own visual language. A page of text splits
// into passages, the passages become a chunk strip (the same strip the dashboard uses
// for upload progress), the question pulls out three of them, and the answer cites them.
// The drawing is purely illustrative, so hidden from screen readers; the text beside it
// says the same. It plays when it scrolls into view (on a phone it sits below the fold, and
// playing on load would finish before anyone saw it), and "Replay" plays it again.
import { motion, useInView, useReducedMotion, type Variants } from "motion/react";
import { useRef, useState, type ReactNode } from "react";

// Line widths (%) of the illustrated page, grouped into four passages.
const PASSAGES = [
  [96, 88, 92, 54],
  [94, 90, 72],
  [91, 95, 86, 40],
  [93, 80, 66],
];
const STRIP_SEGMENTS = 24;
const RETRIEVED = new Map([
  [5, 1],
  [6, 2],
  [15, 3],
]); // segment index → footnote number

// Timeline, in seconds from when the drawing starts playing.
const T = { lines: 0.2, split: 1.1, strip: 1.7, question: 3.0, retrieve: 3.4, answer: 4.0 };

const fade: Variants = {
  hidden: { opacity: 0, y: 4 },
  shown: (delay: number) => ({ opacity: 1, y: 0, transition: { delay, duration: 0.4, ease: "easeOut" } }),
};

export function PipelineFigure() {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.5 });
  const [run, setRun] = useState(0); // bumped by Replay: remounts the drawing
  // Reduced motion: show the finished figure straight away, and there's nothing to replay.
  const still = Boolean(useReducedMotion());

  return (
    <figure ref={ref} className="border border-rule bg-paper-deep/60 p-5 sm:p-6">
      <Drawing key={run} play={inView} still={still} />

      <figcaption className="mt-6 flex items-baseline justify-between gap-4 border-t border-rule pt-3 font-mono text-[11px] text-ink-soft">
        <span>Fig. 1 — How an answer is made</span>
        {!still && (
          <button
            type="button"
            onClick={() => setRun((n) => n + 1)}
            aria-label="Replay the figure's animation"
            className="link-underline shrink-0 whitespace-nowrap hover:text-ink"
          >
            Replay <span aria-hidden="true">↻</span>
          </button>
        )}
      </figcaption>
    </figure>
  );
}

// Everything starts at its initial state and waits for `play`. With `still`, initial={false}
// starts every element at its end state instead (MotionConfig alone would still play the
// fades and colors).
function Drawing({ play, still }: { play: boolean; still: boolean }) {
  let line = 0;
  const run = play || still;

  return (
    <div aria-hidden="true">
      <motion.div initial={still ? false : "hidden"} animate={run ? "shown" : "hidden"} className="space-y-6">
        <Step number="01" label="extract & chunk">
          <div>
            {PASSAGES.map((widths, p) => (
              <motion.div
                key={p}
                className={`relative border-l-2 pl-3 ${p === 0 ? "" : "mt-2.5"}`}
                // Passages start as one continuous column, then slide apart and get a margin
                // mark. The gaps are always in the layout; the slide is a transform, so the
                // figure's size never changes and nothing around it shifts.
                initial={still ? false : { y: -10 * p, borderColor: "rgba(0,0,0,0)" }}
                animate={run ? { y: 0, borderColor: "var(--color-ink-faint)" } : undefined}
                transition={{ delay: T.split + p * 0.12, duration: 0.5, ease: "easeInOut" }}
              >
                <motion.span
                  variants={fade}
                  custom={T.split + p * 0.12}
                  className="absolute top-0 -left-7 font-mono text-[10px] leading-none text-ink-faint"
                >
                  §{p + 1}
                </motion.span>
                {widths.map((width, i) => (
                  <motion.div
                    key={i}
                    className="my-1.5 h-[5px] origin-left rounded-full bg-ink/25"
                    style={{ width: `${width}%` }}
                    initial={still ? false : { scaleX: 0 }}
                    animate={run ? { scaleX: 1 } : undefined}
                    transition={{ delay: T.lines + line++ * 0.04, duration: 0.35, ease: "easeOut" }}
                  />
                ))}
              </motion.div>
            ))}
          </div>
        </Step>

        <Step number="02" label="embed">
          <div className="flex gap-[3px]">
            {Array.from({ length: STRIP_SEGMENTS }, (_, i) => (
              <motion.span
                key={i}
                className="h-3 flex-1"
                initial={still ? false : { backgroundColor: "var(--color-rule)" }}
                animate={!run ? undefined : {
                  backgroundColor: still
                    ? `var(--color-${RETRIEVED.has(i) ? "mark" : "ink"})`
                    : RETRIEVED.has(i)
                      ? ["var(--color-rule)", "var(--color-ink)", "var(--color-mark)"]
                      : ["var(--color-rule)", "var(--color-ink)", "var(--color-ink)"],
                }}
                transition={{
                  delay: T.strip + i * 0.04,
                  // Retrieved segments sit on ink until the question arrives, then turn red.
                  duration: RETRIEVED.has(i) ? T.retrieve - T.strip - i * 0.04 + 0.3 : 0.3,
                  times: RETRIEVED.has(i) ? [0, 0.08, 1] : [0, 0.6, 1],
                  ease: "linear",
                }}
              />
            ))}
          </div>
        </Step>

        <Step number="03" label="retrieve">
          <motion.p variants={fade} custom={T.question} className="font-serif text-base italic">
            “Which method did the study use?”
          </motion.p>
        </Step>

        <Step number="04" label="answer">
          <motion.p variants={fade} custom={T.answer} className="font-serif text-[15px] leading-relaxed">
            A randomised controlled trial
            <Footnote n={1} delay={T.answer + 0.5} still={still} run={run} />, run across three sites over two years
            <Footnote n={2} delay={T.answer + 0.65} still={still} run={run} />, with outcomes scored blind
            <Footnote n={3} delay={T.answer + 0.8} still={still} run={run} />.
          </motion.p>
        </Step>
      </motion.div>
    </div>
  );
}

function Step({ number, label, children }: { number: string; label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] items-start gap-4 sm:grid-cols-[7rem_1fr]">
      <p className="pt-0.5 font-mono text-[11px] leading-tight text-ink-soft">
        <span className="text-ink">{number}</span> {label}
      </p>
      <div className="pl-6">{children}</div>
    </div>
  );
}

function Footnote({ n, delay, still, run }: { n: number; delay: number; still: boolean; run: boolean }) {
  return (
    <motion.sup
      className="ml-px font-mono text-[10px] text-mark"
      initial={still ? false : { opacity: 0, y: -3 }}
      animate={run ? { opacity: 1, y: 0 } : undefined}
      transition={{ delay, duration: 0.3 }}
    >
      {n}
    </motion.sup>
  );
}
