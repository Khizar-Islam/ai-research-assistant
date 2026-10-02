// Runs ingestion for one uploaded document: extract → chunk → embed → save.
//
// Called without `await` after the upload route has already responded 202, so it must
// never throw: every outcome ends with the Document marked "ready" or "failed".
import { randomUUID } from "node:crypto";
import { prisma } from "../../lib/prisma.ts";
import { embedder, EmbeddingError, inBatches, titleFromFilename } from "../embeddings.ts";
import { chunkText } from "./chunk.ts";
import { ExtractionError, extractText, type FileKind } from "./extract.ts";

// Rows per INSERT. 100 chunks × 768 numbers keeps each statement around 1.5 MB, instead
// of one ~15 MB statement for a 1,000-chunk document.
const INSERT_BATCH_SIZE = 100;

export async function ingestDocument(
  documentId: string,
  filename: string,
  buffer: Buffer,
  kind: FileKind,
): Promise<void> {
  const startedAt = performance.now();
  try {
    const text = await extractText(buffer, kind);
    const chunks = chunkText(text);

    // Embed everything before writing anything, so a document is never "ready" with
    // chunks that can't be searched. This is the slow step: ~100 chunks/minute on the
    // free tier.
    const vectors = await embedder.embedDocumentChunks(
      chunks.map((chunk) => chunk.content),
      titleFromFilename(filename),
    );

    // Prisma can't write the `vector` column (it's Unsupported in the schema), so chunks
    // are inserted with raw SQL. unnest() turns parallel arrays into rows: one statement
    // per batch instead of one per chunk. Chunk ids come from here, not the database:
    // Prisma's @default(uuid()) is filled in by Prisma's client, not by Postgres.
    const inserts = inBatches(chunks, INSERT_BATCH_SIZE).map((batch) => {
      const ids = batch.map(() => randomUUID());
      const contents = batch.map((chunk) => chunk.content);
      const indices = batch.map((chunk) => chunk.chunkIndex);
      // "[0.1,0.2,...]" is pgvector's text format; ::vector parses it.
      const embeddings = batch.map((chunk) => JSON.stringify(vectors[chunk.chunkIndex]));
      return prisma.$executeRaw`
        INSERT INTO "Chunk" ("id", "documentId", "content", "chunkIndex", "embedding")
        SELECT t.id, ${documentId}, t.content, t.chunk_index, t.embedding::vector
        FROM unnest(${ids}::text[], ${contents}::text[], ${indices}::int[], ${embeddings}::text[])
          AS t(id, content, chunk_index, embedding)
      `;
    });

    // All-or-nothing: every chunk, its vector and the "ready" status land together, or
    // nothing does.
    await prisma.$transaction([
      prisma.chunk.deleteMany({ where: { documentId } }), // no-op normally; makes a retry safe
      ...inserts,
      prisma.document.update({ where: { id: documentId }, data: { status: "ready", errorMessage: null } }),
    ]);

    const ms = Math.round(performance.now() - startedAt);
    console.log(`[ingest] ${documentId}: ready, ${chunks.length} chunks embedded in ${ms} ms`);
  } catch (error) {
    await markFailed(documentId, error);
  }
}

async function markFailed(documentId: string, error: unknown): Promise<void> {
  // ExtractionError and EmbeddingError messages are written for the user. Anything else
  // is a bug or an infrastructure problem: log the details, store a generic message.
  const userFacing = error instanceof ExtractionError || error instanceof EmbeddingError;
  const errorMessage = userFacing ? error.message : "Processing failed due to a server error";
  if (error instanceof EmbeddingError && error.cause) {
    // e.g. the raw 429 body or the bad response, for debugging; the user sees only the message.
    console.error(`[ingest] ${documentId}: failed, ${error.message}`, error.cause);
  } else if (userFacing) {
    console.log(`[ingest] ${documentId}: failed, ${error.message}`);
  } else {
    console.error(`[ingest] ${documentId}: failed with an unexpected error`, error);
  }

  try {
    // updateMany, not update: if the user deleted the document mid-processing there's no
    // row left, and that's fine rather than another error.
    await prisma.$transaction([
      prisma.chunk.deleteMany({ where: { documentId } }),
      prisma.document.updateMany({ where: { id: documentId }, data: { status: "failed", errorMessage } }),
    ]);
  } catch (dbError) {
    // The database is unreachable too. The startup sweep below will catch this row later.
    console.error(`[ingest] ${documentId}: could not record the failure`, dbError);
  }
}

// Processing runs inside the server process with no job queue, so a restart or crash
// mid-upload would leave a document on "processing" forever. On startup, fail anything
// that has been processing far longer than any real upload takes. (Recent ones are left
// alone in case another server instance is still working on them.)
const STALE_AFTER_MS = 10 * 60 * 1000;

export async function failInterruptedDocuments(): Promise<number> {
  const { count } = await prisma.document.updateMany({
    where: { status: "processing", createdAt: { lt: new Date(Date.now() - STALE_AFTER_MS) } },
    data: { status: "failed", errorMessage: "Interrupted by server restart. Please upload again." },
  });
  return count;
}
