import type { Metadata } from "next";

export const metadata: Metadata = { title: "Documents" };

// Placeholder so the landing page's link resolves; stage 3 builds the real list.
export default function DashboardPage() {
  return (
    <main className="mx-auto max-w-5xl px-5 py-12 sm:px-8">
      <h1 className="font-serif text-4xl tracking-tight">Documents</h1>
      <p className="mt-3 text-ink-soft">The document list and upload arrive in the next stage.</p>
    </main>
  );
}
