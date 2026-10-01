import type { ErrorRequestHandler, RequestHandler } from "express";

// Any request that didn't match a route.
export const notFound: RequestHandler = (req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.originalUrl}` });
};

// Last stop for errors. Express 5 forwards rejected promises from async handlers here
// automatically, so routes don't need their own try/catch just to report a 500.
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
};
