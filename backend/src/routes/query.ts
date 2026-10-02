// POST /api/query   — ask a question; get an answer with citations; saved to history.
// GET  /api/queries — the user's past questions and answers, newest first.
//
// POST body: { "question": string (1–2,000 chars) }
// GET query: ?limit=1..50 (default 20)
import { Router } from "express";
import { prisma } from "../lib/prisma.ts";
import { userIdOf } from "../lib/requestUser.ts";
import { devUser } from "../middleware/devUser.ts";
import { AiServiceError } from "../services/aiRetry.ts";
import { answerer } from "../services/answering.ts";
import type { Citation } from "../services/citations.ts";
import { aiErrorResponse } from "./aiErrors.ts";
import { parseHistoryLimit, parseQueryRequest } from "./query.validation.ts";

export const queryRouter = Router();
queryRouter.use(devUser); // replaced by real auth in Step 8

queryRouter.post("/", async (req, res) => {
  const parsed = parseQueryRequest(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  try {
    res.json(await answerer.answerQuestion(userIdOf(req), parsed.value.question));
  } catch (error) {
    if (!(error instanceof AiServiceError)) throw error; // → errorHandler, 500

    // Nothing was saved: a failed answer isn't part of the history.
    const response = aiErrorResponse(error, "Answering");
    if (response.log) console.error(`[query] ${error.name} ${error.code}: ${error.message}`, error.cause ?? "");
    if (response.retryAfterSeconds) res.set("Retry-After", String(response.retryAfterSeconds));
    res.status(response.status).json({ error: response.message });
  }
});

export const historyRouter = Router();
historyRouter.use(devUser);

historyRouter.get("/", async (req, res) => {
  const limit = parseHistoryLimit(req.query.limit);
  if (!limit.ok) {
    res.status(400).json({ error: limit.error });
    return;
  }

  const rows = await prisma.query.findMany({
    where: { userId: userIdOf(req) },
    orderBy: { createdAt: "desc" },
    take: limit.value,
    select: { id: true, question: true, answer: true, citations: true, createdAt: true },
  });

  res.json({
    queries: rows.map((row) => {
      const citations = Array.isArray(row.citations) ? (row.citations as unknown as Citation[]) : [];
      // Not stored: "answered" means the answer cites at least one source (see citations.ts).
      return { ...row, citations, answered: citations.length > 0 };
    }),
  });
});
