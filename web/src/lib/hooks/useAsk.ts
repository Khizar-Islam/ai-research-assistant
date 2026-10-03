"use client";

// Asks one question over POST /api/query/stream and tracks the answer as it arrives:
// real stages (searching → writing), the sources, the text piece by piece, then the
// checked final answer, which goes into the history cache like any other past question.
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, askStream, isAbort } from "../api";
import { readServerEvents } from "../sse";
import type { AnswerResult, Citation, HistoryQuery, RetrievalInfo } from "../types";
import { historyKey } from "./useQueries";

export type LivePhase = "searching" | "writing" | "error" | "stopped";

export type LiveAnswer = {
  question: string;
  phase: LivePhase;
  sources: Citation[]; // every source the model was given, by marker
  pieces: string[]; // the streamed text so far, as it arrived
  error?: { message: string; retryAfterSeconds?: number };
  startedAt: string;
};

// What the final answer adds beyond a history row, kept for answers given on this page.
export type AnswerExtras = { retrieval: RetrievalInfo; truncated: boolean };

type StreamError = { status: number; message: string; retryAfterSeconds?: number };

export function useAsk() {
  const queryClient = useQueryClient();
  const [live, setLive] = useState<LiveAnswer | null>(null);
  // Answers completed on this page: their retrieval info (history rows don't have it) and
  // which ones just arrived, so their footnotes can animate in once.
  const [extras, setExtras] = useState<ReadonlyMap<string, AnswerExtras>>(new Map());
  const [justAnswered, setJustAnswered] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  // Leaving the page stops the answer; the server then saves nothing.
  useEffect(() => () => controller.current?.abort(), []);

  const update = useCallback(
    (change: Partial<LiveAnswer>) => setLive((current) => (current ? { ...current, ...change } : current)),
    [],
  );

  const ask = useCallback(
    async (question: string) => {
      controller.current?.abort();
      const cancel = new AbortController();
      controller.current = cancel;
      setLive({ question, phase: "searching", sources: [], pieces: [], startedAt: new Date().toISOString() });

      try {
        const body = await askStream(question, cancel.signal);
        for await (const { event, data } of readServerEvents(body)) {
          const payload: unknown = JSON.parse(data);
          switch (event) {
            case "stage":
              update({ phase: (payload as { stage: "searching" | "writing" }).stage });
              break;
            case "sources":
              update({ sources: payload as Citation[] });
              break;
            case "delta":
              setLive((current) => current && { ...current, pieces: [...current.pieces, (payload as { text: string }).text] });
              break;
            case "done":
              finish(payload as AnswerResult);
              return;
            case "error": {
              // Nothing was saved; the streamed text is discarded with the error.
              const { message, retryAfterSeconds } = payload as StreamError;
              update({ phase: "error", pieces: [], error: { message, retryAfterSeconds } });
              return;
            }
          }
        }
        // The stream ended without `done` or `error`: the connection dropped.
        update({ phase: "error", pieces: [], error: { message: "The connection closed before the answer finished. Try again." } });
      } catch (error) {
        if (isAbort(error)) return; // stopped on purpose: stop() already updated the state
        const message = error instanceof ApiError ? error.message : "Something went wrong while answering. Try again.";
        update({ phase: "error", pieces: [], error: { message } });
      } finally {
        if (controller.current === cancel) controller.current = null;
      }

      function finish(result: AnswerResult) {
        // Into the history cache, exactly as GET /api/queries would return it, so the
        // transcript shows it as a normal entry from here on.
        const row: HistoryQuery = {
          id: result.id,
          question: result.question,
          answer: result.answer,
          answered: result.answered,
          citations: result.citations.map((citation) => ({ ...citation, available: true })),
          createdAt: result.createdAt,
        };
        queryClient.setQueryData<HistoryQuery[]>(historyKey, (rows = []) => [row, ...rows.filter((r) => r.id !== row.id)]);
        setExtras((map) => new Map(map).set(result.id, { retrieval: result.retrieval, truncated: result.truncated }));
        setJustAnswered(result.id);
        setLive(null);
      }
    },
    [queryClient, update],
  );

  // The Stop button: closing the stream makes the server abort generation and save
  // nothing, so the answer is simply gone.
  const stop = useCallback(() => {
    controller.current?.abort();
    update({ phase: "stopped", pieces: [] });
  }, [update]);

  const dismiss = useCallback(() => setLive(null), []);

  const busy = live?.phase === "searching" || live?.phase === "writing";
  return { live, busy, ask, stop, dismiss, extras, justAnswered };
}
