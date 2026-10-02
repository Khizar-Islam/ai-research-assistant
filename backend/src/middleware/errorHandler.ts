import type { ErrorRequestHandler, RequestHandler } from "express";

// Any request that didn't match a route.
export const notFound: RequestHandler = (req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.originalUrl}` });
};

// The fields body-parser (express.json) and similar middleware put on their errors.
type HttpError = { status?: unknown; statusCode?: unknown; expose?: unknown; type?: unknown; message?: unknown };

// Last stop for errors. Express 5 forwards rejected promises from async handlers here
// automatically, so routes don't need their own try/catch just to report a 500.
export const errorHandler: ErrorRequestHandler = (err: HttpError, _req, res, _next) => {
  // Client errors raised by middleware (malformed JSON → 400, body too large → 413)
  // carry their status. Without this they'd all be reported as 500s.
  const status = typeof err?.status === "number" ? err.status : err?.statusCode;
  if (typeof status === "number" && status >= 400 && status < 500) {
    const message =
      err.type === "entity.parse.failed"
        ? "Malformed JSON body"
        : err.expose === true && typeof err.message === "string" // safe-to-show message
          ? err.message
          : "Bad request";
    res.status(status).json({ error: message });
    return;
  }

  console.error(err);
  res.status(500).json({ error: "Internal server error" });
};
