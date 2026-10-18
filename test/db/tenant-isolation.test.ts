// v1 gate: "A staff user in workspace A cannot see any record from workspace B
// by URL, server action or public endpoint." Server actions and public
// endpoints reach the database through withUser(), so this exercises the same
// path they use.
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withUser, type Database } from "@/lib/db";
import { contacts, workspaces } from "@/lib/db/schema";
import { TEST_DATABASE_URL } from "../global-setup";

const TENANT_TABLES = [
  "contacts", "leads", "pipeline_stages", "litters", "forms", "form_submissions",
  "waitlist_entries", "waitlist_events", "payments", "messages", "activities",
  "templates", "sequences", "sequence_steps", "sequence_enrollments", "memberships", "audit_log",
] as const;

let db: Database;
const ids = {
  ownerA: randomUUID(), staffA: randomUUID(), ownerB: randomUUID(),
  outsider: randomUUID(), support: randomUUID(),
  wsA: "", wsB: "",
};
const rowsB: Record<string, string> = {};

function pgCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e.code ?? e.cause?.code;
}

async function expectPgError(promise: Promise<unknown>, code: string) {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err, `expected Postgres error ${code}`).not.toBeNull();
  expect(pgCode(err)).toBe(code);
}

// Inserts one row in every tenant table for a workspace, as the table owner.
async function seedTenantData(wsId: string, ownerId: string) {
  const one = async <T,>(q: ReturnType<typeof sql>) => (await db.execute(q))[0] as T;
  const stage = await one<{ id: string }>(sql`select id from pipeline_stages where workspace_id = ${wsId} and is_default`);
  const litter = await one<{ id: string }>(sql`select id from litters where workspace_id = ${wsId} and is_general`);
  const form = await one<{ id: string }>(sql`select id from forms where workspace_id = ${wsId} and kind = 'inquiry'`);
  const seq = await one<{ id: string }>(sql`select id from sequences where workspace_id = ${wsId}`);
  const contact = await one<{ id: string }>(sql`
    insert into contacts (workspace_id, first_name, email_norm, phone_e164)
    values (${wsId}, 'Pat', ${`pat-${wsId}@example.com`}, '+15555550100') returning id`);
  const lead = await one<{ id: string }>(sql`
    insert into leads (workspace_id, contact_id, stage_id, source)
    values (${wsId}, ${contact.id}, ${stage.id}, 'form') returning id`);
  await db.execute(sql`insert into form_submissions (workspace_id, form_id, lead_id, answers)
                       values (${wsId}, ${form.id}, ${lead.id}, '{"name":"Pat"}')`);
  const entry = await one<{ id: string }>(sql`
    insert into waitlist_entries (workspace_id, lead_id, litter_id, position)
    values (${wsId}, ${lead.id}, ${litter.id}, 1) returning id`);
  await db.execute(sql`insert into waitlist_events (workspace_id, entry_id, to_position, actor_user_id)
                       values (${wsId}, ${entry.id}, 1, ${ownerId})`);
  await db.execute(sql`insert into payments (workspace_id, lead_id, kind, amount_cents, method, status, paid_at)
                       values (${wsId}, ${lead.id}, 'deposit', 30000, 'zelle', 'paid', now())`);
  await db.execute(sql`insert into messages (workspace_id, lead_id, channel, direction, body, status)
                       values (${wsId}, ${lead.id}, 'sms', 'in', 'Is the litter still available?', 'received')`);
  await db.execute(sql`insert into activities (workspace_id, lead_id, type, payload)
                       values (${wsId}, ${lead.id}, 'note', '{"text":"Met at the show"}')`);
  await db.execute(sql`insert into sequence_enrollments (workspace_id, lead_id, sequence_id)
                       values (${wsId}, ${lead.id}, ${seq.id})`);
  return { contact: contact.id, lead: lead.id, stage: stage.id, litter: litter.id };
}

beforeAll(async () => {
  db = createDb(TEST_DATABASE_URL);
  for (const [name, id] of Object.entries(ids)) {
    if (name.startsWith("ws")) continue;
    await db.execute(sql`insert into auth.users (id, email) values (${id}, ${`${name}@example.com`})`);
  }
  const create = async (name: string, slug: string, type: string, owner: string) =>
    ((await db.execute(sql`select app.create_workspace(${name}, ${slug}, ${type}, 'America/Chicago', ${owner}, null) as id`))[0] as { id: string }).id;
  ids.wsA = await create("Oak Hill Goldens", "oak-hill", "breeder", ids.ownerA);
  ids.wsB = await create("Pawsitive Training", "pawsitive", "service", ids.ownerB);
  await db.execute(sql`insert into memberships (user_id, workspace_id, role) values (${ids.staffA}, ${ids.wsA}, 'staff')`);
  // A support session on B that has already expired.
  await db.execute(sql`insert into memberships (user_id, workspace_id, role, expires_at)
                       values (${ids.support}, ${ids.wsB}, 'support', now() - interval '1 minute')`);
  await seedTenantData(ids.wsA, ids.ownerA);
  Object.assign(rowsB, await seedTenantData(ids.wsB, ids.ownerB));
});

