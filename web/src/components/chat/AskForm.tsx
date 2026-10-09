"use client";

// The question box, pinned to the bottom of the page. Enter asks, Shift+Enter adds a new
// line. While an answer is streaming the button becomes Stop. Where the browser can do
// speech recognition, a mic button dictates into the box; nothing is asked until Ask.
import { AnimatePresence } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { SwapItem } from "@/components/Swap";
import { stopSpeaking } from "@/lib/hooks/useSpeech";
import { useSpeechRecognition } from "@/lib/hooks/useSpeechRecognition";

const MAX_QUESTION_CHARS = 2_000; // the API's limit (query.validation.ts)
const SHOW_COUNT_FROM = 1_800;
const MAX_HEIGHT_PX = 168; // about six lines, then the box scrolls

// Grow with the text, up to MAX_HEIGHT_PX; only then show a scrollbar. scrollHeight
// leaves out the border, which the border-box height includes, so add it back.
// An empty box fits its placeholder instead: on a phone "Ask about your documents" takes
// two lines, and scrollHeight doesn't count placeholder text, so it's measured as if typed
// (put back at once, in the same frame: nothing is ever drawn, and React's value is "").
function fitToContent(element: HTMLTextAreaElement | null) {
  if (!element) return;
  element.style.height = "auto";
  const border = element.offsetHeight - element.clientHeight;
  const empty = element.value === "";
  if (empty) element.value = element.placeholder;
  const wanted = element.scrollHeight + border;
  if (empty) element.value = "";
  element.style.height = `${Math.min(wanted, MAX_HEIGHT_PX)}px`;
  element.style.overflowY = wanted > MAX_HEIGHT_PX ? "auto" : "hidden";
}

type Props = {
  busy: boolean;
  disabled: boolean; // no documents to ask about
  onAsk: (question: string) => void;
  onStop: () => void;
};

