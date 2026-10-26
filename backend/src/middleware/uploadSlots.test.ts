// The upload slot cap: the slot manager on its own, then the middleware on a tiny Express
// app built like the real upload route (stub auth, the real rate limiters, the real multer
// middleware, a stub handler with the route's release logic, a fake pipeline), and the
// 30-minute backstop with mock timers. No database, no Gemini.
//
// The mechanism is tested with a per-user limit of 1 (below the server's 3), so the
// per-user and server-wide refusals can be told apart; the real limits are checked on
// their own.
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, describe, it, type TestContext } from "node:test";
import express from "express";
import { errorHandler } from "./errorHandler.ts";
import { uploadLimiters } from "./rateLimit.ts";
import { checkFileType, MAX_UPLOAD_BYTES, receiveUpload } from "./upload.ts";
import {
  claimUploadSlot,
  createUploadSlotMiddleware,
  createUploadSlots,
  MAX_UPLOADS_PER_SERVER,
  MAX_UPLOADS_PER_USER,
  SLOT_BACKSTOP_MS,
} from "./uploadSlots.ts";

const TEST_LIMITS = { perUser: 1, perServer: 3 };
const USER_BUSY = "You already have several uploads processing. Wait for one to finish, then try again.";
const SERVER_BUSY = "The server is busy with other uploads. Try again in a minute.";

describe("upload slot limits", () => {
  it("allows three per user and three across the server", () => {
    assert.equal(MAX_UPLOADS_PER_USER, 3);
    assert.equal(MAX_UPLOADS_PER_SERVER, 3);
    assert.equal(SLOT_BACKSTOP_MS, 30 * 60 * 1000);
  });

  it("lets one user's drop of three files through; a fourth upload from anyone is refused", () => {
    const slots = createUploadSlots(); // the real limits
    for (let i = 0; i < 3; i++) assert.ok(slots.tryAcquire("a").ok);
    assert.deepEqual(slots.tryAcquire("a"), { ok: false, reason: "user" });
    assert.deepEqual(slots.tryAcquire("b"), { ok: false, reason: "server" });
  });
});

describe("upload slot manager", () => {
  it("enforces the per-user limit and the server-wide limit", () => {
    const slots = createUploadSlots(TEST_LIMITS);

    const a = slots.tryAcquire("a");
    assert.ok(a.ok);
    assert.deepEqual(slots.tryAcquire("a"), { ok: false, reason: "user" });
    assert.ok(slots.tryAcquire("b").ok);
    assert.ok(slots.tryAcquire("c").ok);
    assert.deepEqual(slots.tryAcquire("d"), { ok: false, reason: "server" });
    assert.equal(slots.inUse(), 3);

    a.slot.release();
    assert.equal(slots.inUse("a"), 0);
    assert.ok(slots.tryAcquire("d").ok, "a released, so d fits");
  });

  it("frees a slot once however many times it is released", () => {
    const slots = createUploadSlots(TEST_LIMITS);
    const a = slots.tryAcquire("a");
    const b = slots.tryAcquire("b");
    assert.ok(a.ok && b.ok);

    a.slot.release();
    a.slot.release();
    a.slot.release();
    assert.equal(a.slot.released, true);
    assert.equal(slots.inUse(), 1, "b still holds its slot");
    assert.equal(slots.inUse("b"), 1);

    b.slot.release();
    b.slot.release();
    assert.equal(slots.inUse(), 0, "never below zero");
    // Repeated releases didn't leave spare capacity behind: still exactly three.
    assert.ok(slots.tryAcquire("x").ok && slots.tryAcquire("y").ok && slots.tryAcquire("z").ok);
    assert.deepEqual(slots.tryAcquire("w"), { ok: false, reason: "server" });
  });
});

