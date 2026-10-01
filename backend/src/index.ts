import { createApp } from "./app.ts";
import { env } from "./config/env.ts";
import { prisma } from "./lib/prisma.ts";

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
});

// On Ctrl+C / platform shutdown: stop accepting requests, then close the DB pool,
// so connections to the Supabase pooler aren't left hanging.
function shutdown(signal: string) {
  console.log(`${signal} received, shutting down...`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
