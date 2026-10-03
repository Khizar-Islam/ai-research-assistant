// Adds `req.userId` to Express's Request type. Set by requireAuth from the signed-in
// user's API token, so routes can scope every query to one user.
declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export {};
