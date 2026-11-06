import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Database } from "@/lib/db";
import { assignSmsNumber, normalizeNumber, removeSmsNumber, twilioAccount, type TwilioFetch } from "@/lib/sms-setup";
import { TEST_DATABASE_URL } from "../global-setup";

let db: Database;
const owner = randomUUID();
let wsA = "";
let wsB = "";
// Unique per run so reruns against the same database don't collide.
const NUM = `+1312${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
const SERVICE = `MG${"a".repeat(32)}`;

type Call = { path: string; method: string; body?: Record<string, string>; base?: string };
let calls: Call[];
// A fake Twilio that owns NUM (as PN1) and SERVICE.
const fake = (over: { owns?: boolean; sms?: boolean; fail?: string } = {}): TwilioFetch => async (path, init = {}) => {
  calls.push({ path, method: init.method ?? "GET", body: init.body ? Object.fromEntries(init.body) : undefined, base: init.base });
  if (over.fail && path.includes(over.fail)) return { ok: false, status: 404, data: {} };
  if (path.startsWith("/IncomingPhoneNumbers.json")) {
    const owns = over.owns ?? true;
    return { ok: true, status: 200, data: { incoming_phone_numbers: owns ? [{ sid: "PN1", capabilities: { sms: over.sms ?? true } }] : [] } };
  }
  if (path === ".json") return { ok: true, status: 200, data: { status: "active", type: "Trial" } };
  return { ok: true, status: 200, data: {} };
};
const row = async (id: string) => ((await db.execute(sql`
  select sms_number_e164, twilio_messaging_service_sid, sms_enabled from workspaces where id = ${id}`)) as unknown as {
  sms_number_e164: string | null; twilio_messaging_service_sid: string | null; sms_enabled: boolean;
}[])[0];

beforeAll(async () => {
  db = createDb(TEST_DATABASE_URL);
  await db.execute(sql`insert into auth.users (id, email) values (${owner}, ${`sms-${owner.slice(0, 6)}@example.com`})`);
  const mk = async (s: string) => ((await db.execute(sql`
    select app.create_workspace(${s}, ${`sms-${s}-${owner.slice(0, 8)}`}, 'breeder', 'America/Chicago', ${owner}, null) as id`)) as unknown as { id: string }[])[0].id;
  wsA = await mk("a");
  wsB = await mk("b");
});

beforeEach(() => {
  calls = [];
  process.env.TWILIO_ACCOUNT_SID = "ACtest";
  process.env.TWILIO_AUTH_TOKEN = "token";
  process.env.NEXT_PUBLIC_SITE_URL = "https://app.example";
});

afterAll(async () => {
  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
});

describe("normalizeNumber", () => {
  it("accepts common US formats and +E.164, rejects the rest", () => {
    expect(normalizeNumber("(312) 555-0100")).toBe("+13125550100");
    expect(normalizeNumber("1-312-555-0100")).toBe("+13125550100");
    expect(normalizeNumber("+44 20 7946 0958")).toBe("+442079460958");
    expect(normalizeNumber("555-0100")).toBeNull();
    expect(normalizeNumber("+0123")).toBeNull();
  });
});

describe("assignSmsNumber", () => {
  it("saves a number Twilio owns and points its incoming texts at the app", async () => {
    const r = await assignSmsNumber(db, { workspaceId: wsA, number: NUM }, fake());
    expect(r).toEqual({ ok: true, number: NUM, webhook: "set" });
    expect(calls.at(-1)).toEqual({
      path: "/IncomingPhoneNumbers/PN1.json", method: "POST", base: undefined,
      body: { SmsUrl: "https://app.example/api/webhooks/twilio/sms", SmsMethod: "POST" },
    });
    expect(await row(wsA)).toMatchObject({ sms_number_e164: NUM, twilio_messaging_service_sid: null });
  });

  it("with a Messaging Service, sets the webhook on the service instead", async () => {
    const r = await assignSmsNumber(db, { workspaceId: wsA, number: NUM, messagingServiceSid: SERVICE }, fake());
    expect(r.ok).toBe(true);
    expect(calls.at(-1)).toMatchObject({
      path: `/${SERVICE}`, method: "POST", base: "https://messaging.twilio.com/v1/Services",
      body: { InboundRequestUrl: "https://app.example/api/webhooks/twilio/sms", UseInboundWebhookOnNumber: "false" },
    });
    expect((await row(wsA)).twilio_messaging_service_sid).toBe(SERVICE);
  });

  it("refuses a number another workspace already has", async () => {
    const r = await assignSmsNumber(db, { workspaceId: wsB, number: NUM }, fake());
    expect(r).toEqual({ ok: false, error: expect.stringContaining("already the texting number") });
    expect(calls).toEqual([]);
    expect((await row(wsB)).sms_number_e164).toBeNull();
  });

  it("refuses numbers not on the Twilio account or without SMS", async () => {
    const other = "+13125550199";
    expect(await assignSmsNumber(db, { workspaceId: wsB, number: other }, fake({ owns: false })))
      .toEqual({ ok: false, error: expect.stringContaining("isn't a number on this Twilio account") });
    expect(await assignSmsNumber(db, { workspaceId: wsB, number: other }, fake({ sms: false })))
      .toEqual({ ok: false, error: expect.stringContaining("can't send text messages") });
    expect((await row(wsB)).sms_number_e164).toBeNull();
  });

  it("validates input before calling Twilio", async () => {
    expect((await assignSmsNumber(db, { workspaceId: wsB, number: "12" }, fake())).ok).toBe(false);
    expect((await assignSmsNumber(db, { workspaceId: wsB, number: NUM, messagingServiceSid: "MG123" }, fake())).ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it("doesn't save when Twilio can't update the service", async () => {
    const r = await assignSmsNumber(db, { workspaceId: wsB, number: "+13125550198", messagingServiceSid: SERVICE }, fake({ fail: SERVICE }));
    expect(r.ok).toBe(false);
    expect((await row(wsB)).sms_number_e164).toBeNull();
  });

  it("on localhost, saves without touching webhooks", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
    const num = "+13125550197";
    expect(await assignSmsNumber(db, { workspaceId: wsB, number: num }, fake())).toEqual({ ok: true, number: num, webhook: "skipped_local" });
    expect(calls.map((c) => c.method)).toEqual(["GET"]);
  });

  it("removing the number turns texting off", async () => {
    await db.execute(sql`update workspaces set sms_enabled = true where id = ${wsA}`);
    await removeSmsNumber(db, wsA);
    expect(await row(wsA)).toEqual({ sms_number_e164: null, twilio_messaging_service_sid: null, sms_enabled: false });
  });

  it("the database refuses the same number on two workspaces", async () => {
    await db.execute(sql`update workspaces set sms_number_e164 = '+13125550196' where id = ${wsA}`);
    await expect(db.execute(sql`update workspaces set sms_number_e164 = '+13125550196' where id = ${wsB}`)).rejects.toThrow();
  });
});

describe("twilioAccount", () => {
  it("reports trial accounts and missing credentials", async () => {
    expect(await twilioAccount(fake())).toEqual({ ok: true, trial: true });
    delete process.env.TWILIO_AUTH_TOKEN;
    expect((await twilioAccount(fake())).ok).toBe(false);
  });
});
