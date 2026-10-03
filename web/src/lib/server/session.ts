// Page protection for signed-in-only pages. The real access control is the API (every
// request needs a valid token); this just sends a signed-out visitor to sign in instead of
// showing them a page whose every request would fail.
import "server-only";
import type { Session } from "next-auth";
import { redirect } from "next/navigation";
import { auth } from "@/auth";

export async function requireSession(currentPath: string): Promise<Session> {
  const session = await auth();
  if (!session?.user) redirect(`/signin?callbackUrl=${encodeURIComponent(currentPath)}`);
  return session;
}
