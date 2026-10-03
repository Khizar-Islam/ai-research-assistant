import type { Metadata } from "next";
import { requireSession } from "@/lib/server/session";
import { ChatView } from "@/components/chat/ChatView";
import { SearchScope } from "@/components/chat/Transcript";

export const metadata: Metadata = { title: "Ask" };

export default async function ChatPage() {
  await requireSession("/chat"); // signed out → sign in, then back here
  return (
    <main className="mx-auto max-w-3xl px-5 pt-12 sm:px-8">
      <h1 className="font-serif text-4xl tracking-tight">Ask your documents</h1>
      <div className="mt-2 max-w-2xl">
        <SearchScope />
      </div>
      <ChatView />
    </main>
  );
}
