"use client";

// Client-side context shared by every page: who is signed in (NextAuth), the TanStack
// Query cache (server state such as the document list) and the app-wide motion settings.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import type { Session } from "next-auth";
import { SessionProvider } from "next-auth/react";
import { useState, type ReactNode } from "react";

export function Providers({ children, session }: { children: ReactNode; session: Session | null }) {
  // Created once per browser tab. useState (not a module-level constant) so it is never
  // shared between requests if a component is ever rendered on the server.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5_000,
            // A 4xx won't fix itself; only retry what might be a passing network blip.
            retry: (failureCount, error) => failureCount < 2 && !isClientError(error),
          },
        },
      }),
  );

  return (
    // Keyed by user: when the signed-in user changes, start from the server's session
    // instead of the one this provider fetched before (it doesn't re-fetch on its own).
    <SessionProvider key={session?.user?.email ?? "signed-out"} session={session}>
      <QueryClientProvider client={queryClient}>
        {/* "user": animations follow the OS "reduce motion" setting. */}
        <MotionConfig reducedMotion="user">{children}</MotionConfig>
      </QueryClientProvider>
    </SessionProvider>
  );
}

function isClientError(error: unknown): boolean {
  const status = (error as { status?: number }).status;
  return typeof status === "number" && status >= 400 && status < 500;
}
