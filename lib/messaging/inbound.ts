import "server-only";
import { sql } from "drizzle-orm";
import type { Database, Tx } from "@/lib/db";
import { normalizePhone } from "@/lib/intake/normalize";
import { upsertInquiry } from "@/lib/intake/upsert";

// Carrier opt-out and opt-in keywords (TCPA / CTIA). Twilio's Messaging Service
// sends the confirmation replies; we record the consent change.
const STOP_WORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "OPTOUT", "REVOKE"]);
const START_WORDS = new Set(["START", "UNSTOP", "YES", "OPTIN"]);

async function timelineNote(tx: Tx, workspaceId: string, contactId: string, payload: object) {
  await tx.execute(sql`
    insert into activities (workspace_id, lead_id, type, payload)
    select ${workspaceId}, l.id, 'system', ${JSON.stringify(payload)}::jsonb
    from leads l where l.contact_id = ${contactId} order by l.closed_at is null desc, l.created_at desc limit 1`);
}

// Records that a webhook event was handled; false if it already was.
export async function claimWebhookEvent(tx: Tx, provider: "stripe" | "twilio" | "email", eventId: string, payload: unknown) {
  const rows = await tx.execute(sql`
    insert into webhook_events (provider, event_id, payload, processed_at)
    values (${provider}, ${eventId}, ${JSON.stringify(payload)}::jsonb, now())
    on conflict (provider, event_id) do nothing returning id`);
  return rows.length > 0;
}

export type InboundSms = { messageSid: string; from: string; to: string; body: string };

export async function handleInboundSms(db: Database, sms: InboundSms): Promise<"ignored" | "duplicate" | "opt_out" | "opt_in" | "threaded"> {
  const from = normalizePhone(sms.from);
  const to = normalizePhone(sms.to);
  if (!from || !to) return "ignored";

  return db.transaction(async (tx) => {
    const [ws] = (await tx.execute(sql`select id from workspaces where sms_number_e164 = ${to}`)) as unknown as { id: string }[];
    if (!ws) return "ignored";
    if (!(await claimWebhookEvent(tx, "twilio", `in:${sms.messageSid}`, { from, to }))) return "duplicate";

    const keyword = sms.body.trim().toUpperCase().replace(/[^A-Z]/g, "");
    const [contact] = (await tx.execute(sql`
      select id from contacts where workspace_id = ${ws.id} and phone_e164 = ${from}`)) as unknown as { id: string }[];

    if (STOP_WORDS.has(keyword)) {
      if (contact) {
        await tx.execute(sql`update contacts set sms_consent_at = null where id = ${contact.id}`);
        await tx.execute(sql`
          update sequence_enrollments set status = 'stopped'
          where status = 'active' and lead_id in (select id from leads where contact_id = ${contact.id})`);
        await timelineNote(tx, ws.id, contact.id, { event: "sms_opt_out", keyword });
      }
      return "opt_out";
    }
    if (START_WORDS.has(keyword) && contact) {
      await tx.execute(sql`
        update contacts set sms_consent_at = now(), sms_consent_text = ${`Texted ${keyword} to ${to}`},
                            sms_consent_source = 'sms_keyword'
        where id = ${contact.id}`);
      await timelineNote(tx, ws.id, contact.id, { event: "sms_opt_in", keyword });
      return "opt_in";
    }

    // Thread onto the contact's open lead (or most recent); an unknown number
    // becomes a new lead from a text.
    let leadId: string | undefined;
    if (contact) {
      const [lead] = (await tx.execute(sql`
        select id from leads where contact_id = ${contact.id}
        order by closed_at is null desc, created_at desc limit 1`)) as unknown as { id: string }[];
      leadId = lead?.id;
    }
    if (!leadId) {
      ({ leadId } = await upsertInquiry(tx, {
        workspaceId: ws.id, firstName: "Unknown texter", email: null, phone: from, source: "text",
      }));
    }
    await tx.execute(sql`
      insert into messages (workspace_id, lead_id, channel, direction, kind, body, provider_id, status, to_address)
      values (${ws.id}, ${leadId}, 'sms', 'in', 'one_off', ${sms.body.slice(0, 2000)}, ${sms.messageSid}, 'received', ${from})
      on conflict (channel, provider_id) where provider_id is not null do nothing`);
    // A reply ends the Nurture sequence.
    await tx.execute(sql`update sequence_enrollments set status = 'stopped' where lead_id = ${leadId} and status = 'active'`);
    return "threaded";
  });
}

// Delivery receipts from Twilio (MessageStatus) or the email provider.
export async function recordDeliveryStatus(
  db: Database,
  params: { provider: "twilio" | "email"; eventId: string; providerMessageId: string; status: "delivered" | "failed"; error?: string },
) {
  await db.transaction(async (tx) => {
    if (!(await claimWebhookEvent(tx, params.provider, params.eventId, params))) return;
    await tx.execute(sql`
      update messages set status = ${params.status},
        last_error = ${params.status === "failed" ? (params.error ?? "Delivery failed").slice(0, 500) : null}
      where provider_id = ${params.providerMessageId} and direction = 'out' and status in ('sent', 'delivered')`);
  });
}

// One-click unsubscribe, an email complaint, or a hard bounce.
export async function unsubscribeEmail(db: Database, contactId: string, reason: "link" | "complaint") {
  await db.transaction(async (tx) => {
    const updated = await tx.execute(sql`
      update contacts set email_unsubscribed_at = now()
      where id = ${contactId} and email_unsubscribed_at is null returning workspace_id`);
    if (!updated.length) return;
    const workspaceId = (updated[0] as { workspace_id: string }).workspace_id;
    await tx.execute(sql`
      update sequence_enrollments set status = 'stopped'
      where status = 'active' and lead_id in (select id from leads where contact_id = ${contactId})`);
    await timelineNote(tx, workspaceId, contactId, { event: "email_unsubscribed", reason });
  });
}

export async function contactForProviderMessage(db: Database, providerMessageId: string) {
  const [row] = await db.execute(sql`
    select c.id from messages m join leads l on l.id = m.lead_id join contacts c on c.id = l.contact_id
    where m.provider_id = ${providerMessageId} limit 1`);
  return (row as { id: string } | undefined)?.id ?? null;
}
