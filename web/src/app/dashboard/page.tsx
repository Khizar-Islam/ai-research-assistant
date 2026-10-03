import type { Metadata } from "next";
import { DocumentList } from "@/components/documents/DocumentList";

export const metadata: Metadata = { title: "Documents" };

// Step 8: redirect to sign-in when there's no session.
export default function DashboardPage() {
  return (
    <main className="mx-auto max-w-5xl px-5 py-12 sm:px-8">
      <h1 className="font-serif text-4xl tracking-tight">Documents</h1>
      <p className="mt-2 max-w-xl text-ink-soft">
        Everything you upload is split into passages and indexed, so questions can be answered from it.
      </p>
      {/* Stage 4: the upload dropzone goes here. */}
      <div className="mt-10">
        <DocumentList />
      </div>
    </main>
  );
}
