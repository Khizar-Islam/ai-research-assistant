// Runs ingestion for one uploaded document: extract → chunk → embed → save.
//
// Called without `await` after the upload route has already responded 202, so it must
// never throw: every outcome ends with the Document marked "ready" or "failed".
import { randomUUID } from "node:crypto";
import { prisma } from "../../lib/prisma.ts";
import { embedder, EmbeddingError, inBatches, titleFromFilename } from "../embeddings.ts";
import { chunkText, type TextChunk } from "./chunk.ts";
import { ExtractionError, extractText, type FileKind } from "./extract.ts";

// Rows per INSERT. 100 chunks × 768 numbers keeps each statement around 1.5 MB, instead
// of one ~15 MB statement for a 1,000-chunk document.
const INSERT_BATCH_SIZE = 100;

// The save transaction normally takes 1–2 s (1,000 chunks ≈ 15 MB to Supabase). Prisma's
// default limit is 5 s, and one network stall on 2026-10-03 hit it (44 s) after minutes
// of embedding work. 30 s rides out a hiccup; maxWait is how long to wait for a free
// connection from the pool before starting.
const SAVE_TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 };
const SLOW_SAVE_MS = 5_000;

export async function ingestDocument(
  documentId: string,
  filename: string,
  buffer: Buffer,
  kind: FileKind,
): Promise<void> {
  const startedAt = performance.now();
  try {
    // stage starts as "extracting": the upload route sets it when it creates the row.
    const text = await extractText(buffer, kind);
    await setProgress(documentId, { stage: "chunking" });
    const chunks = chunkText(text);
    await setProgress(documentId, { stage: "embedding", chunksTotal: chunks.length, chunksEmbedded: 0 });

    // Embed everything before writing anything, so a document is never "ready" with
    // chunks that can't be searched. This is the slow step: ~100 chunks/minute on the
    // free tier, which is why it reports progress after every batch.
    const vectors = await embedder.embedDocumentChunks(
      chunks.map((chunk) => chunk.content),
      titleFromFilename(filename),
      (embeddedCount) => setProgress(documentId, { chunksEmbedded: embeddedCount }),
    );
    await setProgress(documentId, { stage: "saving" });
    const save = await saveChunks(documentId, chunks, vectors);

    const ms = Math.round(performance.now() - startedAt);
    console.log(`[ingest] ${documentId}: ready, ${chunks.length} chunks embedded in ${ms} ms (save ${save.totalMs} ms)`);
    if (save.totalMs > SLOW_SAVE_MS) {
      // Succeeded, but slow enough to be worth seeing before it ever becomes a timeout.
      console.warn(`[ingest] ${documentId}: slow save, ${save.steps.join(", ")}`);
    }
  } catch (error) {
    await markFailed(documentId, error);
  }
}

// Writes every chunk, its vector and the "ready" status in one transaction: all of it
// lands, or none of it does. Each statement is timed, so if the transaction ever stalls
// the log says which statement was still running and for how long. (Otherwise Prisma
// reports only "transaction expired", which hides where the time went.)
async function saveChunks(
  documentId: string,
  chunks: TextChunk[],
  vectors: number[][],
): Promise<{ totalMs: number; steps: string[] }> {
  const startedAt = performance.now();
  const steps: string[] = [];
  let inFlight: { name: string; startedAt: number } | undefined = { name: "waiting for a connection", startedAt };

  async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
    if (inFlight) steps.push(`${inFlight.name} ${elapsed(inFlight.startedAt)} ms`); // the connection wait
    inFlight = { name, startedAt: performance.now() };
    const result = await run();
    steps.push(`${name} ${elapsed(inFlight.startedAt)} ms`);
    inFlight = undefined;
    return result;
  }

  const batches = inBatches(chunks, INSERT_BATCH_SIZE);
  try {
    await prisma.$transaction(async (tx) => {
      // No-op normally; makes a retry of the same document safe.
      await step("delete old chunks", () => tx.chunk.deleteMany({ where: { documentId } }));

      // Prisma can't write the `vector` column (it's Unsupported in the schema), so chunks
      // are inserted with raw SQL. unnest() turns parallel arrays into rows: one statement
      // per batch instead of one per chunk. Chunk ids come from here, not the database:
      // Prisma's @default(uuid()) is filled in by Prisma's client, not by Postgres.
      for (const [i, batch] of batches.entries()) {
        const ids = batch.map(() => randomUUID());
        const contents = batch.map((chunk) => chunk.content);
        const indices = batch.map((chunk) => chunk.chunkIndex);
        // "[0.1,0.2,...]" is pgvector's text format; ::vector parses it.
        const embeddings = batch.map((chunk) => JSON.stringify(vectors[chunk.chunkIndex]));
        await step(
          `insert batch ${i + 1}/${batches.length} (${batch.length} chunks)`,
          () => tx.$executeRaw`
            INSERT INTO "Chunk" ("id", "documentId", "content", "chunkIndex", "embedding")
            SELECT t.id, ${documentId}, t.content, t.chunk_index, t.embedding::vector
            FROM unnest(${ids}::text[], ${contents}::text[], ${indices}::int[], ${embeddings}::text[])
              AS t(id, content, chunk_index, embedding)
          `,
        );
      }

      await step("mark ready", () =>
        tx.document.update({ where: { id: documentId }, data: { status: "ready", stage: null, errorMessage: null } }),
      );
      inFlight = { name: "commit", startedAt: performance.now() };
    }, SAVE_TX_OPTIONS);
  } catch (error) {
    const running = inFlight ? `; still running: ${inFlight.name} (${elapsed(inFlight.startedAt)} ms)` : "";
    console.error(
      `[ingest] ${documentId}: save transaction failed after ${elapsed(startedAt)} ms ` +
        `(limit ${SAVE_TX_OPTIONS.timeout} ms); finished: ${steps.join(", ") || "nothing"}${running}`,
    );
    throw error; // markFailed logs the error itself and records the failure
  }

  return { totalMs: elapsed(startedAt), steps };
}

function elapsed(since: number): number {
  return Math.round(performance.now() - since);
}

// Progress is for display only, so writing it is best-effort: if the write fails the
// error is logged and ingestion carries on (if the database is really down, the final
// transaction fails and markFailed records that). updateMany, not update, for the same
// reason as in markFailed: the document may have been deleted mid-processing.
export type IngestStage = "extracting" | "chunking" | "embedding" | "saving";
type Progress = { stage?: IngestStage; chunksTotal?: number; chunksEmbedded?: number };

async function setProgress(documentId: string, progress: Progress): Promise<void> {
  try {
    await prisma.document.updateMany({ where: { id: documentId, status: "processing" }, data: progress });
  } catch (error) {
    console.error(`[ingest] ${documentId}: could not record progress`, error);
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
