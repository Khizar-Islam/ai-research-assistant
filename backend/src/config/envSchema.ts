// The rules for the backend's environment variables. Pure (no .env loading, no exiting),
// so the production guards can be tested; config/env.ts applies them at startup.
import { z } from "zod";

const LOCAL_WEB_ORIGIN = "http://localhost:3000";

const EnvSchema = z
  .object({
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
    // Locally it defaults to the dev server; in production it must be set (see below).
    CORS_ORIGIN: z.string().optional(),

    // Set by Render itself on its servers; never set by hand. Only used to tell "running
    // on Render" apart from "running on a laptop".
    RENDER: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    const production = env.NODE_ENV === "production";

    // NODE_ENV defaults to "development", and development is what lets the API accept the
    // dev sign-in's identities (middleware/auth.ts). Forgetting NODE_ENV on the real server
    // must therefore stop the server, not quietly allow sign-in without a password.
    if (env.RENDER && !production) {
      ctx.addIssue({
        code: "custom",
        path: ["NODE_ENV"],
        message: 'must be "production" on Render (it defaults to development, which allows the dev sign-in)',
      });
    }

    if (production && !env.CORS_ORIGIN?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["CORS_ORIGIN"],
        message: "is required in production: the web app's URL, e.g. https://your-app.vercel.app",
      });
      return;
    }

    for (const origin of splitOrigins(env.CORS_ORIGIN)) {
      const problem = originProblem(origin, production);
      if (problem) ctx.addIssue({ code: "custom", path: ["CORS_ORIGIN"], message: problem });
    }
  })
  .transform(({ RENDER: _render, CORS_ORIGIN, ...env }) => ({ ...env, CORS_ORIGIN: splitOrigins(CORS_ORIGIN) }));

export type Env = z.output<typeof EnvSchema>;

function splitOrigins(value: string | undefined): string[] {
  if (!value?.trim()) return [LOCAL_WEB_ORIGIN];
  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

// The browser's Origin header is exactly scheme://host[:port]: no path, no trailing slash.
// An allowed origin written any other way never matches, and CORS fails only in production.
function originProblem(origin: string, production: boolean): string | null {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return `"${origin}" is not a URL`;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return `"${origin}" must start with https://`;
  if (url.origin !== origin) return `"${origin}" must be just the origin, like ${url.origin} (no path or trailing slash)`;
  if (production && url.protocol !== "https:") return `"${origin}" must use https:// in production`;
  return null;
}

// The validated environment, or a readable list of what's wrong (names and reasons only,
// never the values of secrets).
export function parseEnv(source: Record<string, string | undefined>): { env: Env } | { error: string } {
  const parsed = EnvSchema.safeParse(source);
  return parsed.success ? { env: parsed.data } : { error: z.prettifyError(parsed.error) };
}
