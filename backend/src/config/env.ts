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
