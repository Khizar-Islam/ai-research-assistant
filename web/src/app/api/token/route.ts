// GET /api/token — a short-lived token for the Express API, for the signed-in user.
//
// The session cookie stays on this app's domain and can't be read by page code, so the
// browser asks here (same origin, the cookie comes along), gets a ~15-minute token, and
// sends it to Express as `Authorization: Bearer <token>`. Other sites can't read this
// response: it has no CORS headers, so the browser keeps it from them.
import { auth } from "@/auth";
import { signApiToken } from "@/lib/server/apiToken";

const noStore = { "Cache-Control": "no-store" }; // a token must never be cached anywhere

export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!session || !email || !session.identity) {
    return Response.json({ error: "Not signed in." }, { status: 401, headers: noStore });
  }

  const { token, expiresAt } = await signApiToken({
    ...session.identity,
    email,
    name: session.user?.name,
    picture: session.user?.image,
  });
  return Response.json({ token, expiresAt }, { headers: noStore });
}
