// The single PrismaClient the whole backend shares.
//
// Prisma 7 no longer opens database connections itself — it hands queries to a
// "driver adapter". PrismaPg wraps a node-postgres (`pg`) connection pool pointed at
// DATABASE_URL, the Supabase transaction pooler on port 6543.
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "../config/env.ts";
import { PrismaClient } from "../generated/prisma/client.ts";

const adapter = new PrismaPg(
  {
    connectionString: env.DATABASE_URL,
    // pg closes connections idle for 10 s by default, and opening a new TLS connection to
    // the Supabase pooler costs ~450–950 ms vs ~90 ms for a query on an open one. Keep
    // idle connections for 5 minutes so normal use (a question every so often) stays fast.
    idleTimeoutMillis: 5 * 60_000,
    // TCP keepalive so a connection silently dropped by the network is noticed, not reused.
    keepAlive: true,
  },
  {
    // If the pooler closes an idle connection first, pg drops it from the pool and the next
    // query opens a new one. Harmless, but worth a line in the log.
    onPoolError: (error) => console.warn(`[db] idle connection closed: ${error.message}`),
  },
);

export const prisma = new PrismaClient({
  adapter,
  log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});
