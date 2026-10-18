import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withUser } from "@/lib/db";
import { getLeadDetail, type LeadMessage, type TimelineItem } from "@/lib/leads/queries";
import { requireWorkspace } from "@/lib/workspace";
import { leadName } from "../lead-flags";
import { listPayments } from "@/lib/payments";
import { ContactCard, Composer, LeadControls, MergeReviewBanner, TaskList } from "./lead-panels";
import { ApplicationPanel, PaymentsPanel, WaitlistPanel } from "./qualify-panels";

export const metadata = { title: "Lead · CoreConnect" };

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { user, workspace } = await requireWorkspace();
  const detail = await withUser(user.id, async (tx) => {
    // Opening the lead counts as reading its replies (Inbox shows unread ones).
    await tx.execute(sql`
      update messages set read_at = now()
      where lead_id = ${id} and workspace_id = ${workspace.id} and direction = 'in' and read_at is null`);
    const lead = await getLeadDetail(tx, workspace.id, id);
    if (!lead) return null;
    const [extra] = (await tx.execute(sql`
      select
        exists (select 1 from form_submissions fs join forms f on f.id = fs.form_id
                where fs.lead_id = ${id} and f.kind = 'application') as applied,
        exists (select 1 from messages m join templates t on t.id = m.template_id
                where m.lead_id = ${id} and t.system_key = 'application_link') as app_sent,
        (w.deposit_amount_cents is not null and w.stripe_charges_enabled) as deposits_ready
      from workspaces w where w.id = ${workspace.id}`)) as unknown as { applied: boolean; app_sent: boolean; deposits_ready: boolean }[];
    const [entry] = (await tx.execute(sql`
      select e.id, e.position, li.name as litter_name, e.sex_pref, e.color_pref
      from waitlist_entries e join litters li on li.id = e.litter_id
      where e.lead_id = ${id} and e.status = 'active' order by e.created_at desc limit 1`)) as unknown as {
      id: string; position: number; litter_name: string; sex_pref: string | null; color_pref: string | null;
    }[];
    const litters = (await tx.execute(sql`
      select id, name, is_general from litters where workspace_id = ${workspace.id} and status <> 'closed'
      order by is_general desc, expected_date nulls last`)) as unknown as { id: string; name: string; is_general: boolean }[];
    return { ...lead, extra, entry: entry ?? null, litters, payments: await listPayments(tx, workspace.id, id) };
  });
  if (!detail) notFound();
  const { lead } = detail;

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <Link href="/app/leads" className="text-sm text-neutral-500 hover:underline">← Leads</Link>
      <h1 className="mt-2 text-2xl font-semibold">{leadName(lead)}</h1>
      <p className="text-sm text-neutral-500">
        <span className="capitalize">{lead.source}</span> · added {fmt(lead.created_at)}
        {lead.closed_at && ` · closed ${fmt(lead.closed_at)}${lead.closed_reason ? ` (${lead.closed_reason})` : ""}`}
      </p>

      {lead.needs_merge_review && <MergeReviewBanner leadId={lead.id} contactId={lead.contact_id} />}

      <div className="mt-6 grid gap-6 lg:grid-cols-[20rem_1fr]">
        <aside className="space-y-6">
          <ApplicationPanel
            leadId={lead.id}
            status={detail.extra.applied ? "submitted" : detail.extra.app_sent ? "sent" : "not_sent"}
            closed={lead.closed_at !== null}
            litters={detail.litters}
            depositsReady={detail.extra.deposits_ready}
          />
          <LeadControls
            leadId={lead.id}
            stageId={lead.stage_id}
            stages={detail.stages}
            rating={lead.rating}
            tags={lead.tags}
            assigneeId={lead.assigned_user_id}
            members={detail.members}
          />
          <WaitlistPanel leadId={lead.id} closed={lead.closed_at !== null} litters={detail.litters} entry={detail.entry} />
          <PaymentsPanel leadId={lead.id} payments={detail.payments} depositsReady={detail.extra.deposits_ready} closed={lead.closed_at !== null} />
          <ContactCard
            leadId={lead.id}
            contactId={lead.contact_id}
            contact={{
              firstName: lead.first_name ?? "", lastName: lead.last_name ?? "", email: lead.email_norm ?? "",
              phone: lead.phone_e164 ?? "", city: lead.city ?? "", state: lead.state ?? "",
            }}
            smsConsent={lead.sms_consent_at}
            unsubscribed={lead.email_unsubscribed_at !== null}
            doNotContact={lead.do_not_contact}
          />
          {detail.submissions.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold">Form answers</h2>
              {detail.submissions.map((s) => (
                <div key={s.id} className="mt-2 rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
                  <p className="text-xs text-neutral-500">{s.form_title} · {fmt(s.submitted_at)}</p>
                  {s.answers.length === 0 ? (
                    <p className="mt-1 text-neutral-500">No answers to custom questions.</p>
                  ) : (
                    <dl className="mt-2 space-y-2">
                      {s.answers.map((a) => (
                        <div key={a.label}>
                          <dt className="text-xs text-neutral-500">{a.label}</dt>
                          <dd className="whitespace-pre-wrap">{a.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              ))}
            </section>
          )}
        </aside>

        <div className="min-w-0 space-y-6">
          <Composer leadId={lead.id} templates={detail.templates} />
          <TaskList leadId={lead.id} tasks={detail.tasks} />
          <section>
            <h2 className="text-sm font-semibold">Timeline</h2>
            <ol className="mt-2 space-y-3">
              {merge(detail.timeline, detail.messages).map((entry) =>
                entry.kind === "message" ? (
                  <MessageEntry key={entry.item.id} m={entry.item} />
                ) : (
                  <li key={entry.item.id} className="border-l-2 border-neutral-200 pl-3 text-sm dark:border-neutral-800">
                    <p>{describe(entry.item)}</p>
                    {"text" in entry.item.payload && entry.item.payload.text ? (
                      <p className="mt-1 whitespace-pre-wrap text-neutral-700 dark:text-neutral-300">{String(entry.item.payload.text)}</p>
                    ) : null}
                    <p className="mt-0.5 text-xs text-neutral-500">{entry.item.actor_name ? `${entry.item.actor_name} · ` : ""}{fmt(entry.item.created_at, true)}</p>
                  </li>
                ),
              )}
            </ol>
          </section>
        </div>
      </div>
    </main>
  );
}

function fmt(iso: string, withTime = false) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric", ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  });
}

const CHANNELS: Record<string, string> = { call: "Call", text: "Text", dm: "DM", in_person: "In person" };

function describe(item: TimelineItem): string {
  const p = item.payload as Record<string, string | boolean | null>;
  switch (item.type) {
    case "note": return "Note";
    case "call_logged": return `${CHANNELS[String(p.channel)] ?? "Contact"} logged`;
    case "stage_change": return `Moved from ${p.from ?? "?"} to ${p.to}${p.reason ? ` (${p.reason})` : ""}`;
    case "task": return `Task: ${p.title}${item.done_at ? " (done)" : ` · due ${fmt(item.due_at!)}`}`;
    case "form":
      if (p.event === "application_submitted") return "Submitted the application";
      return p.event === "inquiry_merged" ? "Sent another inquiry" : "Submitted the inquiry form";
    case "payment": {
      const amount = typeof p.amount_cents === "number" ? (p.amount_cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" }) : "";
      return `${p.kind === "deposit" ? "Deposit" : "Payment"} ${amount} ${p.status === "paid" ? "received" : String(p.status ?? "")} (${p.method})`;
    }
    case "system":
      if (p.event === "lead_created") return p.source === "import" ? "Imported from CSV" : `Lead added (${p.source})`;
      if (p.event === "inquiry_merged") return "Added again; merged into this lead";
      if (p.event === "application_approved") return "Application approved";
      if (p.event === "sms_opt_out") return `Opted out of texts (replied ${p.keyword})`;
      if (p.event === "sms_opt_in") return `Opted back in to texts (replied ${p.keyword})`;
      if (p.event === "email_unsubscribed") return p.reason === "complaint" ? "Marked an email as spam; unsubscribed" : "Unsubscribed from email";
      return "Update";
  }
}

type Entry = { kind: "activity"; item: TimelineItem; at: string } | { kind: "message"; item: LeadMessage; at: string };

function merge(activities: TimelineItem[], messages: LeadMessage[]): Entry[] {
  return [
    ...activities.map((item) => ({ kind: "activity" as const, item, at: item.created_at })),
    ...messages.map((item) => ({ kind: "message" as const, item, at: item.created_at })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

const KIND_LABEL: Record<string, string> = { auto_reply: "Auto-reply", sequence: "Nurture", reminder: "Reminder", system: "System" };

function MessageEntry({ m }: { m: LeadMessage }) {
  const inbound = m.direction === "in";
  const label = `${inbound ? "Received" : "Sent"} ${m.channel === "email" ? "email" : "text"}${KIND_LABEL[m.kind] && !inbound ? ` · ${KIND_LABEL[m.kind]}` : ""}`;
  const status =
    m.status === "failed" ? `Failed: ${m.last_error ?? "unknown error"}`
    : m.status === "queued" ? (m.send_after && new Date(m.send_after) > new Date() ? `Scheduled for ${fmt(m.send_after, true)}` : "Sending")
    : m.status === "delivered" ? "Delivered" : m.status === "sent" ? "Sent" : "";
  return (
    <li className={`border-l-2 pl-3 text-sm ${inbound ? "border-blue-400" : m.status === "failed" ? "border-red-500" : "border-neutral-400 dark:border-neutral-600"}`}>
      <p className="font-medium">{label}{m.subject ? `: ${m.subject}` : ""}</p>
      <p className="mt-1 whitespace-pre-wrap text-neutral-700 dark:text-neutral-300">{m.body}</p>
      <p className={`mt-0.5 text-xs ${m.status === "failed" ? "text-red-600" : "text-neutral-500"}`}>
        {m.author_name ? `${m.author_name} · ` : ""}{fmt(m.created_at, true)}{status && !inbound ? ` · ${status}` : ""}
      </p>
    </li>
  );
}
