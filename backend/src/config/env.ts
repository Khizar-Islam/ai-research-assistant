// Loads backend/.env and validates every variable the app needs, once, at startup.
// If something is missing or malformed the process exits immediately with a clear
// message, instead of failing later on the first request that happens to use it.
import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),

  // Supabase transaction pooler (port 6543), used by the running app.
  // DIRECT_URL (session pooler) is only for the Prisma CLI, so it isn't validated here.
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, "must be a postgresql:// connection string"),

  // Google AI Studio key for Gemini (embeddings now, answer generation in Step 5).
  // Only checked for presence/shape; a wrong key shows up as a 400/403 on the first call.
  GEMINI_API_KEY: z
    .string()
    .trim()
    .min(30, "looks too short to be a Gemini API key")
    .regex(/^\S+$/, "must not contain spaces"),

  // Model that writes answers (Step 5). Chosen by a live comparison: same answer quality
  // as gemini-3.5-flash in testing, ~10x faster (~0.9 s). Gemini models get retired, so
  // this is config, not code: switch to "gemini-3.5-flash" here if flash-lite is ever
  // unavailable or struggles with harder questions.
  GEMINI_CHAT_MODEL: z
    .string()
    .trim()
    .regex(/^gemini-[\w.-]+$/, 'must be a Gemini model id like "gemini-3.5-flash-lite"')
    .default("gemini-3.5-flash-lite"),

  // Verifies the short-lived API tokens the Next.js app signs for signed-in users (see
  // middleware/requireAuth.ts). Shared with web/.env.local. 32+ characters: HS256 is only
  // as strong as its secret.
  API_JWT_SECRET: z.string().min(32, "must be at least 32 characters (generate a random one)"),

  // Comma-separated list of origins allowed to call the API (the Next.js frontend).
  CORS_ORIGIN: z
    .string()
    .default("http://localhost:3000")
    .transform((value) => value.split(",").map((origin) => origin.trim())),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  // prettifyError lists which variables failed and why — it never prints their values.
  console.error("Invalid environment variables:\n" + z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
