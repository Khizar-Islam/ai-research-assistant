# CLAUDE.md — AI Research Assistant (RAG)

This file lives in the root of the project folder. Claude Code reads it automatically every time you open this project in the terminal — you never need to paste it in or remind it. It covers everything the coding agent needs: how you want to work, the full technical blueprint, the database schema, the RAG pipeline, and how to use the Supabase MCP server.

There is a **separate document** — `ai-research-assistant-claude-chat-handoff.md` — meant to be uploaded into a normal Claude.ai chat (not Claude Code). That one is for things Claude Code cannot do from the terminal: creating the Supabase project itself, clicking through dashboards, debugging a live deployment, walking through OAuth screens, etc. The two documents are used **at the same time**, for two different tools. This one does not replace that one.

---

## How To Work With Me

- I am a 3rd-year Software Engineering student building this as a portfolio project to show employers. I am not a beginner, but I want everything explained clearly — don't assume I know a library just because I've used something similar before.
- Work in small steps. Build one piece, tell me it's done and what it does, then move to the next piece. Don't dump 15 files at once.
- Before running a destructive command (deleting a migration, dropping a table, overwriting a file with real work in it), tell me what it does and ask first.
- If something is ambiguous or you're making a judgment call (e.g. picking a chunk size, picking a UI layout), just make the call and tell me what you chose and why — don't stop and ask me unless it's something I'd actually have an opinion on.
- When you hit an error, don't just paste the fix — tell me in one line what actually went wrong, so I understand it and not just copy-paste my way through this.
- Keep the "AI slop" design traps out of this project entirely (see Visual Design Direction below). I will call it out if I see them.

---

## Core Concept

An AI Research Assistant that lets a user upload documents (PDFs, text files, maybe URLs later) and then ask natural-language questions about them. The app finds the most relevant chunks of the uploaded documents using vector similarity search, feeds those chunks to Gemini as context, and returns an answer **with citations** pointing back to which document/section the answer came from.

This is a real RAG (Retrieval-Augmented Generation) system, not a toy — real embeddings, real vector search, real citation tracking.

---

## Tech Stack

