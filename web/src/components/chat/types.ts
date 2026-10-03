import type { Citation, RetrievalInfo } from "@/lib/types";

// A citation as the transcript shows it. Live answers don't carry `available` (their
// sources exist by definition); history marks deleted ones false.
export type EntryCitation = Citation & { available?: boolean };

// One question and its answer, from history or from a live answer.
export type TranscriptEntry = {
  id: string;
  question: string;
  answer: string;
  answered: boolean;
  citations: EntryCitation[];
  createdAt: string;
  truncated?: boolean;
  retrieval?: RetrievalInfo; // live answers only: why a question went unanswered
};
