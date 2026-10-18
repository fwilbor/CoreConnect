import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withUser, type Database, type Tx } from "@/lib/db";
import { approveApplication, declineApplication, loadApplication, sendApplicationLink, submitApplication } from "@/lib/applications";
import { upsertInquiry } from "@/lib/intake/upsert";
import { createLitter, notifyWaitlist, updateLitter } from "@/lib/litters";
import { advanceToStage, LeadError } from "@/lib/leads/mutations";
import { runDueSequenceSteps } from "@/lib/messaging/automations";
import { parseDollars, recordManualPayment } from "@/lib/payments";
import { createToken } from "@/lib/tokens";
import { addToWaitlist, listWaitlist, moveEntry, removeEntry, transferEntry, waitlistHistory } from "@/lib/waitlist";
import { TEST_DATABASE_URL } from "../global-setup";

process.env.NEXT_PUBLIC_SITE_URL = "https://app.example";

let db: Database;
const owner = randomUUID();
const other = randomUUID();
let ws = "";
let slug = "";
let otherWs = "";
const as = <T,>(fn: (tx: Tx) => Promise<T>, user = owner) => withUser(user, fn, db);
const ctx = () => ({ workspaceId: ws, userId: owner });
const q = async <T = Record<string, unknown>>(query: ReturnType<typeof sql>) => (await db.execute(query)) as unknown as T[];
let n = 0;
async function newLead(first: string) {
  const { leadId } = await as((tx) => upsertInquiry(tx, {
    workspaceId: ws, firstName: first, lastName: "W", email: `${first.toLowerCase()}${++n}-${owner.slice(0, 4)}@example.com`,
    phone: null, source: "form",
  }));
  return leadId;
}
const stageOf = async (leadId: string) =>
  (await q<{ name: string }>(sql`select s.name from leads l join pipeline_stages s on s.id = l.stage_id where l.id = ${leadId}`))[0].name;
const order = async (litterId: string) => (await as((tx) => listWaitlist(tx, ws, litterId))).map((e) => `${e.position}:${e.first_name}`);

beforeAll(async () => {
  db = createDb(TEST_DATABASE_URL);
  await db.execute(sql`insert into auth.users (id, email) values (${owner}, ${`wl-${owner.slice(0, 6)}@example.com`}), (${other}, ${`wl-other-${other.slice(0, 6)}@example.com`})`);
  slug = `wl-${owner.slice(0, 8)}`;
  [{ id: ws }] = await q<{ id: string }>(sql`select app.create_workspace('Waitlist Kennel', ${slug}, 'breeder', 'America/Chicago', ${owner}, null) as id`);
  [{ id: otherWs }] = await q<{ id: string }>(sql`select app.create_workspace('Other', ${`wl-o-${owner.slice(0, 8)}`}, 'breeder', 'America/Chicago', ${other}, null) as id`);
  await db.execute(sql`update workspaces set physical_address = '1 Main St', deposit_terms = 'Deposits are non-refundable.' where id = ${ws}`);
});

afterAll(async () => {
  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
});

