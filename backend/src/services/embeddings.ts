// Turns text into vectors with Gemini, for both sides of retrieval: document chunks at
// upload time, and questions at query time (Step 4). Both go through this one module,
// because the two sides only match if they use the same model, size and prompt formats.
//
// Facts this is built on (checked against the live API, Step 3 stage 1):
//   - gemini-embedding-2 has no `taskType` setting; the task is written into the text
//     itself, with a different format for documents and for questions.
//   - One request takes at most 100 inputs, and each needs wrapping as its own Content
//     object; plain strings in an array get merged into ONE vector.
//   - The free tier allows 100 inputs per minute (every item in a batch counts), and a
//     429 response says how long to wait (`retryDelay`).

export const EMBEDDING_MODEL = "gemini-embedding-2";
export const EMBEDDING_DIMENSIONS = 768; // must match the vector(768) column
export const MAX_ITEMS_PER_REQUEST = 100; // the API's hard limit
// Uploads send 90 per request, not 100: the free tier allows 100 inputs per minute in
// total, so this leaves ~10 a minute for questions while a big document is processing.
export const DOCUMENT_BATCH_SIZE = 90;
export const MAX_CHUNKS_PER_DOCUMENT = 1_000; // ~11 minutes of free-tier quota

// What went wrong, for code to act on (e.g. choosing an HTTP status); `message` is the
// same thing in words a user can read.
export type EmbeddingErrorCode =
  | "too_large" // document over MAX_CHUNKS_PER_DOCUMENT
  | "rate_limited" // per-minute limit; worth retrying shortly
  | "quota_exhausted" // daily limit; not worth retrying today
  | "unavailable" // service errors/timeouts persisted through retries
  | "rejected" // the API refused the request (bad key, bad input)
  | "bad_response"; // the API answered with something that isn't valid vectors

// A failure explained in words a user can read (stored in Document.errorMessage).
// `cause` keeps the original error for the server log.
export class EmbeddingError extends Error {
  override name = "EmbeddingError";
  readonly code: EmbeddingErrorCode;

