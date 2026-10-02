// Builds the Express app without starting it, so it can later be imported by tests
// (e.g. supertest) without opening a port. index.ts is what actually listens.
import cors from "cors";
import express from "express";
import { env } from "./config/env.ts";
import { errorHandler, notFound } from "./middleware/errorHandler.ts";
import { documentsRouter } from "./routes/documents.ts";
import { healthRouter } from "./routes/health.ts";
import { searchRouter } from "./routes/search.ts";

export function createApp() {
  const app = express();

  app.use(cors({ origin: env.CORS_ORIGIN }));
  app.use(express.json({ limit: "1mb" }));

  app.use("/api/health", healthRouter);
  app.use("/api/documents", documentsRouter);
  app.use("/api/search", searchRouter);

  // Must come after all routes.
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
