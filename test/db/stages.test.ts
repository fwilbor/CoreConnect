import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withUser, type Database, type Tx } from "@/lib/db";
import { upsertInquiry } from "@/lib/intake/upsert";
import { listStages } from "@/lib/leads/queries";
import { addStage, deleteStage, moveStage, renameStage, setDefaultStage } from "@/lib/leads/stages";
import { TEST_DATABASE_URL } from "../global-setup";

let db: Database;
const owner = randomUUID();
let ws = "";
const as = <T,>(fn: (tx: Tx) => Promise<T>) => withUser(owner, fn, db);
const ctx = () => ({ workspaceId: ws, userId: owner });
const names = async () => (await as((tx) => listStages(tx, ws))).map((s) => s.name);
const idOf = async (name: string) => (await as((tx) => listStages(tx, ws))).find((s) => s.name === name)!.id;

beforeAll(async () => {
  db = createDb(TEST_DATABASE_URL);
  await db.execute(sql`insert into auth.users (id, email) values (${owner}, ${`stages-${owner.slice(0, 6)}@example.com`})`);
  const [row] = await db.execute(sql`select app.create_workspace('Stage Kennel', ${`stages-${owner.slice(0, 8)}`}, 'service', 'America/Chicago', ${owner}, null) as id`);
  ws = (row as { id: string }).id;
});

afterAll(async () => {
  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
});

describe("stage settings", () => {
  it("starts from the service template", async () => {
    expect(await names()).toEqual(["New", "Contacted", "Application", "Approved", "Booked", "Paid", "Completed", "Closed"]);
  });

  it("adds new stages before the won and lost stages", async () => {
    await as((tx) => addStage(tx, ctx(), "Consult scheduled"));
    expect((await names()).slice(-3)).toEqual(["Consult scheduled", "Completed", "Closed"]);
    await expect(as((tx) => addStage(tx, ctx(), "consult SCHEDULED"))).rejects.toThrow("already has that name");
  });

  it("reorders open stages but never moves them past Completed", async () => {
    await as(async (tx) => moveStage(tx, ctx(), await idOf("Consult scheduled"), -1));
    expect((await names()).slice(-4)).toEqual(["Consult scheduled", "Paid", "Completed", "Closed"]);
    await as(async (tx) => moveStage(tx, ctx(), await idOf("Paid"), 1));
    expect((await names()).slice(-3)).toEqual(["Paid", "Completed", "Closed"]);
  });

  it("renames, including the won stage", async () => {
    await as(async (tx) => renameStage(tx, ctx(), await idOf("Completed"), "Graduated"));
    expect(await names()).toContain("Graduated");
  });

  it("protects won/lost stages, the default stage and stages holding leads", async () => {
    await expect(as(async (tx) => deleteStage(tx, ctx(), await idOf("Closed")))).rejects.toThrow("can be renamed but not removed");
    await expect(as(async (tx) => deleteStage(tx, ctx(), await idOf("New")))).rejects.toThrow("Choose another stage");

    await as(async (tx) => setDefaultStage(tx, ctx(), await idOf("Contacted")));
    await as((tx) => upsertInquiry(tx, { workspaceId: ws, firstName: "Lands", email: "lands@example.com", phone: null, source: "call" }));
    const [lead] = await db.execute(sql`select s.name from leads l join pipeline_stages s on s.id = l.stage_id where l.workspace_id = ${ws}`);
    expect(lead.name).toBe("Contacted");
    await expect(as(async (tx) => deleteStage(tx, ctx(), await idOf("Contacted")))).rejects.toThrow();

    await as(async (tx) => setDefaultStage(tx, ctx(), await idOf("New")));
    await expect(as(async (tx) => deleteStage(tx, ctx(), await idOf("Contacted")))).rejects.toThrow("Move the 1 lead");
  });

  it("removes an empty stage and closes the gap", async () => {
    await as(async (tx) => deleteStage(tx, ctx(), await idOf("Consult scheduled")));
    const stages = await as((tx) => listStages(tx, ws));
    expect(stages.map((s) => s.position)).toEqual(stages.map((_, i) => i + 1));
    expect(stages.map((s) => s.name)).not.toContain("Consult scheduled");
  });
});