- **Frontend**: Next.js (App Router, TypeScript), Tailwind CSS v4, Framer Motion
- **Backend**: Node.js + Express (same pattern as the Interview Prep backend)
- **Database**: Supabase Postgres (with the `pgvector` extension enabled)
- **ORM**: Prisma — used for everything except the vector similarity query itself, which needs raw SQL (Prisma doesn't support the vector type natively)
- **AI**: Google Gemini — `gemini-embedding-2` for embeddings, and a Gemini chat model (check current availability — we hit deprecation issues on the last project, don't assume the model name in this doc is still live) for generating the final answer
- **File parsing**: `pdf-parse` for PDFs to start with, plain text handled directly
- **Auth**: NextAuth.js with Google OAuth (same pattern as Interview Prep)

---

## Supabase MCP Server

I have the Supabase MCP server connected in this Claude Code session, which means you can directly:
- Inspect the current database schema
- Run SQL against the database
- Apply migrations
- Enable Postgres extensions (specifically `pgvector`, which this project needs)
- Generate TypeScript types from the schema

Use it instead of asking me to go paste SQL into the Supabase dashboard manually. That's the whole point of it being connected.

**Important safety rule**: the MCP server connects using a key that bypasses Row Level Security. This is fine because this is a development project with no real user data in it, but never use this connection method against a production database with real users. If this project ever goes to production, the production database access should go through properly scoped keys, not the MCP connection.

First things to do with it when we start:
1. Confirm connection to the right Supabase project.
2. Run `CREATE EXTENSION IF NOT EXISTS vector;` to enable pgvector.
3. Confirm it's enabled before writing the schema.

---

## Database Schema (Prisma)

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        String   @id @default(uuid())
  email     String   @unique
  name      String?
  image     String?
  createdAt DateTime @default(now())

  documents Document[]
  queries   Query[]

  // NextAuth required relations
  accounts Account[]
  sessions Session[]
}

model Document {
  id         String   @id @default(uuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  filename   String
  fileType   String   // "pdf" | "text" | "url"
  status     String   @default("processing") // "processing" | "ready" | "failed"
  createdAt  DateTime @default(now())

  chunks Chunk[]
}

model Chunk {
  id         String                 @id @default(uuid())
  documentId String
  document   Document               @relation(fields: [documentId], references: [id], onDelete: Cascade)
  content    String                 // the actual text of this chunk
  chunkIndex Int                    // order within the document
  embedding  Unsupported("vector(768)") // pgvector column — Prisma can't type this natively
  createdAt  DateTime               @default(now())

  @@index([documentId])
}

model Query {
  id         String   @id @default(uuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  question   String
  answer     String
  citations  Json     // array of {documentId, filename, chunkContent snippet}
  createdAt  DateTime @default(now())
}

// ── NextAuth required models — do not rename these, the adapter expects these exact names ──
model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String? @db.Text
  access_token      String? @db.Text
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String? @db.Text
  session_state     String?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
}
```

**Gotcha carried over from the Interview Prep project**: NextAuth's Prisma adapter hardcodes the model name `Session`. Since this project doesn't have its own separate "session" concept (unlike Interview Prep, which had interview sessions), there's no naming collision here — `Session` can stay as-is. Just don't accidentally create another model called `Session` for something else later without renaming it.

**Why `embedding` is `Unsupported("vector(768)")`**: Prisma has no native vector type. This tells Prisma "this column exists, don't try to manage it directly." The column will still be created by the migration (you may need to tweak the generated migration SQL directly to add `vector(768)` as the type — Prisma migrate sometimes needs a manual nudge for `Unsupported` fields). Reads/writes to this specific column happen through raw SQL (`prisma.$queryRaw` / `prisma.$executeRaw`), not the normal Prisma client methods.

---

## API Routes

**Documents**
- `POST /api/documents/upload` — accepts a file, saves a `Document` row (status: "processing"), triggers the extraction → chunking → embedding pipeline, updates status to "ready" or "failed" when done
- `GET /api/documents` — list the current user's documents
- `DELETE /api/documents/:id` — deletes a document and cascades to its chunks

**Query**
- `POST /api/query` — takes `{ question: string }`, runs the full RAG pipeline (embed the question → vector search → build context → ask Gemini → return answer + citations), saves a `Query` row
- `GET /api/queries` — list past queries for the current user (like a history)

---

## The RAG Pipeline

This is the core of the project. Four steps:

**1. Extraction** — when a file is uploaded, pull the raw text out of it (`pdf-parse` for PDFs, direct read for `.txt`).

**2. Chunking** — split the raw text into overlapping chunks. Don't just split by character count blindly; split on paragraph/sentence boundaries where possible so chunks don't cut off mid-sentence. Target roughly 500–800 tokens per chunk with 50–100 tokens of overlap between consecutive chunks, so context isn't lost at chunk boundaries. Store each chunk with its `chunkIndex` so order is preserved.

**3. Embedding** — for each chunk, call the Gemini embedding model (`gemini-embedding-2`, 768 output dimensions to match the schema) and store the resulting vector in the `embedding` column via raw SQL, since Prisma can't write to an `Unsupported` field with its normal `.create()`/`.update()` methods:

```js
await prisma.$executeRaw`
  UPDATE "Chunk"
  SET embedding = ${embeddingVector}::vector
  WHERE id = ${chunkId}
`;
```

**4. Query time (retrieval + generation)**:
- Embed the user's question the same way chunks were embedded.
- Run a cosine similarity search against all chunks belonging to that user's documents, ordered by closeness, limited to the top N (start with top 5):

```js
const results = await prisma.$queryRaw`
  SELECT c.id, c.content, c."documentId", d.filename,
         1 - (c.embedding <=> ${questionEmbedding}::vector) AS similarity
  FROM "Chunk" c
  JOIN "Document" d ON d.id = c."documentId"
  WHERE d."userId" = ${userId}
  ORDER BY c.embedding <=> ${questionEmbedding}::vector
  LIMIT 5
`;
```
  (`<=>` is the pgvector cosine distance operator — smaller means more similar, hence `1 - distance` to get a similarity score.)
- Build a prompt for Gemini that includes the retrieved chunks as context, with clear instructions to answer only from the provided context and to cite which chunk(s) it used.
- Return the answer plus a `citations` array mapping back to source documents, so the frontend can show "this came from document X".

---

## Frontend Page Structure

- `/` — landing page explaining what the tool does, sign-in
- `/dashboard` — list of uploaded documents, upload button, processing status per document
- `/chat` — the actual Q&A interface: question input, streaming or non-streaming answer, citations shown as clickable references under the answer

---

## Animation Details

Keep animation purposeful, not decorative:
- Document upload: show a real progress indicator through the actual pipeline stages (extracting → chunking → embedding → ready), not a fake spinner. This is genuinely more interesting than most loading states because there ARE real distinct stages happening.
- Chat answers: stream the answer in token-by-token if you can (matches the "AI thinking" feel from Interview Prep's SSE work), citations fade/slide in after the answer text completes.
- Citation references: hovering over a citation marker in the answer text should highlight the exact source chunk somewhere on screen — this is a nice, function-driven interaction, not just an effect for its own sake.

---

## Visual Design Direction

Same rule as every other project: no "AI slop." Specifically avoid:
- Purple-to-blue gradients
- Glowing borders / neon accent lines
- Glassmorphism (frosted blur panels)
- Floating blurred orbs in the background
- Generic "icon in a circle" feature blocks

Instead: pick a real palette and a real type pairing, and let the one signature visual idea be tied to what this product actually does — e.g. a visual language around "documents → chunks → connections" (think: a subtle chunk/graph motif, or a citation-thread visual) rather than generic AI-startup aesthetics.

---

## Build Order

1. Backend scaffold (Express, Prisma schema, Supabase connection) — use the MCP server to enable pgvector and confirm the schema is live.
2. Document upload + extraction + chunking (no embeddings yet — just confirm chunks are being created and stored correctly).
3. Embedding pipeline — wire up Gemini embeddings, store vectors, confirm via a raw SQL query that they're populated.
4. Vector search + basic query endpoint (no UI yet — test via Thunder Client like we did with Interview Prep).
5. Gemini answer generation with citations, wired to the query endpoint.
6. Frontend: dashboard + upload UI.
7. Frontend: chat interface.
8. Auth (NextAuth + Google, same pattern as Interview Prep).
9. Animation pass.
10. Deployment (this happens with help from the separate Claude.ai chat doc, not from here).

---

## Scope Notes

- Start with PDF and plain text only. URL scraping as a document source is a nice-to-have to add later if there's time, not part of the first working version.
- Don't build multi-document "compare these two documents" features until basic single-corpus Q&A is solid.
- Citation accuracy matters more than answer length — if the retrieved chunks don't actually contain the answer, the model should say it doesn't know rather than hallucinate, and the prompt should say this explicitly.
