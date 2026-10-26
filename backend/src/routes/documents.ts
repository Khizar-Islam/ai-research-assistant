// /api/documents — upload documents, list them, inspect their chunks, delete them.
// Every query is scoped to req.userId, so a user can only ever see their own documents;
// someone else's document id gets the same 404 as one that doesn't exist.
import { Router } from "express";
import { prisma } from "../lib/prisma.ts";
import { userIdOf } from "../lib/requestUser.ts";
import { requireAuth } from "../middleware/auth.ts";
import { uploadLimiters } from "../middleware/rateLimit.ts";
import { checkFileType, receiveUpload } from "../middleware/upload.ts";
import { claimUploadSlot, uploadSlot } from "../middleware/uploadSlots.ts";
import { estimateTokens } from "../services/ingest/chunk.ts";
import { ingestDocument, type IngestStage } from "../services/ingest/pipeline.ts";

export const documentsRouter = Router();

documentsRouter.use(requireAuth);

// Fields returned for a document everywhere (never the user id).
const documentFields = {
  id: true,
  filename: true,
  fileType: true,
  status: true,
  errorMessage: true,
  stage: true,
  chunksTotal: true,
  chunksEmbedded: true,
  createdAt: true,
} as const;

// POST /api/documents/upload — multipart/form-data, one file in field "file".
// uploadSlot comes before receiveUpload so a busy server answers 429 before the file is
// read into memory.
documentsRouter.post("/upload", ...uploadLimiters, uploadSlot, receiveUpload, async (req, res) => {
  const slot = claimUploadSlot(res);
  if (!slot) return; // the client went away before it got an answer; nothing was stored

  let ingesting = false;
  try {
    const file = req.file!; // receiveUpload guarantees it
    const check = checkFileType(file);
    if (!check.ok) {
      res.status(415).json({ error: check.error });
      return;
    }

    const document = await prisma.document.create({
      data: {
        userId: userIdOf(req),
        filename: file.originalname.trim().slice(0, 255) || "untitled",
        fileType: check.kind,
        stage: "extracting" satisfies IngestStage, // so the first poll already shows a stage
      },
      select: documentFields,
    });

    // 202 Accepted: stored and queued, not finished. Processing continues after the
    // response; the client polls GET /api/documents for the status to change.
    res.status(202).json(document);

    // ingestDocument never rejects; the slot is held until it has finished or failed.
    ingesting = true;
    void ingestDocument(document.id, document.filename, file.buffer, check.kind).finally(slot.release);
  } finally {
    if (!ingesting) slot.release(); // answered without ingesting: 415, or the database failed
  }
});

// GET /api/documents — the user's documents, newest first.
documentsRouter.get("/", async (req, res) => {
  const documents = await prisma.document.findMany({
    where: { userId: userIdOf(req) },
    orderBy: { createdAt: "desc" },
    select: { ...documentFields, _count: { select: { chunks: true } } },
  });

  res.json({
    documents: documents.map(({ _count, ...document }) => ({ ...document, chunkCount: _count.chunks })),
  });
});

// GET /api/documents/:id/chunks — a document's chunks in order, for checking chunking.
documentsRouter.get("/:id/chunks", async (req, res) => {
  const document = await prisma.document.findFirst({
    where: { id: req.params.id, userId: userIdOf(req) },
    select: {
      ...documentFields,
      chunks: { orderBy: { chunkIndex: "asc" }, select: { id: true, chunkIndex: true, content: true } },
    },
  });
  if (!document) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  const { chunks, ...rest } = document;
  res.json({
    document: rest,
    chunks: chunks.map((chunk) => ({
      ...chunk,
      charCount: chunk.content.length,
      tokenEstimate: estimateTokens(chunk.content),
    })),
  });
});

// DELETE /api/documents/:id — removes the document; the database cascades to its chunks.
documentsRouter.delete("/:id", async (req, res) => {
  const { count } = await prisma.document.deleteMany({
    where: { id: req.params.id, userId: userIdOf(req) },
  });
  if (count === 0) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  res.status(204).end();
});