afterAll(async () => {
  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
});

const countIn = (userId: string, table: string, wsId: string) =>
  withUser(userId, async (tx) => {
    const [row] = await tx.execute(sql`select count(*)::int as n from ${sql.identifier(table)} where workspace_id = ${wsId}`);
    return (row as { n: number }).n;
  }, db);

describe("schema guarantees", () => {
  it("has RLS enabled on every public table", async () => {
    const rows = await db.execute(sql`select tablename from pg_tables where schemaname = 'public' and not rowsecurity`);
    expect(rows.map((r) => r.tablename)).toEqual([]);
  });

  it("gives the anon role no privileges on any public table", async () => {
    const rows = await db.execute(sql`
      select c.relname from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
        and has_table_privilege('anon', c.oid, 'select, insert, update, delete')`);
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it("gives every tenant table a workspace_id column", async () => {
    const rows = await db.execute(sql`
      select t.tablename from pg_tables t
      where t.schemaname = 'public'
        and t.tablename not in ('workspaces', 'users', 'webhook_events')
        and not exists (select 1 from information_schema.columns c
                        where c.table_schema = 'public' and c.table_name = t.tablename
                          and c.column_name = 'workspace_id')`);
    expect(rows.map((r) => r.tablename)).toEqual([]);
  });
});

describe("cross-tenant isolation", () => {
  for (const [label, user] of [["owner of A", "ownerA"], ["staff of A", "staffA"]] as const) {
    it(`${label} sees workspace A's rows and none of B's, in every tenant table`, async () => {
      for (const table of TENANT_TABLES) {
        if (!(table === "audit_log" && user === "staffA")) {
          expect(await countIn(ids[user], table, ids.wsA), `${table} in A`).toBeGreaterThan(0);
        }
        expect(await countIn(ids[user], table, ids.wsB), `${table} in B`).toBe(0);
      }
    });
  }

  it("hides workspace B itself and B's users", async () => {
    const result = await withUser(ids.staffA, async (tx) => ({
      workspaces: await tx.select({ id: workspaces.id }).from(workspaces),
      ownerB: await tx.execute(sql`select id from users where id = ${ids.ownerB}`),
    }), db);
    expect(result.workspaces.map((w) => w.id)).toEqual([ids.wsA]);
    expect(result.ownerB).toHaveLength(0);
  });

  it("finds nothing when B's record id is requested directly, as by URL", async () => {
    const found = await withUser(ids.staffA, (tx) =>
      tx.select().from(contacts).where(eq(contacts.id, rowsB.contact)), db);
    expect(found).toHaveLength(0);
  });

  it("refuses inserts into B", async () => {
    await expectPgError(
      withUser(ids.ownerA, (tx) => tx.insert(contacts).values({ workspaceId: ids.wsB, emailNorm: "x@example.com" }), db),
      "42501",
    );
  });

  it("changes nothing on updates or deletes aimed at B", async () => {
    const result = await withUser(ids.ownerA, async (tx) => ({
      updated: await tx.execute(sql`update contacts set first_name = 'Hacked' where id = ${rowsB.contact} returning id`),
      deleted: await tx.execute(sql`delete from leads where id = ${rowsB.lead} returning id`),
      ws: await tx.execute(sql`update workspaces set name = 'Hacked' where id = ${ids.wsB} returning id`),
    }), db);
    expect([result.updated.length, result.deleted.length, result.ws.length]).toEqual([0, 0, 0]);
    const [c] = await db.execute(sql`select first_name from contacts where id = ${rowsB.contact}`);
    expect(c.first_name).toBe("Pat");
  });

  it("refuses moving a row from A into B", async () => {
    await expectPgError(
      withUser(ids.ownerA, (tx) =>
        tx.execute(sql`update contacts set workspace_id = ${ids.wsB} where workspace_id = ${ids.wsA}`), db),
      "42501",
    );
  });

  it("refuses an A lead that points at B's contact, stage or litter", async () => {
    const [stageA] = await db.execute(sql`select id from pipeline_stages where workspace_id = ${ids.wsA} and is_default`);
    const [contactA] = await db.execute(sql`select id from contacts where workspace_id = ${ids.wsA}`);
    const attempts = [
      { contact: rowsB.contact, stage: stageA.id, litter: null },
      { contact: contactA.id, stage: rowsB.stage, litter: null },
      { contact: contactA.id, stage: stageA.id, litter: rowsB.litter },
    ];
    for (const a of attempts) {
      await expectPgError(
        withUser(ids.ownerA, (tx) => tx.execute(sql`
          insert into leads (workspace_id, contact_id, stage_id, litter_id, source)
          values (${ids.wsA}, ${a.contact}, ${a.stage}, ${a.litter}, 'call')`), db),
        "23503",
      );
    }
  });

  it("gives a user with no membership nothing at all", async () => {
    for (const table of TENANT_TABLES) {
      expect(await countIn(ids.outsider, table, ids.wsA), table).toBe(0);
      expect(await countIn(ids.outsider, table, ids.wsB), table).toBe(0);
    }
  });

  it("gives an expired support session nothing, and an active one access", async () => {
    expect(await countIn(ids.support, "contacts", ids.wsB)).toBe(0);
    await db.execute(sql`update memberships set expires_at = now() + interval '1 hour'
                         where user_id = ${ids.support} and workspace_id = ${ids.wsB}`);
    expect(await countIn(ids.support, "contacts", ids.wsB)).toBeGreaterThan(0);
    expect(await countIn(ids.support, "contacts", ids.wsA)).toBe(0);
  });

  it("gives the anon role no table access", async () => {
    await expectPgError(
      db.transaction(async (tx) => {
        await tx.execute(sql`set local role anon`);
        await tx.execute(sql`select 1 from contacts limit 1`);
      }),
      "42501",
    );
  });
});

describe("roles", () => {
  it("lets staff work leads but not edit workspace settings or memberships", async () => {
    const result = await withUser(ids.staffA, async (tx) => ({
      ws: await tx.execute(sql`update workspaces set name = 'Renamed' where id = ${ids.wsA} returning id`),
      note: await tx.execute(sql`update contacts set city = 'Austin' where workspace_id = ${ids.wsA} returning id`),
    }), db);
    expect(result.ws).toHaveLength(0);
    expect(result.note.length).toBeGreaterThan(0);
    await expectPgError(
      withUser(ids.staffA, (tx) => tx.execute(sql`
        insert into memberships (user_id, workspace_id, role) values (${ids.outsider}, ${ids.wsA}, 'staff')`), db),
      "42501",
    );
  });

  it("stops anyone from making themselves a platform admin", async () => {
    await expectPgError(
      withUser(ids.ownerA, (tx) =>
        tx.execute(sql`update users set is_platform_admin = true where id = ${ids.ownerA}`), db),
      "42501",
    );
  });

  it("stops owners from granting themselves support access", async () => {
    await expectPgError(
      withUser(ids.ownerA, (tx) => tx.execute(sql`
        insert into memberships (user_id, workspace_id, role, expires_at)
        values (${ids.outsider}, ${ids.wsA}, 'support', now() + interval '1 day')`), db),
      "42501",
    );
  });
});

describe("waitlist rules", () => {
  it("keeps position history append-only, even for the table owner", async () => {
    await expectPgError(db.execute(sql`update waitlist_events set reason = 'edited'`), "42501");
    await expectPgError(db.execute(sql`delete from waitlist_events`), "42501");
  });

  it("requires a reason for a manual reorder", async () => {
    const [entry] = await db.execute(sql`select id from waitlist_entries where workspace_id = ${ids.wsA}`);
    await expectPgError(
      withUser(ids.ownerA, (tx) => tx.execute(sql`
        insert into waitlist_events (workspace_id, entry_id, from_position, to_position, actor_user_id)
        values (${ids.wsA}, ${entry.id}, 1, 2, ${ids.ownerA})`), db),
      "23514",
    );
  });

  it("enforces unique positions on the general waitlist; released entries hold none", async () => {
    const [entry] = await db.execute(sql`select lead_id, litter_id from waitlist_entries where workspace_id = ${ids.wsA}`);
    await expectPgError(
      db.execute(sql`insert into waitlist_entries (workspace_id, lead_id, litter_id, position)
                     values (${ids.wsA}, ${entry.lead_id}, ${entry.litter_id}, 1)`),
      "23505",
    );
    await db.execute(sql`insert into waitlist_entries (workspace_id, lead_id, litter_id, position, status)
                         values (${ids.wsA}, ${entry.lead_id}, ${entry.litter_id}, null, 'released'),
                                (${ids.wsA}, ${entry.lead_id}, ${entry.litter_id}, null, 'released')`);
  });

  it("lets a reorder swap two positions inside one transaction", async () => {
    const [entry] = await db.execute(sql`select lead_id, litter_id from waitlist_entries where workspace_id = ${ids.wsA} and position = 1`);
    await db.execute(sql`insert into waitlist_entries (workspace_id, lead_id, litter_id, position)
                         values (${ids.wsA}, ${entry.lead_id}, ${entry.litter_id}, 2)`);
    await db.transaction(async (tx) => {
      await tx.execute(sql`set constraints all deferred`);
      await tx.execute(sql`update waitlist_entries set position = 3 - position
                           where litter_id = ${entry.litter_id} and position in (1, 2)`);
    });
  });
});