export function AskForm({ busy, disabled, onAsk, onStop }: Props) {
  const [question, setQuestion] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const askButton = useRef<HTMLButtonElement>(null);
  const stopButton = useRef<HTMLButtonElement>(null);
  const trimmed = question.trim();
  const canAsk = !busy && !disabled && trimmed.length > 0;

  const resize = () => fitToContent(box.current);

  // Dictation goes after whatever was already typed: `typed` is the box as it was when
  // listening started, and each update rewrites everything heard since.
  const typed = useRef("");
  const voice = useSpeechRecognition({
    onText: (heard) => {
      const before = typed.current.trimEnd();
      setQuestion(`${before}${before && heard ? " " : ""}${heard}`.slice(0, MAX_QUESTION_CHARS));
      requestAnimationFrame(resize);
    },
    // Done listening: back to the box, cursor at the end, ready to edit before asking.
    onEnd: () =>
      requestAnimationFrame(() => {
        const element = box.current;
        if (!element) return;
        element.focus();
        element.setSelectionRange(element.value.length, element.value.length);
      }),
  });

  function toggleListening() {
    if (voice.listening) return voice.stop();
    typed.current = question;
    stopSpeaking(); // the mic would hear an answer being read aloud
    voice.start();
  }
  // The first height, again when the placeholder changes (documents loaded or all removed),
  // whenever the width changes the wrapping (a phone turned sideways), and once the serif
  // font has loaded: it sets wider than the fallback, so the placeholder may only wrap then.
  useLayoutEffect(() => fitToContent(box.current), [disabled]);
  useEffect(() => {
    const refit = () => fitToContent(box.current);
    void document.fonts?.ready.then(refit);
    window.addEventListener("resize", refit);
    return () => window.removeEventListener("resize", refit);
  }, []);

  // Ask and Stop swap places. If the one leaving had focus, hand it on rather than let
  // it drop to the page: Ask → Stop, and Stop → the box (Ask comes back disabled while
  // the box is empty). A layout effect, so it runs before the browser notices the
  // leaving button went inert and blurs it.
  useLayoutEffect(() => {
    const active = document.activeElement;
    if (busy && active === askButton.current) stopButton.current?.focus();
    if (!busy && active === stopButton.current) box.current?.focus();
  }, [busy]);

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!canAsk) return;
    voice.cancel(); // asked mid-dictation: a late result mustn't refill the emptied box
    onAsk(trimmed);
    setQuestion("");
    requestAnimationFrame(resize);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // isComposing: Enter that confirms an IME composition (e.g. Japanese input) isn't a submit.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <form onSubmit={submit} className="sticky bottom-0 z-10 border-t border-ink bg-paper pt-4 pb-5">
      <label htmlFor="question" className="sr-only">
        Your question
      </label>
      <div className="flex items-end gap-3">
        <textarea
          id="question"
          ref={box}
          rows={1}
          value={question}
          maxLength={MAX_QUESTION_CHARS}
          disabled={disabled}
          // While dictating, the words arrive here; typing at the same time would fight them.
          readOnly={voice.listening}
          placeholder={disabled ? "Upload a document first" : "Ask about your documents"}
          onChange={(event) => {
            setQuestion(event.target.value);
            voice.clearError();
            resize();
          }}
          onKeyDown={handleKeyDown}
          className="min-h-11 min-w-0 flex-1 resize-none overflow-y-hidden border border-ink-faint bg-paper px-3.5 py-2.5 font-serif text-lg leading-snug placeholder:text-ink-faint focus:border-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark disabled:cursor-not-allowed disabled:opacity-60 read-only:border-mark"
        />
        {voice.supported && (
          <MicButton listening={voice.listening} disabled={disabled} onClick={toggleListening} />
        )}
        {/* One fixed-width slot for both, so the box doesn't shift as they swap. */}
        <div className="relative h-11 w-18 shrink-0">
          <AnimatePresence mode="popLayout" initial={false}>
            {busy ? (
              <SwapItem key="stop" className="h-full" instantWhenReduced>
                <button
                  ref={stopButton}
                  type="button"
                  onClick={onStop}
                  className="press size-full border border-ink text-sm font-medium hover:border-mark hover:text-mark"
                >
                  Stop
                </button>
              </SwapItem>
            ) : (
              <SwapItem key="ask" className="h-full" instantWhenReduced>
                <button
                  ref={askButton}
                  type="submit"
                  disabled={!canAsk}
                  className="press size-full bg-ink text-sm font-medium text-paper hover:bg-mark disabled:cursor-not-allowed disabled:bg-ink-faint"
                >
                  Ask
                </button>
              </SwapItem>
            )}
          </AnimatePresence>
        </div>
      </div>
      <p className="mt-2 flex justify-between gap-4 font-mono text-[11px] text-ink-soft">
        {voice.error ? (
          <span role="alert" className="text-mark">
            {voice.error}
          </span>
        ) : voice.listening ? (
          <span className="text-mark">Listening… speak your question, then pause or press the mic to finish.</span>
        ) : (
          <span className="hidden sm:inline">Enter to ask · Shift+Enter for a new line</span>
        )}
        {question.length >= SHOW_COUNT_FROM && (
          <span className={question.length >= MAX_QUESTION_CHARS ? "text-mark" : ""}>
            {question.length.toLocaleString("en-US")} / {MAX_QUESTION_CHARS.toLocaleString("en-US")}
          </span>
        )}
      </p>
      <p role="status" className="sr-only">
        {voice.listening ? "Listening" : ""}
      </p>
    </form>
  );
}

// Outlined, beside Ask: secondary to it. While listening it turns red with a small pulsing
// dot (steady with reduced motion), and pressing it again stops.
function MicButton({ listening, disabled, onClick }: { listening: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={listening}
      aria-label={listening ? "Stop listening" : "Speak your question"}
      title={listening ? "Stop listening" : "Speak your question"}
      className={`press relative grid size-11 shrink-0 place-items-center border disabled:cursor-not-allowed disabled:opacity-60 ${
        listening ? "border-mark text-mark" : "border-ink-faint text-ink-soft hover:border-ink hover:text-ink"
      }`}
    >
      <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="5.5" y="1.75" width="5" height="8" rx="2.5" />
        <path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2" strokeLinecap="round" />
      </svg>
      {listening && <span aria-hidden="true" className="absolute top-1.5 right-1.5 size-1.5 bg-mark motion-safe:animate-ripple" />}
    </button>
  );
}
