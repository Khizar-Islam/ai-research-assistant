# Deploying Footnote

The API (`backend/`) runs on **Render**, the web app (`web/`) on **Vercel**, and the data
lives in **Supabase** Postgres with pgvector (`ap-southeast-1`). All three on free plans.

```
Browser ──► Vercel   web/      pages, Google sign-in (NextAuth), /api/token mints API tokens
   └──────► Render   backend/  Express API: uploads, search, streamed answers ──► Supabase, Gemini
```

Only the browser calls the API, so CORS on Render allows exactly the Vercel domain.
Uploads go straight to Render (Vercel's request-size limits don't apply).

## Environment variables

Names only; values live in each dashboard, never in git. Generate secrets with
`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`, and use
fresh ones for production, not your local values.

**Render (backend)**

| Name | Value |
|---|---|
| `NODE_ENV` | `production`. Required: on Render the API refuses to start without it. |
| `DATABASE_URL` | Supabase transaction pooler (port 6543) |
| `DIRECT_URL` | Supabase session pooler (port 5432). Needed at **build** time: `prisma generate` fails without it. |
| `GEMINI_API_KEY` | Google AI Studio key |
| `API_JWT_SECRET` | Same value as on Vercel |
| `CORS_ORIGIN` | The Vercel URL: `https://…`, no path, no trailing slash |
| `GEMINI_CHAT_MODEL` | Optional (defaults to `gemini-3.5-flash-lite`) |

Don't set `PORT`: Render provides it.

**Vercel (web)**

| Name | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | The Render URL. Baked in at build time: set it before building, redeploy after changing it. |
| `AUTH_SECRET` | Encrypts the session cookie |
| `API_JWT_SECRET` | Same value as on Render |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | The Google OAuth client |

Never set `AUTH_DEV_LOGIN` on Vercel: a production build that sees it refuses to start.

## First deploy (in this order: each step needs a URL from the one before)

1. **Supabase.** Copy both connection strings (Project Settings → Database). Check the
   migrations are applied: `cd backend && npm run db:status`.
2. **Render.** New → Web Service → this repo.
   - Root Directory `backend` · Runtime Node · Region **Singapore** (next to Supabase) · Free
   - Build: `npm ci --include=dev && npm run build`
     (`--include=dev` because `prisma` and `typescript` are devDependencies and npm skips
     those when `NODE_ENV=production`)
   - Start: `npm start` · Health check path: `/api/health`
   - Environment: the Render table, with `CORS_ORIGIN` as a placeholder for now
     (`https://placeholder.example`).
   - Deploy, then open `https://<service>.onrender.com/api/health`: expect
     `"status":"ok"` and a `pgvector` version.
3. **Vercel.** Add New → Project → this repo.
   - Root Directory **`web`** · Framework Next.js · Node 22.x
   - Environment: the Vercel table. Deploy and note the production URL.
4. **Render again.** Set `CORS_ORIGIN` to the Vercel URL; it redeploys.
5. **Google Cloud Console** → Credentials → the OAuth client (keep the localhost entries):
   - Authorized JavaScript origin: `https://<project>.vercel.app`
   - Authorized redirect URI: `https://<project>.vercel.app/api/auth/callback/google`
   - OAuth consent screen stays in **Testing**: only listed test users can sign in. Add
     anyone who should try the app (e.g. a recruiter's Google address) under Test users.
6. **Smoke test** on the Vercel URL: sign-in offers only Google (no Dev Tester); sign in;
   upload a small `.txt`, watch it reach Ready; ask a question, check the citations.

## Later deploys

- Pushing to `master` redeploys both (Render auto-deploy, Vercel Git integration).
- **Schema changes:** Render's free plan has no pre-deploy step, so migrations are run by
  hand, before pushing code that needs them: `cd backend && npm run db:deploy`.

## Free-plan behaviour

- **Render sleeps** after ~15 minutes without requests; the next request takes up to a
  minute. The web app shows "Waking the server up…" meanwhile. 512 MB of memory: very
  large PDFs may fail. A redeploy or sleep stops any document mid-processing; it is marked
  failed on the next start and can be uploaded again.
- **Supabase pauses** a project after ~7 days of no activity. `/api/health` then returns
  503; resume it from the Supabase dashboard.
- **Gemini free tier** has per-minute and per-day limits, and Google may use free-tier
  inputs (uploaded documents included) to improve its products.
- **Google sign-in only works on the production domain**, not on Vercel preview URLs.

## When something's wrong

| Symptom | Likely cause |
|---|---|
| Render build fails in `postinstall` / `prisma generate` | `DIRECT_URL` not set on Render, or the build command lacks `--include=dev` |
| Render log: `must be "production" on Render … → at NODE_ENV` | Set `NODE_ENV=production` |
| Render log: `… (no path or trailing slash) → at CORS_ORIGIN` | Remove the trailing `/` (or the path) |
| Browser console: CORS error | `CORS_ORIGIN` doesn't exactly match the Vercel URL |
| "Can't reach the server at …" | `NEXT_PUBLIC_API_URL` wrong, or set after the build: redeploy Vercel |
| "The server didn't accept your sign-in" | `API_JWT_SECRET` differs between Render and Vercel |
| Google: `redirect_uri_mismatch` | Redirect URI in Google Cloud doesn't match the Vercel URL exactly |
| Google: "access blocked" / not allowed | The account isn't a test user (consent screen in Testing) |
| `/api/health` 503 | Supabase project paused, or a wrong `DATABASE_URL` |
