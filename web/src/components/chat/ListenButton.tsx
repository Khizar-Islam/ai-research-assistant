"use client";

// Reads a finished answer aloud, without its [n] markers. Never starts on its own. One
// answer at a time: Listen on another stops this one. Not shown where the browser has no
// speech synthesis.
import { speak, stopSpeaking, useSpeakingId, useSpeechSupported } from "@/lib/hooks/useSpeech";

export function ListenButton({ id, text }: { id: string; text: string }) {
  const supported = useSpeechSupported();
  const speaking = useSpeakingId() === id;
  if (!supported) return null;

  return (
    <button
      type="button"
      onClick={() => (speaking ? stopSpeaking() : speak(id, text))}
      aria-label={speaking ? "Stop reading the answer aloud" : "Listen to the answer"}
      className="link-underline inline-flex items-center gap-1.5 font-mono text-[11px] text-ink-soft hover:text-mark"
    >
      {speaking ? (
        <>
          <span aria-hidden="true" className="size-1.5 bg-mark motion-safe:animate-ripple" />
          Stop <span aria-hidden="true">■</span>
        </>
      ) : (
        <>
          Listen <span aria-hidden="true">▸</span>
        </>
      )}
    </button>
  );
}
