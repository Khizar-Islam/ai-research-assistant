// TEMPORARY auth stand-in until NextAuth lands in Step 8 (then this file is deleted).
//
// Every request is treated as coming from one fixed user, dev@localhost, so the document
// routes can be built and tested with real per-user scoping before login exists. It only
// works when NODE_ENV=development; anywhere else it refuses with 401, so a misconfigured
// deploy can't silently let everyone act as the same user.
import type { RequestHandler } from "express";
import { env } from "../config/env.ts";
import { prisma } from "../lib/prisma.ts";

const DEV_EMAIL = "dev@localhost";

// Looked up once per process, then reused. Caching the promise (not the id) means
// requests that arrive together during startup share one upsert instead of racing.
let devUserId: Promise<string> | undefined;

function getDevUserId(): Promise<string> {
  devUserId ??= prisma.user
    .upsert({
      where: { email: DEV_EMAIL },
      update: {},
      create: { email: DEV_EMAIL, name: "Dev User" },
      select: { id: true },
    })
    .then((user) => user.id)
    .catch((error: unknown) => {
      devUserId = undefined; // don't cache a failure; the next request retries
      throw error;
    });
  return devUserId;
}

export const devUser: RequestHandler = async (req, res, next) => {
  if (env.NODE_ENV !== "development") {
    res.status(401).json({ error: "Authentication is not configured" });
    return;
  }

  req.userId = await getDevUserId();
  next();
};
