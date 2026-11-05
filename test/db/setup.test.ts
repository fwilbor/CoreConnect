import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withUser, type Database } from "@/lib/db";
import { upsertInquiry } from "@/lib/intake/upsert";
import { loadSetup } from "@/lib/setup";
import { TEST_DATABASE_URL } from "../global-setup";

let db: Database;
const owner = randomUUID();
let ws = "";
const slug = `su-${owner.slice(0, 8)}`;
const steps = async () => Object.fromEntries((await withUser(owner, (tx) => loadSetup(tx, ws, slug), db)).map((s) => [s.key, s.done]));

beforeAll(async () => {
  db = createDb(TEST_DATABASE_URL);
  await db.execute(sql`insert into auth.users (id, email) values (${owner}, ${`su-${owner.slice(0, 6)}@example.com`})`);
  const [row] = (await db.execute(sql`select app.create_workspace('Setup Kennel', ${slug}, 'breeder', 'America/Chicago', ${owner}, null) as id`)) as unknown as { id: string }[];
  ws = row.id;
});

afterAll(async () => {
  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
});

describe("setup checklist", () => {
  it("starts with nothing done, even though seeding touched the templates", async () => {
    expect(await steps()).toEqual({ address: false, auto_reply: false, deposits: false, stripe: false, inquiry: false });
  });

  it("ticks each step from the workspace's real state", async () => {
    await db.execute(sql`update workspaces set physical_address = '1 Main St', deposit_amount_cents = 30000,
                         deposit_terms = 'Non-refundable', stripe_charges_enabled = true where id = ${ws}`);
    await db.execute(sql`update templates set body = 'Hi from us!', created_at = now() - interval '1 day'
                         where workspace_id = ${ws} and system_key = 'auto_reply_email'`);
    await withUser(owner, (tx) => upsertInquiry(tx, {
      workspaceId: ws, firstName: "Test", email: `t-${owner.slice(0, 4)}@example.com`, phone: null, source: "form",
    }), db);
    expect(await steps()).toEqual({ address: true, auto_reply: true, deposits: true, stripe: true, inquiry: true });
  });
});
