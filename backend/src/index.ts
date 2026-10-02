import { createApp } from "./app.ts";
import { env } from "./config/env.ts";
import { prisma } from "./lib/prisma.ts";
import { failInterruptedDocuments } from "./services/ingest/pipeline.ts";

const app = createApp();

// Express 5 calls this callback on failure too (e.g. EADDRINUSE when another server already
// has the port), passing the error. Without the check it would log "listening" and then
// exit silently with code 0.
const server = app.listen(env.PORT, (error?: Error) => {
  if (error) {
    console.error(`Could not start the API on port ${env.PORT}: ${error.message}`);
    process.exit(1);
  }
  console.log(`API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
});

// Documents left on "processing" by a previous run that died mid-upload. Not fatal if it
// fails (e.g. database briefly unreachable); it runs again on the next start.
failInterruptedDocuments()
  .then((count) => {
    if (count > 0) console.log(`[ingest] marked ${count} interrupted document(s) as failed`);
  })
  .catch((error) => console.error("[ingest] startup sweep failed:", error));

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
