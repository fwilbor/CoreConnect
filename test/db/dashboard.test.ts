import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withUser, type Database, type Tx } from "@/lib/db";
import { biggestLeak, formatDuration, loadDashboard } from "@/lib/dashboard";
import { upsertInquiry } from "@/lib/intake/upsert";
import { logContact, moveLeadToStage } from "@/lib/leads/mutations";
import { recordManualPayment } from "@/lib/payments";
import { TEST_DATABASE_URL } from "../global-setup";

process.env.NEXT_PUBLIC_SITE_URL = "https://app.example";

let db: Database;
const owner = randomUUID();
const other = randomUUID();
let ws = "";
let otherWs = "";
const as = <T,>(fn: (tx: Tx) => Promise<T>, user = owner) => withUser(user, fn, db);
const ctx = () => ({ workspaceId: ws, userId: owner });
const q = async <T = Record<string, unknown>>(query: ReturnType<typeof sql>) => (await db.execute(query)) as unknown as T[];
const stage = async (name: string) => (await q<{ id: string }>(sql`select id from pipeline_stages where workspace_id = ${ws} and name = ${name}`))[0].id;
let n = 0;
async function newLead(source: "form" | "facebook" | "referral" | "import" = "form", workspaceId = ws, user = owner) {
  return (await withUser(user, (tx) => upsertInquiry(tx, {
    workspaceId, firstName: `L${++n}`, lastName: "D", email: `l${n}-${owner.slice(0, 4)}@example.com`, phone: null, source,
  }), db)).leadId;
}

beforeAll(async () => {
  db = createDb(TEST_DATABASE_URL);
  await db.execute(sql`insert into auth.users (id, email) values (${owner}, ${`db-${owner.slice(0, 6)}@example.com`}), (${other}, ${`db-o-${other.slice(0, 6)}@example.com`})`);
  [{ id: ws }] = await q<{ id: string }>(sql`select app.create_workspace('Dash Kennel', ${`db-${owner.slice(0, 8)}`}, 'breeder', 'America/Chicago', ${owner}, null) as id`);
  [{ id: otherWs }] = await q<{ id: string }>(sql`select app.create_workspace('Other', ${`db-o-${owner.slice(0, 8)}`}, 'breeder', 'America/Chicago', ${other}, null) as id`);

  // Six form leads, two from Facebook, one imported (left out), one in another workspace.
  const form: string[] = [];
  for (let i = 0; i < 6; i++) form.push(await newLead("form"));
  const fb = [await newLead("facebook"), await newLead("facebook")];
  await newLead("import");
  await newLead("form", otherWs, other);

  const [contacted, approved, closed] = [await stage("Contacted"), await stage("Approved"), await stage("Closed")];
  // Four reach Contacted, two of them reach Approved (skipping Application), one pays a deposit.
  for (const id of form.slice(0, 4)) await as((tx) => moveLeadToStage(tx, ctx(), id, contacted));
  for (const id of form.slice(0, 2)) await as((tx) => moveLeadToStage(tx, ctx(), id, approved));
  await as((tx) => recordManualPayment(tx, ctx(), { leadId: form[0], kind: "deposit", method: "zelle", amount: "500", paidOn: new Date().toISOString().slice(0, 10), note: "" }));
  // A lost lead still counts for the stages it reached before closing.
  await as((tx) => moveLeadToStage(tx, ctx(), form[3], closed));

  // Personal replies: one after 10 minutes, one after 2 hours. Facebook leads were never answered.
  for (const [id, mins] of [[form[0], 10], [form[1], 120]] as const) {
    await as((tx) => logContact(tx, ctx(), id, "call", ""));
    await db.execute(sql`update activities set created_at = (select created_at from leads where id = ${id}) + make_interval(mins => ${mins})
                         where lead_id = ${id} and type = 'call_logged'`);
  }
  void fb;
});

afterAll(async () => {
  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
});

describe("dashboard", () => {
  it("counts this period's leads by source, without imports or other workspaces", async () => {
    const d = await as((tx) => loadDashboard(tx, ws, 30));
    expect(d.leads.count).toBe(8);
    expect(d.sources).toEqual([
      { source: "form", leads: 6, deposits: 1 },
      { source: "facebook", leads: 2, deposits: 0 },
    ]);
    expect(d.conversion).toEqual({ paid: 1, of: 8 });
  });

  it("builds the funnel from the furthest stage each lead reached", async () => {
    const d = await as((tx) => loadDashboard(tx, ws, 30));
    const reached = Object.fromEntries(d.funnel.map((s) => [s.stage, s.reached]));
    // Approved implies Application; Closed doesn't erase Contacted; the lost stage isn't a step.
    expect(reached).toMatchObject({ New: 8, Contacted: 4, Application: 2, Approved: 2, Placed: 0 });
    expect(d.funnel.map((s) => s.stage)).not.toContain("Closed");
    expect(biggestLeak(d.funnel)).toMatchObject({ from: "New", to: "Contacted", lost: 4 });
  });

  it("measures the median time to a personal reply and counts who is still waiting", async () => {
    const d = await as((tx) => loadDashboard(tx, ws, 30));
    expect(d.response.medianSeconds).toBe(65 * 60); // median of 10 and 120 minutes
    // Six leads never got a personal reply; one of them is closed, so five are waiting.
    expect(d.response.waiting).toBe(5);
  });

  it("sums this month's deposits", async () => {
    const d = await as((tx) => loadDashboard(tx, ws, 30));
    expect(d.deposits).toMatchObject({ cents: 50000, count: 1 });
  });

  it("can't be read for another workspace", async () => {
    await expect(as((tx) => loadDashboard(tx, ws, 30), other)).rejects.toThrow("Workspace not found");
  });
});

describe("dashboard helpers", () => {
  it("formats durations for people", () => {
    expect([30, 600, 5400, 40 * 3600, 30 * 86400].map(formatDuration)).toEqual(["under a minute", "10 min", "1.5 h", "1.7 days", "30 days"]);
  });

  it("ignores tiny steps when finding the biggest leak", () => {
    expect(biggestLeak([{ stage: "A", reached: 2 }, { stage: "B", reached: 0 }])).toBeNull();
    expect(biggestLeak([{ stage: "A", reached: 10 }, { stage: "B", reached: 8 }, { stage: "C", reached: 2 }]))
      .toMatchObject({ from: "B", to: "C", lost: 6 });
  });
});
