// NextAuth's own endpoints: the Google redirect and callback, sign-out, the session
// lookup the browser uses, and CSRF protection for them.
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
