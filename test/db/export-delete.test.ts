import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { strFromU8, unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withUser, type Database, type Tx } from "@/lib/db";
import { deleteContact } from "@/lib/contacts";
import { exportWorkspace, writeAudit, zipFiles } from "@/lib/export";
import { upsertInquiry } from "@/lib/intake/upsert";
import { addNote } from "@/lib/leads/mutations";
import { recordManualPayment } from "@/lib/payments";
import { addToWaitlist, listWaitlist, waitlistHistory } from "@/lib/waitlist";
import { TEST_DATABASE_URL } from "../global-setup";

process.env.NEXT_PUBLIC_SITE_URL = "https://app.example";

let db: Database;
const owner = randomUUID();
const staff = randomUUID();
const outsider = randomUUID();
let ws = "";
let otherWs = "";
const as = <T,>(fn: (tx: Tx) => Promise<T>, user = owner) => withUser(user, fn, db);
const ctx = (userId = owner) => ({ workspaceId: ws, userId });
const q = async <T = Record<string, unknown>>(query: ReturnType<typeof sql>) => (await db.execute(query)) as unknown as T[];
let n = 0;
async function newLead(first: string, workspaceId = ws, user = owner) {
  return withUser(user, (tx) => upsertInquiry(tx, {
    workspaceId, firstName: first, lastName: "X", email: `${first.toLowerCase()}${++n}-${owner.slice(0, 4)}@example.com`,
    phone: null, source: "form",
  }), db);
}

beforeAll(async () => {
  db = createDb(TEST_DATABASE_URL);
  await db.execute(sql`insert into auth.users (id, email) values
    (${owner}, ${`xd-${owner.slice(0, 6)}@example.com`}), (${staff}, ${`xd-s-${staff.slice(0, 6)}@example.com`}),
    (${outsider}, ${`xd-o-${outsider.slice(0, 6)}@example.com`})`);
  [{ id: ws }] = await q<{ id: string }>(sql`select app.create_workspace('Export Kennel', ${`xd-${owner.slice(0, 8)}`}, 'breeder', 'America/Chicago', ${owner}, null) as id`);
  [{ id: otherWs }] = await q<{ id: string }>(sql`select app.create_workspace('Other', ${`xd-o-${owner.slice(0, 8)}`}, 'breeder', 'America/Chicago', ${outsider}, null) as id`);
  await db.execute(sql`insert into memberships (user_id, workspace_id, role) values (${staff}, ${ws}, 'staff')`);
});

afterAll(async () => {
  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
});

describe("export", () => {
  it("zips every table of the owner's workspace and nothing from another", async () => {
    await newLead("Ellie");
    await newLead("=HYPERLINK(evil)");
    await newLead("Stranger", otherWs, outsider);

    const { files, rows } = await as((tx) => exportWorkspace(tx, ws));
    const unzipped = unzipSync(zipFiles(files));
    expect(Object.keys(unzipped)).toEqual(expect.arrayContaining(["leads_summary.csv", "contacts.csv", "messages.csv", "payments.csv", "waitlist_events.csv"]));
    expect(rows).toBeGreaterThan(0);

    const summary = strFromU8(unzipped["leads_summary.csv"]);
    expect(summary.split("\n")[0]).toContain("first_name,last_name,email,phone,stage");
    expect(summary).toContain("Ellie");
    // A formula-looking name is escaped so a spreadsheet shows it as text.
    expect(summary).toContain("'=HYPERLINK(evil)");
    const all = Object.values(files).join("\n");
    expect(all).not.toContain("Stranger");
    expect(all).not.toContain(otherWs);
  });

  it("is recorded in the audit log, and staff can't record one", async () => {
    await as((tx) => writeAudit(tx, ws, "export", { rows: 1 }));
    const [row] = await q<{ actor_user_id: string; action: string }>(sql`
      select actor_user_id, action from audit_log where workspace_id = ${ws} and action = 'export' order by created_at desc limit 1`);
    expect(row).toEqual({ actor_user_id: owner, action: "export" });

    await expect(as((tx) => writeAudit(tx, ws, "export", {}), staff)).rejects.toThrow();
    await expect(as((tx) => writeAudit(tx, otherWs, "export", {}))).rejects.toThrow();
    // Only export and contact delete can be written this way.
    await expect(as((tx) => tx.execute(sql`select app.write_audit(${ws}, 'workspace.create', '{}'::jsonb)`))).rejects.toThrow();
  });
});

