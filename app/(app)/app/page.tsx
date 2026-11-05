import Link from "next/link";
import { sql } from "drizzle-orm";
import { withUser } from "@/lib/db";
import { formatCents } from "@/lib/messaging/send";
import { formatDay, formatInZone } from "@/lib/format";
import { loadSetup, type SetupStep } from "@/lib/setup";
import { GOING_COLD_DAYS, loadToday } from "@/lib/today";
import { requireWorkspace } from "@/lib/workspace";

export const metadata = { title: "Today · CoreConnect" };

// Default home (Screens: Today). Same content as the morning digest.
export default async function TodayPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { user, workspace } = await requireWorkspace();
  const { error } = await searchParams;
  const { today, timezone, mergeReview, setup } = await withUser(user.id, async (tx) => {
    const [ws] = (await tx.execute(sql`
      select timezone, (select count(*)::int from contacts where workspace_id = ${workspace.id} and needs_merge_review) as merge_review
      from workspaces where id = ${workspace.id}`)) as unknown as { timezone: string; merge_review: number }[];
    return {
      today: await loadToday(tx, workspace.id), timezone: ws.timezone, mergeReview: ws.merge_review,
      setup: workspace.role === "staff" ? [] : await loadSetup(tx, workspace.id, workspace.slug),
    };
  });
  const time = (iso: string) => formatInZone(iso, timezone);
  const day = (ymd: string) => formatDay(ymd, "weekday");
  const litterWord = workspace.businessType === "service" ? "Slot" : "Litter";

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="text-2xl font-semibold">Today</h1>
      {error === "owner_only" && <p className="mt-3 text-sm text-red-600">Only the workspace owner can open that page.</p>}
      {setup.some((s) => !s.done) && <SetupCard steps={setup} />}

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="New leads (24 h)" value={today.counts.newLeads} href="#new" />
        <Stat label="Going cold" value={today.counts.goingCold} href="#cold" />
        <Stat label="Tasks due" value={today.counts.tasksDue} href="#tasks" />
        <Stat label="Payments (24 h)" value={today.counts.payments} href="#payments" />
      </div>

      {(mergeReview > 0 || today.failedSends > 0) && (
        <div className="mt-4 space-y-2 text-sm">
          {mergeReview > 0 && (
            <Link href="/app/leads?review=1" className="block rounded-md bg-amber-50 p-3 text-amber-900 hover:underline dark:bg-amber-950 dark:text-amber-100">
              {mergeReview} possible duplicate {mergeReview === 1 ? "contact" : "contacts"} to review
            </Link>
          )}
          {today.failedSends > 0 && (
            <Link href="/app/inbox" className="block rounded-md bg-red-50 p-3 text-red-900 hover:underline dark:bg-red-950 dark:text-red-100">
              {today.failedSends} {today.failedSends === 1 ? "message" : "messages"} failed to send in the last 24 hours
            </Link>
          )}
        </div>
      )}

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <Section id="new" title="New leads" total={today.counts.newLeads} empty="No new leads in the last 24 hours.">
          {today.newLeads.map((l) => (
            <Row key={l.lead_id} href={`/app/leads/${l.lead_id}`} main={l.name} sub={`${l.source} · ${time(l.at)}`} />
          ))}
        </Section>

        <Section id="cold" title="Going cold" total={today.counts.goingCold}
          empty={`Every open lead has been touched in the last ${GOING_COLD_DAYS} days.`}>
          {today.goingCold.map((l) => (
            <Row key={l.lead_id} href={`/app/leads/${l.lead_id}`} main={l.name} sub={`${l.stage} · no contact in ${l.days} days`} />
          ))}
        </Section>

        <Section id="tasks" title="Tasks due" total={today.counts.tasksDue} empty="Nothing due today.">
          {today.tasksDue.map((k) => (
            <Row key={k.task_id} href={`/app/leads/${k.lead_id}`} main={k.title} sub={`${k.name} · ${time(k.due_at)}`} alert={k.overdue ? "Overdue" : undefined} />
          ))}
        </Section>

        <Section id="payments" title="Payments received" total={today.counts.payments} empty="No payments in the last 24 hours.">
          {today.payments.map((p) => (
            <Row key={p.id} href={p.lead_id ? `/app/leads/${p.lead_id}` : undefined} main={`${formatCents(p.amount_cents)} · ${p.name ?? "Deleted contact"}`}
              sub={`${p.method} · ${time(p.paid_at)}`} />
          ))}
        </Section>

        <Section id="gohome" title="Go-home dates (next 2 weeks)" total={today.goHome.length} empty="None in the next 2 weeks.">
          {today.goHome.map((g) => (
            <Row key={g.litter_id} href={`/app/litters/${g.litter_id}`} main={`${litterWord}: ${g.litter}`}
              sub={`${day(g.date)}${g.assumed ? " (8 weeks from birth)" : ""} · ${g.waitlist} on waitlist`} />
          ))}
        </Section>
      </div>
    </main>
  );
}

