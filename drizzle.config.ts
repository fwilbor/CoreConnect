// SQL-first: supabase/migrations/*.sql is the source of truth. drizzle-kit is
// used only to regenerate the typed schema from a database built from those
// migrations:  pnpm db:reset && pnpm db:pull
import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local", quiet: true });

export default defineConfig({
  dialect: "postgresql",
  out: "./lib/db/generated",
  schemaFilter: ["public"],
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5432/coreconnect_dev" },
});
