// The configured requireAuth the routes use. Kept apart from requireAuth.ts so that file
// has no environment or database imports and can be tested with fakes.
import { env } from "../config/env.ts";
import { secretKey } from "../lib/apiToken.ts";
import { createUserResolver } from "../services/users.ts";
import { createRequireAuth } from "./requireAuth.ts";

export const requireAuth = createRequireAuth({
  secret: secretKey(env.API_JWT_SECRET),
  resolveUser: createUserResolver(),
  allowDevIdentities: env.NODE_ENV === "development",
});
