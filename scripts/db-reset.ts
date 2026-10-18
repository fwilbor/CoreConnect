// Recreates a local or CI database from scratch: the Supabase shim, then every
// migration in order. Refuses to touch anything that isn't localhost.
//
//   pnpm db:reset                      -> DATABASE_URL from .env.local
//   pnpm db:reset postgres://...       -> explicit URL
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

export async function resetDatabase(url: string) {
  const target = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(target.hostname)) {
    throw new Error(`db:reset only runs against localhost, got ${target.hostname}`);
  }
  const dbName = target.pathname.slice(1);
  if (!/^[a-z0-9_]+$/.test(dbName)) throw new Error(`unexpected database name: ${dbName}`);

  const admin = new URL(url);
  admin.pathname = "/postgres";
  const adminSql = postgres(admin.toString(), { max: 1, onnotice: () => {} });
  await adminSql.unsafe(`drop database if exists ${dbName} with (force)`);
  await adminSql.unsafe(`create database ${dbName}`);
  await adminSql.end();

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(readFileSync(join("supabase", "local", "supabase-shim.sql"), "utf8"));
    const dir = join("supabase", "migrations");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      await sql.unsafe(readFileSync(join(dir, file), "utf8"));
    }
  } finally {
    await sql.end();
  }
}

if (process.argv[1]?.endsWith("db-reset.ts")) {
  const url = process.argv[2] ?? process.env.DATABASE_URL;
  if (!url) throw new Error("pass a database URL or set DATABASE_URL");
  resetDatabase(url)
    .then(() => console.log(`reset ${new URL(url).pathname.slice(1)}`))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
