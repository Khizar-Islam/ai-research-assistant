// GET /api/health — proves the full path works: Express → Prisma → PrismaPg →
// Supabase transaction pooler → Postgres, and that pgvector is usable over it.
import { Router } from "express";
import { prisma } from "../lib/prisma.ts";

export const healthRouter = Router();

type HealthRow = {
  vector_version: string | null;
  cosine_distance: number;
};

healthRouter.get("/", async (_req, res) => {
  const startedAt = performance.now();

  try {
    // The `<=>` cosine-distance cast is the same operator the RAG search will use, so this
    // also confirms the `vector` type resolves through the pooler's search_path.
    const [row] = await prisma.$queryRaw<HealthRow[]>`
      SELECT
        (SELECT extversion FROM pg_extension WHERE extname = 'vector') AS vector_version,
        '[1,0,0]'::vector <=> '[0,1,0]'::vector                       AS cosine_distance
    `;

    res.json({
      status: "ok",
      database: "connected",
      pgvector: row?.vector_version ?? null,
      vectorCheck: row?.cosine_distance === 1 ? "ok" : "unexpected result",
      latencyMs: Math.round(performance.now() - startedAt),
    });
  } catch (error) {
    // Log the real error server-side; don't leak connection details to the client.
    console.error("[health] database check failed:", error);
    res.status(503).json({ status: "error", database: "unreachable" });
  }
});
