// Display formatting shared by the dashboard components.
import type { DocumentFileType, IngestStage } from "./types";

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

// "3 Oct 2026, 10:06", in the viewer's own time zone.
export function formatUploadedAt(iso: string): string {
  return dateFormat.format(new Date(iso));
}

export const FILE_TYPE_LABEL: Record<DocumentFileType, string> = { pdf: "PDF", text: "Text" };

export const STAGE_LABEL: Record<IngestStage, string> = {
  extracting: "Extracting text",
  chunking: "Splitting into passages",
  embedding: "Embedding",
  saving: "Saving",
};

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
}
