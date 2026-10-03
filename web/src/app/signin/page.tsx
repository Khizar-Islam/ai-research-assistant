import type { Metadata } from "next";
import { PageTransition } from "@/components/PageTransition";
import { redirect } from "next/navigation";
import { auth, DEV_TESTERS, devLoginEnabled, googleEnabled, signIn } from "@/auth";
import { SignInButton } from "@/components/SignInButton";
import { PRODUCT_NAME } from "@/lib/config";

export const metadata: Metadata = { title: "Sign in" };

type Props = { searchParams: Promise<{ callbackUrl?: string | string[]; error?: string | string[] }> };

// Where to go after signing in. Only a path on this site: an absolute or protocol-relative
// URL ("//evil.com") here would make the sign-in page an open redirect.
function safeDestination(value: string | string[] | undefined): string {
  const path = Array.isArray(value) ? value[0] : value;
  return path && path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/\\") ? path : "/dashboard";
}

// NextAuth reports failures as ?error=<code>; say what happened in plain words.
const ERRORS: Record<string, string> = {
  AccessDenied: "That Google account couldn’t be used: its email address isn’t verified with Google.",
  OAuthAccountNotLinked: "That email is already linked to a different sign-in method.",
  Configuration: "Sign-in isn’t set up correctly on the server. Check the auth settings in .env.local.",
  Verification: "That sign-in link has expired or was already used.",
};

export default async function SignInPage({ searchParams }: Props) {
  const params = await searchParams;
  const destination = safeDestination(params.callbackUrl);
  if (await auth()) redirect(destination); // already signed in

  const errorCode = Array.isArray(params.error) ? params.error[0] : params.error;
  const error = errorCode ? (ERRORS[errorCode] ?? "Sign-in didn’t work. Please try again.") : null;

  return (
    <PageTransition>
      <main className="mx-auto max-w-md px-5 py-20 sm:px-8">
        {/* Eases up in reading order (CSS "reveal"); the error, when there is one, comes in
            with it, just before the buttons. */}
        <p className="reveal font-mono text-xs tracking-wide text-ink-soft uppercase" style={{ "--reveal-index": 0 } as React.CSSProperties}>{PRODUCT_NAME}</p>
        <h1 className="reveal mt-3 font-serif text-4xl tracking-tight" style={{ "--reveal-index": 1 } as React.CSSProperties}>
          Sign in
        </h1>
        <p className="reveal mt-3 text-ink-soft" style={{ "--reveal-index": 2 } as React.CSSProperties}>
          Your documents and questions are private to your account. Sign in to upload documents and ask about them.
        </p>

        {error && (
          <p role="alert" className="reveal mt-6 border-l-2 border-mark bg-paper-deep px-4 py-3 text-sm" style={{ "--reveal-index": 3 } as React.CSSProperties}>
            {error}
          </p>
        )}

        <div className="reveal mt-8 space-y-3" style={{ "--reveal-index": 4 } as React.CSSProperties}>
          {googleEnabled ? (
            <form
              action={async () => {
                "use server";
                await signIn("google", { redirectTo: destination });
              }}
            >
              <SignInButton
                label="Continue with Google"
                pendingLabel="Opening Google…"
                className="press flex w-full items-center justify-center gap-3 bg-ink px-5 py-3 text-sm font-medium text-paper hover:bg-mark"
              />
            </form>
          ) : (
            <p className="border border-rule px-4 py-3 text-sm text-ink-soft">
              Google sign-in isn’t configured yet: add <code className="font-mono text-xs">AUTH_GOOGLE_ID</code> and{" "}
              <code className="font-mono text-xs">AUTH_GOOGLE_SECRET</code> to <code className="font-mono text-xs">web/.env.local</code>.
            </p>
          )}

          {devLoginEnabled && (
            <div className="space-y-2 border-t border-dashed border-ink-faint pt-3">
              {DEV_TESTERS.map((tester) => (
                <form
                  key={tester.key}
                  action={async () => {
                    "use server";
                    await signIn("dev", { tester: tester.key, redirectTo: destination });
                  }}
                >
                  <SignInButton
                    label={`Continue as ${tester.name}`}
                    pendingLabel="Signing in…"
                    className="press w-full border border-ink px-5 py-3 text-sm font-medium hover:border-mark hover:text-mark"
                  />
                </form>
              ))}
              <p className="font-mono text-[11px] text-ink-soft">
                Development only · fixed test users ({DEV_TESTERS.map((t) => t.email).join(", ")}), no password
              </p>
            </div>
          )}
        </div>
      </main>
    </PageTransition>
  );
}
