import Link from "next/link";
import { auth } from "@/auth";
import { PipelineFigure } from "@/components/landing/PipelineFigure";
import { PRODUCT_NAME } from "@/lib/config";

// The real pipeline, in the backend's real numbers (chunk.ts, embeddings.ts, answering.ts).
const STEPS = [
  {
    number: "01",
    title: "Extract",
    body: "Text is pulled out of each PDF or text file. A scanned PDF with no text layer is turned away with a reason, never indexed empty.",
  },
  {
    number: "02",
    title: "Chunk",
    body: "The text is split on paragraph and sentence boundaries into passages of about 600 tokens, each overlapping the last by about 80, so no fact is cut in half.",
  },
  {
    number: "03",
    title: "Embed",
    body: "Every passage becomes a 768-dimension vector from Gemini’s gemini-embedding-2, stored in Postgres with pgvector.",
  },
  {
    number: "04",
    title: "Retrieve & answer",
    body: "Your question is embedded the same way. The closest passages by cosine similarity are filtered for relevance, and the answer is written from at most five of them, citing each.",
  },
];

export default async function Home() {
  const signedIn = Boolean((await auth())?.user);

  return (
    <main className="mx-auto max-w-5xl px-5 sm:px-8">
      <section className="grid items-center gap-12 py-16 sm:py-24 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
        <div>
          <p className="font-mono text-xs tracking-wide text-ink-soft uppercase">Research assistant for your own files</p>
          <h1 className="mt-5 font-serif text-5xl leading-[1.05] tracking-tight sm:text-6xl">
            Ask your documents.
            <br />
            <em>Every answer cites its source.</em>
            <sup className="ml-1 font-mono text-lg text-mark not-italic">1</sup>
          </h1>
          <p className="mt-6 max-w-[34rem] text-lg leading-relaxed text-ink-soft">
            Upload PDFs and text files. {PRODUCT_NAME} finds the passages that bear on your question and answers
            only from those, with a footnote on every claim pointing back to where it came from. If your documents
            don’t say, it tells you so instead of guessing.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-3">
            <Link
              href={signedIn ? "/dashboard" : "/signin?callbackUrl=%2Fdashboard"}
              className="press inline-block bg-ink px-5 py-3 text-sm font-medium text-paper hover:bg-mark"
            >
              {signedIn ? "Open your documents" : "Sign in to start"} <span aria-hidden="true">→</span>
            </Link>
            <p className="font-mono text-xs text-ink-soft">.pdf · .txt · .md, up to 10 MB</p>
          </div>
        </div>

        <PipelineFigure />
      </section>

      <section aria-labelledby="how-heading" className="border-t border-ink pt-8 pb-20">
        <h2 id="how-heading" className="font-serif text-2xl">
          How it works
        </h2>
        <ol className="mt-8 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step) => (
            <li key={step.number} className="border-t border-rule pt-4">
              <p className="font-mono text-xs text-mark">{step.number}</p>
              <h3 className="mt-2 font-serif text-xl">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <footer className="border-t border-rule py-6 font-mono text-[11px] text-ink-soft">
        <span className="text-ink">Colophon.</span> Set in Newsreader and IBM Plex. Built with Next.js, Express,
        PostgreSQL + pgvector and Google Gemini.
      </footer>
    </main>
  );
}
