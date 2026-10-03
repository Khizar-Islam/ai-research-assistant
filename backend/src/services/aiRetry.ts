// Retry and error handling shared by every Gemini call (embeddings, answer generation).
// No network imports, so it can be unit-tested and used by modules that are.

// What went wrong, for code to act on (e.g. choosing an HTTP status); `message` is the
// same thing in words a user can read.
export type AiErrorCode =
  | "too_large" // input over our own limits (e.g. a document over the chunk cap)
  | "rate_limited" // per-minute limit; worth retrying shortly
  | "quota_exhausted" // daily limit; not worth retrying today
  | "unavailable" // service errors/timeouts persisted through retries
  | "rejected" // the API refused the request (bad key, bad input)
  | "bad_response" // the API answered with something unusable
  | "blocked" // the model refused to produce output (safety filters)
  | "cancelled"; // the client went away mid-request (a closed stream); nothing to report

// A failure explained in words a user can read; `cause` keeps the original error for the
// server log. Subclassed per service so callers can tell them apart.
export class AiServiceError extends Error {
  override name = "AiServiceError";
  readonly code: AiErrorCode;

  constructor(code: AiErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}

// The client disconnected, so the work was stopped. An AiServiceError so withRetry passes
// it straight through instead of treating the abort as a network failure to retry.
export class RequestCancelledError extends AiServiceError {
  override name = "RequestCancelledError";

  constructor(options?: ErrorOptions) {
    super("cancelled", "The request was cancelled.", options);
  }
}

export function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new RequestCancelledError({ cause: signal.reason });
}

export type RetryPolicy = {
  maxAttempts: number; // per request, including the first
  maxWaitMs: number; // longest single wait this caller accepts before giving up
  totalBudgetMs: number; // across all requests of one call
};

// A 429 asking us to wait longer than this isn't the per-minute limit (those ask for
// seconds); it's the daily quota, so waiting it out isn't an option.
export const DAILY_QUOTA_SIGNAL_MS = 90_000;

export type RetryDeps = {
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  log: (message: string) => void;
};

export const realRetryDeps: RetryDeps = {
  sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  now: Date.now,
  log: console.log,
};

// Real implementations for whatever a test didn't fake.
export function retryDepsFrom(deps: Partial<RetryDeps>): RetryDeps {
  return {
    sleep: deps.sleep ?? realRetryDeps.sleep,
    now: deps.now ?? realRetryDeps.now,
    log: deps.log ?? realRetryDeps.log,
  };
}

export type RetryOptions = {
  policy: RetryPolicy;
  deadline: number; // absolute time (deps.now() scale) after which we stop waiting
  // Names the service in log lines ("[embeddings] ...") and messages ("Embedding ...").
  logTag: string;
  serviceName: string; // e.g. "Embedding", "Answer generation"
  makeError: (code: AiErrorCode, message: string, options: ErrorOptions) => AiServiceError;
};

// Runs `call`, retrying rate limits and transient failures as the policy allows.
// An AiServiceError thrown by `call` itself (e.g. a response that failed validation) is
// passed straight through: retrying won't fix it.
export async function withRetry<T>(call: () => Promise<T>, options: RetryOptions, deps: RetryDeps): Promise<T> {
  const { policy, deadline, logTag, serviceName, makeError } = options;
  const service = serviceName.toLowerCase();

  for (let attempt = 1; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      if (error instanceof AiServiceError) throw error;

      const failure = classify(error);
      if (failure.kind === "fatal") {
        throw makeError("rejected", `The ${service} service rejected the request`, { cause: error });
      }

      // Wait as long as the server asks. Otherwise: for a rate limit, long enough for a
      // per-minute window to move on; for anything else, backoff 1s, 2s, 4s, ...
      const waitMs =
        failure.retryAfterMs ??
        (failure.kind === "rate-limit" ? 20_000 : Math.min(1000 * 2 ** (attempt - 1), 30_000));

      // Per-minute limits ask for seconds; a much longer wait means the daily quota is gone.
      if (failure.kind === "rate-limit" && waitMs > DAILY_QUOTA_SIGNAL_MS) {
        throw makeError("quota_exhausted", `${serviceName} quota exceeded. Try again later.`, { cause: error });
      }
      if (attempt >= policy.maxAttempts || waitMs > policy.maxWaitMs || deps.now() + waitMs > deadline) {
        throw failure.kind === "rate-limit"
          ? makeError("rate_limited", `${serviceName} service is busy (rate limit). Try again in a few minutes.`, { cause: error })
          : makeError("unavailable", `${serviceName} service is unavailable. Try again later.`, { cause: error });
      }
      // Without this, work waiting out a rate limit looks stuck.
      deps.log(`[${logTag}] ${describeFailure(failure, error)}, waiting ${seconds(waitMs)} (attempt ${attempt + 1}/${policy.maxAttempts})`);
      await deps.sleep(waitMs);
    }
  }
}

type Failure = { kind: "rate-limit" | "transient" | "fatal"; retryAfterMs?: number };

// Decides whether an error is worth retrying. Works on the SDK's ApiError shape
// ({ status, message: <JSON body> }) without importing it, so tests can fake it.
export function classify(error: unknown): Failure {
  const status = typeof (error as { status?: unknown })?.status === "number" ? (error as { status: number }).status : undefined;

  if (status === 429) return { kind: "rate-limit", retryAfterMs: retryDelayMs(error) };
  if (status !== undefined && status >= 500) return { kind: "transient" }; // incl. 503 "high demand"
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