describe("waitlist order and history", () => {
  let litterId = "";
  const leads: Record<string, string> = {};

  it("adds in order, logs each addition and moves the lead to Waitlisted", async () => {
    litterId = await as((tx) => createLitter(tx, ctx(), { name: "Spring 2027", sire: "Max", dam: "Bella", expectedDate: "2027-03-01", bornDate: "", expectedCount: "7", status: "planned" }));
    for (const name of ["Ana", "Ben", "Cal", "Dee"]) {
      leads[name] = await newLead(name);
      await as((tx) => addToWaitlist(tx, ctx(), { leadId: leads[name], litterId, sexPref: "Female" }));
    }
    expect(await order(litterId)).toEqual(["1:Ana", "2:Ben", "3:Cal", "4:Dee"]);
    expect(await stageOf(leads.Ana)).toBe("Waitlisted");
    await expect(as((tx) => addToWaitlist(tx, ctx(), { leadId: leads.Ana, litterId }))).rejects.toThrow("already on that waitlist");
  });

  it("requires a reason to reorder and logs everyone who shifted", async () => {
    const [dee] = (await as((tx) => listWaitlist(tx, ws, litterId))).filter((e) => e.first_name === "Dee");
    await expect(as((tx) => moveEntry(tx, ctx(), dee.id, 2, "  "))).rejects.toThrow("Give a reason");
    await as((tx) => moveEntry(tx, ctx(), dee.id, 2, "Deposit paid in March 2026"));
    expect(await order(litterId)).toEqual(["1:Ana", "2:Dee", "3:Ben", "4:Cal"]);

    const history = await as((tx) => waitlistHistory(tx, ws, litterId));
    const moves = history.filter((h) => h.from_position !== null && h.to_position !== null);
    expect(moves.map((m) => `${m.first_name} ${m.from_position}->${m.to_position}`).sort()).toEqual(["Ben 2->3", "Cal 3->4", "Dee 4->2"]);
    expect(moves.find((m) => m.first_name === "Dee")!.reason).toBe("Deposit paid in March 2026");
    expect(moves.find((m) => m.first_name === "Ben")!.reason).toContain("Shifted when Dee W moved from #4 to #2");
    expect(moves.every((m) => m.actor_name?.startsWith("wl-"))).toBe(true);
  });

  it("closes the gap when someone is matched, and moves them to Matched", async () => {
    const [ana] = (await as((tx) => listWaitlist(tx, ws, litterId))).filter((e) => e.first_name === "Ana");
    await as((tx) => removeEntry(tx, ctx(), ana.id, "matched", "Matched with the red female"));
    expect(await order(litterId)).toEqual(["1:Dee", "2:Ben", "3:Cal"]);
    expect(await stageOf(leads.Ana)).toBe("Matched");
    const history = await as((tx) => waitlistHistory(tx, ws, litterId));
    expect(history.filter((h) => h.reason?.includes("Ana W (#1) matched")).length).toBe(3);
  });

  it("moves an entry to another litter's list", async () => {
    const summer = await as((tx) => createLitter(tx, ctx(), { name: "Summer 2027", sire: "", dam: "", expectedDate: "", bornDate: "", expectedCount: "", status: "planned" }));
    const [cal] = (await as((tx) => listWaitlist(tx, ws, litterId))).filter((e) => e.first_name === "Cal");
    await as((tx) => transferEntry(tx, ctx(), cal.id, summer, "Wants a later litter"));
    expect(await order(litterId)).toEqual(["1:Dee", "2:Ben"]);
    expect(await order(summer)).toEqual(["1:Cal"]);
  });

  it("refuses another workspace's waitlist", async () => {
    const [dee] = await as((tx) => listWaitlist(tx, ws, litterId));
    await expect(as((tx) => moveEntry(tx, { workspaceId: otherWs, userId: other }, dee.id, 2, "x"), other)).rejects.toThrow("not found");
    await expect(as((tx) => moveEntry(tx, { workspaceId: ws, userId: other }, dee.id, 2, "x"), other)).rejects.toThrow(LeadError);
  });

  it("emails the waitlist only once the litter is born", async () => {
    await expect(as((tx) => notifyWaitlist(tx, ctx(), litterId))).rejects.toThrow("Mark the litter as born first");
    await as((tx) => updateLitter(tx, ctx(), litterId, { name: "Spring 2027", sire: "Max", dam: "Bella", expectedDate: "2027-03-01", bornDate: "2027-03-03", expectedCount: "7", status: "born" }));
    expect(await as((tx) => notifyWaitlist(tx, ctx(), litterId))).toEqual({ queued: 2, skipped: 0 });
    const [msg] = await q<{ body: string; subject: string }>(sql`select body, subject from messages where lead_id = ${leads.Dee} and kind = 'system'`);
    expect(msg.subject).toBe("The Spring 2027 litter has arrived!");
    expect(msg.body).toContain("You are number 1 on the list");
  });
});

