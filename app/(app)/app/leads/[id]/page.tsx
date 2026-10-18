import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { withUser } from "@/lib/db";
import { getLeadDetail, type TimelineItem } from "@/lib/leads/queries";
import { requireWorkspace } from "@/lib/workspace";
import { leadName } from "../lead-flags";
import { ContactCard, Composer, LeadControls, MergeReviewBanner, TaskList } from "./lead-panels";

export const metadata = { title: "Lead · CoreConnect" };

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { user, workspace } = await requireWorkspace();
  const detail = await withUser(user.id, (tx) => getLeadDetail(tx, workspace.id, id));
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
          <LeadControls
            leadId={lead.id}
            stageId={lead.stage_id}
            stages={detail.stages}
            rating={lead.rating}
            tags={lead.tags}
            assigneeId={lead.assigned_user_id}
            members={detail.members}
          />
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
          <Composer leadId={lead.id} />
          <TaskList leadId={lead.id} tasks={detail.tasks} />
          <section>
            <h2 className="text-sm font-semibold">Timeline</h2>
            <ol className="mt-2 space-y-3">
              {detail.timeline.map((item) => (
                <li key={item.id} className="border-l-2 border-neutral-200 pl-3 text-sm dark:border-neutral-800">
                  <p>{describe(item)}</p>
                  {"text" in item.payload && item.payload.text ? (
                    <p className="mt-1 whitespace-pre-wrap text-neutral-700 dark:text-neutral-300">{String(item.payload.text)}</p>
                  ) : null}
                  <p className="mt-0.5 text-xs text-neutral-500">{item.actor_name ? `${item.actor_name} · ` : ""}{fmt(item.created_at, true)}</p>
                </li>
              ))}
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
    case "form": return p.event === "inquiry_merged" ? "Sent another inquiry" : "Submitted the inquiry form";
    case "payment": return "Payment recorded";
    case "system":
      if (p.event === "lead_created") return p.source === "import" ? "Imported from CSV" : `Lead added (${p.source})`;
      if (p.event === "inquiry_merged") return "Added again; merged into this lead";
      return "Update";
  }
}
