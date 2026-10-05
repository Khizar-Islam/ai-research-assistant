// Loads backend/.env and validates every variable the app needs, once, at startup.
// If something is missing or malformed the process exits immediately with a clear
// message, instead of failing later on the first request that happens to use it.
// The rules themselves are in envSchema.ts.
import "dotenv/config";
import { parseEnv } from "./envSchema.ts";

const result = parseEnv(process.env);

if ("error" in result) {
  console.error("Invalid environment variables:\n" + result.error);
  process.exit(1);
}

export const env = result.env;
