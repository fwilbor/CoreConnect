import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withUser, type Database, type Tx } from "@/lib/db";
import { upsertInquiry } from "@/lib/intake/upsert";
import { handleInboundEmail, type ReceivedEmail } from "@/lib/messaging/inbound-email";
import { logTransports } from "@/lib/messaging/transports";
import { deliverNotifications } from "@/lib/notifications";
import { createToken } from "@/lib/tokens";
import { TEST_DATABASE_URL } from "../global-setup";

process.env.APP_TOKEN_SECRET = "test-token-secret-that-is-long-enough-123";
process.env.NEXT_PUBLIC_SITE_URL = "https://app.example";
process.env.EMAIL_FROM_DOMAIN = "mail.example";
process.env.EMAIL_INBOUND_DOMAIN = "in.example";
process.env.EMAIL_REPLY_DOMAIN = "in.example";
delete process.env.EMAIL_FROM;

let db: Database;
const owner = randomUUID();
const staff = randomUUID();
const outsider = randomUUID();
const ownerEmail = `nt-owner-${owner.slice(0, 6)}@example.com`;
const staffEmail = `nt-staff-${staff.slice(0, 6)}@example.com`;
const outsiderEmail = `nt-out-${outsider.slice(0, 6)}@example.com`;
let ws = "";
let slug = "";
let otherSlug = "";
const as = <T,>(fn: (tx: Tx) => Promise<T>, user = owner) => withUser(user, fn, db);
const q = async <T = Record<string, unknown>>(query: ReturnType<typeof sql>) => (await db.execute(query)) as unknown as T[];
const notesFor = (leadId: string) => q<{ user_id: string; status: string }>(sql`select user_id, status from notifications where lead_id = ${leadId}`);
let n = 0;
const lead = (extra: Partial<Parameters<typeof upsertInquiry>[1]> = {}) =>
  as((tx) => upsertInquiry(tx, {
    workspaceId: ws, firstName: "Ann", lastName: "Lee", email: `ann${++n}-${owner.slice(0, 4)}@example.com`, phone: null,
    source: "form", ...extra,
  }));
const pass = { spf: "pass", dkim: "pass", dmarc: "pass" };
const forward = (over: Partial<ReceivedEmail> & { buyer?: string } = {}): ReceivedEmail => ({
  id: `re_${randomUUID()}`, from: ownerEmail, fromHeader: null, to: [`${slug}@in.example`], subject: "Fwd: Puppies",
  html: null, authentication: pass,
  text: [
    "---------- Forwarded message ---------",
    `From: Gina Park <${over.buyer ?? `gina${++n}@example.com`}>`,
    "Date: Tue, Nov 4, 2026", "Subject: Puppies", "",
    "Any males available in spring? 918-555-0101",
  ].join("\n"),
  ...over,
});

beforeAll(async () => {
  db = createDb(TEST_DATABASE_URL);
  await db.execute(sql`insert into auth.users (id, email) values (${owner}, ${ownerEmail}), (${staff}, ${staffEmail}), (${outsider}, ${outsiderEmail})`);
  slug = `nt-${owner.slice(0, 8)}`;
  otherSlug = `nt-o-${owner.slice(0, 8)}`;
  [{ id: ws }] = await q<{ id: string }>(sql`select app.create_workspace('Notify Kennel', ${slug}, 'breeder', 'America/Chicago', ${owner}, null) as id`);
  await q(sql`select app.create_workspace('Other', ${otherSlug}, 'breeder', 'America/Chicago', ${outsider}, null)`);
  await db.execute(sql`insert into memberships (user_id, workspace_id, role) values (${staff}, ${ws}, 'staff')`);
  await db.execute(sql`update workspaces set physical_address = '1 Main St' where id = ${ws}`);
});

afterAll(async () => {
  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
});

describe("new-lead notifications", () => {
  it("emails the owner, not unassigned staff, with the lead's details", async () => {
    const { leadId } = await lead();
    expect(await notesFor(leadId)).toEqual([{ user_id: owner, status: "queued" }]);

    const transports = logTransports();
    await deliverNotifications(db, transports, 500);
    const mine = transports.sink.email.filter((e) => e.to === ownerEmail);
    expect(mine).toHaveLength(1);
    expect(mine[0].subject).toBe("New lead: Ann Lee (website form)");
    expect(mine[0].text).toContain(`https://app.example/app/leads/${leadId}`);
    expect(mine[0].from).toBe(`"CoreConnect" <notifications@mail.example>`);
    expect(await notesFor(leadId)).toEqual([{ user_id: owner, status: "sent" }]);
  });

  it("skips the person who added the lead, and CSV imports", async () => {
    const quick = await lead({ actorUserId: owner, source: "call" });
    const imported = await lead({ source: "import" });
    expect(await notesFor(quick.leadId)).toEqual([]);
    expect(await notesFor(imported.leadId)).toEqual([]);
  });

  it("respects each person's own switch, including after a notification was queued", async () => {
    const queued = await lead();
    await as((tx) => tx.execute(sql`select app.set_notify_new_leads(${ws}, false)`));
    const later = await lead();
    expect(await notesFor(later.leadId)).toEqual([]);

    await deliverNotifications(db, logTransports(), 500);
    expect(await notesFor(queued.leadId)).toEqual([{ user_id: owner, status: "failed" }]);
    await as((tx) => tx.execute(sql`select app.set_notify_new_leads(${ws}, true)`));
    // Staff can flip their own switch (the rest of memberships is owner-only).
    await as((tx) => tx.execute(sql`select app.set_notify_new_leads(${ws}, false)`), staff);
    const [row] = await q<{ notify_new_leads: boolean }>(sql`select notify_new_leads from memberships where user_id = ${staff} and workspace_id = ${ws}`);
    expect(row.notify_new_leads).toBe(false);
  });
});

