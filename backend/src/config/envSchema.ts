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
    // this is config, not code. (gemini-3.5-flash itself is now auto-routed to 3.6-flash.)
    GEMINI_CHAT_MODEL: z
      .string()
      .trim()
      .regex(/^gemini-[\w.-]+$/, 'must be a Gemini model id like "gemini-3.5-flash-lite"')
      .default("gemini-3.5-flash-lite"),

    // Tried automatically when GEMINI_CHAT_MODEL stays unavailable (5xx, timeout) before
    // any answer text has reached the user; see services/generation.ts. Unset or blank →
    // the default. Setting it to the same id as GEMINI_CHAT_MODEL turns the fallback off.
    GEMINI_CHAT_FALLBACK_MODEL: z.preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
      z
        .string()
        .trim()
        .regex(/^gemini-[\w.-]+$/, 'must be a Gemini model id like "gemini-3.6-flash"')
        .default("gemini-3.6-flash"),
    ),

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

    // Number of proxies in front of the API, 0 to 5 (default 0 = trust proxy off). With
    // the right count, req.ip is the visitor's address, which the per-IP rate limit
    // counts on. A bad value falls back to 0 with a warning instead of stopping the server.
    TRUST_PROXY_HOPS: z
      .string()
      .optional()
      .transform((raw) => parseTrustProxyHops(raw).hops),
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

// "" or unset → 0. A whole number 0–5 (spaces allowed around it) → that number. Anything
// else → 0, plus a warning saying why.
export function parseTrustProxyHops(raw: string | undefined): { hops: number; warning?: string } {
  const value = raw?.trim() ?? "";
  if (value === "") return { hops: 0 };
  if (/^\d+$/.test(value) && Number(value) <= 5) return { hops: Number(value) };
  return {
    hops: 0,
    warning: `TRUST_PROXY_HOPS=${JSON.stringify(value.slice(0, 40))} is not a whole number from 0 to 5; using 0 (trust proxy off).`,
  };
}

// The validated environment, or a readable list of what's wrong (names and reasons only,
// never the values of secrets). `warnings` are problems worth logging that don't stop the
// server.
export function parseEnv(source: Record<string, string | undefined>): { env: Env; warnings: string[] } | { error: string } {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) return { error: z.prettifyError(parsed.error) };
  const { warning } = parseTrustProxyHops(source.TRUST_PROXY_HOPS);
  return { env: parsed.data, warnings: warning ? [warning] : [] };
}
