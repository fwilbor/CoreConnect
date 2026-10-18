import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, withUser, type Database } from "@/lib/db";
import { upsertInquiry } from "@/lib/intake/upsert";
import { moveLeadToStage } from "@/lib/leads/mutations";
import { runDueSequenceSteps } from "@/lib/messaging/automations";
import { handleInboundSms, recordDeliveryStatus, unsubscribeEmail } from "@/lib/messaging/inbound";
import { deliverDueMessages, queueMessage } from "@/lib/messaging/send";
import { logTransports, PermanentSendError, type Transports } from "@/lib/messaging/transports";
import { tick } from "@/lib/messaging/worker";
import { TEST_DATABASE_URL } from "../global-setup";

process.env.APP_TOKEN_SECRET = "test-token-secret-that-is-long-enough-123";
process.env.NEXT_PUBLIC_SITE_URL = "https://app.example";
process.env.EMAIL_FROM_DOMAIN = "mail.example";
delete process.env.EMAIL_FROM;

let db: Database;
let transports: ReturnType<typeof logTransports>;
const owner = randomUUID();
let ws = "";
const NUMBER = "+13125559000";

const q = async <T = Record<string, unknown>>(query: ReturnType<typeof sql>) => (await db.execute(query)) as unknown as T[];
let n = 0;
const lead = (extra: Partial<Parameters<typeof upsertInquiry>[1]> = {}) =>
  db.transaction((tx) => upsertInquiry(tx, {
    workspaceId: ws, firstName: "Ann", lastName: "Lee", email: `ann${++n}-${owner.slice(0, 4)}@example.com`,
    phone: `+1312555${String(1000 + n).padStart(4, "0")}`, source: "form", ...extra,
  }));
const messagesFor = (leadId: string) =>
  q<{ id: string; channel: string; kind: string; status: string; send_after: string | null; last_error: string | null; attempts: number; body: string }>(
    sql`select id, channel, kind, status, send_after, last_error, attempts, body from messages where lead_id = ${leadId} order by created_at`);

beforeAll(async () => {
  db = createDb(TEST_DATABASE_URL);
  await db.execute(sql`insert into auth.users (id, email) values (${owner}, ${`msg-owner-${owner.slice(0, 6)}@example.com`})`);
  const [row] = await q<{ id: string }>(sql`select app.create_workspace('Oak Hill', ${`msg-${owner.slice(0, 8)}`}, 'breeder', 'America/Chicago', ${owner}, null) as id`);
  ws = row.id;
  await db.execute(sql`update workspaces set physical_address = '1 Main St, Tulsa, OK 74103', sms_enabled = true,
                       sms_number_e164 = ${NUMBER} where id = ${ws}`);
});

beforeEach(() => {
  transports = logTransports();
  // Nothing else in the test database is ours to send.
  return db.execute(sql`update messages set status = 'failed' where status = 'queued' and workspace_id <> ${ws}`);
});

afterAll(async () => {
  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
});

