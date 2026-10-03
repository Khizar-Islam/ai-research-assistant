export const PRODUCT_NAME = "Footnote";

// Where the Express API lives. NEXT_PUBLIC_ variables are inlined into the browser
// bundle at build time, so this must be set before `next build`, not only at runtime.
const rawApiUrl = process.env.NEXT_PUBLIC_API_URL;

if (!rawApiUrl) {
  throw new Error("NEXT_PUBLIC_API_URL is not set. Copy web/.env.example to web/.env.local.");
}

export const API_URL = rawApiUrl.replace(/\/+$/, ""); // tolerate a trailing slash

// Step 8: replaced by the signed-in user's email from NextAuth.
export const DEV_USER_EMAIL = "dev@localhost";
