// One-off migration (Step 8): moves everything the old development stand-in user
// (dev@localhost, from before real sign-in existed) owns to a real account, then
// deletes the now-empty dev user.
//
//   npm run claim-dev-data -- --to you@gmail.com             # dry run: shows what would move
//   npm run claim-dev-data -- --to you@gmail.com --confirm   # does it
//
// Documents move with their chunks (chunks belong to documents, not users), and past
// questions move with their citations, so nothing is copied or re-embedded. All of it
// happens in one transaction: either everything moves, or nothing does.
import "dotenv/config";
import { parseArgs } from "node:util";
import pg from "pg";

const DEV_EMAIL = "dev@localhost";

const { values } = parseArgs({
  options: { to: { type: "string" }, confirm: { type: "boolean", default: false } },
});
if (!values.to) {
  console.error("Usage: npm run claim-dev-data -- --to <your sign-in email> [--confirm]");
  process.exit(1);
}
const targetEmail = values.to.trim().toLowerCase();

const db = new pg.Client({ connectionString: process.env.DIRECT_URL });
await db.connect();
try {
  const dev = (await db.query<{ id: string }>(`select id from "User" where email = $1`, [DEV_EMAIL])).rows[0];
  if (!dev) {
    console.log(`Nothing to do: there is no ${DEV_EMAIL} user (already claimed?).`);
    process.exit(0);
  }

  // The target must be a real person who has signed in with Google, so data can't be
  // moved to a mistyped address or to a development test identity.
  const target = (
    await db.query<{ id: string; email: string; name: string | null; google: boolean }>(
      `select u.id, u.email, u.name, exists (select 1 from "Account" a where a."userId" = u.id and a.provider = 'google') as google
       from "User" u where u.email = $1`,
      [targetEmail],
    )
  ).rows[0];
  if (!target) {
    console.error(`No user ${targetEmail}. Sign in with Google once first, so the account exists.`);
    process.exit(1);
  }
  if (!target.google) {
    console.error(`${targetEmail} hasn't signed in with Google; refusing to move data to it.`);
    process.exit(1);
  }

  const documents = (
    await db.query<{ filename: string; status: string; chunks: number }>(
      `select d.filename, d.status, (select count(*)::int from "Chunk" c where c."documentId" = d.id) chunks
       from "Document" d where d."userId" = $1 order by d."createdAt"`,
      [dev.id],
    )
  ).rows;
  const queries = (
    await db.query<{ id: string; question: string }>(`select id, question from "Query" where "userId" = $1 order by "createdAt"`, [dev.id])
  ).rows;
  const targetBefore = (
    await db.query<{ documents: number; queries: number }>(
      `select (select count(*)::int from "Document" where "userId" = $1) documents, (select count(*)::int from "Query" where "userId" = $1) queries`,
      [target.id],
    )
  ).rows[0]!;

  console.log(`${values.confirm ? "MOVING" : "DRY RUN"}: ${DEV_EMAIL} → ${target.email}${target.name ? ` (${target.name})` : ""}\n`);
  console.log(`Documents (${documents.length}), with their chunks:`);
  for (const d of documents) console.log(`  ${d.filename.padEnd(32)} ${d.status.padEnd(8)} ${d.chunks} chunk(s)`);
  console.log(`\nPast questions (${queries.length}):`);
  for (const q of queries) console.log(`  ${q.id.startsWith("fixture-") ? "[test fixture] " : ""}${q.question}`);
  console.log(`\n${target.email} owns ${targetBefore.documents} document(s) and ${targetBefore.queries} question(s) now.`);
  console.log(`Afterwards: ${targetBefore.documents + documents.length} document(s), ${targetBefore.queries + queries.length} question(s); ${DEV_EMAIL} deleted.`);

  if (!values.confirm) {
    console.log("\nNothing was changed. Run again with --confirm to do it.");
    process.exit(0);
  }

  await db.query("begin");
  const movedDocs = await db.query(`update "Document" set "userId" = $1 where "userId" = $2`, [target.id, dev.id]);
  const movedQueries = await db.query(`update "Query" set "userId" = $1 where "userId" = $2`, [target.id, dev.id]);
  // Empty now; deleting it can't cascade into anything (that's checked, not assumed).
  const left = (
    await db.query<{ n: number }>(
      `select (select count(*)::int from "Document" where "userId" = $1) + (select count(*)::int from "Query" where "userId" = $1) n`,
      [dev.id],
    )
  ).rows[0]!.n;
  if (left !== 0) throw new Error(`${DEV_EMAIL} still owns ${left} row(s) after the move; rolling back.`);
  await db.query(`delete from "User" where id = $1`, [dev.id]);
  await db.query("commit");
  console.log(`\nDone: moved ${movedDocs.rowCount} document(s) and ${movedQueries.rowCount} question(s); deleted ${DEV_EMAIL}.`);
} catch (error) {
  await db.query("rollback").catch(() => {});
  console.error("Failed; nothing was changed:", error);
  process.exitCode = 1;
} finally {
  await db.end();
}
