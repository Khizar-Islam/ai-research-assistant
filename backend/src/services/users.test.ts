import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ApiIdentity } from "../lib/apiToken.ts";
import { createUserResolver, type UserStore } from "./users.ts";

type User = { id: string; email: string; name: string | null; image: string | null };
type Account = { userId: string; provider: string; providerAccountId: string };

// An in-memory store with the same unique rules as the database: one user per email, one
// account per provider + provider id. Records every call.
function memoryStore(users: User[] = [], accounts: Account[] = []) {
  const calls: string[] = [];
  let nextId = users.length + 1;
  const unique = () => Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
  const store: UserStore = {
    findByAccount: async (provider, providerAccountId) => {
      calls.push("findByAccount");
      const account = accounts.find((a) => a.provider === provider && a.providerAccountId === providerAccountId);
      const user = account && users.find((u) => u.id === account.userId);
      return user ? { userId: user.id, name: user.name, image: user.image } : null;
    },
    findByEmail: async (email) => {
      calls.push("findByEmail");
      const user = users.find((u) => u.email === email);
      return user ? { id: user.id } : null;
    },
    createWithAccount: async (identity) => {
      calls.push("createWithAccount");
      if (users.some((u) => u.email === identity.email)) throw unique();
      const id = `user-${nextId++}`;
      users.push({ id, email: identity.email, name: identity.name, image: identity.image });
      accounts.push({ userId: id, provider: identity.provider, providerAccountId: identity.providerAccountId });
      return id;
    },
    linkAccount: async (userId, identity) => {
      calls.push("linkAccount");
      accounts.push({ userId, provider: identity.provider, providerAccountId: identity.providerAccountId });
    },
    updateProfile: async (userId, profile) => {
      calls.push("updateProfile");
      Object.assign(users.find((u) => u.id === userId)!, profile);
    },
  };
  return { store, users, accounts, calls };
}

const ada: ApiIdentity = { provider: "google", providerAccountId: "g-1", email: "ada@example.com", name: "Ada", image: null };

describe("resolveUser", () => {
  it("creates the user and their account the first time they arrive", async () => {
    const db = memoryStore();
    const userId = await createUserResolver(db.store)(ada);
    assert.equal(userId, "user-1");
    assert.deepEqual(db.users, [{ id: "user-1", email: "ada@example.com", name: "Ada", image: null }]);
    assert.deepEqual(db.accounts, [{ userId: "user-1", provider: "google", providerAccountId: "g-1" }]);
  });

  it("finds a returning user by their Google id, even if their email changed", async () => {
    const db = memoryStore([{ id: "user-1", email: "old@example.com", name: "Ada", image: null }], [{ userId: "user-1", provider: "google", providerAccountId: "g-1" }]);
    assert.equal(await createUserResolver(db.store)({ ...ada, email: "new@example.com" }), "user-1");
    assert.equal(db.users.length, 1);
  });

  it("links a new sign-in method to an existing user with the same (verified) email", async () => {
    const db = memoryStore([{ id: "user-1", email: "ada@example.com", name: null, image: null }]);
    assert.equal(await createUserResolver(db.store)(ada), "user-1");
    assert.deepEqual(db.accounts, [{ userId: "user-1", provider: "google", providerAccountId: "g-1" }]);
    assert.equal(db.users[0]!.name, "Ada", "profile filled in from the sign-in");
  });

  it("updates the name and photo only when they changed", async () => {
    const db = memoryStore([{ id: "user-1", email: "ada@example.com", name: "Ada", image: null }], [{ userId: "user-1", provider: "google", providerAccountId: "g-1" }]);
    await createUserResolver(db.store)(ada);
    assert.ok(!db.calls.includes("updateProfile"));

    await createUserResolver(db.store)({ ...ada, image: "https://example.com/new.png" });
    assert.equal(db.users[0]!.image, "https://example.com/new.png");
  });

  it("answers repeat requests from a cache, then looks again after 5 minutes", async () => {
    const db = memoryStore();
    let t = 0;
    const resolve = createUserResolver(db.store, () => t);
    await resolve(ada);
    const callsAfterFirst = db.calls.length;

    t += 60_000;
    await resolve(ada);
    assert.equal(db.calls.length, callsAfterFirst, "no database call within the cache window");

    t += 5 * 60_000;
    await resolve(ada);
    assert.ok(db.calls.length > callsAfterFirst);
  });

  it("survives two first requests racing to create the same user", async () => {
    const db = memoryStore();
    // Simulate the race: the other request creates the user between our lookup and our
    // create, so our create hits the unique constraint.
    const realFindByEmail = db.store.findByEmail;
    let raced = false;
    db.store.findByEmail = async (email) => {
      const result = await realFindByEmail(email);
      if (!raced) {
        raced = true;
        await createUserResolver(db.store)(ada); // the "other request"
      }
      return result;
    };
    const userId = await createUserResolver(db.store)(ada);
    assert.equal(userId, "user-1");
    assert.equal(db.users.length, 1, "still exactly one user");
  });

  it("lets other database errors through", async () => {
    const db = memoryStore();
    db.store.findByAccount = async () => {
      throw new Error("connection refused");
    };
    await assert.rejects(createUserResolver(db.store)(ada), /connection refused/);
  });
});
