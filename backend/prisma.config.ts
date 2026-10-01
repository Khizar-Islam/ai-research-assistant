// Config for the Prisma CLI (migrate, generate, validate). The running app does NOT
// read this file — it connects through the PrismaPg adapter using DATABASE_URL.
import "dotenv/config"; // Prisma 7 no longer loads .env on its own
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Session pooler (5432). Migrations need a session-level connection (advisory
    // locks, prepared statements), which the transaction pooler (6543) can't give.
    url: env("DIRECT_URL"),
  },
});