// First-run checklist: each step ticks itself from the workspace's real state,
// and the card disappears once everything is done.
function SetupCard({ steps }: { steps: SetupStep[] }) {
  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);
  return (
    <section aria-labelledby="setup" className="mt-4 rounded-xl border border-neutral-200 p-5 dark:border-neutral-800">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="setup" className="font-semibold">Get ready for your first buyers</h2>
        <span className="text-sm text-neutral-500">{done} of {steps.length} done</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800" aria-hidden>
        <div className="h-full rounded-full bg-[#2a78d6] dark:bg-[#3987e5]" style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      <ol className="mt-4 space-y-1">
        {steps.map((s) => (
          <li key={s.key}>
            <Link href={s.href} className={`flex gap-3 rounded-md px-2 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-900 ${s === next ? "bg-neutral-50 dark:bg-neutral-900" : ""}`}>
              <span aria-hidden className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs ${s.done ? "border-green-600 bg-green-600 text-white" : "border-neutral-300 dark:border-neutral-600"}`}>
                {s.done ? "✓" : ""}
              </span>
              <span>
                <span className={`block text-sm font-medium ${s.done ? "text-neutral-500 line-through" : ""}`}>
                  {s.title}<span className="sr-only">{s.done ? " (done)" : " (to do)"}</span>
                </span>
                {s === next && <span className="block text-sm text-neutral-600 dark:text-neutral-300">{s.why}</span>}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Stat({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <a href={href} className="rounded-lg border border-neutral-200 p-4 hover:border-neutral-400 dark:border-neutral-800">
      <div className="text-3xl font-semibold tabular-nums">{value}</div>
      <div className="mt-1 text-sm text-neutral-500">{label}</div>
    </a>
  );
}

function Section({ id, title, total, empty, children }: {
  id: string; title: string; total: number; empty: string; children: React.ReactNode[];
}) {
  return (
    <section id={id} className="scroll-mt-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-500">{empty}</p>
      ) : (
        <ul className="mt-2 divide-y divide-neutral-200 rounded-md border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          {children}
        </ul>
      )}
      {total > children.length && <p className="mt-1 text-xs text-neutral-500">Showing {children.length} of {total}.</p>}
    </section>
  );
}

function Row({ href, main, sub, alert }: { href?: string; main: string; sub: string; alert?: string }) {
  const body = (
    <>
      <span className="flex items-center gap-2 font-medium">
        {main}
        {alert && <span className="rounded bg-red-100 px-1.5 text-xs font-normal text-red-800 dark:bg-red-950 dark:text-red-200">{alert}</span>}
      </span>
      <span className="block text-sm text-neutral-500">{sub}</span>
    </>
  );
  return <li>{href ? <Link href={href} className="block px-3 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-900">{body}</Link> : <div className="px-3 py-2">{body}</div>}</li>;
}
