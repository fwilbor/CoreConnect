import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withUser, type Database, type Tx } from "@/lib/db";
import { upsertInquiry } from "@/lib/intake/upsert";
import {
  addNote, addTask, assignLead, logContact, moveLeadToStage, normalizeTags, setRating, setTags, setTaskDone,
  updateContact, LeadError,
} from "@/lib/leads/mutations";
import { getLeadDetail, listLeads, listStages } from "@/lib/leads/queries";
import { TEST_DATABASE_URL } from "../global-setup";

let db: Database;
const owner = randomUUID();
const staff = randomUUID();
const otherOwner = randomUUID();
let ws = "";
let otherWs = "";
let stages: Record<string, string> = {};

const as = <T,>(userId: string, fn: (tx: Tx) => Promise<T>) => withUser(userId, fn, db);
const ctx = () => ({ workspaceId: ws, userId: owner });

async function newLead(firstName: string, phone: string, extra: Partial<Parameters<typeof upsertInquiry>[1]> = {}) {
  return as(owner, (tx) =>
    upsertInquiry(tx, { workspaceId: ws, firstName, lastName: "Tester", email: null, phone, source: "call", ...extra }));
}

beforeAll(async () => {
  db = createDb(TEST_DATABASE_URL);
  await db.execute(sql`insert into auth.users (id, email) values
    (${owner}, ${`owner-${owner.slice(0, 6)}@example.com`}), (${staff}, ${`staff-${staff.slice(0, 6)}@example.com`}),
    (${otherOwner}, ${`other-${otherOwner.slice(0, 6)}@example.com`})`);
  const [a] = await db.execute(sql`select app.create_workspace('Pipeline Kennel', ${`pipe-${owner.slice(0, 8)}`}, 'breeder', 'America/Chicago', ${owner}, null) as id`);
  const [b] = await db.execute(sql`select app.create_workspace('Other Kennel', ${`pipe-other-${owner.slice(0, 8)}`}, 'breeder', 'America/Chicago', ${otherOwner}, null) as id`);
  ws = (a as { id: string }).id;
  otherWs = (b as { id: string }).id;
  await db.execute(sql`insert into memberships (user_id, workspace_id, role) values (${staff}, ${ws}, 'staff')`);
  stages = Object.fromEntries((await as(owner, (tx) => listStages(tx, ws))).map((s) => [s.name, s.id]));
});

afterAll(async () => {
  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
});

describe("stage moves", () => {
  it("closes a lead in a lost stage with a reason, reopens it, and logs both moves", async () => {
    const { leadId } = await newLead("Mover", "+13125550201");
    await as(owner, (tx) => moveLeadToStage(tx, ctx(), leadId, stages["Closed"], "Went elsewhere"));
    let [row] = await db.execute(sql`select closed_at is not null as closed, closed_reason from leads where id = ${leadId}`);
    expect(row).toEqual({ closed: true, closed_reason: "Went elsewhere" });

    await as(owner, (tx) => moveLeadToStage(tx, ctx(), leadId, stages["Contacted"]));
    [row] = await db.execute(sql`select closed_at is not null as closed, closed_reason from leads where id = ${leadId}`);
    expect(row).toEqual({ closed: false, closed_reason: null });

    const moves = await db.execute(sql`select payload->>'to' as "to" from activities where lead_id = ${leadId} and type = 'stage_change' order by created_at`);
    expect(moves.map((m) => m.to)).toEqual(["Closed", "Contacted"]);
  });

  it("closes a placed lead without a reason", async () => {
    const { leadId } = await newLead("Placed", "+13125550202");
    await as(owner, (tx) => moveLeadToStage(tx, ctx(), leadId, stages["Placed"]));
    const [row] = await db.execute(sql`select closed_at is not null as closed, closed_reason from leads where id = ${leadId}`);
    expect(row).toEqual({ closed: true, closed_reason: null });
  });

  it("stops an active sequence when the stage changes", async () => {
    const { leadId } = await newLead("Nurtured", "+13125550203");
    await db.execute(sql`insert into sequence_enrollments (workspace_id, lead_id, sequence_id)
                         select ${ws}, ${leadId}, id from sequences where workspace_id = ${ws}`);
    await as(staff, (tx) => moveLeadToStage(tx, { workspaceId: ws, userId: staff }, leadId, stages["Contacted"]));
    const [row] = await db.execute(sql`select status from sequence_enrollments where lead_id = ${leadId}`);
    expect(row.status).toBe("stopped");
  });

  it("refuses another workspace's stage or lead", async () => {
    const { leadId } = await newLead("Guarded", "+13125550204");
    const [otherStage] = await db.execute(sql`select id from pipeline_stages where workspace_id = ${otherWs} and is_default`);
    await expect(as(owner, (tx) => moveLeadToStage(tx, ctx(), leadId, otherStage.id as string))).rejects.toThrow(LeadError);
    await expect(
      as(otherOwner, (tx) => moveLeadToStage(tx, { workspaceId: ws, userId: otherOwner }, leadId, stages["Contacted"])),
    ).rejects.toThrow("Lead not found");
  });
});

