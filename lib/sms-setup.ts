import "server-only";
import { sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { siteUrl } from "@/lib/messaging/send";

// Platform-admin setup of a workspace's texting number. The Twilio account is
// CoreConnect's (TWILIO_ACCOUNT_SID), so numbers are assigned here, not by the
// workspace owner; the owner only turns texting on or off in Settings.
//
// Assigning a number checks it belongs to our Twilio account and can send SMS,
// refuses one already used by another workspace (inbound texts are routed by
// number), and points the number's incoming-message webhook at this app when
// the app has a public https URL.

export type TwilioFetch = (path: string, init?: { method?: string; body?: URLSearchParams; base?: string }) => Promise<{
  ok: boolean; status: number; data: Record<string, unknown>;
}>;

export const twilioConfigured = () => Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);

export const twilioFetch: TwilioFetch = async (path, init = {}) => {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const base = init.base ?? `https://api.twilio.com/2010-04-01/Accounts/${sid}`;
  const res = await fetch(`${base}${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}` },
    body: init.body,
    signal: AbortSignal.timeout(15_000),
  });
  return { ok: res.ok, status: res.status, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
};

export type TwilioAccount = { ok: true; trial: boolean } | { ok: false; error: string };

export async function twilioAccount(call: TwilioFetch = twilioFetch): Promise<TwilioAccount> {
  if (!twilioConfigured()) return { ok: false, error: "Twilio isn't configured (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN). Texts are only logged." };
  try {
    const r = await call(".json");
    if (!r.ok) return { ok: false, error: `Twilio rejected the credentials (${r.status}).` };
    if (r.data.status !== "active") return { ok: false, error: `The Twilio account is ${String(r.data.status)}.` };
    return { ok: true, trial: r.data.type === "Trial" };
  } catch {
    return { ok: false, error: "Couldn't reach Twilio." };
  }
}

// US numbers may be typed any common way; anything else must already be +E.164.
export function normalizeNumber(input: string): string | null {
  const s = input.trim();
  const digits = s.replace(/\D/g, "");
  if (s.startsWith("+")) return /^[1-9]\d{6,14}$/.test(digits) ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

const SERVICE_SID = /^MG[0-9a-f]{32}$/;
const SERVICES_BASE = "https://messaging.twilio.com/v1/Services";

// Where Twilio should post incoming texts, or null when this app can't be
// reached from the internet (localhost), in which case nothing is changed.
export function inboundWebhookUrl(): string | null {
  const url = siteUrl();
  return /^https:\/\//.test(url) && !/localhost|127\.0\.0\.1/.test(url) ? `${url}/api/webhooks/twilio/sms` : null;
}

export type AssignResult =
  | { ok: true; number: string; webhook: "set" | "skipped_local" }
  | { ok: false; error: string };

export async function assignSmsNumber(
  db: Database,
  input: { workspaceId: string; number: string; messagingServiceSid?: string },
  call: TwilioFetch = twilioFetch,
): Promise<AssignResult> {
  const number = normalizeNumber(input.number);
  if (!number) return { ok: false, error: "Enter a phone number like (312) 555-0100 or +13125550100." };
  const service = input.messagingServiceSid?.trim() || null;
  if (service && !SERVICE_SID.test(service)) return { ok: false, error: "A Messaging Service SID starts with MG followed by 32 characters." };
  if (!twilioConfigured()) return { ok: false, error: "Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN first." };

  const [taken] = (await db.execute(sql`
    select name from workspaces where sms_number_e164 = ${number} and id <> ${input.workspaceId}`)) as unknown as { name: string }[];
  if (taken) return { ok: false, error: `${number} is already the texting number for ${taken.name}.` };

  let owned;
  try {
    owned = await call(`/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(number)}`);
  } catch {
    return { ok: false, error: "Couldn't reach Twilio. Try again." };
  }
  if (!owned.ok) return { ok: false, error: `Twilio returned ${owned.status} looking up the number.` };
  const found = (owned.data.incoming_phone_numbers as { sid: string; capabilities?: { sms?: boolean } }[] | undefined)?.[0];
  if (!found) return { ok: false, error: `${number} isn't a number on this Twilio account. Buy it in Twilio first.` };
  if (found.capabilities?.sms === false) return { ok: false, error: `${number} can't send text messages.` };

  // Incoming texts: a Messaging Service's own webhook wins over the number's,
  // so set it where Twilio will actually use it.
  const webhook = inboundWebhookUrl();
  if (webhook) {
    const body = service
      ? new URLSearchParams({ InboundRequestUrl: webhook, InboundMethod: "POST", UseInboundWebhookOnNumber: "false" })
      : new URLSearchParams({ SmsUrl: webhook, SmsMethod: "POST" });
    let r;
    try {
      r = service
        ? await call(`/${service}`, { method: "POST", body, base: SERVICES_BASE })
        : await call(`/IncomingPhoneNumbers/${found.sid}.json`, { method: "POST", body });
    } catch {
      return { ok: false, error: "Couldn't reach Twilio to set the incoming-text webhook. Try again." };
    }
    if (!r.ok) {
      return { ok: false, error: service
        ? `Twilio couldn't update Messaging Service ${service} (${r.status}). Check the SID.`
        : `Twilio couldn't set the number's incoming-text webhook (${r.status}).` };
    }
  } else if (service) {
    try {
      const r = await call(`/${service}`, { base: SERVICES_BASE });
      if (!r.ok) return { ok: false, error: `Messaging Service ${service} wasn't found on this Twilio account.` };
    } catch {
      return { ok: false, error: "Couldn't reach Twilio. Try again." };
    }
  }

  try {
    await db.execute(sql`
      update workspaces set sms_number_e164 = ${number}, twilio_messaging_service_sid = ${service} where id = ${input.workspaceId}`);
  } catch (e) {
    // The unique index catches a race with another assignment.
    if ((e as { code?: string; cause?: { code?: string } }).code === "23505" || (e as { cause?: { code?: string } }).cause?.code === "23505") {
      return { ok: false, error: `${number} is already used by another workspace.` };
    }
    throw e;
  }
  return { ok: true, number, webhook: webhook ? "set" : "skipped_local" };
}

// Taking the number away also turns texting off, so nothing queues against a
// workspace that can't send.
export async function removeSmsNumber(db: Database, workspaceId: string) {
  await db.execute(sql`
    update workspaces set sms_number_e164 = null, twilio_messaging_service_sid = null, sms_enabled = false where id = ${workspaceId}`);
}