describe("applications", () => {
  it("sends the link, moves to Application and starts reminders", async () => {
    const leadId = await newLead("Eve");
    await as((tx) => sendApplicationLink(tx, ctx(), leadId));
    expect(await stageOf(leadId)).toBe("Application");
    const [msg] = await q<{ body: string }>(sql`select body from messages where lead_id = ${leadId} and kind = 'one_off'`);
    expect(msg.body).toMatch(new RegExp(`https://app\\.example/${slug}/apply/[\\w-]+\\.[\\w-]+`));
    const [e] = await q(sql`select e.status from sequence_enrollments e join sequences s on s.id = e.sequence_id where e.lead_id = ${leadId} and s.system_key = 'application_reminder'`);
    expect(e.status).toBe("active");
    // Sending the link was a human touch, so Nurture stopped.
    const [nurture] = await q(sql`select e.status from sequence_enrollments e join sequences s on s.id = e.sequence_id where e.lead_id = ${leadId} and s.system_key = 'nurture'`);
    expect(nurture.status).toBe("stopped");
  });

  it("accepts one valid submission per link, then stops the reminders", async () => {
    const leadId = await newLead("Fay");
    await as((tx) => sendApplicationLink(tx, ctx(), leadId));
    const token = createToken("apply", leadId);
    expect(await loadApplication(slug, token, db)).toMatchObject({ firstName: "Fay", alreadySubmitted: false });
    expect(await loadApplication("wrong-slug", token, db)).toBeNull();
    expect(await loadApplication(slug, `${token}x`, db)).toBeNull();

    const bad = await submitApplication({ slug, token, raw: { household: "" }, userAgent: null }, db);
    expect(bad).toMatchObject({ ok: false, reason: "invalid" });

    const answers = { household: "Two adults", home_type: "House with fenced yard", owned_breed: "yes", timeline: "1 to 3 months" };
    expect(await submitApplication({ slug, token, raw: answers, userAgent: "vitest" }, db)).toMatchObject({ ok: true });
    expect(await submitApplication({ slug, token, raw: answers, userAgent: "vitest" }, db)).toEqual({ ok: false, reason: "already_submitted" });

    await db.execute(sql`update sequence_enrollments set next_run_at = now() - interval '1 second' where lead_id = ${leadId}`);
    await runDueSequenceSteps(db);
    const [e] = await q(sql`select e.status from sequence_enrollments e join sequences s on s.id = e.sequence_id where e.lead_id = ${leadId} and s.system_key = 'application_reminder'`);
    expect(e.status).toBe("stopped");
  });

  it("approves onto the general waitlist; emails with the deposit link only when deposits are set up", async () => {
    const first = await newLead("Gus");
    const r1 = await as((tx) => approveApplication(tx, ctx(), { leadId: first, waitlist: "general", sendEmail: true }));
    expect(r1).toMatchObject({ position: 1, emailed: false, emailNote: expect.stringContaining("connect Stripe") });
    expect(await stageOf(first)).toBe("Waitlisted");

    await db.execute(sql`update workspaces set deposit_amount_cents = 30000, stripe_charges_enabled = true where id = ${ws}`);
    const second = await newLead("Hal");
    const r2 = await as((tx) => approveApplication(tx, ctx(), { leadId: second, waitlist: "general", sendEmail: true }));
    expect(r2).toMatchObject({ position: 2, emailed: true, emailNote: null });
    const [msg] = await q<{ body: string }>(sql`select body from messages where lead_id = ${second} and kind = 'one_off'`);
    expect(msg.body).toContain("$300.00");
    expect(msg.body).toMatch(new RegExp(`/${slug}/deposit/`));
    const [e] = await q(sql`select e.status from sequence_enrollments e join sequences s on s.id = e.sequence_id where e.lead_id = ${second} and s.system_key = 'deposit_reminder'`);
    expect(e.status).toBe("active");
  });

  it("declines politely and closes the lead as Not a fit", async () => {
    const leadId = await newLead("Ivy");
    await as((tx) => declineApplication(tx, ctx(), leadId, true));
    const [row] = await q(sql`select s.name, l.closed_reason from leads l join pipeline_stages s on s.id = l.stage_id where l.id = ${leadId}`);
    expect(row).toEqual({ name: "Closed", closed_reason: "Not a fit" });
    const [msg] = await q<{ subject: string }>(sql`select subject from messages where lead_id = ${leadId} and kind = 'one_off'`);
    expect(msg.subject).toBe("An update on your inquiry");
  });
});

describe("manual payments", () => {
  it("records a Zelle deposit with the terms in force and moves to Deposit paid", async () => {
    const leadId = await newLead("Jo");
    await as((tx) => addToWaitlist(tx, ctx(), { leadId, litterId: null }));
    await as((tx) => recordManualPayment(tx, ctx(), { leadId, kind: "deposit", method: "zelle", amount: "$300", paidOn: "2026-10-20", note: "Zelle ref 123" }));
    const [p] = await q(sql`select amount_cents, status, terms_snapshot, method from payments where lead_id = ${leadId}`);
    expect(p).toEqual({ amount_cents: 30000, status: "paid", terms_snapshot: "Deposits are non-refundable.", method: "zelle" });
    expect(await stageOf(leadId)).toBe("Deposit paid");
  });

  it("parses dollar amounts strictly", () => {
    expect(parseDollars("1,250.50")).toBe(125050);
    for (const bad of ["", "abc", "1.234", "-5", "0"]) expect(() => parseDollars(bad)).toThrow(LeadError);
  });

  it("never moves a lead backwards", async () => {
    const leadId = await newLead("Kim");
    await as((tx) => advanceToStage(tx, ctx(), leadId, "deposit_paid"));
    expect(await as((tx) => advanceToStage(tx, ctx(), leadId, "application"))).toBe(false);
    expect(await stageOf(leadId)).toBe("Deposit paid");
  });
});
