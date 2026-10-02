// Receives one uploaded file (multipart/form-data, field "file") and checks what it
// actually is before anything touches the database.
import type { RequestHandler } from "express";
import multer from "multer";
import type { FileKind } from "../services/ingest/extract.ts";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

const receiveSingleFile = multer({
  // Keep the file in memory as a Buffer: no temp files to clean up, and the original is
  // gone once processing finishes. Fine at 10 MB; very large files would need streaming.
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 10 },
  // Browsers and curl send non-ASCII filenames ("résumé.pdf") as raw UTF-8 bytes; multer's
  // default of latin1 would turn that into "rÃ©sumÃ©.pdf".
  defParamCharset: "utf8",
}).single("file");

// Runs multer and turns its errors into proper 4xx responses instead of 500s.
export const receiveUpload: RequestHandler = (req, res, next) => {
  receiveSingleFile(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({ error: `File is too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB)` });
      } else {
        // e.g. LIMIT_UNEXPECTED_FILE (wrong field name) or LIMIT_FILE_COUNT (two files).
        res.status(400).json({ error: `Send exactly one file in a form field named "file" (${error.message})` });
      }
      return;
    }
    if (error) {
      // Not a limit violation: the multipart body itself was malformed or cut off.
      res.status(400).json({ error: "Malformed upload body" });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: 'No file received. Send multipart/form-data with the file in a field named "file".' });
      return;
    }
    next();
  });
};

export type FileCheck = { ok: true; kind: FileKind } | { ok: false; error: string };

const TEXT_EXTENSIONS = new Set([".txt", ".md"]);

// Decides the file type from its extension AND its bytes. The declared MIME type is
// ignored entirely: clients set it from the extension (or get it wrong), so it adds nothing.
export function checkFileType(file: Express.Multer.File): FileCheck {
  const name = file.originalname.toLowerCase();
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";

  if (extension === ".pdf") {
    // Every PDF starts with this header (magic bytes). A renamed .docx or image doesn't.
    return file.buffer.subarray(0, 5).toString("latin1") === "%PDF-"
      ? { ok: true, kind: "pdf" }
      : { ok: false, error: "File has a .pdf extension but is not a PDF" };
  }

  if (TEXT_EXTENSIONS.has(extension)) {
    // Null bytes never appear in real text files; they're the classic sign of binary data.
    if (file.buffer.includes(0)) return { ok: false, error: "File is not plain text (contains binary data)" };
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(file.buffer);
    } catch {
      return { ok: false, error: "Text file is not valid UTF-8" };
    }
    return { ok: true, kind: "text" };
  }

  return { ok: false, error: "Unsupported file type. Upload a .pdf, .txt or .md file." };
}
