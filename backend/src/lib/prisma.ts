// The single PrismaClient the whole backend shares.
//
// Prisma 7 no longer opens database connections itself — it hands queries to a
// "driver adapter". PrismaPg wraps a node-postgres (`pg`) connection pool pointed at
// DATABASE_URL, the Supabase transaction pooler on port 6543.
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "../config/env.ts";
import { PrismaClient } from "../generated/prisma/client.ts";

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

export const prisma = new PrismaClient({
  adapter,
  log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});