describe("forwarded inquiries (FR-04)", () => {
  it("turns a member's verified forward into a lead with the inquiry on the timeline", async () => {
    const r = await handleInboundEmail(db, forward({ buyer: "gina.park@example.com" }));
    expect(r).toMatchObject({ kind: "lead", created: true });
    const leadId = (r as { leadId: string }).leadId;
    const [row] = await q<{ first_name: string; last_name: string; email_norm: string; phone_e164: string; source: string }>(sql`
      select c.first_name, c.last_name, c.email_norm, c.phone_e164, l.source from leads l join contacts c on c.id = l.contact_id where l.id = ${leadId}`);
    expect(row).toEqual({ first_name: "Gina", last_name: "Park", email_norm: "gina.park@example.com", phone_e164: "+19185550101", source: "email" });
    const [act] = await q<{ payload: Record<string, string> }>(sql`
      select payload from activities where lead_id = ${leadId} and payload->>'event' = 'email_inquiry'`);
    expect(act.payload).toMatchObject({ subject: "Puppies", text: "Any males available in spring? 918-555-0101", forwarded_by: ownerEmail });
    // The buyer gets the auto-reply; the owner who forwarded it isn't notified about their own forward.
    const [auto] = await q<{ to_address: string }>(sql`select to_address from messages where lead_id = ${leadId} and kind = 'auto_reply'`);
    expect(auto.to_address).toBe("gina.park@example.com");
    expect(await notesFor(leadId)).toEqual([]);
  });

  it("ignores the same email delivered twice", async () => {
    const email = forward();
    await handleInboundEmail(db, email);
    expect(await handleInboundEmail(db, email)).toEqual({ kind: "duplicate" });
  });

  it("refuses non-members, unverified senders and other workspaces' addresses", async () => {
    expect(await handleInboundEmail(db, forward({ from: "stranger@example.com" }))).toMatchObject({ kind: "ignored" });
    expect(await handleInboundEmail(db, forward({ authentication: { spf: "fail", dkim: "gray", dmarc: "fail" } }))).toMatchObject({ kind: "ignored" });
    expect(await handleInboundEmail(db, forward({ authentication: null }))).toMatchObject({ kind: "ignored" });
    expect(await handleInboundEmail(db, forward({ from: ownerEmail, to: [`${otherSlug}@in.example`] }))).toMatchObject({ kind: "ignored" });
    expect(await handleInboundEmail(db, forward({ to: [`${slug}@elsewhere.example`] }))).toMatchObject({ kind: "ignored" });
  });

  it("reports a forward it can't read instead of guessing", async () => {
    const r = await handleInboundEmail(db, forward({ text: "Call this person back please" }));
    expect(r).toEqual({ kind: "unparsed", workspaceName: "Notify Kennel", forwarder: ownerEmail });
  });
});

describe("email replies (FR-24)", () => {
  it("threads a reply onto the lead and ends Nurture", async () => {
    const { leadId } = await lead();
    const token = createToken("reply", leadId);
    const r = await handleInboundEmail(db, {
      id: `re_${randomUUID()}`, from: "ann@example.com", fromHeader: null, to: [`Kennel <reply+${token}@in.example>`],
      subject: "Re: Thanks for reaching out", html: null, authentication: null,
      text: "Yes, Saturday works!\n\nOn Tue, Nov 4, 2026, Kennel wrote:\n> Can you visit?",
    });
    expect(r).toEqual({ kind: "reply", leadId });
    const [msg] = await q<{ body: string; direction: string; status: string }>(sql`
      select body, direction, status from messages where lead_id = ${leadId} and direction = 'in'`);
    expect(msg).toEqual({ body: "Yes, Saturday works!", direction: "in", status: "received" });
    const [e] = await q<{ status: string }>(sql`select status from sequence_enrollments where lead_id = ${leadId}`);
    expect(e.status).toBe("stopped");
  });

  it("ignores a tampered token", async () => {
    const r = await handleInboundEmail(db, {
      id: `re_${randomUUID()}`, from: "x@example.com", fromHeader: null, to: ["reply+bogus.token@in.example"],
      subject: null, text: "hi", html: null, authentication: null,
    });
    expect(r).toMatchObject({ kind: "ignored" });
  });
});
