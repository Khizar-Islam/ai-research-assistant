"use client";

// "Fig. 2": what happens when you ask, played as a loop with the real pieces of /chat. The
// stage line is the one the live answer shows, and the "not found" note is the one the
// transcript shows. Two cases take turns:
//   1. answered: the question is typed, Search runs, three passages come back, Write
//      streams an answer that cites two of them ([1] [2]); the third was given to the
//      model but not cited, so it drops back, as it would drop out of the footnotes.
//   2. not found: Search runs, nothing is close enough (best match below the 0.55 cut-off),
//      so the server answers "couldn't find it" without ever calling the model: no Write.
//
// Everything on screen is a function of (case, time), so pausing is just not advancing
// the clock. It runs only while on screen and the tab is visible, pauses while a mouse
// points at it (to try the markers), and has Pause and Replay. With reduced motion it's
// one still frame: case 1, finished.
import { useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent } from "react";
import { NotAnswered } from "@/components/chat/Entry";
import { StageLine } from "@/components/chat/StageLine";
import { ChunkStrip } from "@/components/documents/ChunkStrip";

// ── The sample: one short document, two questions ─────────────────────────────────────
const FILENAME = "lighthouse-optics.pdf";
const PASSAGES = [
  "Before the 1820s, lighthouses burned open fires, candles or oil lamps backed by metal reflectors, and much of their light was lost.",
  "The French physicist Augustin-Jean Fresnel presented his design for a lighthouse lens in 1822.",
  "Instead of one thick curved lens, it used concentric rings of glass prisms, making it far thinner and lighter than a solid lens of the same size.",
  "The prisms bent light that would otherwise escape into a single horizontal beam, visible much farther out to sea.",
  "The first was installed in the Cordouan Lighthouse, at the mouth of the Gironde estuary, in 1823.",
  "Lenses came in sizes called orders, from the large first order for coastal lights to the small sixth order for harbours.",
];

// Retrieved for case 1, best first: marker → passage index, similarity. Illustrative,
// but in the real range (answerable questions scored 0.66–0.77), all above the 0.55
// cut-off and within 0.10 of the best, so the real relevance filter would keep all three.
const SOURCES = [
  { marker: 1, passage: 1, similarity: 0.76 },
  { marker: 2, passage: 3, similarity: 0.71 },
  { marker: 3, passage: 2, similarity: 0.67 },
];
// Strings are text; numbers are citation markers.
const ANSWER: (string | number)[] = [
  "It was designed by the French physicist Augustin-Jean Fresnel, who presented it in 1822",
  1,
  ". Its prisms bent light that would otherwise escape into a single horizontal beam, visible much farther out to sea",
  2,
  ".",
];
const CITED = new Set(ANSWER.filter((piece): piece is number => typeof piece === "number"));

const CASES = {
  answered: { question: "Who designed the Fresnel lens, and why was it better?" },
  notFound: { question: "How much did the first Fresnel lens cost to build?", bestSimilarity: 0.52 },
} as const;
type Case = keyof typeof CASES;

// The answer as it streams: words (with their trailing space) and markers, one per tick.
type Token = { text: string } | { marker: number };
const TOKENS: Token[] = ANSWER.flatMap((piece): Token[] =>
  typeof piece === "number" ? [{ marker: piece }] : (piece.match(/\S+\s*/g) ?? []).map((text) => ({ text })),
);

// ── Timeline (ms from the start of a case) ───────────────────────────────────────────
const TYPE_START = 500;
const CHAR_MS = 38;
const WORD_MS = 75;
const HOLD_MS = 3_800; // the finished frame, long enough to read
const FADE_MS = 400;

function timeline(which: Case) {
  const search = TYPE_START + CASES[which].question.length * CHAR_MS + 350;
  if (which === "notFound") {
    const done = search + 1_400;
    return { search, done, fade: done + HOLD_MS, end: done + HOLD_MS + FADE_MS, lit: [], write: Infinity, words: Infinity };
  }
  const lit = SOURCES.map((_, i) => search + 1_000 + i * 220);
  const write = lit.at(-1)! + 500;
  const words = write + 300;
  const done = words + TOKENS.length * WORD_MS + 200;
  return { search, done, fade: done + HOLD_MS, end: done + HOLD_MS + FADE_MS, lit, write, words };
}
const TIMES = { answered: timeline("answered"), notFound: timeline("notFound") };
// When each marker lands in the stream (its passage flashes then).
const MARKER_AT = new Map(
  TOKENS.flatMap((token, i) => ("marker" in token ? [[token.marker, TIMES.answered.words + i * WORD_MS] as const] : [])),
);
const FLASH_MS = 700;
const TICK_MS = 50;
const STILL = { which: "answered" as Case, t: TIMES.answered.done }; // the reduced-motion frame

