import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withUser, type Database, type Tx } from "@/lib/db";
import { runDueDigests } from "@/lib/digest";
import { upsertInquiry } from "@/lib/intake/upsert";
import { addNote, addTask } from "@/lib/leads/mutations";
import { createLitter } from "@/lib/litters";
import { logTransports } from "@/lib/messaging/transports";
import { loadToday } from "@/lib/today";
import { listLeads } from "@/lib/leads/queries";
import { isGoingCold } from "@/app/(app)/app/leads/lead-flags";
import { TEST_DATABASE_URL } from "../global-setup";

process.env.NEXT_PUBLIC_SITE_URL = "https://app.example";
process.env.EMAIL_FROM_DOMAIN = "mail.example";
delete process.env.EMAIL_FROM;

let db: Database;
const owner = randomUUID();
const other = randomUUID();
const ownerEmail = `today-${owner.slice(0, 6)}@example.com`;
let ws = "";
let quietWs = "";
const as = <T,>(fn: (tx: Tx) => Promise<T>, user = owner) => withUser(user, fn, db);
const ctx = () => ({ workspaceId: ws, userId: owner });
const q = async <T = Record<string, unknown>>(query: ReturnType<typeof sql>) => (await db.execute(query)) as unknown as T[];
let n = 0;
async function newLead(first: string) {
  const { leadId } = await as((tx) => upsertInquiry(tx, {
    workspaceId: ws, firstName: first, lastName: "T", email: `${first.toLowerCase()}${++n}-${owner.slice(0, 4)}@example.com`,
    phone: null, source: "form",
  }));
  return leadId;
}
// Makes everything about a lead look `days` old.
const age = async (leadId: string, days: number) => {
  await db.execute(sql`update leads set created_at = now() - make_interval(days => ${days}) where id = ${leadId}`);
  await db.execute(sql`update activities set created_at = now() - make_interval(days => ${days}) where lead_id = ${leadId}`);
};

beforeAll(async () => {
  db = createDb(TEST_DATABASE_URL);
  await db.execute(sql`insert into auth.users (id, email) values (${owner}, ${ownerEmail}), (${other}, ${`today-o-${other.slice(0, 6)}@example.com`})`);
  [{ id: ws }] = await q<{ id: string }>(sql`select app.create_workspace('Today Kennel', ${`td-${owner.slice(0, 8)}`}, 'breeder', 'America/Chicago', ${owner}, null) as id`);
  [{ id: quietWs }] = await q<{ id: string }>(sql`select app.create_workspace('Quiet', ${`td-q-${owner.slice(0, 8)}`}, 'breeder', 'America/Chicago', ${other}, null) as id`);
});

afterAll(async () => {
  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
});

