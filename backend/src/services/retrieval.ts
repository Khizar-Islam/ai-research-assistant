// The "R" in RAG: find the chunks of a user's documents closest in meaning to a question.
// Used by POST /api/search now, and by POST /api/query (answer generation) in Step 5.
import { prisma } from "../lib/prisma.ts";
import { embedder } from "./embeddings.ts";

export type RetrievedChunk = {
  chunkId: string;
  documentId: string;
  filename: string;
  chunkIndex: number;
  content: string;
  similarity: number; // cosine similarity, 1 = same direction; higher is more relevant
};

export type Retrieval = {
  results: RetrievedChunk[];
  timings: { embedMs: number; searchMs: number };
};

export async function retrieveChunks(userId: string, question: string, topK: number): Promise<Retrieval> {
  const embedStart = performance.now();
  // Throws EmbeddingError (rate limited, unavailable, ...); the caller maps it to HTTP.
  const questionVector = await embedder.embedQuery(question);
  const embedMs = Math.round(performance.now() - embedStart);

  // pgvector's text format "[0.1,0.2,...]"; ::vector parses it. All values are bound
  // parameters (tagged template), never spliced into the SQL string.
  const vector = JSON.stringify(questionVector);

  const searchStart = performance.now();
  // `<=>` is cosine distance (0 = identical direction), so similarity = 1 - distance.
  // ORDER BY uses the operator expression itself, so an HNSW index can serve it if one is
  // added later (deferred for now: a full scan is faster and exact at this size).
  const rows = await prisma.$queryRaw<RetrievedChunk[]>`
    SELECT c.id              AS "chunkId",
           c."documentId"    AS "documentId",
           d.filename        AS "filename",
           c."chunkIndex"    AS "chunkIndex",
           c.content         AS "content",
           1 - (c.embedding <=> ${vector}::vector) AS "similarity"
    FROM "Chunk" c
    JOIN "Document" d ON d.id = c."documentId"
    WHERE d."userId" = ${userId}
      AND d.status = 'ready'          -- chunks only exist for ready documents today; cheap guard
      AND c.embedding IS NOT NULL     -- chunks stored before embedding existed can't be ranked
    ORDER BY c.embedding <=> ${vector}::vector
    LIMIT ${topK}::int
  `;
  const searchMs = Math.round(performance.now() - searchStart);

  return { results: rows, timings: { embedMs, searchMs } };
}
