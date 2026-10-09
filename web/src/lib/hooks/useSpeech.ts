"use client";

// Reading answers aloud with the browser's own speechSynthesis: no API, no key. One answer
// speaks at a time across the whole page, so which one is kept in a plain module store
// (read with useSyncExternalStore) rather than in any one component.
//
// The answer is spoken one sentence at a time, each sentence its own utterance started
// when the last one ends: Chrome silently stops a single long utterance after about 15 s.
// cancel() before every utterance clears anything the browser still has queued.
import { useSyncExternalStore } from "react";
import { stripMarkers } from "../citations";

let speakingId: string | null = null;
let run = 0; // bumped by every speak/stop; an older run's callbacks see the change and quit
// Chrome can garbage-collect an utterance mid-sentence and never fire its `end`, which
// would strand the chain: holding a reference keeps it alive (written, never read).
const held: { utterance: SpeechSynthesisUtterance | null } = { utterance: null };
const listeners = new Set<() => void>();

function setSpeaking(id: string | null) {
  speakingId = id;
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const subscribeNever = () => () => {};

export const isSpeechSupported = () =>
  typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;

// Which answer is being read aloud (its id), or null.
export const useSpeakingId = () => useSyncExternalStore(subscribe, () => speakingId, () => null);
// false on the server and during hydration, so the first client render matches the HTML.
export const useSpeechSupported = () => useSyncExternalStore(subscribeNever, isSpeechSupported, () => false);

export function stopSpeaking() {
  run++;
  held.utterance = null;
  if (isSpeechSupported()) window.speechSynthesis.cancel();
  if (speakingId !== null) setSpeaking(null);
}

export function speak(id: string, answer: string) {
  stopSpeaking();
  const sentences = toSentences(stripMarkers(answer));
  if (!isSpeechSupported() || sentences.length === 0) return;

  const thisRun = run;
  setSpeaking(id);
  whenVoicesReady(() => {
    if (run !== thisRun) return; // stopped (or another answer started) while waiting
    const voice = pickVoice();

    const say = (index: number) => {
      if (run !== thisRun) return;
      if (index >= sentences.length) {
        held.utterance = null;
        setSpeaking(null);
        return;
      }
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(sentences[index]);
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
      }
      utterance.onend = () => say(index + 1);
      // "interrupted"/"canceled" are our own cancel(); anything else ends the reading.
      utterance.onerror = (event) => {
        if (run === thisRun && event.error !== "interrupted" && event.error !== "canceled") stopSpeaking();
      };
      held.utterance = utterance;
      window.speechSynthesis.speak(utterance);
    };
    say(0);
  });
}

// Chrome loads its voice list asynchronously: getVoices() is empty until `voiceschanged`
// fires. If the list is already there the event may never fire again, so check first, and
// don't wait forever on a browser that has no voices to announce.
const VOICES_WAIT_MS = 1_500;

function whenVoicesReady(then: () => void) {
  const synth = window.speechSynthesis;
  // Already loaded: carry on synchronously, still inside the click. Safari only lets a page
  // start speech from a user gesture, and an await here would leave it.
  if (synth.getVoices().length > 0) return then();

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    synth.removeEventListener("voiceschanged", finish);
    clearTimeout(timer);
    then();
  };
  synth.addEventListener("voiceschanged", finish);
  const timer = setTimeout(finish, VOICES_WAIT_MS);
}

// A voice for the page's language: the browser's default if it speaks it, else the first
// that does (a local one first: it starts faster and works offline). null leaves the
// choice to the browser.
function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  const lang = (document.documentElement.lang || navigator.language || "en").toLowerCase();
  const base = lang.split("-")[0];
  const exact = voices.filter((voice) => voice.lang.toLowerCase() === lang);
  const sameLanguage = voices.filter((voice) => voice.lang.toLowerCase().split(/[-_]/)[0] === base);
  for (const group of [exact, sameLanguage]) {
    const choice = group.find((voice) => voice.default) ?? group.find((voice) => voice.localService) ?? group[0];
    if (choice) return choice;
  }
  return null;
}

// Sentences, by the browser's own rules where it has them (so "Dr. Smith" or "3.5 m"
// don't split), else at . ! ? followed by a space. Blank lines and lists split too.
function toSentences(text: string): string[] {
  const pieces: string[] = [];
  for (const block of text.split(/\n+/)) {
    if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
      const segmenter = new Intl.Segmenter(undefined, { granularity: "sentence" });
      for (const { segment } of segmenter.segment(block)) pieces.push(segment);
    } else {
      pieces.push(...(block.match(/[^.!?]+(?:[.!?]+["'”’)\]]*|$)\s*/g) ?? [block]));
    }
  }
  return pieces.map((piece) => piece.replace(/\s+/g, " ").trim()).filter(Boolean);
}
