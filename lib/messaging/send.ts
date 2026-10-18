import "server-only";
import { sql } from "drizzle-orm";
import type { Database, Tx } from "@/lib/db";
import { createToken } from "@/lib/tokens";
import { buildEmail, renderTemplate } from "./render";
import { PermanentSendError, type Transports } from "./transports";

// The one path every outbound message takes. Consent rules (Automations and
// Compliance sections):
//   * do_not_contact blocks everything.
//   * Email needs an address and no unsubscribe; every email carries the
//     business's physical address and a one-click unsubscribe (CAN-SPAM).
//   * SMS needs the workspace's SMS switched on, a phone and stored consent;
//     automated SMS waits out quiet hours (9 pm to 8 am).
// Consent is checked when a message is queued and again just before delivery.

export type Channel = "email" | "sms";
export type MessageKind = "one_off" | "auto_reply" | "sequence" | "reminder" | "system";

export const MAX_ATTEMPTS = 3;
const BACKOFF_MINUTES = [1, 5, 15];

type SendContext = {
  workspace_id: string;
  workspace_name: string;
  slug: string;
  physical_address: string | null;
  sms_enabled: boolean;
  sms_number_e164: string | null;
  twilio_messaging_service_sid: string | null;
  timezone: string;
  lead_id: string;
  contact_id: string;
  first_name: string | null;
  last_name: string | null;
  email_norm: string | null;
  phone_e164: string | null;
  sms_consent_at: string | null;
  email_unsubscribed_at: string | null;
  do_not_contact: boolean;
  contact_timezone: string | null;
  deposit_amount_cents: number | null;
  waitlist_position: number | null;
  litter_name: string | null;
};

async function loadContext(tx: Tx, workspaceId: string, leadId: string): Promise<SendContext | undefined> {
  const [row] = await tx.execute(sql`
    select w.id as workspace_id, w.name as workspace_name, w.slug, w.physical_address, w.sms_enabled, w.sms_number_e164,
           w.twilio_messaging_service_sid, w.timezone,
           l.id as lead_id, c.id as contact_id, c.first_name, c.last_name, c.email_norm, c.phone_e164,
           c.sms_consent_at, c.email_unsubscribed_at, c.do_not_contact, c.timezone as contact_timezone,
           w.deposit_amount_cents, we.position as waitlist_position, li.name as litter_name
    from leads l join contacts c on c.id = l.contact_id join workspaces w on w.id = l.workspace_id
    left join lateral (
      select e.position, e.litter_id from waitlist_entries e
      where e.lead_id = l.id and e.status = 'active' order by e.created_at desc limit 1) we on true
    left join litters li on li.id = we.litter_id
    where l.id = ${leadId} and l.workspace_id = ${workspaceId}`);
  return row as SendContext | undefined;
}

// Why this message can't go out, or null when it can.
export function blockedReason(ctx: SendContext, channel: Channel): string | null {
  if (ctx.do_not_contact) return "This contact is marked do not contact";
  if (channel === "email") {
    if (!ctx.email_norm) return "This contact has no email address";
    if (ctx.email_unsubscribed_at) return "This contact unsubscribed from email";
    return null;
  }
  if (!ctx.sms_enabled) return "SMS is turned off for this workspace";
  if (!ctx.phone_e164) return "This contact has no phone number";
  if (!ctx.sms_consent_at) return "This contact hasn't agreed to texts";
  return null;
}

export const formatCents = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

export function siteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

function mergeValues(ctx: SendContext) {
  return {
    first_name: ctx.first_name,
    last_name: ctx.last_name,
    business_name: ctx.workspace_name,
    application_link: `${siteUrl()}/${ctx.slug}/apply/${createToken("apply", ctx.lead_id)}`,
    deposit_link: `${siteUrl()}/${ctx.slug}/deposit/${createToken("deposit", ctx.lead_id)}`,
    deposit_amount: ctx.deposit_amount_cents !== null ? formatCents(ctx.deposit_amount_cents) : "",
    waitlist_position: ctx.waitlist_position !== null ? String(ctx.waitlist_position) : "",
    litter_name: ctx.litter_name ?? "",
  };
}

