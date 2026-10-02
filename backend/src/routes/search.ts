// POST /api/search — the retrieval half of RAG on its own: embeds the question and returns
// the most similar chunks of the user's documents, with scores. Saves nothing. Useful for
// checking retrieval quality without an LLM in the loop; Step 5's POST /api/query builds
// on the same retrieveChunks().
//
// Body: { "question": string (1–2,000 chars), "topK"?: 1–20 (default 5) }
import { Router } from "express";
import { userIdOf } from "../lib/requestUser.ts";
import { devUser } from "../middleware/devUser.ts";
import { AiServiceError } from "../services/aiRetry.ts";
import { retrieveChunks } from "../services/retrieval.ts";
import { aiErrorResponse } from "./aiErrors.ts";
import { parseSearchRequest } from "./search.validation.ts";

export const searchRouter = Router();

searchRouter.use(devUser); // replaced by real auth in Step 8

searchRouter.post("/", async (req, res) => {
  const parsed = parseSearchRequest(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const { question, topK } = parsed.value;

  try {
    const { results, timings } = await retrieveChunks(userIdOf(req), question, topK);
    res.json({
      question,
      results: results.map((result) => ({
        ...result,
        similarity: Math.round(result.similarity * 10_000) / 10_000,
      })),
      timings,
    });
  } catch (error) {
    if (!(error instanceof AiServiceError)) throw error; // → errorHandler, 500

    const response = aiErrorResponse(error, "Search");
    if (response.log) console.error(`[search] ${error.code}: ${error.message}`, error.cause ?? "");
    if (response.retryAfterSeconds) res.set("Retry-After", String(response.retryAfterSeconds));
    res.status(response.status).json({ error: response.message });
  }
});