describe("contact delete", () => {
  it("removes the person's data, moves the waitlist up without naming them, and keeps payments redacted", async () => {
    const gone = await newLead("Gwen");
    const stays = await newLead("Stan");
    for (const l of [gone, stays]) await as((tx) => addToWaitlist(tx, ctx(), { leadId: l.leadId, litterId: null }));
    await as((tx) => addNote(tx, ctx(), gone.leadId, "Wants a female, lives in Tulsa"));
    await db.execute(sql`insert into messages (workspace_id, lead_id, channel, direction, body, status)
                         values (${ws}, ${gone.leadId}, 'email', 'in', 'My address is 5 Elm St', 'received')`);
    await as((tx) => recordManualPayment(tx, ctx(), {
      leadId: gone.leadId, kind: "deposit", method: "zelle", amount: "300", paidOn: "2026-11-01", note: "From Gwen's husband",
    }));
    const [{ contact_id: contactId }] = await q<{ contact_id: string }>(sql`select contact_id from leads where id = ${gone.leadId}`);
    const general = (await q<{ id: string }>(sql`select id from litters where workspace_id = ${ws} and is_general`))[0].id;

    const counts = await as((tx) => deleteContact(tx, ctx(), contactId));
    expect(counts).toMatchObject({ leads: 1, payments: 1 });

    const left = await q<{ n: number }>(sql`
      select (select count(*) from contacts where id = ${contactId})
           + (select count(*) from leads where id = ${gone.leadId})
           + (select count(*) from messages where lead_id = ${gone.leadId})
           + (select count(*) from activities where lead_id = ${gone.leadId})
           + (select count(*) from form_submissions where lead_id = ${gone.leadId})
           + (select count(*) from sequence_enrollments where lead_id = ${gone.leadId})
           + (select count(*) from waitlist_entries where lead_id = ${gone.leadId}) as n`);
    expect(Number(left[0].n)).toBe(0);

    const [payment] = await q<{ lead_id: string | null; note: string | null; amount_cents: number }>(sql`
      select lead_id, note, amount_cents from payments where workspace_id = ${ws} and amount_cents = 30000 order by created_at desc limit 1`);
    expect(payment).toEqual({ lead_id: null, note: null, amount_cents: 30000 });

    const list = await as((tx) => listWaitlist(tx, ws, general));
    expect(list.map((e) => [e.position, e.first_name])).toEqual([[1, "Stan"]]);
    const history = JSON.stringify(await as((tx) => waitlistHistory(tx, ws, general)));
    expect(history).toContain("was deleted on request");
    expect(history).not.toContain("Gwen");

    const [audit] = await q<{ details: Record<string, unknown> }>(sql`
      select details from audit_log where workspace_id = ${ws} and action = 'contact.delete' order by created_at desc limit 1`);
    expect(audit.details).toMatchObject({ contact_id: contactId, leads: 1, payments: 1 });
    expect(JSON.stringify(audit.details)).not.toContain("Gwen");
  });

  it("is owner-only and can't reach another workspace", async () => {
    const lead = await newLead("Paula");
    const [{ contact_id: contactId }] = await q<{ contact_id: string }>(sql`select contact_id from leads where id = ${lead.leadId}`);
    await expect(as((tx) => deleteContact(tx, ctx(staff), contactId), staff)).rejects.toThrow("Only the workspace owner can do that");
    await expect(as((tx) => deleteContact(tx, { workspaceId: otherWs, userId: outsider }, contactId), outsider)).rejects.toThrow("Contact not found");
    expect(await q(sql`select id from contacts where id = ${contactId}`)).toHaveLength(1);
  });
});
