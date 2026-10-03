import type { Request } from "express";

// The id set by requireAuth (middleware/requireAuth.ts) from the API token. Throws if a route
// was mounted without auth: a programming error, so a 500 rather than a silent anonymous
// query.
export function userIdOf(req: Request): string {
  if (!req.userId) throw new Error(`${req.method} ${req.originalUrl} reached without an authenticated user`);
  return req.userId;
}