// ── Clock ─────────────────────────────────────────────────────────────────────────────
const subscribeVisibility = (callback: () => void) => {
  document.addEventListener("visibilitychange", callback);
  return () => document.removeEventListener("visibilitychange", callback);
};
const useTabVisible = () =>
  useSyncExternalStore(subscribeVisibility, () => document.visibilityState === "visible", () => true);

export function AskDemo() {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { amount: 0.4 });
  const tabVisible = useTabVisible();
  const still = Boolean(useReducedMotion());
  const [clock, setClock] = useState<{ which: Case; t: number }>({ which: "answered", t: 0 });
  const [paused, setPaused] = useState(false); // the Pause button
  const [pointing, setPointing] = useState(false); // a mouse is over the drawing
  const [active, setActive] = useState<number | null>(null); // the marker pointed at

  const playing = !still && inView && tabVisible && !paused && !pointing;
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const step = Math.min(now - last, 4 * TICK_MS); // a throttled timer doesn't skip ahead
      last = now;
      setClock(({ which, t }) =>
        t + step >= TIMES[which].end ? { which: which === "answered" ? "notFound" : "answered", t: 0 } : { which, t: t + step },
      );
    }, TICK_MS);
    return () => clearInterval(id);
  }, [playing]);

  // Pause on hover only with a precise pointer (a mouse): on a touch screen there's no
  // "leave", so a tap would leave it paused for good.
  const hover = (on: boolean) => (event: PointerEvent) => {
    if (event.pointerType === "touch" || !window.matchMedia("(pointer: fine)").matches) return;
    setPointing(on);
    if (!on) setActive(null);
  };

  const { which, t } = still ? STILL : clock;

  return (
    <figure ref={ref} className="mt-14 border border-rule bg-paper-deep/60 p-5 sm:p-6">
      <div aria-hidden="true" onPointerEnter={hover(true)} onPointerLeave={hover(false)}>
        <Frame which={which} t={t} still={still} active={active} setActive={setActive} />
      </div>

      <figcaption className="mt-6 border-t border-rule pt-3 font-mono text-[11px] text-ink-soft">
        <div className="flex items-baseline justify-between gap-4">
          <span>Fig. 2 — Asking a question</span>
          {!still && (
            <span className="flex shrink-0 gap-4 whitespace-nowrap">
              <button
                type="button"
                onClick={() => setPaused((p) => !p)}
                aria-label={paused ? "Play the demo" : "Pause the demo"}
                className="link-underline hover:text-ink"
              >
                {paused ? "Play" : "Pause"} <span aria-hidden="true">{paused ? "▸" : "❙❙"}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setClock({ which: "answered", t: 0 });
                  setPaused(false);
                }}
                aria-label="Replay the demo from the start"
                className="link-underline hover:text-ink"
              >
                Replay <span aria-hidden="true">↻</span>
              </button>
            </span>
          )}
        </div>
        <p className="mt-1 text-ink-faint">Sample document, illustrative scores.</p>
        <p className="sr-only">
          {still ? "A still picture" : "An animation"} of asking a question. In the first case, “{CASES.answered.question}”,
          a search of the sample document {FILENAME} finds three passages and the answer cites two of them. In the second,
          “{CASES.notFound.question}”, nothing in the document is close enough, so the answer says it couldn’t find it.
        </p>
      </figcaption>
    </figure>
  );
}

// ── One frame ─────────────────────────────────────────────────────────────────────────
type FrameProps = { which: Case; t: number; still: boolean; active: number | null; setActive: (marker: number | null) => void };

