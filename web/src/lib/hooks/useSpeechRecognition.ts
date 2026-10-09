"use client";

// Dictating a question with the browser's Web Speech API (SpeechRecognition, prefixed as
// webkitSpeechRecognition in Chrome, Edge and Safari; Firefox doesn't have it). No API and
// no key, but not on-device either: Chrome sends the audio to Google's speech service, so
// it needs an internet connection, and Safari uses Apple's. Firefox: unsupported, so the
// mic button isn't shown.
//
// One phrase per listen: recognition stops by itself when the speaker pauses, or when
// stop() is called. `onText` gets everything heard so far (settled words plus the current
// guess) each time it changes, so the text box can show it live.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

const subscribeNever = () => () => {};
const recognizer = () =>
  typeof window === "undefined" ? undefined : (window.SpeechRecognition ?? window.webkitSpeechRecognition);

// Plain words for what went wrong. "aborted" is our own cancel(), so it says nothing.
const MESSAGES: Partial<Record<SpeechRecognitionErrorCode, string>> = {
  "not-allowed": "Microphone access is blocked. Allow it for this site in your browser’s settings, then try again.",
  "service-not-allowed": "Voice input is turned off in this browser. Type your question instead.",
  "no-speech": "Didn’t hear anything. Try again, a little closer to the microphone.",
  "audio-capture": "No microphone found. Plug one in or type your question.",
  network: "Voice input needs an internet connection: your browser sends the audio to its speech service. Check your connection and try again.",
  "language-not-supported": "Voice input doesn’t support your browser’s language. Type your question instead.",
};
const FALLBACK = "Voice input stopped unexpectedly. Try again, or type your question.";

type Options = {
  onText: (heard: string) => void;
  onEnd?: () => void; // listening finished on its own or by stop(); not after cancel()
};

export function useSpeechRecognition({ onText, onEnd }: Options) {
  // false on the server and during hydration, so the first client render matches the HTML.
  const supported = useSyncExternalStore(subscribeNever, () => Boolean(recognizer()), () => false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognition = useRef<SpeechRecognition | null>(null);

  // The latest callbacks, without restarting anything when they change.
  const callbacks = useRef({ onText, onEnd });
  useEffect(() => {
    callbacks.current = { onText, onEnd };
  });

  const start = useCallback(() => {
    const Recognition = recognizer();
    if (!Recognition || recognition.current) return;

    const session = new Recognition();
    session.lang = navigator.language || "en-US";
    session.interimResults = true;
    session.continuous = false;
    session.maxAlternatives = 1;

    session.onresult = (event) => {
      let heard = "";
      for (let i = 0; i < event.results.length; i++) heard += event.results[i][0].transcript;
      callbacks.current.onText(heard.replace(/\s+/g, " ").trim());
    };
    session.onerror = (event) => {
      if (event.error !== "aborted") setError(MESSAGES[event.error] ?? FALLBACK);
    };
    session.onend = () => {
      recognition.current = null;
      setListening(false);
      callbacks.current.onEnd?.();
    };

    recognition.current = session;
    setError(null);
    setListening(true);
    try {
      session.start(); // asks for the microphone the first time
    } catch {
      recognition.current = null;
      setListening(false);
      setError(FALLBACK);
    }
  }, []);

  // Stop listening and keep what was heard (onEnd follows).
  const stop = useCallback(() => recognition.current?.stop(), []);

  // Stop listening and drop anything still on its way: no more onText or onEnd. For when the
  // question has just been asked and the box emptied.
  const cancel = useCallback(() => {
    const session = recognition.current;
    if (!session) return;
    session.onresult = session.onerror = session.onend = null;
    recognition.current = null;
    session.abort();
    setListening(false);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  // Leaving the page turns the microphone off.
  useEffect(
    () => () => {
      const session = recognition.current;
      if (!session) return;
      session.onresult = session.onerror = session.onend = null;
      session.abort();
    },
    [],
  );

  return { supported, listening, error, start, stop, cancel, clearError };
}