describe("upload slot backstop", () => {
  // Captures console.warn for the test, so the backstop's log line can be checked.
  function captureWarnings(t: TestContext) {
    const warn = t.mock.method(console, "warn", () => {});
    return () => warn.mock.callCount();
  }

  it("frees a slot that ingestion never released, after 30 minutes", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const warnings = captureWarnings(t);
    const slots = createUploadSlots(TEST_LIMITS);
    const hung = slots.tryAcquire("a");
    assert.ok(hung.ok);

    t.mock.timers.tick(SLOT_BACKSTOP_MS - 1);
    assert.equal(slots.inUse("a"), 1, "still held just before the backstop");
    t.mock.timers.tick(1);
    assert.equal(slots.inUse("a"), 0);
    assert.equal(hung.slot.released, true);
    assert.equal(warnings(), 1, "the backstop logs that it fired");
    assert.ok(slots.tryAcquire("a").ok, "the user can upload again");

    // The hung ingestion finishing much later changes nothing.
    hung.slot.release();
    assert.equal(slots.inUse("a"), 1, "only the new slot is held");
  });

  it("clears the backstop timer on a normal release, so nothing fires later", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const warnings = captureWarnings(t);
    const setTimeoutSpy = t.mock.method(globalThis, "setTimeout");
    const clearTimeoutSpy = t.mock.method(globalThis, "clearTimeout");
    const slots = createUploadSlots(TEST_LIMITS);

    const a = slots.tryAcquire("a");
    assert.ok(a.ok);
    assert.equal(setTimeoutSpy.mock.callCount(), 1);
    a.slot.release();
    assert.equal(clearTimeoutSpy.mock.callCount(), 1);
    assert.equal(clearTimeoutSpy.mock.calls[0]!.arguments[0], setTimeoutSpy.mock.calls[0]!.result, "its own timer");

    t.mock.timers.tick(10 * 60 * 1000);
    const b = slots.tryAcquire("b"); // its backstop is due 10 minutes after a's would have been
    assert.ok(b.ok);
    t.mock.timers.tick(SLOT_BACKSTOP_MS - 10 * 60 * 1000); // when a's backstop was due
    assert.equal(slots.inUse("b"), 1, "b is not freed by a's old timer");
    assert.equal(slots.inUse(), 1);
    assert.equal(warnings(), 0);
  });

  it("does nothing if the backstop fires after a normal release", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const warnings = captureWarnings(t);
    t.mock.method(globalThis, "clearTimeout", () => {}); // keep the timer alive to force the race
    const slots = createUploadSlots(TEST_LIMITS);

    const a = slots.tryAcquire("a");
    assert.ok(a.ok);
    a.slot.release();
    t.mock.timers.tick(10 * 60 * 1000);
    const b = slots.tryAcquire("b");
    assert.ok(b.ok);

    t.mock.timers.tick(SLOT_BACKSTOP_MS - 10 * 60 * 1000); // a's backstop fires now
    assert.equal(slots.inUse(), 1, "not decremented a second time");
    assert.equal(slots.inUse("b"), 1);
    assert.equal(warnings(), 0, "nothing to report for an already-released slot");
  });
});

// ── The middleware in a route like the real one ──────────────────────────────────────────

const slots = createUploadSlots(TEST_LIMITS);
let multerCalls = 0;
let pipelineStarts = 0;
// Ingestions in progress, by filename: the test decides when each one finishes.
const ingestions = new Map<string, { finish: () => void }>();

const app = express();
app.use((req, _res, next) => {
  req.userId = req.get("x-test-user"); // stands in for requireAuth
  next();
});
app.post(
  "/upload",
  ...uploadLimiters,
  createUploadSlotMiddleware(slots),
  (_req, _res, next) => {
    multerCalls++;
    next();
  },
  receiveUpload,
  // The same slot handling as the real handler in routes/documents.ts; the database and
  // ingestDocument are replaced by fakes.
  async (req, res) => {
    const slot = claimUploadSlot(res);
    if (!slot) return;
    let ingesting = false;
    try {
      const file = req.file!;
      const check = checkFileType(file);
      if (!check.ok) {
        res.status(415).json({ error: check.error });
        return;
      }
      if (req.get("x-test-db") === "down") throw new Error("database unreachable"); // → 500

      res.status(202).json({ filename: file.originalname });
      ingesting = true;
      pipelineStarts++;
      // Like ingestDocument: never rejects, whether processing succeeds or fails.
      const done = new Promise<void>((resolve) => ingestions.set(file.originalname, { finish: resolve }));
      void done.finally(slot.release);
    } finally {
      if (!ingesting) slot.release();
    }
  },
);
app.use(errorHandler);

const server = app.listen(0);
after(() => server.close());
const port = (server.address() as AddressInfo).port;
const base = `http://127.0.0.1:${port}`;

async function upload(user: string, filename = `${user}.txt`, options: { field?: string; content?: string | Uint8Array<ArrayBuffer>; db?: "down" } = {}) {
  const form = new FormData();
  form.append(options.field ?? "file", new Blob([options.content ?? "Some plain text."]), filename);
  const headers: Record<string, string> = { "x-test-user": user };
  if (options.db) headers["x-test-db"] = options.db;
  const response = await fetch(`${base}/upload`, { method: "POST", body: form, headers });
  const body = (await response.json()) as { error?: string; code?: string; retryAfterSeconds?: number };
  return { status: response.status, body, retryAfter: response.headers.get("retry-after") };
}

