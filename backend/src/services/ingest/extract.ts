// Step 1 of ingestion: uploaded file bytes → clean plain text.
//
// Paragraphs in the returned text are separated by a blank line ("\n\n"). The chunker
// relies on that, so both branches below produce text in the same shape.
import { PasswordException, PDFParse } from "pdf-parse";

export type FileKind = "pdf" | "text";

// A failure we can explain to the user (stored in Document.errorMessage). Anything else
// thrown from here is an unexpected bug and gets a generic message instead.
export class ExtractionError extends Error {
  override name = "ExtractionError";
}

export async function extractText(buffer: Buffer, kind: FileKind): Promise<string> {
  const text = kind === "pdf" ? await extractPdf(buffer) : decodeText(buffer);

  // \p{L}/\p{N}: any letter or digit in any script. A PDF of scanned images yields no
  // text items at all, or only stray whitespace and symbols.
  if (!/[\p{L}\p{N}]/u.test(text)) {
    throw new ExtractionError(
      kind === "pdf" ? "No extractable text (scanned PDF?)" : "File contains no text",
    );
  }
  return text;
}

// ── Plain text / Markdown ────────────────────────────────────────────────────────────

function decodeText(buffer: Buffer): string {
  let text: string;
  try {
    // fatal: throw on invalid UTF-8 instead of silently inserting U+FFFD characters.
    // The decoder also strips a leading BOM by default.
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new ExtractionError("File is not valid UTF-8 text");
  }

  return text
    .replace(/\r\n?/g, "\n") // Windows / old Mac line endings → \n
    .replace(/[ \t]+$/gm, "") // trailing spaces, so "  \n" still counts as a blank line
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── PDF ──────────────────────────────────────────────────────────────────────────────

async function extractPdf(buffer: Buffer): Promise<string> {
  // new Uint8Array(buffer) copies the bytes: pdf.js may take ownership of (detach) the
  // array it's given, and the caller's Buffer may share memory with other Buffers.
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    // pageJoiner "" turns off the default "-- 1 of 3 --" marker after every page.
    const result = await parser.getText({ pageJoiner: "" });
    // Built from the whole document, so a word split on page 3 can be recognized from
    // its unsplit use on page 1.
    const vocabulary = wordsIn(result.pages.map((page) => page.text).join("\n"));
    return joinPdfPages(
      result.pages.map((page) => cleanPdfPage(page.text, vocabulary)),
      vocabulary,
    );
  } catch (error) {
    if (error instanceof PasswordException) {
      throw new ExtractionError("PDF is password-protected");
    }
    throw new ExtractionError("Could not read PDF (file may be corrupt)");
  } finally {
    await parser.destroy();
  }
}

// PDFs store positioned lines, not paragraphs: a paragraph comes out as several
// hard-wrapped lines. This rebuilds paragraphs from one page of pdf-parse output.
// `vocabulary` (see joinLines) defaults to this page's own words.
export function cleanPdfPage(raw: string, vocabulary: Set<string> = wordsIn(raw)): string {
  const lines = raw
    .split("\n")
    // pdf-parse puts \t between items separated by a wide horizontal gap (table cells,
    // justified text); for prose a single space is what we want.
    .map((line) => line.replace(/[\t ]+/g, " ").trim());

  // Typical full line width on this page. A line that ends a sentence well short of it
  // is very likely the last line of a paragraph.
  const lengths = lines.filter((l) => l.length > 0).map((l) => l.length);
  const fullWidth = lengths.length > 0 ? Math.max(...lengths) : 0;

  const paragraphs: string[] = [];
  let current = "";

  const endParagraph = () => {
    if (current) paragraphs.push(current);
    current = "";
  };

  for (const line of lines) {
    if (line === "") {
      endParagraph(); // a blank line is always a paragraph break
      continue;
    }

    current = current ? joinLines(current, line, vocabulary) : line;

    // Wrapped lines inside a paragraph run close to full width, so a clearly short line
    // is the end of a paragraph, a heading, or a list item: all good places to break.
    // Limitation: a paragraph whose last line happens to be nearly full width merges with
    // the next one. pdf-parse's text output has no spacing info to do better; this only
    // affects formatting, since chunks are still cut at sentence boundaries.
    // (A line ending in a word-break hyphen always continues, however short it is.)
    if (line.length < fullWidth * 0.7 && !/\p{Ll}-$/u.test(line)) endParagraph();
  }
  endParagraph();

  return paragraphs.join("\n\n");
}

// Joins cleaned pages. A page that ends mid-sentence (no closing punctuation) continues
// on the next page, so the two are joined like wrapped lines instead of becoming
// separate paragraphs; otherwise a chunk could start with half a sentence.
export function joinPdfPages(pages: string[], vocabulary: Set<string> = wordsIn(pages.join("\n"))): string {
  let text = "";
  for (const page of pages) {
    if (!page) continue;
    if (!text) text = page;
    else if (/[.!?:]["'”’)\]]?$/.test(text)) text += "\n\n" + page;
    else text = joinLines(text, page, vocabulary);
  }
  return text;
}

// Joins a wrapped line onto the text before it. The hard case is a line ending in a
// hyphen, which is either:
//   - a word split by hyphenation: "infor-" + "mation" → "information"
//   - a real hyphenated compound that wrapped: "software-" + "development" → keep it
// Text alone can't tell these apart, so the document decides: the hyphen is removed only
// if the joined word ("information") appears elsewhere in the same document. Otherwise
// it's kept: an occasional "infor-mation" is better than inventing "softwaredevelopment".
function joinLines(before: string, after: string, vocabulary: Set<string>): string {
  const head = /(\p{L}*\p{Ll})-$/u.exec(before)?.[1];
  const tail = /^\p{Ll}\p{L}*/u.exec(after)?.[0];
  if (head && tail) {
    return vocabulary.has((head + tail).toLowerCase())
      ? before.slice(0, -1) + after // drop the hyphen, no space
      : before + after; // keep the hyphen, no space
  }
  return before + " " + after;
}

// Every word (run of letters) in the text, lowercased. Halves of a split word are
// separate runs here ("infor", "mation"), so a split word only counts as known if it
// also appears unsplit somewhere.
function wordsIn(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/\p{L}+/gu) ?? []);
}
