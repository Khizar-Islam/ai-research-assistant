// Runs ingestion for one uploaded document: extract → chunk → (embed, Step 3) → save.
//
// Called without `await` after the upload route has already responded 202, so it must
// never throw: every outcome ends with the Document marked "ready" or "failed".
import { prisma } from "../../lib/prisma.ts";
import { chunkText } from "./chunk.ts";
import { ExtractionError, extractText, type FileKind } from "./extract.ts";

export async function ingestDocument(documentId: string, buffer: Buffer, kind: FileKind): Promise<void> {
  const startedAt = performance.now();
  try {
    const text = await extractText(buffer, kind);
    const chunks = chunkText(text);

    // Step 3 inserts embedding here, before anything is written, so a document is
    // never "ready" with chunks that can't be searched.

    // All-or-nothing: the chunks and the "ready" status land together, or neither does.
    // One createMany keeps chunkIndex order independent of insert timing.
    await prisma.$transaction([
      prisma.chunk.deleteMany({ where: { documentId } }), // no-op normally; makes a retry safe
      prisma.chunk.createMany({
        data: chunks.map((chunk) => ({ documentId, content: chunk.content, chunkIndex: chunk.chunkIndex })),
      }),
      prisma.document.update({ where: { id: documentId }, data: { status: "ready", errorMessage: null } }),
    ]);

    const ms = Math.round(performance.now() - startedAt);
    console.log(`[ingest] ${documentId}: ready, ${chunks.length} chunks in ${ms} ms`);
  } catch (error) {
    await markFailed(documentId, error);
  }
}

async function markFailed(documentId: string, error: unknown): Promise<void> {
  // ExtractionError messages are written for the user. Anything else is a bug or an
  // infrastructure problem: log the details, store a generic message.
  const errorMessage =
    error instanceof ExtractionError ? error.message : "Processing failed due to a server error";
  if (error instanceof ExtractionError) {
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
