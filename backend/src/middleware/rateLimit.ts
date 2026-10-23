// Rate limits for the API. Every request that costs money (Gemini embeddings, answers) or
// real work (parsing and chunking a PDF) is counted, so one account, or one script, can't
// use up the free Gemini quota or the database for everybody else.
//
// Two kinds of limit:
//   - perIp:  a coarse brake on everything under /api, counted per client address. It runs
//             before sign-in is checked, so it also covers requests with no token at all.
//   - perUser: a tighter limit on the expensive routes, counted per signed-in user (the id
//             requireAuth sets), so people behind the same address don't share a budget.
//
// Counts live in this process's memory. That is fine for the one Render instance this runs
// on, but it means they reset when the server restarts or wakes from sleep, and they would
// not be shared if the API were ever scaled to several instances (a shared store such as
// Redis would be needed then).
import type { Request, RequestHandler } from "express";
import { ipKeyGenerator, type RateLimitInfo, rateLimit } from "express-rate-limit";

type LimitOptions = {
  windowMs: number;
  limit: number;
  // Shown to the person. Say what was limited and roughly how long to wait.
  message: string;
};

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function createLimiter({ windowMs, limit, message }: LimitOptions, key: (req: Request) => string): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-7", // RateLimit and Retry-After headers
    legacyHeaders: false,
    keyGenerator: key,
    handler: (req, res, _next, options) => {
      const resetTime = (req as Request & { rateLimit?: RateLimitInfo }).rateLimit?.resetTime;
      const retryAfterSeconds = resetTime ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000)) : Math.ceil(windowMs / 1000);
      res.set("Retry-After", String(retryAfterSeconds));
      res.status(options.statusCode).json({ error: message, code: "rate_limited", retryAfterSeconds });
    },
  });
}

// Address of the caller. ipKeyGenerator groups IPv6 addresses by their /56 so one person
// can't dodge the limit by rotating through addresses in their own range.
const byIp = (req: Request) => ipKeyGenerator(req.ip ?? "unknown");

// The signed-in user. Falls back to the address if a route was mounted before requireAuth
// (a mistake, but it should still be limited rather than crash).
const byUser = (req: Request) => (req.userId ? `user:${req.userId}` : `ip:${byIp(req)}`);

export const limits = {
  // 300 requests a minute per address. The dashboard polls document status while a file is
  // processing, so this is deliberately generous; it only stops floods.
  perIp: { windowMs: MINUTE, limit: 300, message: "Too many requests. Slow down and try again in a minute." },
  // Asking a question: an embedding call plus an answer. 10 a minute stops hammering, and
  // 150 a day keeps one account well inside the free Gemini quota.
  askPerMinute: { windowMs: MINUTE, limit: 10, message: "You're asking questions too quickly. Wait a minute and try again." },
  askPerDay: { windowMs: DAY, limit: 150, message: "You've reached today's limit of 150 questions. Try again tomorrow." },
  // Uploading a file: parsing plus one embedding call per batch of chunks. The most
  // expensive thing a user can do, so the lowest limit.
  uploadPerHour: { windowMs: HOUR, limit: 10, message: "You've uploaded a lot of files in the last hour. Try again later." },
  uploadPerDay: { windowMs: DAY, limit: 40, message: "You've reached today's limit of 40 uploads. Try again tomorrow." },
  // The debug search endpoint: one embedding call per request.
  searchPerMinute: { windowMs: MINUTE, limit: 30, message: "Too many searches. Wait a minute and try again." },
} satisfies Record<string, LimitOptions>;

export const ipLimiter = createLimiter(limits.perIp, byIp);

// A question counts once against both limits. Used for POST /api/query and
// POST /api/query/stream, which share one budget so streaming can't be used to get around it.
export const askLimiters: RequestHandler[] = [
  createLimiter(limits.askPerMinute, byUser),
  createLimiter(limits.askPerDay, byUser),
];

export const uploadLimiters: RequestHandler[] = [
  createLimiter(limits.uploadPerHour, byUser),
  createLimiter(limits.uploadPerDay, byUser),
];

export const searchLimiters: RequestHandler[] = [createLimiter(limits.searchPerMinute, byUser)];

// For tests: the same limiter shape with small numbers.
export { createLimiter };
