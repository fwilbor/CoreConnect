import "server-only";
import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export function createDb(url: string): Database {
  // prepare: false is required by Supabase's transaction-mode pooler.
  const client = postgres(url, { prepare: false, onnotice: () => {} });
  return drizzle(client, { schema });
}

let _db: Database | undefined;

// The connection is the table owner, so a query made directly on it bypasses
// RLS. Use it only in webhook, job and platform-admin code. Everything done on
// behalf of a logged-in user goes through withUser().
export function serviceDb(): Database {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    _db = createDb(url);
  }
  return _db;
}

// Runs fn in a transaction as Postgres role `authenticated` with the user's id
// in request.jwt.claims, the same context Supabase gives PostgREST requests, so
// every RLS policy applies. userId must come from a verified session
// (supabase.auth.getUser()), never from request input.
export async function withUser<T>(
  userId: string,
  fn: (tx: Tx) => Promise<T>,
  database: Database = serviceDb(),
): Promise<T> {
  const claims = JSON.stringify({ sub: userId, role: "authenticated" });
  return database.transaction(async (tx) => {
    await tx.execute(sql`set local role authenticated`);
    await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
    return fn(tx);
  });
}
