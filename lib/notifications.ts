import "server-only";
import { sql } from "drizzle-orm";
import type { Database, Tx } from "@/lib/db";
import { escapeHtml } from "@/lib/messaging/render";
import { MAX_ATTEMPTS, siteUrl } from "@/lib/messaging/send";
import { PermanentSendError, type Transports } from "@/lib/messaging/transports";

// New-lead emails to the team (Automations: "New lead created: notify owner and
// assignee by email ... immediately"). Queued in the transaction that creates
// the lead, delivered by the tick with the same retry rules as messages.
// Members can switch them off for themselves (memberships.notify_new_leads).

const BACKOFF_MINUTES = [1, 5, 15];

const SOURCE_LABEL: Record<string, string> = {
  form: "website form", embed: "embedded form", email: "email", facebook: "Facebook", instagram: "Instagram",
  text: "text message", call: "phone call", show: "show or event", referral: "referral", other: "other",
};

export async function queueNewLeadNotifications(tx: Tx, workspaceId: string, leadId: string, exceptUserId: string | null = null) {
  await tx.execute(sql`
    insert into notifications (workspace_id, lead_id, user_id, kind)
    select ${workspaceId}, l.id, m.user_id, 'new_lead'
    from leads l join memberships m on m.workspace_id = l.workspace_id
    where l.id = ${leadId} and l.workspace_id = ${workspaceId} and m.notify_new_leads
      and (m.role = 'owner' or m.user_id = l.assigned_user_id)
      and m.user_id is distinct from ${exceptUserId}::uuid
    on conflict do nothing`);
}

type Detail = {
  workspace_name: string; lead_id: string; first_name: string | null; last_name: string | null; email_norm: string | null;
  phone_e164: string | null; source: string; fields: { key: string; label: string }[] | null;
  answers: Record<string, unknown> | null; first_message: string | null;
};

export function buildNewLeadEmail(d: Detail) {
  const name = [d.first_name, d.last_name].filter(Boolean).join(" ") || d.email_norm || d.phone_e164 || "Someone";
  const source = SOURCE_LABEL[d.source] ?? d.source;
  const link = `${siteUrl()}/app/leads/${d.lead_id}`;
  const contact = [d.email_norm, d.phone_e164].filter(Boolean) as string[];
  const answers = (d.fields ?? [])
    .map((f) => {
      const v = d.answers?.[f.key];
      if (v === undefined || v === null || v === "") return null;
      return [f.label, Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v)] as const;
    })
    .filter((a): a is readonly [string, string] => a !== null);
  const said = d.first_message?.trim().slice(0, 1500) || null;

  const subject = `New lead: ${name} (${source})`.replace(/[\r\n]+/g, " ");
  const text = [
    `${name} just came in through your ${source}.`,
    contact.join("\n"),
    ...answers.map(([l, v]) => `${l}: ${v}`),
    said ? `They wrote:\n${said}` : null,
    `Open the lead: ${link}`,
    `You get this because new-lead emails are on for you in ${d.workspace_name}. Turn them off: ${siteUrl()}/app/settings/notifications`,
  ].filter(Boolean).join("\n\n");

  const row = (l: string, v: string) =>
    `<tr><td style="padding:2px 12px 2px 0;color:#737373;vertical-align:top">${escapeHtml(l)}</td><td style="padding:2px 0">${escapeHtml(v)}</td></tr>`;
  const html =
    `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#171717;max-width:560px;margin:0 auto;padding:16px">` +
    `<p style="margin:0 0 4px;font-size:20px;font-weight:600">${escapeHtml(name)}</p>` +
    `<p style="margin:0 0 16px;color:#525252">New lead from your ${escapeHtml(source)}</p>` +
    `<table style="border-collapse:collapse;margin:0 0 16px">` +
    (d.email_norm ? row("Email", d.email_norm) : "") + (d.phone_e164 ? row("Phone", d.phone_e164) : "") +
    answers.map(([l, v]) => row(l, v)).join("") + `</table>` +
    (said ? `<p style="margin:0 0 4px;color:#737373">They wrote</p><p style="margin:0 0 16px;white-space:pre-wrap">${escapeHtml(said)}</p>` : "") +
    `<p style="margin:0 0 24px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#171717;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px">Open the lead</a></p>` +
    `<p style="margin:0;font-size:12px;color:#737373">You get this because new-lead emails are on for you in ${escapeHtml(d.workspace_name)}. ` +
    `<a href="${escapeHtml(siteUrl())}/app/settings/notifications" style="color:#737373">Turn them off</a>.</p></body></html>`;
  return { subject, text, html };
}

