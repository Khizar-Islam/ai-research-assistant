import type { Metadata } from "next";
import { PageTransition } from "@/components/PageTransition";
import { PRODUCT_NAME } from "@/lib/config";

export const metadata: Metadata = {
  title: "Privacy",
  description: `What ${PRODUCT_NAME} stores about you, who it is sent to, and how to have it removed.`,
};

const CONTACT_EMAIL = "khizarislamrathore@gmail.com";

// A portfolio project, so this is a plain description of what the app really does rather than
// legal boilerplate. If the app starts doing something new with data (analytics, a different
// AI provider, sharing between users), this page has to change with it.
export default function PrivacyPage() {
  return (
    <PageTransition>
      <main className="mx-auto max-w-2xl px-5 py-16 sm:px-8">
        <p className="font-mono text-xs tracking-wide text-ink-soft uppercase">{PRODUCT_NAME}</p>
        <h1 className="mt-3 font-serif text-4xl tracking-tight">Privacy</h1>
        <p className="mt-3 text-ink-soft">
          {PRODUCT_NAME} is a personal portfolio project, built and run by one person. This page says what it keeps about you and where
          that information goes.
        </p>

        <h2 className="mt-10 font-serif text-2xl tracking-tight">What it stores</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          <li>
            <strong className="font-medium">Your Google profile:</strong> the name, email address and picture Google shares when you
            sign in. That is all it asks Google for. It never sees your Google password or anything else in your Google account.
          </li>
          <li>
            <strong className="font-medium">Your documents:</strong> the files you upload, kept as their text split into passages, plus
            a numeric fingerprint of each passage that is used for searching.
          </li>
          <li>
            <strong className="font-medium">Your questions and the answers</strong> you were given, so your history is there when you
            come back.
          </li>
        </ul>
        <p className="mt-3">Your documents and questions are tied to your account, and other signed-in users cannot see them.</p>

        <h2 className="mt-10 font-serif text-2xl tracking-tight">Who it is sent to</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          <li>
            <strong className="font-medium">Google (Gemini API):</strong> the text of your documents&rsquo; passages and your questions
            are sent to Google&rsquo;s Gemini models to create the search fingerprints and to write answers. This app uses a free
            Gemini API key, and Google&rsquo;s terms for the free tier allow it to use submitted content to improve its products. Read
            Google&rsquo;s current Gemini API terms, and do not upload anything confidential.
          </li>
          <li>
            <strong className="font-medium">Hosting:</strong> Vercel serves the website, Render runs the API, and Supabase stores the
            database. Your data passes through and is kept on those services.
          </li>
        </ul>
        <p className="mt-3">
          It is not sold, not shown to other users, and not used for advertising. The app has no analytics or advertising trackers.
        </p>

        <h2 className="mt-10 font-serif text-2xl tracking-tight">Removing your data</h2>
        <p className="mt-3">
          You can delete any document yourself from the dashboard, which also deletes its passages. To have your account, questions and
          anything else removed, email{" "}
          <a className="underline underline-offset-2" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>{" "}
          from the address you signed in with.
        </p>

        <h2 className="mt-10 font-serif text-2xl tracking-tight">Cookies</h2>
        <p className="mt-3">
          The app sets cookies only for signing in: one that keeps you signed in between pages, and short-lived ones that protect the sign-in step itself. It sets no tracking cookies.
        </p>

        <h2 className="mt-10 font-serif text-2xl tracking-tight">Questions</h2>
        <p className="mt-3">
          Write to{" "}
          <a className="underline underline-offset-2" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </main>
    </PageTransition>
  );
}
