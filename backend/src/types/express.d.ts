// Adds `req.userId` to Express's Request type. Set by the auth middleware — devUser for
// now, NextAuth session lookup in Step 8 — so routes can scope every query to one user.
declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export {};
