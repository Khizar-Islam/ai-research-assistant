// Turns a signed-in identity (from an API token) into our User row, creating it the first
// time someone arrives. The backend owns users: the web app never touches the database.
//
//   1. An Account for this provider + provider id exists → its user. (Keyed on Google's
//      stable id, so a user whose email changes stays the same user.)
//   2. Otherwise a User with this email exists → link a new Account to it.
//   3. Otherwise → create the User and its Account together.
//
// No OAuth tokens are stored: we never call Google APIs on the user's behalf, so there's
// no reason to hold their access or refresh tokens.
import type { ApiIdentity } from "../lib/apiToken.ts";

export type UserStore = {
  findByAccount: (provider: string, providerAccountId: string) => Promise<{ userId: string; name: string | null; image: string | null } | null>;
  findByEmail: (email: string) => Promise<{ id: string } | null>;
  createWithAccount: (identity: ApiIdentity) => Promise<string>; // the new user's id
  linkAccount: (userId: string, identity: ApiIdentity) => Promise<void>;
  updateProfile: (userId: string, profile: { name: string | null; image: string | null }) => Promise<void>;
};

const accountType = (provider: ApiIdentity["provider"]) => (provider === "google" ? "oidc" : "credentials");

const prismaStore: UserStore = {
  async findByAccount(provider, providerAccountId) {
    const { prisma } = await import("../lib/prisma.ts");
    const account = await prisma.account.findUnique({
      where: { provider_providerAccountId: { provider, providerAccountId } },
      select: { userId: true, user: { select: { name: true, image: true } } },
    });
    return account && { userId: account.userId, ...account.user };
  },
  async findByEmail(email) {
    const { prisma } = await import("../lib/prisma.ts");
    return prisma.user.findUnique({ where: { email }, select: { id: true } });
  },
  async createWithAccount(identity) {
    const { prisma } = await import("../lib/prisma.ts");
    const user = await prisma.user.create({
      data: {
        email: identity.email,
        name: identity.name,
        image: identity.image,
        accounts: {
          create: { type: accountType(identity.provider), provider: identity.provider, providerAccountId: identity.providerAccountId },
        },
      },
      select: { id: true },
    });
    return user.id;
  },
  async linkAccount(userId, identity) {
    const { prisma } = await import("../lib/prisma.ts");
    await prisma.account.create({
      data: { userId, type: accountType(identity.provider), provider: identity.provider, providerAccountId: identity.providerAccountId },
    });
  },
  async updateProfile(userId, profile) {
    const { prisma } = await import("../lib/prisma.ts");
    await prisma.user.update({ where: { id: userId }, data: profile });
  },
};

// Every API request carries a token, so the answer is cached briefly instead of costing a
// database lookup per request. A new name or photo shows up within CACHE_TTL_MS.
const CACHE_TTL_MS = 5 * 60_000;

const isUniqueViolation = (error: unknown) => (error as { code?: unknown })?.code === "P2002";

export function createUserResolver(store: UserStore = prismaStore, now: () => number = Date.now) {
  const cache = new Map<string, { userId: string; expiresAt: number }>();

  async function lookup(identity: ApiIdentity): Promise<string> {
    const account = await store.findByAccount(identity.provider, identity.providerAccountId);
    if (account) {
      if (account.name !== identity.name || account.image !== identity.image) {
        await store.updateProfile(account.userId, { name: identity.name, image: identity.image });
      }
      return account.userId;
    }

    const existing = await store.findByEmail(identity.email);
    if (existing) {
      await store.linkAccount(existing.id, identity);
      await store.updateProfile(existing.id, { name: identity.name, image: identity.image });
      return existing.id;
    }

    return store.createWithAccount(identity);
  }

  return async function resolveUser(identity: ApiIdentity): Promise<string> {
    const key = `${identity.provider}:${identity.providerAccountId}`;
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now()) return cached.userId;

    let userId: string;
    try {
      userId = await lookup(identity);
    } catch (error) {
      // A brand-new user's first page load fires several requests at once; one creates the
      // user, the others hit the unique constraints. They just look it up again.
      if (!isUniqueViolation(error)) throw error;
      userId = await lookup(identity);
    }
    cache.set(key, { userId, expiresAt: now() + CACHE_TTL_MS });
    return userId;
  };
}

export type ResolveUser = ReturnType<typeof createUserResolver>;
