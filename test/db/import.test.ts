import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Database } from "@/lib/db";
import { runImport, type ImportRow } from "@/lib/intake/import";
import { TEST_DATABASE_URL } from "../global-setup";

let db: Database;
const owner = randomUUID();
let wsId = "";

const count = async (query: ReturnType<typeof sql>) => ((await db.execute(query))[0] as { n: number }).n;

beforeAll(async () => {
  db = createDb(TEST_DATABASE_URL);
  await db.execute(sql`insert into auth.users (id, email) values (${owner}, ${`${owner}@example.com`})`);
  const [row] = await db.execute(sql`select app.create_workspace('Import Kennel', ${`import-${owner.slice(0, 8)}`}, 'breeder', 'America/Chicago', ${owner}, null) as id`);
  wsId = (row as { id: string }).id;
  // An existing contact the import should merge into.
  await db.execute(sql`insert into contacts (workspace_id, first_name, email_norm) values (${wsId}, 'Existing', 'existing@example.com')`);
});

afterAll(async () => {
  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
});

const rows: ImportRow[] = [
  { fullName: "Ann Lee", email: "ann@example.com", phone: "312-555-0101", tags: "Waitlist; VIP", notes: "Wants a female" },
  { firstName: "Bo", lastName: "Diaz", phone: "(312) 555-0102" },
  { fullName: "Ann Lee", email: "ANN@example.com" },             // duplicate within the file
  { fullName: "Existing Person", email: "existing@example.com" }, // matches a contact already there
  { fullName: "", email: "noname@example.com" },                   // no name
  { fullName: "Bad Contact", email: "not-an-email", phone: "123" }, // both invalid
  { fullName: "No Contact" },                                      // neither given
];

describe("CSV import", () => {
  it("previews exact counts and saves nothing", async () => {
    const before = await count(sql`select count(*)::int as n from contacts where workspace_id = ${wsId}`);
    const summary = await runImport({ userId: owner, workspaceId: wsId, rows, dryRun: true }, db);
    expect(summary).toEqual({
      total: 7, created: 2, merged: 2, conflicts: 0, committed: false,
      invalid: [
        { row: 6, reason: "No name" },
        { row: 7, reason: "Email and phone are both invalid" },
        { row: 8, reason: "No email or phone" },
      ],
    });
    expect(await count(sql`select count(*)::int as n from contacts where workspace_id = ${wsId}`)).toBe(before);
  });

  it("imports with the same result as the preview", async () => {
    const summary = await runImport({ userId: owner, workspaceId: wsId, rows, dryRun: false }, db);
    expect(summary).toMatchObject({ created: 2, merged: 2, committed: true });

    const [ann] = await db.execute(sql`
      select l.source, l.tags,
             (select count(*)::int from activities a where a.lead_id = l.id and a.type = 'note') as notes
      from leads l join contacts c on c.id = l.contact_id where c.email_norm = 'ann@example.com'`);
    expect(ann).toEqual({ source: "import", tags: expect.arrayContaining(["waitlist", "vip"]), notes: 1 });
    expect(await count(sql`select count(*)::int as n from contacts where workspace_id = ${wsId} and email_norm = 'ann@example.com'`)).toBe(1);
  });

  it("refuses files over the row limit", async () => {
    const big = Array.from({ length: 2001 }, (_, i) => ({ fullName: `P ${i}`, email: `p${i}@example.com` }));
    await expect(runImport({ userId: owner, workspaceId: wsId, rows: big, dryRun: true }, db)).rejects.toThrow(/2000/);
  });
});