// Releases on "close" happen just after the response; give them a moment.
async function eventually(check: () => boolean) {
  for (let i = 0; i < 50 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(check(), "condition never became true");
}

function finishIngestion(filename: string) {
  ingestions.get(filename)!.finish();
  ingestions.delete(filename);
}

describe("upload slot middleware", () => {
  it("holds a user's slot through ingestion and answers their second upload with 429", async () => {
    assert.equal((await upload("u1")).status, 202);
    assert.equal(slots.inUse("u1"), 1, "held after the 202, while ingestion runs");

    const multerBefore = multerCalls;
    const pipelineBefore = pipelineStarts;
    const second = await upload("u1", "u1-second.txt");
    assert.equal(second.status, 429);
    assert.equal(second.body.error, USER_BUSY);
    assert.equal(second.body.code, "upload_in_progress");
    assert.equal(second.retryAfter, "30");
    assert.equal(multerCalls, multerBefore, "a 429 never reaches multer");
    assert.equal(pipelineStarts, pipelineBefore, "or the pipeline");

    finishIngestion("u1.txt"); // the success path
    await eventually(() => slots.inUse("u1") === 0);
    assert.equal((await upload("u1", "u1-third.txt")).status, 202, "free again after ingestion");
    finishIngestion("u1-third.txt");
    await eventually(() => slots.inUse() === 0);
  });

  it("accepts other users until three are processing, then answers the fourth with the busy message", async () => {
    for (const user of ["s1", "s2", "s3"]) assert.equal((await upload(user)).status, 202);
    assert.equal(slots.inUse(), 3);

    const multerBefore = multerCalls;
    const fourth = await upload("s4");
    assert.equal(fourth.status, 429);
    assert.equal(fourth.body.error, SERVER_BUSY);
    assert.equal(fourth.body.code, "uploads_busy");
    assert.equal(fourth.retryAfter, "60");
    assert.equal(multerCalls, multerBefore, "rejected before the body is read");

    // A failed ingestion frees its slot just the same (ingestDocument resolves either way).
    finishIngestion("s2.txt");
    await eventually(() => slots.inUse() === 2);
    assert.equal((await upload("s4")).status, 202);

    for (const name of ["s1.txt", "s3.txt", "s4.txt"]) finishIngestion(name);
    await eventually(() => slots.inUse() === 0);
  });

  it("frees the slot when the request ends before ingestion starts", async () => {
    // multer rejects: wrong field name (400) and a file over the size limit (413)
    assert.equal((await upload("m1", "m1.txt", { field: "document" })).status, 400);
    await eventually(() => slots.inUse("m1") === 0);
    assert.equal((await upload("m2", "m2.txt", { content: new Uint8Array(MAX_UPLOAD_BYTES + 1) })).status, 413);
    await eventually(() => slots.inUse("m2") === 0);

    // the file check rejects (415), and the database fails (500)
    assert.equal((await upload("m3", "m3.exe")).status, 415);
    await eventually(() => slots.inUse("m3") === 0);
    const original = console.error;
    console.error = () => {}; // the error handler logs the simulated failure; keep test output clean
    let dbDown;
    try {
      dbDown = await upload("m4", "m4.txt", { db: "down" });
    } finally {
      console.error = original;
    }
    assert.equal(dbDown.status, 500);
    assert.equal(dbDown.body.error, "Internal server error");
    await eventually(() => slots.inUse("m4") === 0);

    assert.equal(slots.inUse(), 0);
  });

  it("frees the slot when the client disconnects mid-upload", async () => {
    const request = http.request({
      host: "127.0.0.1",
      port,
      method: "POST",
      path: "/upload",
      headers: { "x-test-user": "gone", "content-type": "multipart/form-data; boundary=XYZ", "content-length": "100000" },
    });
    request.on("error", () => {}); // we're about to destroy it
    request.write('--XYZ\r\nContent-Disposition: form-data; name="file"; filename="gone.txt"\r\n\r\npartial');
    await eventually(() => slots.inUse("gone") === 1); // the slot was taken, the body is still arriving
    request.destroy();
    await eventually(() => slots.inUse("gone") === 0);
    assert.equal(slots.inUse(), 0);
  });

  it("leaves the per-user rate limits as they were: the 11th upload in an hour is still refused", async () => {
    // Each upload finishes immediately (415), so the slot is never what stops them.
    for (let i = 0; i < 10; i++) assert.equal((await upload("rl", `rl-${i}.exe`)).status, 415);
    const eleventh = await upload("rl", "rl-10.txt");
    assert.equal(eleventh.status, 429);
    assert.equal(eleventh.body.error, "You've uploaded a lot of files in the last hour. Try again later.");
    assert.equal(eleventh.body.code, "rate_limited");
    assert.equal(slots.inUse(), 0);
  });
});
