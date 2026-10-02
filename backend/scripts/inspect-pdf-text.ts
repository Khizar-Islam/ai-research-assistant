// Debug tool: shows how a PDF's text is stored, around the lines containing a search
// word, to diagnose extraction problems like merged words ("softwaredevelopment").
//
//   npx tsx scripts/inspect-pdf-text.ts <file.pdf> <word>
//
// Prints only the matching lines (plus the line before and after). Nothing is sent
// anywhere; it reads the file locally.
import { readFile } from "node:fs/promises";
import { PDFParse } from "pdf-parse";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const [file, word] = process.argv.slice(2);
if (!file || !word) {
  console.error("Usage: npx tsx scripts/inspect-pdf-text.ts <file.pdf> <word>");
  process.exit(1);
}

const bytes = await readFile(file);
const squash = (s: string) => s.toLowerCase().replace(/\s+/g, "");
const needle = squash(word);
const MAX_MATCHES = 3;

// ── 1. Raw pdf.js text items, grouped into visual lines ──────────────────────────────
type Item = { str: string; x: number; y: number; width: number; height: number; hasEOL: boolean };

const pdf = await getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
let matches = 0;

console.log(`=== 1. Raw text items around "${word}" ===`);
console.log("(x, gap, w, h in PDF points; gap = space between this item and the end of the previous one)\n");

for (let p = 1; p <= pdf.numPages && matches < MAX_MATCHES; p++) {
  const page = await pdf.getPage(p);
  const content = await page.getTextContent();
  const items: Item[] = content.items
    .filter((it) => "str" in it)
    .map((it) => ({
      str: it.str,
      x: it.transform[4],
      y: it.transform[5],
      width: it.width,
      height: it.height,
      hasEOL: it.hasEOL,
    }));

  // A new visual line starts whenever the baseline moves by more than 2 points.
  const lines: Item[][] = [];
  for (const item of items) {
    const line = lines.at(-1);
    if (line && Math.abs(line.at(-1)!.y - item.y) <= 2) line.push(item);
    else lines.push([item]);
  }

  for (let i = 0; i < lines.length && matches < MAX_MATCHES; i++) {
    // Match within a line, or across a line break (the merged-words case).
    const here = squash(lines[i]!.map((it) => it.str).join(""));
    const withNext = here + squash((lines[i + 1] ?? []).map((it) => it.str).join(""));
    if (!here.includes(needle) && !(withNext.includes(needle) && !here.includes(needle) && i + 1 < lines.length)) continue;
    matches++;

    console.log(`--- match ${matches} (page ${p}) ---`);
    for (const line of lines.slice(Math.max(0, i - 1), i + 3)) {
      const prevLineY = line[0]!.y;
      console.log(`line y=${prevLineY.toFixed(1)}`);
      let prevEnd: number | undefined;
      for (const it of line) {
        const gap = prevEnd === undefined ? "" : `gap=${(it.x - prevEnd).toFixed(2)}`;
        console.log(
          `   ${JSON.stringify(it.str).padEnd(28)} x=${it.x.toFixed(1).padStart(6)} ${gap.padEnd(11)} w=${it.width.toFixed(1)} h=${it.height.toFixed(1)}${it.hasEOL ? "  [EOL]" : ""}`,
        );
        prevEnd = it.x + it.width;
      }
    }
    console.log();
    i += 2; // don't report the same spot twice
  }
}
if (matches === 0) console.log(`No line containing "${word}" found.\n`);
await pdf.destroy();

// ── 2. What pdf-parse produced for the same spot (before our cleanup) ────────────────
console.log(`=== 2. pdf-parse output around "${word}" ===`);
console.log("(JSON string: \\n = line break, \\t = cell gap)\n");
const parser = new PDFParse({ data: new Uint8Array(bytes) });
const { text } = await parser.getText({ pageJoiner: "" });
await parser.destroy();

const lower = text.toLowerCase();
const firstWord = word.toLowerCase().split(/\s+/)[0]!;
let shown = 0;
for (let at = lower.indexOf(firstWord); at !== -1 && shown < MAX_MATCHES; at = lower.indexOf(firstWord, at + 1)) {
  console.log(JSON.stringify(text.slice(Math.max(0, at - 60), at + word.length + 60)));
  shown++;
}
if (shown === 0) console.log(`"${firstWord}" not found in pdf-parse output.`);
