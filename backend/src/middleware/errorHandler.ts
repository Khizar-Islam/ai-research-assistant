import type { ErrorRequestHandler, RequestHandler } from "express";

// Any request that didn't match a route.
export const notFound: RequestHandler = (req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.originalUrl}` });
};

// The fields body-parser (express.json) and similar middleware put on their errors.
type HttpError = { statusCode?: unknown; expose?: unknown; type?: unknown; message?: unknown };

// Last stop for errors. Express 5 forwards rejected promises from async handlers here
// automatically, so routes don't need their own try/catch just to report a 500.
export const errorHandler: ErrorRequestHandler = (err: HttpError, _req, res, next) => {
  // Too late to send a reply: let Express's default handler close the connection.
  if (res.headersSent) return next(err);

  // Client errors raised by middleware (malformed JSON → 400, body too large → 413)
  // carry their status. Without this they'd all be reported as 500s. Only statusCode is
  // read, never `status`: Gemini and Prisma SDK errors carry a `status` of their own (the
  // upstream service's), which says nothing about what this request should get.
  const code = err?.statusCode;
  const status = typeof code === "number" && Number.isInteger(code) && code >= 400 && code <= 599 ? code : 500;
  if (status < 500) {
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
