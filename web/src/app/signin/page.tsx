import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth, DEV_TESTERS, devLoginEnabled, googleEnabled, signIn } from "@/auth";
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
    <main className="mx-auto max-w-md px-5 py-20 sm:px-8">
      <p className="font-mono text-xs tracking-wide text-ink-soft uppercase">{PRODUCT_NAME}</p>
      <h1 className="mt-3 font-serif text-4xl tracking-tight">Sign in</h1>
      <p className="mt-3 text-ink-soft">
        Your documents and questions are private to your account. Sign in to upload documents and ask about them.
      </p>

      {error && (
        <p role="alert" className="mt-6 border-l-2 border-mark bg-paper-deep px-4 py-3 text-sm">
          {error}
        </p>
      )}

      <div className="mt-8 space-y-3">
        {googleEnabled ? (
          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: destination });
            }}
          >
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-3 bg-ink px-5 py-3 text-sm font-medium text-paper transition-colors hover:bg-mark"
            >
              Continue with Google
            </button>
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
                <button
                  type="submit"
                  className="w-full border border-ink px-5 py-3 text-sm font-medium transition-colors hover:border-mark hover:text-mark"
                >
                  Continue as {tester.name}
                </button>
              </form>
            ))}
            <p className="font-mono text-[11px] text-ink-soft">
              Development only · fixed test users ({DEV_TESTERS.map((t) => t.email).join(", ")}), no password
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
