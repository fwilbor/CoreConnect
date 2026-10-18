// SQL-first: supabase/migrations/*.sql is the source of truth. drizzle-kit is
// used only to regenerate the typed schema from a database built from those
// migrations:  pnpm db:reset && pnpm db:pull
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  out: "./lib/db/generated",
  schemaFilter: ["public"],
  // Always the local database built by db:reset, never the deployed one.
  dbCredentials: { url: process.env.LOCAL_DATABASE_URL ?? "postgres://postgres@localhost:5432/coreconnect_dev" },
});
