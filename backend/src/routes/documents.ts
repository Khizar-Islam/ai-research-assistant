// /api/documents — upload documents, list them, inspect their chunks, delete them.
// Every query is scoped to req.userId, so a user can only ever see their own documents;
// someone else's document id gets the same 404 as one that doesn't exist.
import { Router, type Request } from "express";
import { prisma } from "../lib/prisma.ts";
import { devUser } from "../middleware/devUser.ts";
import { checkFileType, receiveUpload } from "../middleware/upload.ts";
import { estimateTokens } from "../services/ingest/chunk.ts";
import { ingestDocument } from "../services/ingest/pipeline.ts";

export const documentsRouter = Router();

documentsRouter.use(devUser); // replaced by real auth in Step 8

function userIdOf(req: Request): string {
  if (!req.userId) throw new Error("documentsRouter reached without an authenticated user");
  return req.userId;
}

// Fields returned for a document everywhere (never the user id).
const documentFields = {
  id: true,
  filename: true,
  fileType: true,
  status: true,
  errorMessage: true,
  createdAt: true,
} as const;

// POST /api/documents/upload — multipart/form-data, one file in field "file".
documentsRouter.post("/upload", receiveUpload, async (req, res) => {
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
    },
    select: documentFields,
  });

  // 202 Accepted: stored and queued, not finished. Processing continues after the
  // response; the client polls GET /api/documents for the status to change.
  res.status(202).json(document);

  void ingestDocument(document.id, document.filename, file.buffer, check.kind);
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