describe("lead details", () => {
  it("keeps the next task due date in step with open tasks", async () => {
    const { leadId } = await newLead("Tasked", "+13125550205");
    const soon = new Date(Date.now() + 86_400_000);
    const later = new Date(Date.now() + 3 * 86_400_000);
    const t1 = await as(owner, (tx) => addTask(tx, ctx(), leadId, "Send photos", later));
    const t2 = await as(owner, (tx) => addTask(tx, ctx(), leadId, "Call back", soon));
    const due = async () => {
      const value = (await db.execute(sql`select next_task_due_at from leads where id = ${leadId}`))[0].next_task_due_at as string | null;
      return value ? new Date(value).toISOString() : undefined;
    };

    expect(await due()).toBe(soon.toISOString());
    await as(owner, (tx) => setTaskDone(tx, ctx(), t2, true));
    expect(await due()).toBe(later.toISOString());
    await as(owner, (tx) => setTaskDone(tx, ctx(), t1, true));
    expect(await due()).toBeUndefined();
    await as(owner, (tx) => setTaskDone(tx, ctx(), t1, false));
    expect(await due()).toBe(later.toISOString());
  });

  it("normalizes tags and validates rating and assignee", async () => {
    const { leadId } = await newLead("Tagged", "+13125550206");
    await as(owner, (tx) => setTags(tx, ctx(), leadId, [" Waitlist ", "waitlist", "Show  Contact"]));
    await as(owner, (tx) => setRating(tx, ctx(), leadId, 4));
    await as(owner, (tx) => assignLead(tx, ctx(), leadId, staff));
    const [row] = await db.execute(sql`select tags, rating, assigned_user_id from leads where id = ${leadId}`);
    expect(row).toEqual({ tags: ["waitlist", "show contact"], rating: 4, assigned_user_id: staff });

    await expect(as(owner, (tx) => setRating(tx, ctx(), leadId, 6))).rejects.toThrow(LeadError);
    await expect(as(owner, (tx) => assignLead(tx, ctx(), leadId, otherOwner))).rejects.toThrow("isn't on this workspace");
    expect(() => normalizeTags(Array.from({ length: 21 }, (_, i) => `t${i}`))).toThrow(LeadError);
  });

  it("logs a call as a touch and records notes on the timeline", async () => {
    const { leadId } = await newLead("Called", "+13125550207");
    await as(owner, (tx) => logContact(tx, ctx(), leadId, "call", "Left a voicemail"));
    await as(owner, (tx) => addNote(tx, ctx(), leadId, "Prefers a male"));
    const detail = await as(owner, (tx) => getLeadDetail(tx, ws, leadId));
    expect(detail!.lead.last_contacted_at).not.toBeNull();
    expect(detail!.timeline.map((t) => t.type).slice(0, 3)).toEqual(["note", "call_logged", "system"]);
    expect(detail!.timeline[0].actor_name).toContain("owner-");
  });

  it("refuses a contact edit that would duplicate another contact's phone", async () => {
    await newLead("First", "+13125550208");
    const { contactId } = await newLead("Second", "+13125550209");
    await expect(as(owner, (tx) => updateContact(tx, ctx(), contactId, {
      firstName: "Second", lastName: "", email: "", phone: "312-555-0208", city: "", state: "",
    }))).rejects.toThrow("Another contact");
  });

  it("returns null for another workspace's lead", async () => {
    const { leadId } = await newLead("Private", "+13125550210");
    expect(await as(otherOwner, (tx) => getLeadDetail(tx, ws, leadId))).toBeNull();
  });
});

describe("search and filters", () => {
  it("finds leads by name, phone digits, email and tag", async () => {
    const { leadId } = await newLead("Searchable", "+13125550299", { email: "find.me@example.com", tags: ["vip"] });
    const ids = async (q: string) => (await as(owner, (tx) => listLeads(tx, ws, { q }))).map((l) => l.id);
    for (const q of ["searchable tester", "555-0299", "find.me", "VIP"]) expect(await ids(q)).toContain(leadId);
    expect(await ids("nobody-matches-this")).toEqual([]);
    expect(await ids("100%")).toEqual([]);
  });

  it("filters by stage, tag and last contact, and hides leads closed over 30 days ago", async () => {
    const { leadId: fresh } = await newLead("Fresh", "+13125550301", { tags: ["puppy"] });
    const { leadId: old } = await newLead("Old", "+13125550302");
    await as(owner, (tx) => moveLeadToStage(tx, ctx(), old, stages["Closed"], "No response"));
    await db.execute(sql`update leads set closed_at = now() - interval '40 days' where id = ${old}`);

    const list = (f: Parameters<typeof listLeads>[2]) => as(owner, (tx) => listLeads(tx, ws, f)).then((r) => r.map((l) => l.id));
    expect(await list({ tag: "puppy" })).toEqual([fresh]);
    expect(await list({ stageId: stages["New"] })).toContain(fresh);
    expect(await list({})).not.toContain(old);
    expect(await list({ includeClosed: true })).toContain(old);
    expect(await list({ notContacted: "never" })).toContain(fresh);
  });
});
