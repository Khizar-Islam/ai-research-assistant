// Caps how many uploads are being processed at once. Each upload is held in memory (up to
// 10 MB), and parsing a PDF can take several times its size, so on a 512 MB instance a
// handful of simultaneous uploads could crash the server and lose every document in
// progress. This is separate from the rate limits (rateLimit.ts), which count uploads over
// time, not at the same moment.
//
// A slot is taken before multer reads the body (so a rejected upload never costs memory)
// and held until ingestion finishes or fails. Who releases it:
//   - the upload route, once its handler starts (claimUploadSlot): it hands the slot to
//     ingestion after the 202, or releases it itself if it answers without ingesting;
//   - otherwise the response's "close": the request ended before the handler ran (multer
//     rejected the file, malformed body, the client went away).
// release() is idempotent, so whichever path runs last does nothing. A backstop timer frees
// any slot still held after SLOT_BACKSTOP_MS.
//
// Counts live in this process's memory and reset on restart, like the rate limits.
import type { RequestHandler, Response } from "express";
import { userIdOf } from "../lib/requestUser.ts";

// The server-wide limit is what protects memory: at most three uploads are parsed at once,
// well short of the ~10 that could exhaust 512 MB (an estimate, not measured). The per-user
// limit is the same, so one person dropping up to three files at once still works; anyone
// else uploading meanwhile briefly gets the busy message.
export const MAX_UPLOADS_PER_USER = 3;
export const MAX_UPLOADS_PER_SERVER = 3;

// Longer than the longest legitimate ingestion (its embedding stage is capped at 20
// minutes). Only exists so a hung parse can't lock out uploads until a restart.
export const SLOT_BACKSTOP_MS = 30 * 60 * 1000;

export type UploadSlot = {
  release: () => void;
  readonly released: boolean;
};

type Acquired = { ok: true; slot: UploadSlot } | { ok: false; reason: "user" | "server" };

export function createUploadSlots(limits = { perUser: MAX_UPLOADS_PER_USER, perServer: MAX_UPLOADS_PER_SERVER }) {
  const perUser = new Map<string, number>();
  let total = 0;

  function tryAcquire(userId: string): Acquired {
    const mine = perUser.get(userId) ?? 0;
    if (mine >= limits.perUser) return { ok: false, reason: "user" };
    if (total >= limits.perServer) return { ok: false, reason: "server" };

    perUser.set(userId, mine + 1);
    total++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      clearTimeout(backstop);
      total--;
      const left = (perUser.get(userId) ?? 1) - 1;
      if (left > 0) perUser.set(userId, left);
      else perUser.delete(userId);
    };
    const backstop = setTimeout(() => {
      if (released) return;
      console.warn(`[uploads] a slot was still held after ${SLOT_BACKSTOP_MS / 60_000} minutes; freeing it`);
      release();
    }, SLOT_BACKSTOP_MS);
    backstop.unref(); // never keeps the process alive

    return {
      ok: true,
      slot: {
        get released() {
          return released;
        },
        release,
      },
    };
  }

  // For tests and logs.
  const inUse = (userId?: string) => (userId === undefined ? total : (perUser.get(userId) ?? 0));

  return { tryAcquire, inUse };
}

export type UploadSlots = ReturnType<typeof createUploadSlots>;

// Shown to the person as-is, so fixed text only.
const REJECTIONS = {
  user: {
    message: "You already have several uploads processing. Wait for one to finish, then try again.",
    code: "upload_in_progress",
    retryAfterSeconds: 30,
  },
  server: {
    message: "The server is busy with other uploads. Try again in a minute.",
    code: "uploads_busy",
    retryAfterSeconds: 60,
  },
} as const;

// Where the slot waits between this middleware and the route handler.
type SlotLocals = { uploadSlot?: { slot: UploadSlot; claimed: boolean } };

// Must run after requireAuth (it needs req.userId) and before multer.
export function createUploadSlotMiddleware(slots: UploadSlots): RequestHandler {
  return (req, res, next) => {
    const acquired = slots.tryAcquire(userIdOf(req));
    if (!acquired.ok) {
      const { message, code, retryAfterSeconds } = REJECTIONS[acquired.reason];
      res.set("Retry-After", String(retryAfterSeconds));
      res.status(429).json({ error: message, code, retryAfterSeconds });
      return;
    }

    const held = { slot: acquired.slot, claimed: false };
    (res.locals as SlotLocals).uploadSlot = held;
    // The request ended before the handler took the slot over: nothing else will release it.
    res.once("close", () => {
      if (!held.claimed) held.slot.release();
    });
    next();
  };
}

// Called first thing in the upload handler: from here on the handler (or the ingestion it
// starts) must release the slot. Returns null if the response already closed (the client
// went away while the body was being received), in which case there is nobody to answer.
export function claimUploadSlot(res: Response): UploadSlot | null {
  const held = (res.locals as SlotLocals).uploadSlot;
  if (!held) throw new Error("claimUploadSlot: the uploadSlot middleware didn't run for this route"); // → 500
  if (held.slot.released) return null;
  held.claimed = true;
  return held.slot;
}

export const uploadSlots = createUploadSlots();
export const uploadSlot = createUploadSlotMiddleware(uploadSlots);