export type QueueInput = {
  workspaceId: string;
  leadId: string;
  channel: Channel;
  kind: MessageKind;
  // Either a template or literal subject/body (a one-off typed by staff).
  templateId?: string;
  subject?: string;
  body?: string;
  createdBy?: string | null;
  sequenceStepId?: string | null;
};

export type QueueResult = { queued: true; messageId: string } | { queued: false; reason: string };

export async function queueMessage(tx: Tx, input: QueueInput): Promise<QueueResult> {
  const ctx = await loadContext(tx, input.workspaceId, input.leadId);
  if (!ctx) return { queued: false, reason: "Lead not found" };
  const blocked = blockedReason(ctx, input.channel);
  if (blocked) return { queued: false, reason: blocked };

  let subject = input.subject ?? null;
  let body = input.body ?? "";
  if (input.templateId) {
    const [tpl] = (await tx.execute(sql`
      select channel, subject, body from templates where id = ${input.templateId} and workspace_id = ${input.workspaceId}`)) as unknown as {
      channel: Channel; subject: string | null; body: string;
    }[];
    if (!tpl) return { queued: false, reason: "Template not found" };
    if (tpl.channel !== input.channel) return { queued: false, reason: `That template is for ${tpl.channel}` };
    subject = input.subject ?? tpl.subject;
    body = input.body ?? tpl.body;
  }
  const values = mergeValues(ctx);
  body = renderTemplate(body, values).trim();
  subject = subject ? renderTemplate(subject, values).trim() : null;
  if (!body) return { queued: false, reason: "The message is empty" };
  if (input.channel === "email" && !subject) return { queued: false, reason: "Add a subject" };
  if (input.channel === "sms" && body.length > 1000) return { queued: false, reason: "Texts are limited to 1,000 characters" };

  const automated = input.kind !== "one_off";
  const sendAfter = input.channel === "sms" && automated
    ? sql`app.sms_send_after(${ctx.contact_timezone ?? ctx.timezone})`
    : sql`null`;
  const [msg] = await tx.execute(sql`
    insert into messages (workspace_id, lead_id, channel, direction, kind, template_id, subject, body, status,
                          to_address, send_after, sequence_step_id, created_by)
    values (${input.workspaceId}, ${input.leadId}, ${input.channel}, 'out', ${input.kind}, ${input.templateId ?? null},
            ${subject}, ${body}, 'queued', ${input.channel === "email" ? ctx.email_norm : ctx.phone_e164},
            ${sendAfter}, ${input.sequenceStepId ?? null}, ${input.createdBy ?? null})
    returning id`);

  if (!automated) {
    // A person reached out: that's a touch, and it ends the Nurture sequence.
    await tx.execute(sql`update leads set last_contacted_at = now() where id = ${input.leadId}`);
    await tx.execute(sql`
      update sequence_enrollments set status = 'stopped' where lead_id = ${input.leadId} and status = 'active'
        and sequence_id in (select id from sequences where system_key = 'nurture')`);
  }
  return { queued: true, messageId: (msg as { id: string }).id };
}

