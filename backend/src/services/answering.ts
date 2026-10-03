// The full RAG flow for one question: retrieve → filter → generate → check citations →
// save the Query row. Each step lives in its own module; this file only wires them.
//
// Three layers keep the model from guessing:
//   1. relevance.ts — don't call the model at all when nothing relevant was retrieved
//   2. generation.ts — the prompt tells it to refuse when the sources don't answer
//   3. citations.ts — an answer with no valid citation counts as not answered
//
// Dependencies are injectable so the flow can be tested without a database or network;
// the real ones are imported lazily for the same reason.
import type { Prisma } from "../generated/prisma/client.ts";
import { throwIfCancelled } from "./aiRetry.ts";
import { type Citation, processAnswer, toCitation } from "./citations.ts";
import { type Generated, type PromptSource, REFUSAL } from "./generation.ts";
import { selectSources } from "./relevance.ts";
import type { Retrieval, RetrievedChunk } from "./retrieval.ts";

export const CANDIDATES = 8; // retrieved before filtering; the filter keeps at most 5
export const NO_DOCUMENTS_ANSWER = "You don't have any processed documents yet. Upload a document, then ask again.";

type Sources = (PromptSource & RetrievedChunk)[];

export type AnswerDeps = {
  retrieve: (userId: string, question: string, topK: number) => Promise<Retrieval>;
  generate: (question: string, sources: Sources) => Promise<Generated>;
  generateStream: (
    question: string,
    sources: Sources,
    onDelta: (text: string) => void | Promise<void>,
    signal?: AbortSignal,
  ) => Promise<Generated>;
  save: (row: { userId: string; question: string; answer: string; citations: Citation[] }) => Promise<{ id: string; createdAt: Date }>;
  log: (message: string) => void;
};

export type AnswerResult = {
  id: string; // the saved Query row
  question: string;
  answer: string;
  answered: boolean;
  citations: Citation[];
  truncated: boolean;
  model: string | null; // null when the model wasn't called
  // What retrieval found, so thresholds can be tuned from real questions.
  retrieval: { candidates: number; sourcesUsed: number; bestSimilarity: number | null; skipped: null | "no_documents" | "below_threshold" };
  timings: { embedMs: number; searchMs: number; generateMs: number; totalMs: number };
  createdAt: Date;
};

const realDeps: AnswerDeps = {
  retrieve: async (...args) => (await import("./retrieval.ts")).retrieveChunks(...args),
  generate: async (...args) => (await import("./generation.ts")).generator.generateAnswer(...args),
  generateStream: async (...args) => (await import("./generation.ts")).generator.streamAnswer(...args),
  save: async ({ userId, question, answer, citations }) => {
    const { prisma } = await import("../lib/prisma.ts");
    return prisma.query.create({
      // Citation is plain strings and numbers, so it's valid JSON.
      data: { userId, question, answer, citations: citations as unknown as Prisma.InputJsonValue },
      select: { id: true, createdAt: true },
    });
  },
  log: console.log,
};

// What a streaming client is told while the answer is being produced (see
// routes/queryStream.ts). Every stage is real work, reported as it starts.
export type StreamHooks = {
  onStage: (stage: "searching" | "writing") => void;
  // Every source the model will see, as [n] → chunk, before the first word: markers in
  // the streamed text can be linked to their passages straight away.
  onSources: (sources: Citation[]) => void;
  onDelta: (text: string) => void | Promise<void>;
  signal?: AbortSignal; // aborted when the client disconnects: stop, and save nothing
};

export type Answerer = ReturnType<typeof createAnswerer>;

export function createAnswerer(overrides: Partial<AnswerDeps> = {}) {
  const deps: AnswerDeps = { ...realDeps, ...overrides };

  // The one RAG flow behind both endpoints. `stream` switches generation to streaming and
  // reports progress; retrieval, filtering, citation checks and saving are identical.
  // Throws AiServiceError if embedding or generation fails; nothing is saved then.
  async function run(userId: string, question: string, stream?: StreamHooks): Promise<AnswerResult> {
    const startedAt = performance.now();
    stream?.onStage("searching");
    const { results, timings } = await deps.retrieve(userId, question, CANDIDATES);
    throwIfCancelled(stream?.signal);
    const selection = selectSources(results);

    let answer: string;
    let citations: Citation[] = [];
    let answered = false;
    let truncated = false;
    let model: string | null = null;
    let generateMs = 0;

    if (selection.skip) {
      answer = selection.reason === "no_documents" ? NO_DOCUMENTS_ANSWER : REFUSAL;
    } else {
      stream?.onSources(selection.sources.map((source, i) => toCitation(source, i + 1)));
      stream?.onStage("writing");
      const generateStart = performance.now();
      const generated = stream
        ? await deps.generateStream(question, selection.sources, stream.onDelta, stream.signal)
        : await deps.generate(question, selection.sources);
      generateMs = Math.round(performance.now() - generateStart);

      const processed = processAnswer(generated.text, selection.sources);
      if (processed.invalidMarkers.length > 0) {
        deps.log(`[query] model cited sources it wasn't given: ${processed.invalidMarkers.join(", ")} (removed)`);
      }
      ({ answer, citations, answered } = processed);
      truncated = generated.truncated;
      model = generated.model;
    }

    // A client that left mid-answer never saw it finish: don't put it in their history.
    throwIfCancelled(stream?.signal);
    // "Don't know" answers are saved too: they're part of the history.
    const saved = await deps.save({ userId, question, answer, citations });
    const totalMs = Math.round(performance.now() - startedAt);

    const skipped = selection.skip ? selection.reason : null;
    deps.log(
      `[query] ${saved.id}: ${answered ? "answered" : "not answered"}` +
        (skipped ? ` (skipped model: ${skipped})` : ` by ${model}`) +
        `, best ${selection.bestSimilarity?.toFixed(3) ?? "-"}, ${citations.length} citation(s), ${totalMs} ms`,
    );

    return {
      id: saved.id,
      question,
      answer,
      answered,
      citations,
      truncated,
      model,
      retrieval: {
        candidates: results.length,
        sourcesUsed: selection.sources.length,
        bestSimilarity: selection.bestSimilarity === null ? null : Math.round(selection.bestSimilarity * 10_000) / 10_000,
        skipped,
      },
      timings: { ...timings, generateMs, totalMs },
      createdAt: saved.createdAt,
    };
  }

  return {
    answerQuestion: (userId: string, question: string) => run(userId, question),
    streamQuestion: (userId: string, question: string, hooks: StreamHooks) => run(userId, question, hooks),
  };
}

// The instance the app uses. Tests build their own with fakes via createAnswerer().
export const answerer = createAnswerer();
