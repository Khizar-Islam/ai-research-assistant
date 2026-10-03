// NextAuth: who is signed in to this app. It only proves identity; the Express API owns
// users and data. Sessions are JWTs in an encrypted cookie (no database adapter), and
// the API is called with a separate short-lived token (app/api/token/route.ts).
//
// Sign-in methods:
//   - Google, when AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET are set.
//   - Development-only sign-in as one of two fixed test users (two, so per-user data
//     separation can be tested), when AUTH_DEV_LOGIN=true and NODE_ENV=development. The
//     API refuses these identities anywhere else too (see backend requireAuth).
import NextAuth from "next-auth";
import type { Provider } from "next-auth/providers";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";

// The only identities the dev sign-in can produce. The form picks one by key; anything
// else falls back to the first, so no other identity can be made up.
export const DEV_TESTERS = [
  { key: "tester", email: "dev-tester@footnote.test", name: "Dev Tester" },
  { key: "second", email: "second-tester@footnote.test", name: "Second Tester" },
] as const;

const devLoginRequested = process.env.AUTH_DEV_LOGIN === "true";
if (devLoginRequested && process.env.NODE_ENV === "production") {
  // Fail loudly rather than quietly shipping a passwordless sign-in.
  throw new Error("AUTH_DEV_LOGIN must not be set in production.");
}
export const devLoginEnabled = devLoginRequested && process.env.NODE_ENV === "development";
export const googleEnabled = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

const providers: Provider[] = [];
if (googleEnabled) providers.push(Google); // reads AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET
if (devLoginEnabled) {
  providers.push(
    Credentials({
      id: "dev",
      name: "Dev tester",
      credentials: { tester: {} }, // which fixed tester; no password
      authorize: async (credentials) => {
        const tester = DEV_TESTERS.find((t) => t.key === credentials?.tester) ?? DEV_TESTERS[0];
        return { id: `dev:${tester.email}`, email: tester.email, name: tester.name };
      },
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  session: { strategy: "jwt" },
  pages: { signIn: "/signin", error: "/signin" },
  callbacks: {
    // Users are matched by email on their first visit (backend users.ts), which is only
    // safe if Google has verified that the address belongs to them.
    signIn({ account, profile }) {
      if (account?.provider === "google") return profile?.email_verified === true;
      return true;
    },

    // Runs when the session cookie is created (account is set) and on every read. Records
    // which provider and which stable provider id this user is, for the API token.
    jwt({ token, account, user }) {
      if (account) {
        const google = account.provider === "google";
        token.provider = google ? "google" : "dev";
        // Google's "sub": stays the same even if the user's email changes.
        token.providerAccountId = google ? account.providerAccountId : String(user?.id);
      }
      return token;
    },

    session({ session, token }) {
      if (token.provider && token.providerAccountId) {
        session.identity = { provider: token.provider, providerAccountId: token.providerAccountId };
      }
      return session;
    },
  },
});
