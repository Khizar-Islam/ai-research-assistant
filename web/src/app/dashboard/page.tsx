import type { Metadata } from "next";
import { requireSession } from "@/lib/server/session";
import { DocumentList } from "@/components/documents/DocumentList";
import { DocumentUpload } from "@/components/upload/DocumentUpload";

export const metadata: Metadata = { title: "Documents" };

export default async function DashboardPage() {
  await requireSession("/dashboard"); // signed out → sign in, then back here
  return (
    <main className="mx-auto max-w-5xl px-5 py-12 sm:px-8">
      <h1 className="font-serif text-4xl tracking-tight">Documents</h1>
      <p className="mt-2 max-w-xl text-ink-soft">
        Everything you upload is split into passages and indexed, so questions can be answered from it.
      </p>
      <div className="mt-8">
        <DocumentUpload />
      </div>
      <div className="mt-12">
        <DocumentList />
      </div>
    </main>
  );
}
