import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withUser, type Database } from "@/lib/db";
import { submitPublicInquiry } from "@/lib/intake/public";
import { upsertInquiry } from "@/lib/intake/upsert";
import { TEST_DATABASE_URL } from "../global-setup";

process.env.IP_HASH_SECRET = "test-secret";

let db: Database;
const owner = randomUUID();
const outsider = randomUUID();
let wsId = "";
let otherWsId = "";
const slug = `intake-${randomUUID().slice(0, 8)}`;

const passCaptcha = async () => true;
let ipCounter = 0;
const freshIp = () => `203.0.113.${++ipCounter}`;

const submit = (raw: Record<string, unknown>, opts: { ip?: string; captcha?: () => Promise<boolean> } = {}) =>
  submitPublicInquiry(
    { slug, channel: "embed", raw, turnstileToken: "token", ip: opts.ip ?? freshIp(), userAgent: "vitest" },
    { db, verifyCaptcha: opts.captcha ?? passCaptcha },
  );

const person = (overrides: Record<string, unknown> = {}) => ({
  first_name: "Jane", last_name: "Doe", email: `jane-${randomUUID().slice(0, 6)}@example.com`,
  phone: `(312) 555-${String(1000 + Math.floor(Math.random() * 8999)).slice(0, 4)}`, source: "Website",
  ...overrides,
});

const q = async <T = Record<string, unknown>>(query: ReturnType<typeof sql>) => (await db.execute(query)) as unknown as T[];

beforeAll(async () => {
  db = createDb(TEST_DATABASE_URL);
  await db.execute(sql`insert into auth.users (id, email) values (${owner}, ${`${owner}@example.com`}), (${outsider}, ${`${outsider}@example.com`})`);
  [{ id: wsId }] = await q<{ id: string }>(sql`select app.create_workspace('Intake Kennel', ${slug}, 'breeder', 'America/Chicago', ${owner}, null) as id`);
  [{ id: otherWsId }] = await q<{ id: string }>(sql`select app.create_workspace('Other Kennel', ${`${slug}-b`}, 'breeder', 'America/Chicago', ${outsider}, null) as id`);
});

afterAll(async () => {
  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
});