describe("Today", () => {
  it("lists a lead untouched for 3+ days under going cold, and drops it after any activity", async () => {
    const cold = await newLead("Cora");
    const fresh = await newLead("Finn");
    await age(cold, 4);
    await age(fresh, 4);
    await as((tx) => addNote(tx, ctx(), fresh, "Called, sending photos"));

    let today = await as((tx) => loadToday(tx, ws));
    expect(today.goingCold.map((l) => l.name)).toContain("Cora T");
    expect(today.goingCold.map((l) => l.name)).not.toContain("Finn T");
    expect(today.goingCold.find((l) => l.name === "Cora T")?.days).toBe(4);
    expect(today.newLeads.map((l) => l.name)).not.toContain("Cora T");

    await as((tx) => addNote(tx, ctx(), cold, "Left a voicemail"));
    today = await as((tx) => loadToday(tx, ws));
    expect(today.goingCold.map((l) => l.name)).not.toContain("Cora T");
  });

  it("counts an inbound reply as a touch, but not automated sends", async () => {
    const replied = await newLead("Rhea");
    const nurtured = await newLead("Nell");
    for (const id of [replied, nurtured]) await age(id, 5);
    await db.execute(sql`insert into messages (workspace_id, lead_id, channel, direction, body, status)
                         values (${ws}, ${replied}, 'email', 'in', 'Still interested!', 'received')`);
    await db.execute(sql`insert into messages (workspace_id, lead_id, channel, direction, kind, subject, body, status)
                         values (${ws}, ${nurtured}, 'email', 'out', 'sequence', 'Any questions?', 'Hi', 'sent')`);
    const names = (await as((tx) => loadToday(tx, ws))).goingCold.map((l) => l.name);
    expect(names).toContain("Nell T");
    expect(names).not.toContain("Rhea T");
  });

  it("shows tasks due today or overdue, not later ones", async () => {
    const lead = await newLead("Tess");
    await as((tx) => addTask(tx, ctx(), lead, "Send photos", new Date(Date.now() - 86_400_000)));
    await as((tx) => addTask(tx, ctx(), lead, "Schedule visit", new Date(Date.now() + 3 * 86_400_000)));
    const tasks = (await as((tx) => loadToday(tx, ws))).tasksDue.filter((t) => t.lead_id === lead);
    expect(tasks.map((t) => [t.title, t.overdue])).toEqual([["Send photos", true]]);
  });

  it("shows go-home dates in the next 2 weeks, assuming 8 weeks from birth when none is set", async () => {
    const born = new Date(Date.now() - 50 * 86_400_000).toISOString().slice(0, 10);
    const later = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const soon = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    const base = { sire: "", dam: "", expectedDate: "", expectedCount: "", status: "born" as const };
    await as((tx) => createLitter(tx, ctx(), { ...base, name: "Assumed", bornDate: born }));
    await as((tx) => createLitter(tx, ctx(), { ...base, name: "Set", bornDate: born, goHomeDate: soon }));
    await as((tx) => createLitter(tx, ctx(), { ...base, name: "Later", bornDate: born, goHomeDate: later }));
    const goHome = (await as((tx) => loadToday(tx, ws))).goHome;
    expect(goHome.map((g) => [g.litter, g.assumed])).toEqual([["Set", false], ["Assumed", true]]);
  });

  it("agrees with the board's going-cold flag, lead for lead", async () => {
    const noted = await newLead("Nora");
    const quiet = await newLead("Quin");
    for (const id of [noted, quiet]) await age(id, 6);
    // A note today is a touch for both, even though nobody was "contacted".
    await as((tx) => addNote(tx, ctx(), noted, "Asked about colors"));

    const todayCold = new Set((await as((tx) => loadToday(tx, ws))).goingCold.map((l) => l.lead_id));
    const board = await as((tx) => listLeads(tx, ws));
    for (const id of [noted, quiet]) {
      const card = board.find((l) => l.id === id)!;
      expect(isGoingCold(card)).toBe(todayCold.has(id));
    }
    expect(todayCold.has(quiet)).toBe(true);
    expect(todayCold.has(noted)).toBe(false);
  });

  it("can't be read for another workspace", async () => {
    await expect(as((tx) => loadToday(tx, ws), other)).rejects.toThrow("Workspace not found");
  });
});

describe("morning digest", () => {
  it("emails the owner once a day after the digest time, and skips workspaces with nothing to report", async () => {
    await db.execute(sql`update workspaces set digest_time = '00:00', digest_sent_on = null where id in (${ws}, ${quietWs})`);
    const transports = logTransports();
    await runDueDigests(db, transports, 1000);

    const mine = transports.sink.email.filter((e) => e.to === ownerEmail);
    expect(mine).toHaveLength(1);
    expect(mine[0].subject).toMatch(/^Today Kennel: your morning digest for /);
    expect(mine[0].text).toContain("Going cold");
    expect(mine[0].text).toContain("Nell T");
    expect(mine[0].text).toContain("https://app.example/app/leads/");
    expect(mine[0].from).toBe(`"CoreConnect" <notifications@mail.example>`);
    // The quiet workspace has nothing to say, so no email, but the day is done.
    expect(transports.sink.email.filter((e) => e.to.startsWith("today-o-"))).toEqual([]);
    const sent = await q<{ id: string; done: boolean }>(sql`
      select id, digest_sent_on = (now() at time zone timezone)::date as done from workspaces where id in (${ws}, ${quietWs})`);
    expect(sent.every((r) => r.done)).toBe(true);

    const again = logTransports();
    await runDueDigests(db, again, 1000);
    expect(again.sink.email.filter((e) => e.to === ownerEmail)).toEqual([]);
  });

  it("waits for the workspace's digest time", async () => {
    // 23:59 local is later than "now" except in the last minute of the day.
    await db.execute(sql`update workspaces set digest_time = '23:59', digest_sent_on = null where id = ${ws}`);
    const transports = logTransports();
    await runDueDigests(db, transports, 1000);
    const [{ late }] = await q<{ late: boolean }>(sql`select (now() at time zone 'America/Chicago')::time >= '23:59' as late`);
    expect(transports.sink.email.filter((e) => e.to === ownerEmail)).toHaveLength(late ? 1 : 0);
  });
});
