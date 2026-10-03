// POST /api/query/stream — the same question → answer flow as POST /api/query, sent as
// server-sent events while it happens, so the client can show real progress and the
// answer as it is written.
//
// Body: { "question": string } (same rules as POST /api/query). Invalid input gets a
// normal 400 JSON response; once the stream starts, everything arrives as events:
//
//   event: stage    data: {"stage":"searching"} | {"stage":"writing"}
//   event: sources  data: [Citation, ...]   every source the model sees, as [n] → chunk
//   event: delta    data: {"text":"..."}    the next piece of the answer
//   event: done     data: AnswerResult      the checked, saved answer (the final text)
//   event: error    data: {"status":503,"message":"...","retryAfterSeconds"?:30}
//
// The streamed text is provisional: `done` carries the answer after citation checks
// (e.g. markers for sources the model wasn't given are removed), and the client shows
// that. After `error`, nothing was saved and the streamed text should be discarded.
//
// It's a POST (the question is in the body), so browsers read it with fetch() and a
// stream reader rather than EventSource, which only does GET.
import type { RequestHandler } from "express";
import { userIdOf } from "../lib/requestUser.ts";
import { AiServiceError } from "../services/aiRetry.ts";
import type { Answerer } from "../services/answering.ts";
import { aiErrorResponse } from "./aiErrors.ts";
import { parseQueryRequest } from "./query.validation.ts";

// A comment line every so often keeps proxies and load balancers from closing a stream
// that is quiet while generation waits out a retry.
const HEARTBEAT_MS = 15_000;

export function createQueryStreamHandler(answerer: Pick<Answerer, "streamQuestion">, heartbeatMs = HEARTBEAT_MS): RequestHandler {
  return async (req, res) => {
    const parsed = parseQueryRequest(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    res.status(200).set({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform", // no-transform: proxies mustn't compress/buffer it
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // nginx-style proxies: pass each event straight through
    });
    res.flushHeaders();

    // The client going away (tab closed, navigated off) aborts the work: generation stops
    // and the half-finished answer isn't saved. `res` "close" also fires after a normal
    // end, hence the writableEnded check.
    const cancel = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) cancel.abort();
    });

    // JSON.stringify never emits a raw newline, so each event's data is one line.
    const send = (event: string, data: unknown) => {
      if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(": keep-alive\n\n");
    }, heartbeatMs);

    try {
      const result = await answerer.streamQuestion(userIdOf(req), parsed.value.question, {
        onStage: (stage) => send("stage", { stage }),
        onSources: (sources) => send("sources", sources),
        onDelta: (text) => send("delta", { text }),
        signal: cancel.signal,
      });
      send("done", result);
    } catch (error) {
      if (cancel.signal.aborted) return; // nobody is listening any more

      // Headers are already sent, so the error middleware can't answer: report in-stream.
      if (error instanceof AiServiceError) {
        const response = aiErrorResponse(error, "Answering");
        if (response.log) console.error(`[query] ${error.name} ${error.code}: ${error.message}`, error.cause ?? "");
        send("error", { status: response.status, message: response.message, retryAfterSeconds: response.retryAfterSeconds });
      } else {
        console.error("[query] stream failed", error);
        send("error", { status: 500, message: "Internal server error" });
      }
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  };
}