describe("public inquiry", () => {
  it("creates a contact and a lead at the default stage, with the submission and a timeline entry", async () => {
    const data = person({ sex_pref: "Female", owned_breed: "no", source: "Facebook" });
    expect(await submit(data)).toMatchObject({ ok: true });

    const [row] = await q(sql`
      select c.first_name, c.email_norm, c.phone_e164, l.source, s.name as stage,
             fs.answers, fs.ip_hash is not null and fs.ip_hash <> '' as hashed_ip,
             (select count(*)::int from activities a where a.lead_id = l.id) as activities
      from contacts c join leads l on l.contact_id = c.id join pipeline_stages s on s.id = l.stage_id
      join form_submissions fs on fs.lead_id = l.id
      where c.workspace_id = ${wsId} and c.email_norm = ${data.email}`);
    expect(row).toMatchObject({
      first_name: "Jane", phone_e164: expect.stringMatching(/^\+1312555\d{4}$/), source: "facebook",
      stage: "New", answers: { sex_pref: "Female", owned_breed: false }, hashed_ip: true, activities: 1,
    });
  });

  it("uses the channel as the source when the answer is Website", async () => {
    const data = person();
    await submit(data);
    const [row] = await q(sql`select l.source from leads l join contacts c on c.id = l.contact_id where c.email_norm = ${data.email}`);
    expect(row.source).toBe("embed");
  });

  it("merges a repeat inquiry into the same contact and open lead, matching phone however it is typed", async () => {
    const first = person({ email: "", phone: "312-555-0177" });
    first.email = `repeat-${randomUUID().slice(0, 6)}@example.com`;
    await submit(first);
    await submit({ ...first, email: first.email.toUpperCase(), phone: "+1 (312) 555 0177" });

    const rows = await q(sql`
      select c.id, (select count(*)::int from leads l where l.contact_id = c.id) as leads,
             (select count(*)::int from form_submissions fs join leads l on l.id = fs.lead_id where l.contact_id = c.id) as submissions
      from contacts c where c.workspace_id = ${wsId} and c.phone_e164 = '+13125550177'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ leads: 1, submissions: 2 });
  });

  it("fills a missing phone on an existing contact without overwriting their name", async () => {
    const email = `fill-${randomUUID().slice(0, 6)}@example.com`;
    await db.transaction((tx) => upsertInquiry(tx, { workspaceId: wsId, firstName: "Original", email, phone: null, source: "call" }));
    await submit(person({ first_name: "Changed", email, phone: "312-555-0188" }));
    const [row] = await q(sql`select first_name, phone_e164 from contacts where email_norm = ${email}`);
    expect(row).toEqual({ first_name: "Original", phone_e164: "+13125550188" });
  });

  it("attaches to the email match and flags both contacts when email and phone match different people", async () => {
    const emailA = `a-${randomUUID().slice(0, 6)}@example.com`;
    await db.transaction((tx) => upsertInquiry(tx, { workspaceId: wsId, firstName: "A", email: emailA, phone: null, source: "call" }));
    await db.transaction((tx) => upsertInquiry(tx, { workspaceId: wsId, firstName: "B", email: null, phone: "+13125550199", source: "call" }));

    await submit(person({ email: emailA, phone: "312-555-0199" }));
    const rows = await q(sql`
      select c.first_name, c.needs_merge_review,
             (select count(*)::int from form_submissions fs join leads l on l.id = fs.lead_id where l.contact_id = c.id) as submissions
      from contacts c where c.workspace_id = ${wsId} and (c.email_norm = ${emailA} or c.phone_e164 = '+13125550199')
      order by c.first_name`);
    expect(rows).toEqual([
      { first_name: "A", needs_merge_review: true, submissions: 1 },
      { first_name: "B", needs_merge_review: true, submissions: 0 },
    ]);
  });

  it("starts a new lead when the contact's previous lead is closed", async () => {
    const data = person();
    await submit(data);
    await db.execute(sql`
      update leads set stage_id = (select id from pipeline_stages where workspace_id = ${wsId} and kind = 'lost'),
                       closed_at = now(), closed_reason = 'went elsewhere'
      where contact_id = (select id from contacts where email_norm = ${data.email})`);
    await submit(data);
    const [row] = await q(sql`select count(*)::int as n from leads where contact_id = (select id from contacts where email_norm = ${data.email})`);
    expect(row.n).toBe(2);
  });

  it("stores SMS consent with its exact wording only when the box is ticked", async () => {
    const yes = person({ sms_consent: "on" });
    const no = person();
    await submit(yes);
    await submit(no);
    const rows = await q(sql`
      select email_norm = ${yes.email} as ticked, sms_consent_at is not null as consented, sms_consent_text
      from contacts where email_norm in (${yes.email}, ${no.email}) order by ticked desc`);
    expect(rows[0]).toMatchObject({ ticked: true, consented: true, sms_consent_text: expect.stringContaining("Reply STOP to opt out") });
    expect(rows[1]).toMatchObject({ ticked: false, consented: false, sms_consent_text: null });
  });

  it("validates required and malformed fields", async () => {
    const result = await submit({ first_name: "", email: "nope", phone: "123", source: "Carrier pigeon", sex_pref: "Puppy" });
    expect(result).toMatchObject({ ok: false, status: 400, reason: "invalid" });
    if (!result.ok) expect(Object.keys(result.errors!).sort()).toEqual(["email", "first_name", "phone", "sex_pref", "source"]);
  });

  it("pretends to accept honeypot submissions and stores nothing", async () => {
    const data = person({ company_website: "http://spam.example" });
    expect(await submit(data)).toMatchObject({ ok: true });
    const [row] = await q(sql`select count(*)::int as n from contacts where email_norm = ${data.email}`);
    expect(row.n).toBe(0);
  });

  it("rejects a failed Turnstile check", async () => {
    expect(await submit(person(), { captcha: async () => false })).toMatchObject({ ok: false, reason: "captcha" });
  });

  it("allows 5 submissions per IP per hour", async () => {
    const ip = "198.51.100.7";
    for (let i = 0; i < 5; i++) expect(await submit(person(), { ip })).toMatchObject({ ok: true });
    expect(await submit(person(), { ip })).toMatchObject({ ok: false, status: 429 });
    expect(await submit(person())).toMatchObject({ ok: true });
  });

  it("returns 404 for an unknown workspace", async () => {
    const result = await submitPublicInquiry(
      { slug: "no-such-kennel", channel: "form", raw: person(), turnstileToken: "t", ip: freshIp(), userAgent: null },
      { db, verifyCaptcha: passCaptcha },
    );
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it("creates one contact when the same person submits several times at once", async () => {
    const data = person();
    await Promise.all(Array.from({ length: 5 }, () => submit(data)));
    const [row] = await q(sql`
      select count(distinct c.id)::int as contacts, count(distinct l.id)::int as leads
      from contacts c join leads l on l.contact_id = c.id where c.email_norm = ${data.email}`);
    expect(row).toEqual({ contacts: 1, leads: 1 });
  });
});

describe("staff intake under RLS", () => {
  it("lets a member add a lead to their own workspace", async () => {
    const result = await withUser(owner, (tx) =>
      upsertInquiry(tx, { workspaceId: wsId, firstName: "Walk", lastName: "In", email: null, phone: "+13125550123",
                          source: "show", note: "Met at the Tulsa show", actorUserId: owner }), db);
    expect(result).toMatchObject({ contactCreated: true, leadCreated: true });
    const [row] = await q(sql`select count(*)::int as n from activities where lead_id = ${result.leadId} and type = 'note'`);
    expect(row.n).toBe(1);
  });

  it("refuses adding a lead to another workspace", async () => {
    const err = await withUser(owner, (tx) =>
      upsertInquiry(tx, { workspaceId: otherWsId, firstName: "X", email: "x@example.com", phone: null, source: "call" }), db,
    ).catch((e: { cause?: { code?: string } }) => e.cause?.code);
    expect(err).toBe("42501");
  });
});
