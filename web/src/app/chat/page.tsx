import type { Metadata } from "next";
import { SearchScope, Transcript } from "@/components/chat/Transcript";

export const metadata: Metadata = { title: "Ask" };

// Step 8: redirect to sign-in when there's no session.
export default function ChatPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-12 sm:px-8">
      <h1 className="font-serif text-4xl tracking-tight">Ask your documents</h1>
      <div className="mt-2 max-w-2xl">
        <SearchScope />
      </div>
      {/* Stage 3: the question box goes below the transcript. */}
      <div className="mt-10 border-t border-ink">
        <Transcript />
      </div>
    </main>
  );
}
