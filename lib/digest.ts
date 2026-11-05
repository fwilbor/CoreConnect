import "server-only";
import { sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { escapeHtml, type EmailParts } from "@/lib/messaging/render";
import { formatCents, siteUrl } from "@/lib/messaging/send";
import { PermanentSendError, type Transports } from "@/lib/messaging/transports";
import { isEmpty, loadToday, type Today } from "@/lib/today";

// Morning digest (FR-26): emailed to the workspace owner once a day at the
// workspace's digest time (default 7 am, in the workspace's time zone). Same
// content as the Today screen. Skipped on days with nothing to report.

const shortDate = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone });
const dayDate = (ymd: string) =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

type Section = { title: string; lines: { text: string; href?: string }[]; more?: number };

export function digestSections(t: Today, timeZone: string): Section[] {
  const app = siteUrl();
  const lead = (id: string | null) => (id ? `${app}/app/leads/${id}` : undefined);
  const more = (shown: number, total: number) => (total > shown ? total - shown : undefined);
  const sections: Section[] = [];
  if (t.newLeads.length) sections.push({
    title: `New leads (${t.counts.newLeads})`,
    lines: t.newLeads.map((l) => ({ text: `${l.name} · ${l.source}`, href: lead(l.lead_id) })),
    more: more(t.newLeads.length, t.counts.newLeads),
  });
  if (t.goingCold.length) sections.push({
    title: `Going cold (${t.counts.goingCold})`,
    lines: t.goingCold.map((l) => ({ text: `${l.name} · ${l.stage} · no contact in ${l.days} days`, href: lead(l.lead_id) })),
    more: more(t.goingCold.length, t.counts.goingCold),
  });
  if (t.tasksDue.length) sections.push({
    title: `Tasks due (${t.counts.tasksDue})`,
    lines: t.tasksDue.map((k) => ({
      text: `${k.title} · ${k.name}${k.overdue ? ` · overdue since ${shortDate(k.due_at, timeZone)}` : " · today"}`,
      href: lead(k.lead_id),
    })),
    more: more(t.tasksDue.length, t.counts.tasksDue),
  });
  if (t.payments.length) sections.push({
    title: `Payments received (${t.counts.payments})`,
    lines: t.payments.map((p) => ({ text: `${formatCents(p.amount_cents)} · ${p.name ?? "Deleted contact"} · ${p.method}`, href: lead(p.lead_id) })),
    more: more(t.payments.length, t.counts.payments),
  });
  if (t.goHome.length) sections.push({
    title: "Upcoming go-home dates",
    lines: t.goHome.map((g) => ({
      text: `${g.litter} · ${dayDate(g.date)}${g.assumed ? " (8 weeks from birth)" : ""} · ${g.waitlist} on waitlist`,
      href: `${app}/app/litters/${g.litter_id}`,
    })),
  });
  if (t.failedSends) sections.push({
    title: "Messages that failed to send",
    lines: [{ text: `${t.failedSends} in the last 24 hours. Check the lead timelines for the reason.`, href: `${app}/app/inbox` }],
  });
  return sections;
}

export function buildDigestEmail(workspaceName: string, t: Today, timeZone: string, localDate: string): EmailParts {
  const sections = digestSections(t, timeZone);
  const subject = `${workspaceName}: your morning digest for ${dayDate(localDate)}`;
  const text = [
    `Good morning. Here's what needs attention at ${workspaceName}.`,
    ...sections.map((s) =>
      [s.title, ...s.lines.map((l) => `- ${l.text}${l.href ? ` ${l.href}` : ""}`), ...(s.more ? [`- and ${s.more} more`] : [])].join("\n")),
    `Open Today: ${siteUrl()}/app`,
  ].join("\n\n");

  const li = (l: Section["lines"][number]) =>
    `<li style="margin:0 0 6px">${l.href ? `<a href="${escapeHtml(l.href)}" style="color:#171717">${escapeHtml(l.text)}</a>` : escapeHtml(l.text)}</li>`;
  const html =
    `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;` +
    `font-size:15px;line-height:1.5;color:#171717;max-width:560px;margin:0 auto;padding:16px">` +
    `<p style="margin:0 0 20px">Good morning. Here's what needs attention at ${escapeHtml(workspaceName)}.</p>` +
    sections.map((s) =>
      `<h2 style="font-size:16px;margin:0 0 8px">${escapeHtml(s.title)}</h2>` +
      `<ul style="margin:0 0 20px;padding-left:20px">${s.lines.map(li).join("")}` +
      `${s.more ? `<li style="color:#737373">and ${s.more} more</li>` : ""}</ul>`).join("") +
    `<p style="margin:0"><a href="${escapeHtml(siteUrl())}/app" style="color:#171717">Open Today in CoreConnect</a></p>` +
    `</body></html>`;
  return { subject, text, html };
}

function digestFrom() {
  if (process.env.EMAIL_FROM) return `"CoreConnect" <${process.env.EMAIL_FROM}>`;
  const domain = process.env.EMAIL_FROM_DOMAIN;
  if (!domain) throw new PermanentSendError("Email sending isn't configured (EMAIL_FROM_DOMAIN)");
  return `"CoreConnect" <notifications@${domain}>`;
}

// Sends every digest that's due: workspaces whose local time has reached their
// digest time and that haven't had one today. One workspace per transaction;
// the row lock stops two ticks from sending the same digest. A temporary send
// failure rolls back so the next tick retries; a permanent one is logged and
// the day is marked done.
export async function runDueDigests(db: Database, transports: Transports, limit = 50) {
  const counts = { sent: 0, empty: 0, failed: 0 };
  for (let i = 0; i < limit; i++) {
    const outcome = await db.transaction(async (tx) => {
      const [ws] = (await tx.execute(sql`
        select id, name, timezone, (now() at time zone timezone)::date::text as local_date from workspaces
        where billing_status <> 'read_only'
          and (now() at time zone timezone)::time >= digest_time
          and (digest_sent_on is null or digest_sent_on < (now() at time zone timezone)::date)
        order by id limit 1 for update skip locked`)) as unknown as { id: string; name: string; timezone: string; local_date: string }[];
      if (!ws) return null;
      const markDone = () => tx.execute(sql`update workspaces set digest_sent_on = ${ws.local_date}::date where id = ${ws.id}`);

      const today = await loadToday(tx, ws.id);
      if (isEmpty(today)) {
        await markDone();
        return "empty" as const;
      }
      const owners = (await tx.execute(sql`
        select u.email from memberships m join users u on u.id = m.user_id
        where m.workspace_id = ${ws.id} and m.role = 'owner'`)) as unknown as { email: string }[];
      const email = buildDigestEmail(ws.name, today, ws.timezone, ws.local_date);
      try {
        for (const o of owners) await transports.email({ from: digestFrom(), to: o.email, ...email });
      } catch (err) {
        if (!(err instanceof PermanentSendError)) throw err;
        console.error(`digest for workspace ${ws.id} failed: ${err.message}`);
        await markDone();
        return "failed" as const;
      }
      await markDone();
      return "sent" as const;
    }).catch((err) => {
      console.error(`digest failed, will retry: ${err instanceof Error ? err.message : err}`);
      return "stop" as const;
    });
    if (!outcome || outcome === "stop") break;
    counts[outcome]++;
  }
  return counts;
}