function notificationFrom() {
  if (process.env.EMAIL_FROM) return `"CoreConnect" <${process.env.EMAIL_FROM}>`;
  const domain = process.env.EMAIL_FROM_DOMAIN;
  if (!domain) throw new PermanentSendError("Email sending isn't configured (EMAIL_FROM_DOMAIN)");
  return `"CoreConnect" <notifications@${domain}>`;
}

// Delivers due notifications, one per transaction, skipping rows another
// worker holds. Never throws for delivery problems: the outcome goes on the row.
export async function deliverNotifications(db: Database, transports: Transports, limit = 50) {
  const counts = { sent: 0, retry: 0, failed: 0 };
  for (let i = 0; i < limit; i++) {
    const outcome = await db.transaction(async (tx) => {
      const [n] = (await tx.execute(sql`
        select n.id, n.attempts, n.lead_id, n.user_id, u.email, m.notify_new_leads as still_on
        from notifications n join users u on u.id = n.user_id
        left join memberships m on m.user_id = n.user_id and m.workspace_id = n.workspace_id
        where n.status = 'queued' and coalesce(n.send_after, n.created_at) <= now()
        order by coalesce(n.send_after, n.created_at) limit 1
        for update of n skip locked`)) as unknown as { id: string; attempts: number; lead_id: string; email: string; still_on: boolean | null }[];
      if (!n) return null;

      const fail = async (error: string, permanent: boolean) => {
        const attempts = n.attempts + 1;
        if (permanent || attempts >= MAX_ATTEMPTS) {
          await tx.execute(sql`update notifications set status = 'failed', attempts = ${attempts}, last_error = ${error.slice(0, 500)} where id = ${n.id}`);
          return "failed" as const;
        }
        await tx.execute(sql`
          update notifications set attempts = ${attempts}, last_error = ${error.slice(0, 500)},
            send_after = now() + make_interval(mins => ${BACKOFF_MINUTES[attempts - 1] ?? 15})
          where id = ${n.id}`);
        return "retry" as const;
      };
      // Left the workspace or switched notifications off since this was queued.
      if (!n.still_on) return fail("New-lead emails are off for this person", true);

      const [d] = (await tx.execute(sql`
        select w.name as workspace_name, l.id as lead_id, c.first_name, c.last_name, c.email_norm, c.phone_e164, l.source,
               f.fields, fs.answers,
               coalesce(
                 (select a.payload->>'text' from activities a where a.lead_id = l.id and a.payload->>'event' = 'email_inquiry'
                  order by a.created_at limit 1),
                 (select m.body from messages m where m.lead_id = l.id and m.direction = 'in' order by m.created_at limit 1)) as first_message
        from leads l join contacts c on c.id = l.contact_id join workspaces w on w.id = l.workspace_id
        left join lateral (select form_id, answers from form_submissions where lead_id = l.id order by submitted_at limit 1) fs on true
        left join forms f on f.id = fs.form_id
        where l.id = ${n.lead_id}`)) as unknown as Detail[];
      if (!d) return fail("Lead no longer exists", true);

      try {
        await transports.email({ from: notificationFrom(), to: n.email, ...buildNewLeadEmail(d) });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err), err instanceof PermanentSendError);
      }
      await tx.execute(sql`update notifications set status = 'sent', sent_at = now(), attempts = attempts + 1, last_error = null where id = ${n.id}`);
      return "sent" as const;
    });
    if (!outcome) break;
    counts[outcome]++;
  }
  return counts;
}