function Frame({ which, t, still, active, setActive }: FrameProps) {
  const times = TIMES[which];
  const question = CASES[which].question;
  const typed = Math.max(0, Math.min(question.length, Math.floor((t - TYPE_START) / CHAR_MS)));
  const typing = t < times.search;
  const done = t >= times.done;
  const searching = t >= times.search && !done; // the live stage line goes once the answer is in
  const shownTokens = Math.max(0, Math.floor((t - times.words) / WORD_MS) + 1);
  const fade = still ? "" : "fade-in";

  // Each passage: retrieved yet? which marker? cited, or given and dropped?
  const passageState = (index: number) => {
    const sourceIndex = SOURCES.findIndex((source) => source.passage === index);
    const source = SOURCES[sourceIndex];
    if (which !== "answered" || !source || t < times.lit[sourceIndex]) return { source: undefined, dropped: false, lit: false, highlighted: false };
    const dropped = done && !CITED.has(source.marker);
    const markerAt = MARKER_AT.get(source.marker);
    const flashing = !still && markerAt !== undefined && t >= markerAt && t < markerAt + FLASH_MS;
    return { source, dropped, lit: true, highlighted: flashing || active === source.marker };
  };
  const highlight = new Set(PASSAGES.flatMap((_, i) => (passageState(i).lit && !passageState(i).dropped ? [i] : [])));

  return (
    <div
      className="grid gap-x-8 gap-y-5 transition-opacity duration-300 [grid-template-areas:'question'_'document'_'answer'] lg:grid-cols-[1.1fr_1fr] lg:grid-rows-[auto_1fr] lg:[grid-template-areas:'question_document'_'answer_document']"
      style={{ opacity: t >= times.fade ? 0 : 1 }}
    >
      <div className="[grid-area:question]">
        <p className="font-mono text-[11px] text-ink-soft">
          {which === "answered" ? "Case 1 — the answer is in the document" : "Case 2 — it isn’t"}
        </p>
        <p className="mt-2 min-h-[3.5rem] font-serif text-xl leading-snug italic">
          {question.slice(0, typed)}
          {typing && t >= TYPE_START - 300 && <Caret />}
        </p>
        <div className="mt-3 h-4">{searching && <StageLine writing={t >= times.write} passages={SOURCES.length} announce={false} />}</div>
      </div>

      <div className="min-h-[12rem] [grid-area:answer] lg:min-h-0">
        {which === "answered" && t >= times.words && (
          <p className="font-serif text-lg leading-relaxed">
            {TOKENS.slice(0, shownTokens).map((token, i) =>
              "marker" in token ? (
                <sup
                  key={i}
                  onPointerEnter={() => setActive(token.marker)}
                  onPointerLeave={() => setActive(null)}
                  className={`${fade} ml-px cursor-default px-0.5 font-mono text-[11px] leading-none text-mark transition-colors ${
                    active === token.marker ? "bg-mark/15" : ""
                  }`}
                >
                  {token.marker}
                </sup>
              ) : (
                <span key={i} className={fade}>
                  {token.text}
                </span>
              ),
            )}
            {!done && <Caret />}
          </p>
        )}
        {which === "notFound" && done && (
          <div className={fade}>
            <NotAnswered
              // The backend's REFUSAL, word for word (generation.ts).
              text="I couldn't find the answer to that in your documents."
              retrieval={{
                candidates: 6,
                sourcesUsed: 0,
                bestSimilarity: CASES.notFound.bestSimilarity,
                skipped: "below_threshold",
              }}
            />
          </div>
        )}
      </div>

      <div className="border border-rule bg-paper [grid-area:document]">
        <div className="border-b border-rule px-3 py-2">
          {/* Each half stays whole; on a narrow screen the count wraps under the name. */}
          <p className="flex flex-wrap justify-between gap-x-3 font-mono text-[11px] text-ink-soft">
            <span className="whitespace-nowrap text-ink">{FILENAME}</span>
            <span className="whitespace-nowrap">{PASSAGES.length} passages</span>
          </p>
          <ChunkStrip total={PASSAGES.length} highlight={highlight} muted className="mt-2 h-1.5" />
        </div>
        <ol className="py-1">
          {PASSAGES.map((text, index) => {
            const { source, dropped, lit, highlighted } = passageState(index);
            return (
              <li
                key={index}
                // Phones: the marker and score stack under the § mark, so the text keeps the
                // width. From sm they sit top right, in space the text leaves free.
                className={`relative grid grid-cols-[2.5rem_minmax(0,1fr)] border-l-2 py-2 pr-3 pl-2.5 text-[13px] sm:grid-cols-[1.75rem_minmax(0,1fr)] sm:pr-16 leading-snug transition-colors duration-300 ${
                  highlighted
                    ? "border-l-mark bg-mark/15"
                    : lit && !dropped
                      ? "border-l-mark bg-paper-deep"
                      : dropped
                        ? "border-l-rule"
                        : "border-l-transparent"
                }`}
              >
                <span className="font-mono text-[10px] leading-[1.35rem] text-ink-faint">
                  §{index + 1}
                  {source && (
                    <span className={`${fade} block leading-tight sm:hidden ${dropped ? "" : "text-ink-soft"}`}>
                      <span className={`block ${dropped ? "" : "text-mark"}`}>[{source.marker}]</span>
                      {source.similarity.toFixed(2)}
                      {dropped && <span className="block">not cited</span>}
                    </span>
                  )}
                </span>
                <span className={lit && !dropped ? "text-ink" : "text-ink-soft"}>{text}</span>
                {source && (
                  <span
                    className={`${fade} absolute top-2 right-3 hidden text-right font-mono text-[10px] leading-tight sm:block ${
                      dropped ? "text-ink-faint" : "text-ink-soft"
                    }`}
                  >
                    <span className={dropped ? "" : "text-mark"}>[{source.marker}]</span> {source.similarity.toFixed(2)}
                    {dropped && <span className="block">not cited</span>}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

function Caret() {
  return <span className="ml-0.5 inline-block h-[1.1em] w-[2px] translate-y-[3px] bg-ink motion-safe:animate-ripple" />;
}
