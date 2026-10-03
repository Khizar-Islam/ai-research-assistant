// Prints an API token for calling this API by hand (curl, Thunder Client) in development,
// as a development sign-in identity. The API refuses these identities unless
// NODE_ENV=development, so this can't be used against production.
//
//   npm run auth:token                                  # as "Dev Tester"
//   npm run auth:token -- --email someone@footnote.test --name "Someone" --minutes 30
//
//   curl -H "Authorization: Bearer $(npm run -s auth:token)" localhost:4000/api/documents
import "dotenv/config";
import { parseArgs } from "node:util";
import { secretKey, signApiToken } from "../src/lib/apiToken.ts";

const { values } = parseArgs({
  options: {
    email: { type: "string", default: "dev-tester@footnote.test" },
    name: { type: "string", default: "Dev Tester" },
    minutes: { type: "string", default: "15" },
  },
});

const secret = process.env.API_JWT_SECRET;
if (!secret || secret.length < 32) {
  console.error("API_JWT_SECRET is missing or too short in backend/.env");
  process.exit(1);
}
const minutes = Number(values.minutes);
if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 60) {
  console.error("--minutes must be between 1 and 60 (the API rejects tokens older than an hour)");
  process.exit(1);
}

const email = values.email.toLowerCase();
const token = await signApiToken(
  // The same sub for the same email, so repeated runs are the same user.
  { sub: `dev:${email}`, provider: "dev", email, name: values.name },
  secretKey(secret),
  { expiresIn: `${minutes}m` },
);
process.stdout.write(token);
