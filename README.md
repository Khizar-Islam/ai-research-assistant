# Footnote

Upload your own PDFs and text files, ask questions in plain language, and get answers where every claim points back to the passage it came from. If your documents don't contain the answer, it says so instead of guessing.

**Live demo:** https://ai-research-assistant-lac-two.vercel.app

> Sign-in is limited to approved Google accounts while the app is in testing mode. To try it, email khizarislamrathore@gmail.com with your Gmail address and I'll add you. The API runs on a free host, so the first load after a quiet period can take up to a minute.

<!-- Add 2-3 screenshots here (docs/ folder): dashboard with the chunk strip, a chat answer with footnotes, the passages panel -->

## What it does

- **Upload** PDF, TXT or Markdown files (up to 10 MB). Each file is extracted, split into passages, embedded and stored.
- **Live progress** while a file is processed: extract, chunk, embed, save, with the real number of passages embedded so far.
- **Ask** a question and watch the answer stream in. Footnote markers in the text link to the exact passages used.
- **Check the source** by opening a citation: the passages panel jumps to the cited passage.
- **Honest refusals.** Questions the documents can't answer get a clear "not found" note, not an invented answer.
- **Voice.** Dictate a question with the mic button and have an answer read aloud, using the browser's built-in speech support (Chrome and Edge for dictation).
- **History** of past questions, including answers whose source document has since been deleted.

## How it works

1. **Ingestion.** Text is extracted (PDF line-wraps and hyphenation are repaired), then split on paragraph and sentence boundaries into chunks of about 600 tokens with about 80 tokens of overlap.
2. **Embedding.** Each chunk is embedded with Gemini (`gemini-embedding-2`, 768 dimensions) and stored in Postgres with pgvector.
3. **Retrieval.** The question is embedded the same way. A cosine-similarity search runs over the signed-in user's chunks only.
4. **Answering.** Passages above a relevance threshold go to a Gemini chat model with instructions to answer only from them and cite each claim as `[n]`. Citations are checked after generation: markers pointing at passages that weren't supplied are removed, and an answer with no valid citation is treated as "don't know".
5. **Streaming.** The answer is sent over server-sent events: search stage, sources, text pieces, then the checked final answer.

## Design decisions

- **Prompt-injection resistance.** Uploaded documents are untrusted. They are passed to the model as delimited data, tag look-alikes inside them are neutralised, and the answer is validated structurally afterwards.
- **User isolation.** Every query is scoped to the signed-in user. Tests cover another user's documents, chunks and history never appearing.
- **Auth across two hosts.** NextAuth (Google) runs on the web app. It mints a short-lived signed token that the Express API verifies independently, so uploads and streams go straight from the browser to the API without a proxy.
- **Honest progress.** Upload progress comes from the pipeline's real stages, not a fake spinner.
- **Landing demo.** The "How it works" figure on the home page replays the real stages (ask, retrieve, answer with footnotes) in a loop.
- **Reduced motion.** Movement and looping animation are removed for users who ask for it.
- **Database safety.** Row Level Security is enabled on every table, and migrations are managed with Prisma.

## Tech stack

| Layer | Tools |
|---|---|
| Frontend | Next.js (App Router), TypeScript, Tailwind CSS, motion, TanStack Query |
| Auth | NextAuth v5 with Google OAuth |
| Backend | Node.js, Express, TypeScript, Zod |
| Database | Supabase Postgres with pgvector, Prisma |
| AI | Gemini embeddings and Gemini chat model |
| Hosting | Vercel (web), Render (API), Supabase (database) |

## Project layout

```
backend/   Express API: ingestion, embeddings, search, answering, auth
web/       Next.js app: landing page, dashboard, chat
DEPLOY.md  Deployment runbook
```

## Run it locally

1. Create a Supabase project and enable the `vector` extension.
2. In `backend/`, copy `.env.example` to `.env`, fill it in, then run `npm install`, `npm run db:deploy` and `npm run dev`.
3. In `web/`, copy `.env.example` to `.env.local`, fill it in, then run `npm install` and `npm run dev`.
4. Open http://localhost:3000.

See `DEPLOY.md` for the production setup.

## Known limits

- Free-tier Gemini quotas cap how many documents can be embedded per day.
- Scanned PDFs without a text layer are rejected (no OCR).
- Each question is answered on its own, with no memory of earlier questions.

## Author

Khizar Islam Rathore, Software Engineering student at the University of Karachi.
GitHub: github.com/Khizar-Islam | LinkedIn: linkedin.com/in/khizar-islam-rathore
