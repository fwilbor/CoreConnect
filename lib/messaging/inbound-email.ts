import "server-only";
import { sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { htmlToText, isPersonAddress, parseForwarded, stripQuoted } from "@/lib/intake/forwarded";
import { normalizeEmail, normalizePhone, splitName } from "@/lib/intake/normalize";
import { upsertInquiry } from "@/lib/intake/upsert";
import { verifyToken } from "@/lib/tokens";
import { claimWebhookEvent } from "./inbound";

// Inbound email, received by the provider and posted to /api/webhooks/email/inbound.
//   reply+<token>@EMAIL_REPLY_DOMAIN   a buyer replying to one of our emails:
//                                      threads onto their lead (FR-24)
//   <slug>@EMAIL_INBOUND_DOMAIN        an inquiry a team member forwarded:
//                                      becomes a lead with source "email" (FR-04)
// Forwards are accepted only from the workspace's own members, and only when
// the receiving server verified the sender (SPF, DKIM or DMARC pass), so a
// stranger, or someone spoofing the owner's address, can't create leads or set
// off auto-replies to other people.

export type ReceivedEmail = {
  id: string;
  from: string; // bare address
  fromHeader: string | null; // "Name <address>"
  to: string[];
  subject: string | null;
  text: string | null;
  html: string | null;
  authentication: { spf?: string; dkim?: string; dmarc?: string } | null;
};

export type InboundOutcome =
  | { kind: "ignored"; reason: string }
  | { kind: "duplicate" }
  | { kind: "reply"; leadId: string }
  | { kind: "lead"; leadId: string; created: boolean }
  | { kind: "unparsed"; workspaceName: string; forwarder: string };

const domainOf = (addr: string) => addr.split("@")[1]?.toLowerCase() ?? "";
const localOf = (addr: string) => addr.split("@")[0]?.toLowerCase() ?? "";
const verified = (a: ReceivedEmail["authentication"]) => Boolean(a && [a.spf, a.dkim, a.dmarc].includes("pass"));

export async function handleInboundEmail(db: Database, email: ReceivedEmail): Promise<InboundOutcome> {
  // Addresses as written (case kept for reply tokens); comparisons lowercase them.
  const to = email.to.map((t) => t.match(/[^\s<>"]+@[^\s<>"]+/)?.[0]).filter((t): t is string => Boolean(t));
  const replyDomain = process.env.EMAIL_REPLY_DOMAIN?.toLowerCase();
  const inboundDomain = process.env.EMAIL_INBOUND_DOMAIN?.toLowerCase();

  const replyAddr = to.find((t) => replyDomain && domainOf(t) === replyDomain && localOf(t).startsWith("reply+"));
  // Tokens are case-sensitive: take them from the address as written.
  if (replyAddr) return threadReply(db, email, replyAddr.split("@")[0].slice("reply+".length));

  const forwardAddr = to.find((t) => inboundDomain && domainOf(t) === inboundDomain && /^[a-z0-9-]{3,40}$/.test(localOf(t)));
  if (forwardAddr) return forwardedInquiry(db, email, localOf(forwardAddr));
  return { kind: "ignored", reason: "not addressed to a CoreConnect address" };
}

async function threadReply(db: Database, email: ReceivedEmail, token: string): Promise<InboundOutcome> {
  const leadId = verifyToken(token, "reply");
  if (!leadId) return { kind: "ignored", reason: "reply token invalid or expired" };
  const body = stripQuoted(email.text?.trim() ? email.text : htmlToText(email.html ?? "")).slice(0, 10000) || "(empty reply)";

  return db.transaction(async (tx) => {
    const [lead] = (await tx.execute(sql`select workspace_id from leads where id = ${leadId}`)) as unknown as { workspace_id: string }[];
    if (!lead) return { kind: "ignored", reason: "lead no longer exists" } as const;
    if (!(await claimWebhookEvent(tx, "email", `in:${email.id}`, { email_id: email.id }))) return { kind: "duplicate" } as const;
    await tx.execute(sql`
      insert into messages (workspace_id, lead_id, channel, direction, kind, subject, body, provider_id, status, to_address)
      values (${lead.workspace_id}, ${leadId}, 'email', 'in', 'one_off', ${email.subject?.slice(0, 300) ?? null}, ${body},
              ${email.id}, 'received', ${normalizeEmail(email.from)})
      on conflict (channel, provider_id) where provider_id is not null do nothing`);
    // A reply ends the Nurture sequence, as a text reply does.
    await tx.execute(sql`
      update sequence_enrollments set status = 'stopped' where lead_id = ${leadId} and status = 'active'
        and sequence_id in (select id from sequences where system_key = 'nurture')`);
    return { kind: "reply", leadId } as const;
  });
}

async function forwardedInquiry(db: Database, email: ReceivedEmail, slug: string): Promise<InboundOutcome> {
  const forwarder = normalizeEmail(email.from);
  if (!forwarder) return { kind: "ignored", reason: "no sender" };
  if (!verified(email.authentication)) return { kind: "ignored", reason: "sender not verified (SPF/DKIM/DMARC)" };

  return db.transaction(async (tx) => {
    const [ws] = (await tx.execute(sql`
      select w.id, w.name, m.user_id from workspaces w
      join memberships m on m.workspace_id = w.id and (m.expires_at is null or m.expires_at > now())
      join users u on u.id = m.user_id and lower(u.email) = ${forwarder}
      where w.slug = ${slug} and w.billing_status <> 'read_only'`)) as unknown as { id: string; name: string; user_id: string }[];
    if (!ws) return { kind: "ignored", reason: "forwarder isn't a member of that workspace" } as const;
    if (!(await claimWebhookEvent(tx, "email", `in:${email.id}`, { email_id: email.id }))) return { kind: "duplicate" } as const;

    const parsed = parseForwarded({ text: email.text, html: email.html, subject: email.subject });
    const buyerEmail = parsed && isPersonAddress(parsed.from.email) && parsed.from.email !== forwarder ? normalizeEmail(parsed.from.email) : null;
    const phone = normalizePhone(parsed?.phone ?? null);
    if (!parsed || (!buyerEmail && !phone)) {
      return { kind: "unparsed", workspaceName: ws.name, forwarder } as const;
    }
    const name = splitName(parsed.from.name ?? (buyerEmail ? buyerEmail.split("@")[0] : "Email inquiry"));
    const result = await upsertInquiry(tx, {
      workspaceId: ws.id, firstName: name.firstName, lastName: name.lastName, email: buyerEmail, phone, source: "email",
      actorUserId: ws.user_id,
    });
    // The inquiry itself, on the timeline like a form submission.
    await tx.execute(sql`
      insert into activities (workspace_id, lead_id, type, payload, actor_user_id)
      values (${ws.id}, ${result.leadId}, 'form',
              ${JSON.stringify({ event: "email_inquiry", subject: parsed.subject, text: parsed.body || null, forwarded_by: forwarder })}::jsonb,
              ${ws.user_id})`);
    return { kind: "lead", leadId: result.leadId, created: result.leadCreated } as const;
  });
}