function fromAddress(ctx: SendContext) {
  const name = ctx.workspace_name.replace(/["<>\r\n]/g, "");
  // EMAIL_FROM overrides everything (e.g. Resend's onboarding@resend.dev while
  // testing without a domain). Otherwise the shared sending domain, with the
  // business name shown as the sender (Third-party services: Email).
  if (process.env.EMAIL_FROM) return `"${name}" <${process.env.EMAIL_FROM}>`;
  const domain = process.env.EMAIL_FROM_DOMAIN;
  if (!domain) throw new PermanentSendError("Email sending isn't configured (EMAIL_FROM_DOMAIN)");
  return `"${name}" <${ctx.slug}@${domain}>`;
}

async function replyTo(tx: Tx, ctx: SendContext) {
  // Replies thread back onto the lead once inbound email is set up; until then
  // they go straight to the owner.
  const domain = process.env.EMAIL_REPLY_DOMAIN;
  if (domain) return `reply+${createToken("reply", ctx.lead_id)}@${domain}`;
  const [owner] = await tx.execute(sql`
    select u.email from memberships m join users u on u.id = m.user_id
    where m.workspace_id = ${ctx.workspace_id} and m.role = 'owner' order by m.created_at limit 1`);
  return (owner as { email: string } | undefined)?.email;
}

type QueuedMessage = {
  id: string; workspace_id: string; lead_id: string; channel: Channel; kind: MessageKind;
  subject: string | null; body: string; attempts: number;
};

// Sends one queued message. Called inside a transaction that holds the row
// lock (see worker.ts). Never throws for delivery problems: the outcome is
// written to the row.
export async function deliverMessage(tx: Tx, msg: QueuedMessage, transports: Transports): Promise<"sent" | "retry" | "failed"> {
  const fail = async (error: string, permanent: boolean) => {
    const attempts = msg.attempts + 1;
    if (permanent || attempts >= MAX_ATTEMPTS) {
      await tx.execute(sql`update messages set status = 'failed', attempts = ${attempts}, last_error = ${error.slice(0, 500)} where id = ${msg.id}`);
      return "failed" as const;
    }
    const wait = BACKOFF_MINUTES[attempts - 1] ?? 15;
    await tx.execute(sql`
      update messages set attempts = ${attempts}, last_error = ${error.slice(0, 500)},
                          send_after = now() + make_interval(mins => ${wait})
      where id = ${msg.id}`);
    return "retry" as const;
  };

  const ctx = await loadContext(tx, msg.workspace_id, msg.lead_id);
  if (!ctx) return fail("Lead no longer exists", true);
  const blocked = blockedReason(ctx, msg.channel);
  if (blocked) return fail(`Not sent: ${blocked.toLowerCase()}`, true);

  try {
    let providerId: string;
    if (msg.channel === "email") {
      if (!ctx.physical_address?.trim()) {
        return fail("Add your business mailing address in Settings before sending email (required by CAN-SPAM)", true);
      }
      const unsubscribeUrl = `${siteUrl()}/u/${createToken("unsubscribe", ctx.contact_id)}`;
      const email = buildEmail({
        subject: msg.subject ?? "", body: msg.body, businessName: ctx.workspace_name,
        physicalAddress: ctx.physical_address, unsubscribeUrl,
      });
      ({ providerId } = await transports.email({
        from: fromAddress(ctx), to: ctx.email_norm!, replyTo: await replyTo(tx, ctx), ...email,
        headers: {
          "List-Unsubscribe": `<${siteUrl()}/api/public/unsubscribe/${createToken("unsubscribe", ctx.contact_id)}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      }));
    } else {
      // Automated first texts carry opt-out instructions (carrier rules).
      const body = msg.kind === "auto_reply" && !/\bSTOP\b/.test(msg.body) ? `${msg.body} Reply STOP to opt out.` : msg.body;
      ({ providerId } = await transports.sms({
        to: ctx.phone_e164!, body, messagingServiceSid: ctx.twilio_messaging_service_sid, from: ctx.sms_number_e164,
        statusCallback: `${siteUrl()}/api/webhooks/twilio/status`,
      }));
    }
    await tx.execute(sql`
      update messages set status = 'sent', sent_at = now(), provider_id = ${providerId}, attempts = attempts + 1,
                          last_error = null
      where id = ${msg.id}`);
    return "sent";
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err), err instanceof PermanentSendError);
  }
}

// Delivers up to `limit` due messages, one transaction each, skipping rows
// another worker holds.
export async function deliverDueMessages(db: Database, transports: Transports, limit = 50, onlyId?: string) {
  const counts = { sent: 0, retry: 0, failed: 0 };
  for (let i = 0; i < limit; i++) {
    const outcome = await db.transaction(async (tx) => {
      const [msg] = await tx.execute(sql`
        select id, workspace_id, lead_id, channel, kind, subject, body, attempts from messages
        where status = 'queued' and direction = 'out' and coalesce(send_after, created_at) <= now()
          ${onlyId ? sql`and id = ${onlyId}` : sql``}
        order by coalesce(send_after, created_at)
        limit 1
        for update skip locked`);
      return msg ? deliverMessage(tx, msg as QueuedMessage, transports) : null;
    });
    if (!outcome) break;
    counts[outcome]++;
  }
  return counts;
}
