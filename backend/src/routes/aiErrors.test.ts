import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type AiErrorCode, AiServiceError } from "../services/aiRetry.ts";
import { EmbeddingError } from "../services/embeddings.ts";
import { GenerationError } from "../services/generation.ts";
import { aiErrorResponse } from "./aiErrors.ts";

const ALL_CODES: AiErrorCode[] = ["rate_limited", "quota_exhausted", "unavailable", "rejected", "bad_response", "blocked", "too_large"];
const responseFor = (code: AiErrorCode, action: "Search" | "Answering" = "Search", message = "internal message") =>
  aiErrorResponse(new AiServiceError(code, message), action);

describe("aiErrorResponse", () => {
  it("rate limit → 503 with Retry-After, not logged (expected under load)", () => {
    assert.deepEqual(responseFor("rate_limited"), {
      status: 503,
      message: "Search is busy right now. Try again in a moment.",
      retryAfterSeconds: 30,
      log: false,
    });
    assert.equal(responseFor("rate_limited", "Answering").message, "Answering is busy right now. Try again in a moment.");
  });

  it("quota exhausted and unavailable → 503, logged, no Retry-After", () => {
    for (const code of ["quota_exhausted", "unavailable"] as const) {
      const response = responseFor(code);
      assert.equal(response.status, 503);
      assert.equal(response.retryAfterSeconds, undefined);
      assert.equal(response.log, true);
    }
    assert.equal(responseFor("quota_exhausted", "Answering").message, "The daily answering quota has been reached. Try again tomorrow.");
  });

  it("rejected / bad response → 502, logged", () => {
    for (const code of ["rejected", "bad_response", "too_large"] as const) {
      assert.equal(responseFor(code).status, 502);
      assert.equal(responseFor(code).log, true);
    }
  });

  it("safety block → 422 with the user-facing safety message", () => {
    const blocked = new GenerationError("blocked", "The answer was blocked by the model's safety filters.");
    assert.deepEqual(aiErrorResponse(blocked, "Answering"), {
      status: 422,
      message: "The answer was blocked by the model's safety filters.",
      log: true,
    });
  });

  it("never passes an internal error message to the client (except the user-facing safety message)", () => {
    for (const code of ALL_CODES.filter((c) => c !== "blocked")) {
      for (const action of ["Search", "Answering"] as const) {
        assert.doesNotMatch(responseFor(code, action).message, /internal message/, `${code}/${action}`);
      }
    }
  });

  it("works for both embedding and generation errors", () => {
    assert.equal(aiErrorResponse(new EmbeddingError("unavailable", "x"), "Search").status, 503);
    assert.equal(aiErrorResponse(new GenerationError("unavailable", "x"), "Answering").status, 503);
  });
});
