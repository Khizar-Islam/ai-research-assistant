"use client";

// The question box, pinned to the bottom of the page. Enter asks, Shift+Enter adds a new
// line. While an answer is streaming the button becomes Stop.
import { useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

const MAX_QUESTION_CHARS = 2_000; // the API's limit (query.validation.ts)
const SHOW_COUNT_FROM = 1_800;
const MAX_HEIGHT_PX = 168; // about six lines, then the box scrolls

// Grow with the text, up to MAX_HEIGHT_PX; only then show a scrollbar. scrollHeight
// leaves out the border, which the border-box height includes, so add it back.
function fitToContent(element: HTMLTextAreaElement | null) {
  if (!element) return;
  element.style.height = "auto";
  const border = element.offsetHeight - element.clientHeight;
  const wanted = element.scrollHeight + border;
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
  const trimmed = question.trim();
  const canAsk = !busy && !disabled && trimmed.length > 0;

  const resize = () => fitToContent(box.current);
  useLayoutEffect(() => fitToContent(box.current), []); // the empty box's first height

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!canAsk) return;
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
          placeholder={disabled ? "Upload a document first" : "Ask about your documents"}
          onChange={(event) => {
            setQuestion(event.target.value);
            resize();
          }}
          onKeyDown={handleKeyDown}
          className="min-h-11 flex-1 resize-none overflow-y-hidden border border-ink-faint bg-paper px-3.5 py-2.5 font-serif text-lg leading-snug placeholder:text-ink-faint focus:border-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark disabled:cursor-not-allowed disabled:opacity-60"
        />
        {busy ? (
          <button
            type="button"
            onClick={onStop}
            className="h-11 shrink-0 border border-ink px-4 text-sm font-medium hover:border-mark hover:text-mark"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!canAsk}
            className="h-11 shrink-0 bg-ink px-5 text-sm font-medium text-paper transition-colors hover:bg-mark disabled:cursor-not-allowed disabled:bg-ink-faint"
          >
            Ask
          </button>
        )}
      </div>
      <p className="mt-2 flex justify-between gap-4 font-mono text-[11px] text-ink-soft">
        <span className="hidden sm:inline">Enter to ask · Shift+Enter for a new line</span>
        {question.length >= SHOW_COUNT_FROM && (
          <span className={question.length >= MAX_QUESTION_CHARS ? "text-mark" : ""}>
            {question.length.toLocaleString("en-US")} / {MAX_QUESTION_CHARS.toLocaleString("en-US")}
          </span>
        )}
      </p>
    </form>
  );
}