  constructor(code: EmbeddingErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}

// ── Prompt formats (from the gemini-embedding-2 docs) ────────────────────────────────

export function formatDocumentChunk(title: string, text: string): string {
  return `title: ${title || "none"} | text: ${text}`;
}

export function formatQuery(question: string): string {
  return `task: search result | query: ${question}`;
}

// "Khizar_Islam_Rathore_CV2.pdf" → "Khizar Islam Rathore CV2". The title gives every
// chunk context about what document it came from. "|" would confuse the format above.
export function titleFromFilename(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, "")
    .replace(/[_|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Calling the API ──────────────────────────────────────────────────────────────────

// Embeds already-formatted texts, one vector per text, in order. Injected so tests can
// run without the network; the default calls Gemini.
export type EmbedBatch = (texts: string[]) => Promise<number[][]>;

const REQUEST_TIMEOUT_MS = 30_000;

const geminiEmbedBatch: EmbedBatch = async (texts) => {
  // Imported lazily so loading this module (e.g. in unit tests) doesn't require a key.
  const { gemini } = await import("../lib/gemini.ts");
  const response = await gemini.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: texts.map((text) => ({ parts: [{ text }] })),
    config: {
      outputDimensionality: EMBEDDING_DIMENSIONS,
      // The SDK has no default timeout; a hung request would stall the document forever.
      abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  });
  return (response.embeddings ?? []).map((embedding) => embedding.values ?? []);
};

export type RetryPolicy = {
  maxAttempts: number; // per request, including the first
  maxWaitMs: number; // longest single wait this caller accepts before giving up
  totalBudgetMs: number; // across all requests of one call
};

// A 429 asking us to wait longer than this isn't the per-minute limit (those ask for
// seconds); it's the daily quota, so waiting it out isn't an option.
const DAILY_QUOTA_SIGNAL_MS = 90_000;

// Uploads run in the background, so they can afford to wait out the per-minute quota.
const DOCUMENT_POLICY: RetryPolicy = { maxAttempts: 6, maxWaitMs: DAILY_QUOTA_SIGNAL_MS, totalBudgetMs: 20 * 60_000 };
// A question has someone waiting on the answer: fail fast instead of stalling the chat.
const QUERY_POLICY: RetryPolicy = { maxAttempts: 3, maxWaitMs: 5_000, totalBudgetMs: 15_000 };

export type EmbedderDeps = {
  embedBatch?: EmbedBatch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (message: string) => void;
};

export function createEmbedder(deps: EmbedderDeps = {}) {
  const embedBatch = deps.embedBatch ?? geminiEmbedBatch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? Date.now;
  const log = deps.log ?? console.log;

  async function embedWithRetry(texts: string[], policy: RetryPolicy, deadline: number): Promise<number[][]> {
    for (let attempt = 1; ; attempt++) {
      try {
        const vectors = await embedBatch(texts);
        checkVectors(vectors, texts.length);
        return vectors;
      } catch (error) {
        if (error instanceof EmbeddingError) throw error;

        const failure = classify(error);
        if (failure.kind === "fatal") {
          throw new EmbeddingError("rejected", "The embedding service rejected the request", { cause: error });
        }

        // Wait as long as the server asks. Otherwise: for a rate limit, long enough for a
        // per-minute window to move on; for anything else, backoff 1s, 2s, 4s, ...
        const waitMs =
          failure.retryAfterMs ??
          (failure.kind === "rate-limit" ? 20_000 : Math.min(1000 * 2 ** (attempt - 1), 30_000));

        // Per-minute limits ask for seconds; a much longer wait means the daily quota is gone.
        if (failure.kind === "rate-limit" && waitMs > DAILY_QUOTA_SIGNAL_MS) {
          throw new EmbeddingError("quota_exhausted", "Embedding quota exceeded. Try again later.", { cause: error });
        }
        if (attempt >= policy.maxAttempts || waitMs > policy.maxWaitMs || now() + waitMs > deadline) {
          throw failure.kind === "rate-limit"
            ? new EmbeddingError("rate_limited", "Embedding service is busy (rate limit). Try again in a few minutes.", { cause: error })
            : new EmbeddingError("unavailable", "Embedding service is unavailable. Try again later.", { cause: error });
        }
        // Without this, a document waiting out a rate limit looks stuck on "processing".
        log(`[embeddings] ${describeFailure(failure, error)}, waiting ${seconds(waitMs)} (attempt ${attempt + 1}/${policy.maxAttempts})`);
        await sleep(waitMs);
      }
    }
  }

  return {
    // Returns one vector per chunk, in the same order.
    async embedDocumentChunks(chunks: string[], title: string): Promise<number[][]> {
      if (chunks.length > MAX_CHUNKS_PER_DOCUMENT) {
        throw new EmbeddingError(
          "too_large",
          `Document is too large to index (${chunks.length.toLocaleString("en-US")} chunks; ` +
            `the limit is ${MAX_CHUNKS_PER_DOCUMENT.toLocaleString("en-US")})`,
        );
      }
      const deadline = now() + DOCUMENT_POLICY.totalBudgetMs;
      const texts = chunks.map((chunk) => formatDocumentChunk(title, chunk));
      const vectors: number[][] = [];
      // Sequential on purpose: parallel requests would only hit the per-minute quota sooner.
      for (const batch of inBatches(texts, DOCUMENT_BATCH_SIZE)) {
        vectors.push(...(await embedWithRetry(batch, DOCUMENT_POLICY, deadline)));
      }
      return vectors;
    },

    async embedQuery(question: string): Promise<number[]> {
      const deadline = now() + QUERY_POLICY.totalBudgetMs;
      const [vector] = await embedWithRetry([formatQuery(question)], QUERY_POLICY, deadline);
      return vector!;
    },
  };
}

// The instance the app uses. Tests build their own with fakes via createEmbedder().
export const embedder = createEmbedder();

// ── Helpers ──────────────────────────────────────────────────────────────────────────

export function inBatches<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

// Never store a malformed vector: it would silently poison every search it takes part in.
function checkVectors(vectors: number[][], expectedCount: number): void {
  const ok =
    vectors.length === expectedCount &&
    vectors.every((v) => v.length === EMBEDDING_DIMENSIONS && v.every(Number.isFinite));
  if (!ok) {
    throw new EmbeddingError("bad_response", "The embedding service returned an unexpected response", {
      cause: new Error(
        `expected ${expectedCount} vectors of ${EMBEDDING_DIMENSIONS}, got ${vectors.length}: ` +
          `[${vectors.slice(0, 3).map((v) => v.length).join(", ")}${vectors.length > 3 ? ", ..." : ""}]`,
      ),
    });
  }
}

type Failure = { kind: "rate-limit" | "transient" | "fatal"; retryAfterMs?: number };

// "rate limited" / "service error (503)" / "request failed (TypeError: fetch failed)"
function describeFailure(failure: Failure, error: unknown): string {
  if (failure.kind === "rate-limit") return "rate limited";
  const status = (error as { status?: unknown })?.status;
  if (typeof status === "number") return `service error (${status})`;
  const name = error instanceof Error ? error.name : "Error";
  const message = error instanceof Error ? error.message : String(error);
  return `request failed (${name}: ${message.slice(0, 80)})`;
}

// 38000 → "38s", 1500 → "1.5s"
const seconds = (ms: number) => `${Number((ms / 1000).toFixed(1))}s`;

// Decides whether an error is worth retrying. Works on the SDK's ApiError shape
// ({ status, message: <JSON body> }) without importing it, so tests can fake it.
export function classify(error: unknown): Failure {
  const status = typeof (error as { status?: unknown })?.status === "number" ? (error as { status: number }).status : undefined;

  if (status === 429) return { kind: "rate-limit", retryAfterMs: retryDelayMs(error) };
  if (status !== undefined && status >= 500) return { kind: "transient" };
  if (status !== undefined) return { kind: "fatal" }; // 400 bad request, 401/403 bad key, 404 model gone

  // No HTTP status: the request never completed (network failure, DNS, our timeout).
  return { kind: "transient" };
}

// The 429 body carries `"retryDelay": "38s"` inside a RetryInfo detail.
function retryDelayMs(error: unknown): number | undefined {
  const message = String((error as { message?: unknown })?.message ?? "");
  const match = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(message);
  return match ? Math.ceil(Number(match[1]) * 1000) : undefined;
}
