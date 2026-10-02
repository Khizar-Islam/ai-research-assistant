// The single Gemini client the whole backend shares (same idea as lib/prisma.ts).
// For the REST calls we make (embeddings, generation) the SDK sends the key in the
// `x-goog-api-key` header, not the URL, so it doesn't end up in error messages or logs.
import { GoogleGenAI } from "@google/genai";
import { env } from "../config/env.ts";

export const gemini = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
