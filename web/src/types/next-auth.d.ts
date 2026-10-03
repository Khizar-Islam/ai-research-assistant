// What this app adds to NextAuth's session and session-cookie token (see src/auth.ts).
import "next-auth";
import "next-auth/jwt";

type Identity = { provider: "google" | "dev"; providerAccountId: string };

declare module "next-auth" {
  interface Session {
    identity?: Identity; // which provider account is signed in; used for the API token
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    provider?: Identity["provider"];
    providerAccountId?: string;
  }
}