describe("new lead automations", () => {
  it("queues the auto-reply email and enrolls in Nurture; the tick sends a compliant email", async () => {
    const { leadId } = await lead();
    expect((await messagesFor(leadId)).map((m) => [m.channel, m.kind, m.status])).toEqual([["email", "auto_reply", "queued"]]);
    const [enrollment] = await q(sql`select status, next_step from sequence_enrollments where lead_id = ${leadId}`);
    expect(enrollment).toEqual({ status: "active", next_step: 1 });

    await tick(db, transports);
    const [msg] = await messagesFor(leadId);
    expect(msg.status).toBe("sent");
    const sent = transports.sink.email.find((e) => e.to.startsWith("ann"))!;
    expect(sent.from).toMatch(/^"Oak Hill" <msg-.*@mail\.example>$/);
    expect(sent.replyTo).toBe(`msg-owner-${owner.slice(0, 6)}@example.com`);
    expect(sent.text).toContain("1 Main St, Tulsa, OK 74103");
    expect(sent.html).toMatch(/https:\/\/app\.example\/u\/[\w-]+\.[\w-]+/);
    expect(sent.headers!["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(sent.text).toMatch(/https:\/\/app\.example\/msg-[\w-]+\/apply\//);
  });

  it("adds an SMS auto-reply only with consent, held for quiet hours and carrying STOP wording", async () => {
    const { leadId } = await lead({ smsConsent: { text: "I agree", source: "test" } });
    const sms = (await messagesFor(leadId)).find((m) => m.channel === "sms")!;
    expect(sms).toMatchObject({ kind: "auto_reply", status: "queued" });
    const [{ local_hour, held }] = await q<{ local_hour: number; held: boolean }>(sql`
      select extract(hour from send_after at time zone 'America/Chicago')::int as local_hour, send_after > now() + interval '1 minute' as held
      from messages where id = ${sms.id}`);
    if (held) expect(local_hour).toBe(8);

    await db.execute(sql`update messages set send_after = now() where id = ${sms.id}`);
    await deliverDueMessages(db, transports);
    expect(transports.sink.sms.at(-1)!.body).toMatch(/Reply STOP to opt out\.$/);

    const { leadId: noConsent } = await lead();
    expect((await messagesFor(noConsent)).map((m) => m.channel)).toEqual(["email"]);
  });

  it("does nothing for CSV imports", async () => {
    const { leadId } = await lead({ source: "import" });
    expect(await messagesFor(leadId)).toEqual([]);
    expect(await q(sql`select 1 from sequence_enrollments where lead_id = ${leadId}`)).toEqual([]);
  });
});

describe("delivery", () => {
  it("refuses email without a business address (CAN-SPAM)", async () => {
    await db.execute(sql`update workspaces set physical_address = null where id = ${ws}`);
    try {
      const { leadId } = await lead();
      await deliverDueMessages(db, transports);
      const [msg] = await messagesFor(leadId);
      expect(msg).toMatchObject({ status: "failed", last_error: expect.stringContaining("mailing address") });
    } finally {
      await db.execute(sql`update workspaces set physical_address = '1 Main St, Tulsa, OK 74103' where id = ${ws}`);
    }
  });

  it("re-checks consent at send time", async () => {
    const { leadId, contactId } = await lead();
    await unsubscribeEmail(db, contactId, "link");
    await deliverDueMessages(db, transports);
    const [msg] = await messagesFor(leadId);
    expect(msg).toMatchObject({ status: "failed", last_error: "Not sent: this contact unsubscribed from email" });
    const result = await db.transaction((tx) => queueMessage(tx, { workspaceId: ws, leadId, channel: "email", kind: "one_off", subject: "Hi", body: "Hello" }));
    expect(result).toEqual({ queued: false, reason: "This contact unsubscribed from email" });
  });

  it("retries temporary failures with backoff, then gives up after 3 attempts", async () => {
    const { leadId } = await lead();
    const flaky: Transports = { ...transports, email: async () => { throw new Error("timeout"); } };
    await deliverDueMessages(db, flaky);
    let [msg] = await messagesFor(leadId);
    expect(msg).toMatchObject({ status: "queued", attempts: 1, last_error: "timeout" });
    expect(new Date(msg.send_after!).getTime()).toBeGreaterThan(Date.now());

    for (let i = 0; i < 2; i++) {
      await db.execute(sql`update messages set send_after = now() where id = ${msg.id}`);
      await deliverDueMessages(db, flaky);
    }
    [msg] = await messagesFor(leadId);
    expect(msg).toMatchObject({ status: "failed", attempts: 3 });
  });

  it("fails permanently on errors that a retry can't fix", async () => {
    const { leadId } = await lead();
    await deliverDueMessages(db, { ...transports, email: async () => { throw new PermanentSendError("Resend 422: invalid to"); } });
    expect((await messagesFor(leadId))[0]).toMatchObject({ status: "failed", attempts: 1 });
  });

  it("records delivery receipts once", async () => {
    const { leadId } = await lead();
    await deliverDueMessages(db, transports);
    const [{ provider_id }] = await q<{ provider_id: string }>(sql`select provider_id from messages where lead_id = ${leadId}`);
    await recordDeliveryStatus(db, { provider: "email", eventId: `evt-${provider_id}`, providerMessageId: provider_id, status: "delivered" });
    await recordDeliveryStatus(db, { provider: "email", eventId: `evt-${provider_id}`, providerMessageId: provider_id, status: "failed" });
    expect((await messagesFor(leadId))[0].status).toBe("delivered");
  });

  it("counts a one-off message as a touch and ends Nurture", async () => {
    const { leadId } = await lead();
    const result = await withUser(owner, (tx) => queueMessage(tx, {
      workspaceId: ws, leadId, channel: "email", kind: "one_off", subject: "Photos", body: "Hi {{first_name}}!", createdBy: owner,
    }), db);
    expect(result.queued).toBe(true);
    const [row] = await q(sql`
      select l.last_contacted_at is not null as touched, e.status, m.body
      from leads l join sequence_enrollments e on e.lead_id = l.id join messages m on m.lead_id = l.id and m.kind = 'one_off'
      where l.id = ${leadId}`);
    expect(row).toEqual({ touched: true, status: "stopped", body: "Hi Ann!" });
  });
});

describe("Nurture sequence", () => {
  const due = (leadId: string) => db.execute(sql`update sequence_enrollments set next_run_at = now() - interval '1 second' where lead_id = ${leadId}`);

  it("sends steps 1 to 3 on schedule, then completes", async () => {
    const { leadId } = await lead();
    await deliverDueMessages(db, transports);
    for (const step of [1, 2, 3]) {
      await due(leadId);
      await runDueSequenceSteps(db);
      const msgs = (await messagesFor(leadId)).filter((m) => m.kind === "sequence");
      expect(msgs).toHaveLength(step);
    }
    const [e] = await q(sql`select status from sequence_enrollments where lead_id = ${leadId}`);
    expect(e.status).toBe("completed");
  });

  it("schedules the next step from the enrollment time (day 1, 3, 7)", async () => {
    const { leadId } = await lead();
    await due(leadId);
    await runDueSequenceSteps(db);
    const [row] = await q<{ hours: number }>(sql`
      select round(extract(epoch from next_run_at - created_at) / 3600)::int as hours from sequence_enrollments where lead_id = ${leadId}`);
    expect(row.hours).toBe(72);
  });

  it("stops on an inbound reply, a stage change or a closed lead", async () => {
    const replied = await lead();
    await db.execute(sql`insert into messages (workspace_id, lead_id, channel, direction, body, status)
                         values (${ws}, ${replied.leadId}, 'email', 'in', 'Yes please', 'received')`);
    const moved = await lead();
    const [stage] = await q<{ id: string }>(sql`select id from pipeline_stages where workspace_id = ${ws} and name = 'Contacted'`);
    await withUser(owner, (tx) => moveLeadToStage(tx, { workspaceId: ws, userId: owner }, moved.leadId, stage.id), db);

    for (const l of [replied, moved]) await due(l.leadId);
    await runDueSequenceSteps(db);
    const rows = await q(sql`select status from sequence_enrollments where lead_id in (${replied.leadId}, ${moved.leadId})`);
    expect(rows.map((r) => r.status)).toEqual(["stopped", "stopped"]);
    expect((await messagesFor(replied.leadId)).filter((m) => m.kind === "sequence")).toEqual([]);
  });
});

describe("inbound SMS", () => {
  it("threads a text onto the contact's lead and ends Nurture", async () => {
    const { leadId } = await lead();
    const [{ phone_e164 }] = await q<{ phone_e164: string }>(sql`select c.phone_e164 from leads l join contacts c on c.id = l.contact_id where l.id = ${leadId}`);
    const sid = `SM${randomUUID().replace(/-/g, "")}`;
    expect(await handleInboundSms(db, { messageSid: sid, from: phone_e164, to: NUMBER, body: "Is the litter here yet?" })).toBe("threaded");
    expect(await handleInboundSms(db, { messageSid: sid, from: phone_e164, to: NUMBER, body: "Is the litter here yet?" })).toBe("duplicate");
    const inbound = (await q(sql`select direction, status, body from messages where lead_id = ${leadId} and direction = 'in'`));
    expect(inbound).toEqual([{ direction: "in", status: "received", body: "Is the litter here yet?" }]);
    const [e] = await q(sql`select status from sequence_enrollments where lead_id = ${leadId}`);
    expect(e.status).toBe("stopped");
  });

  it("creates a lead for an unknown number", async () => {
    const result = await handleInboundSms(db, { messageSid: `SM${randomUUID()}`, from: "(312) 555-8888", to: NUMBER, body: "Hi, saw your puppies" });
    expect(result).toBe("threaded");
    const [row] = await q(sql`select l.source from leads l join contacts c on c.id = l.contact_id where c.phone_e164 = '+13125558888'`);
    expect(row.source).toBe("text");
  });

  it("records STOP and START as consent changes on the timeline, and blocks texts after STOP", async () => {
    const { leadId, contactId } = await lead({ smsConsent: { text: "I agree", source: "test" } });
    const [{ phone_e164 }] = await q<{ phone_e164: string }>(sql`select phone_e164 from contacts where id = ${contactId}`);
    expect(await handleInboundSms(db, { messageSid: `SM${randomUUID()}`, from: phone_e164, to: NUMBER, body: " stop " })).toBe("opt_out");
    await db.execute(sql`update messages set send_after = now() where lead_id = ${leadId} and status = 'queued'`);
    await deliverDueMessages(db, transports);
    const sms = (await messagesFor(leadId)).find((m) => m.channel === "sms")!;
    expect(sms).toMatchObject({ status: "failed", last_error: "Not sent: this contact hasn't agreed to texts" });

    expect(await handleInboundSms(db, { messageSid: `SM${randomUUID()}`, from: phone_e164, to: NUMBER, body: "START" })).toBe("opt_in");
    const events = await q(sql`select payload->>'event' as event from activities where lead_id = ${leadId} and type = 'system' and payload ? 'keyword' order by created_at`);
    expect(events.map((e) => e.event)).toEqual(["sms_opt_out", "sms_opt_in"]);
  });

  it("ignores texts to numbers that aren't a workspace's", async () => {
    expect(await handleInboundSms(db, { messageSid: `SM${randomUUID()}`, from: "+13125550000", to: "+13125550001", body: "hi" })).toBe("ignored");
  });
});
