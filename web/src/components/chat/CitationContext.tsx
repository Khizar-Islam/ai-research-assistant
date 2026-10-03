"use client";

// Shared by an answer's markers and its footnotes: which citation is being pointed at
// (hover or keyboard focus), so the marker and its footnote light up together, and how
// to open a citation's passage in the passages panel.
import { createContext, useContext } from "react";
import type { EntryCitation } from "./types";

export type CitationContextValue = {
  active: string | null; // citationKey() of the citation being pointed at
  setActive: (key: string | null) => void;
  // Opens the cited passage in the passages panel; `trigger` gets focus back when the
  // panel closes. Only offered where canOpen() says the document is there to open (not
  // deleted, and in the loaded document list).
  openPassage: (citation: EntryCitation, trigger: HTMLElement) => void;
  canOpen: (citation: EntryCitation) => boolean;
};

export const citationKey = (entryId: string, marker: number) => `${entryId}:${marker}`;

const noop: CitationContextValue = { active: null, setActive: () => {}, openPassage: () => {}, canOpen: () => false };

export const CitationContext = createContext<CitationContextValue>(noop);

export const useCitations = () => useContext(CitationContext);
