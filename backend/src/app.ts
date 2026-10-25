// Builds the Express app without starting it, so it can later be imported by tests
// (e.g. supertest) without opening a port. index.ts is what actually listens.
import cors from "cors";
import express from "express";
import { env } from "./config/env.ts";
import { errorHandler, notFound } from "./middleware/errorHandler.ts";
import { ipLimiter } from "./middleware/rateLimit.ts";
import { documentsRouter } from "./routes/documents.ts";
import { healthRouter } from "./routes/health.ts";
import { historyRouter, queryRouter } from "./routes/query.ts";
import { searchRouter } from "./routes/search.ts";

export function createApp() {
  const app = express();

  // How many proxies sit in front of the API (TRUST_PROXY_HOPS, default 0 = off). With the
  // right count req.ip is the visitor's address; with too few, every visitor looks like the
  // nearest proxy and shares one per-IP limit.
  if (env.TRUST_PROXY_HOPS > 0) app.set("trust proxy", env.TRUST_PROXY_HOPS);

  app.use(cors({ origin: env.CORS_ORIGIN }));
  app.use(express.json({ limit: "1mb" }));

  app.use("/api/health", healthRouter); // not limited: the platform health check calls it
  app.use("/api", ipLimiter);
  app.use("/api/documents", documentsRouter);
  app.use("/api/search", searchRouter);
  app.use("/api/query", queryRouter);
  app.use("/api/queries", historyRouter);

  // Must come after all routes.
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
