import Link from "next/link";
import { biggestLeak, formatDuration, loadDashboard, PERIODS, type PeriodDays } from "@/lib/dashboard";
import { withUser } from "@/lib/db";
import { formatCents } from "@/lib/messaging/send";
import { requireWorkspace } from "@/lib/workspace";

export const metadata = { title: "Dashboard · CoreConnect" };

// FR-27. The page answers four questions, in the order an owner asks them:
//   Is money coming in?          one hero figure: deposits this month
//   Am I keeping up?             three tiles: new leads, personal reply time, conversion
//   Where do I lose people?      the pipeline funnel, with the biggest leak in words
//   Where do good buyers come from?  sources ranked, with the deposits each produced
// One hue for every bar; numbers in text colors; every chart has a table view.

const SOURCE_LABEL: Record<string, string> = {
  form: "Website form", embed: "Embedded form", email: "Email", facebook: "Facebook", instagram: "Instagram",
  text: "Text", call: "Phone call", show: "Show or event", referral: "Referral", other: "Other",
};
const BAR = "bg-[#2a78d6] dark:bg-[#3987e5]";
const card = "rounded-xl border border-neutral-200 p-5 dark:border-neutral-800";
const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0);
// Whole dollars unless there are cents: $9,500, $312.50.
const dollars = (cents: number) => (cents % 100 === 0 ? `$${(cents / 100).toLocaleString("en-US")}` : formatCents(cents));
const MUTED_BAR = "bg-neutral-300 dark:bg-neutral-600";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const { user, workspace } = await requireWorkspace();
  const requested = Number((await searchParams).days);
  const days: PeriodDays = (PERIODS as readonly number[]).includes(requested) ? (requested as PeriodDays) : 30;
  const d = await withUser(user.id, (tx) => loadDashboard(tx, workspace.id, days));
  const period = days === 365 ? "12 months" : `${days} days`;
  const leak = biggestLeak(d.funnel);
  const quiet = d.leads.count < 3;

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <nav aria-label="Period" className="flex rounded-lg border border-neutral-300 p-0.5 text-sm dark:border-neutral-700">
          {PERIODS.map((p) => (
            <Link key={p} href={`/app/dashboard?days=${p}`} aria-current={p === days ? "page" : undefined}
              className={`rounded-md px-3 py-1 ${p === days ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900" : "text-neutral-600 dark:text-neutral-300"}`}>
              {p === 365 ? "12 months" : `${p} days`}
            </Link>
          ))}
        </nav>
      </div>

      {/* Is money coming in? */}
      <section className={`${card} mt-5`} aria-labelledby="deposits">
        <h2 id="deposits" className="text-sm text-neutral-600 dark:text-neutral-300">Deposits collected in {d.deposits.monthLabel}</h2>
        <p className="mt-1 text-5xl font-semibold tracking-tight sm:text-6xl">{dollars(d.deposits.cents)}</p>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
          {d.deposits.count === 0 ? "No deposits yet this month" : `${d.deposits.count} ${d.deposits.count === 1 ? "deposit" : "deposits"}`}
          {" · "}
          <Delta current={d.deposits.cents} previous={d.deposits.lastMonthToDateCents} upIsGood
            format={(c) => dollars(Math.abs(c))} against="this point last month" />
        </p>
      </section>

      {/* Am I keeping up? */}
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Tile label={`New leads, last ${period}`} value={d.leads.count.toLocaleString("en-US")}>
          <Delta current={d.leads.count} previous={d.leads.previous} upIsGood relative against={`previous ${period}`} />
        </Tile>
        <Tile label="Median time to a personal reply"
          value={d.response.medianSeconds === null ? "—" : formatDuration(d.response.medianSeconds)}>
          {d.response.medianSeconds !== null && d.response.previousMedianSeconds !== null ? (
            <Delta current={d.response.medianSeconds} previous={d.response.previousMedianSeconds} upIsGood={false}
              format={formatDuration} against={`previous ${period}`} />
          ) : (
            <span>Auto-replies don&apos;t count</span>
          )}
          {d.response.waiting > 0 && (
            <Link href="/app/leads?view=list&contacted=never" className="mt-1 block font-medium text-neutral-900 underline dark:text-white">
              {d.response.waiting} still waiting for a reply
            </Link>
          )}
        </Tile>
        <Tile label="Leads who paid a deposit" value={d.conversion.of ? `${pct(d.conversion.paid, d.conversion.of)}%` : "—"}>
          <span>{d.conversion.paid} of {d.conversion.of} from the last {period}</span>
        </Tile>
      </div>

      {quiet ? (
        <section className={`${card} mt-4 text-center`}>
          <p className="font-medium">Your funnel and sources appear here once a few leads come in.</p>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
            Share your <Link href={`/${workspace.slug}/inquire`} className="underline">inquiry form</Link> or add it to your
            website from <Link href="/app/settings/forms" className="underline">Settings › Inquiry form</Link>.
          </p>
        </section>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {/* Where do I lose people? */}
          <section className={card} aria-labelledby="funnel">
            <h2 id="funnel" className="font-semibold">How far leads get</h2>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
              {leak
                ? <>The biggest drop is from <b className="font-semibold text-neutral-900 dark:text-white">{leak.from}</b> to{" "}
                    <b className="font-semibold text-neutral-900 dark:text-white">{leak.to}</b>: {leak.lost} of {leak.lost + d.funnel.find((s) => s.stage === leak.to)!.reached} leads ({Math.round(leak.rate * 100)}%) stop there.</>
                : `Leads from the last ${period}, by the furthest stage they reached.`}
            </p>
            <Bars
              rows={d.funnel.map((s, i) => ({
                label: s.stage, value: s.reached, muted: s.afterGoal,
                dividerBefore: s.afterGoal && !d.funnel[i - 1]?.afterGoal ? "After the deposit" : undefined,
                detail: i === 0
                  ? `${s.reached} leads`
                  : `${s.reached} leads · ${pct(s.reached, d.funnel[0].reached)}% of all · ${pct(s.reached, d.funnel[i - 1].reached)}% of ${d.funnel[i - 1].stage}`,
              }))}
              max={d.funnel[0]?.reached ?? 0}
            />
            <TableView head={["Stage", "Leads", "% of all", "% of previous"]}
              rows={d.funnel.map((s, i) => [s.stage, String(s.reached), `${pct(s.reached, d.funnel[0].reached)}%`, i ? `${pct(s.reached, d.funnel[i - 1].reached)}%` : "—"])} />
          </section>

          {/* Where do good buyers come from? */}
          <section className={card} aria-labelledby="sources">
            <h2 id="sources" className="font-semibold">Where leads come from</h2>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
              {bestSource(d.sources) ?? `Leads from the last ${period}, most first.`}
            </p>
            <Bars
              rows={d.sources.map((s) => ({
                label: SOURCE_LABEL[s.source] ?? s.source, value: s.leads,
                note: s.deposits ? `${s.deposits} paid` : undefined,
                detail: `${s.leads} leads · ${pct(s.leads, d.leads.count)}% of all · ${s.deposits} paid a deposit (${pct(s.deposits, s.leads)}%)`,
              }))}
              max={d.sources[0]?.leads ?? 0}
            />
            <TableView head={["Source", "Leads", "Share", "Paid a deposit"]}
              rows={d.sources.map((s) => [SOURCE_LABEL[s.source] ?? s.source, String(s.leads), `${pct(s.leads, d.leads.count)}%`, `${s.deposits} (${pct(s.deposits, s.leads)}%)`])} />
          </section>
        </div>
      )}
    </main>
  );
}

// One sentence on the source that turns leads into deposits best, once there's enough to say it.
function bestSource(sources: { source: string; leads: number; deposits: number }[]) {
  const ranked = sources.filter((s) => s.leads >= 3 && s.deposits > 0).sort((a, b) => b.deposits / b.leads - a.deposits / a.leads);
  const top = ranked[0];
  if (!top) return null;
  return `${SOURCE_LABEL[top.source] ?? top.source} converts best: ${pct(top.deposits, top.leads)}% of those leads paid a deposit.`;
}

function Tile({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  return (
    <section className={card}>
      <h2 className="text-sm text-neutral-600 dark:text-neutral-300">{label}</h2>
      <p className="mt-1 text-3xl font-semibold tracking-tight">{value}</p>
      <div className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">{children}</div>
    </section>
  );
}

// A signed change against a named period. Arrow plus words, so it never relies on color alone.
function Delta({ current, previous, upIsGood, against, relative, format }: {
  current: number; previous: number; upIsGood: boolean; against: string; relative?: boolean; format?: (n: number) => string;
}) {
  if (previous === 0 && current === 0) return <span>no change from {against}</span>;
  if (previous === 0) return <span>none in the {against}</span>;
  const diff = current - previous;
  if (diff === 0) return <span>same as {against}</span>;
  const good = diff > 0 === upIsGood;
  const amount = relative ? `${Math.round(Math.abs(diff / previous) * 100)}%` : format ? format(Math.abs(diff)) : String(Math.abs(diff));
  return (
    <span className={good ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}>
      <span aria-hidden>{diff > 0 ? "▲" : "▼"}</span> {diff > 0 ? "up" : "down"} {amount}
      <span className="text-neutral-600 dark:text-neutral-300"> vs {against}</span>
    </span>
  );
}

// Horizontal bars on one baseline: 20px thick, square at the baseline, 4px
// rounded end, value at the tip in text color. Hover or focus shows the detail.
function Bars({ rows, max }: {
  rows: { label: string; value: number; note?: string; detail: string; muted?: boolean; dividerBefore?: string }[];
  max: number;
}) {
  if (rows.length === 0) return <p className="mt-4 text-sm text-neutral-500">Nothing yet in this period.</p>;
  return (
    <ul className="mt-4 space-y-2">
      {rows.map((r) => [
        r.dividerBefore && (
          <li key={`${r.label}-divider`} aria-hidden className="border-t border-neutral-200 pt-2 text-xs text-neutral-500 dark:border-neutral-800">
            {r.dividerBefore}
          </li>
        ),
        <li key={r.label} tabIndex={0} aria-label={`${r.label}: ${r.detail}`}
          className="group relative grid grid-cols-[6rem_minmax(0,1fr)] sm:grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-3 rounded outline-none focus-visible:ring-2 focus-visible:ring-neutral-400">
          <span className="truncate text-sm text-neutral-700 dark:text-neutral-300">{r.label}</span>
          <span className="flex min-w-0 items-center gap-2">
            {r.value > 0 && (
              <span className={`h-5 rounded-r ${r.muted ? MUTED_BAR : BAR}`} style={{ width: `${Math.max(2, (r.value / Math.max(max, 1)) * 85)}%` }} />
            )}
            <span className="whitespace-nowrap text-sm font-medium">
              {r.value}
              {r.note && <span className="font-normal text-neutral-500"> · {r.note}</span>}
            </span>
          </span>
          <span role="tooltip"
            className="pointer-events-none absolute -top-8 left-[6.75rem] sm:left-[8.25rem] z-10 hidden whitespace-nowrap rounded-md bg-neutral-900 px-2 py-1 text-xs text-white shadow group-hover:block group-focus-visible:block dark:bg-white dark:text-neutral-900">
            {r.detail}
          </span>
        </li>,
      ])}
    </ul>
  );
}

function TableView({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <details className="mt-4 text-sm">
      <summary className="cursor-pointer text-neutral-500">View as table</summary>
      <table className="mt-2 w-full tabular-nums">
        <thead>
          <tr className="text-left text-neutral-500">{head.map((h) => <th key={h} className="py-1 font-normal">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r[0]} className="border-t border-neutral-200 dark:border-neutral-800">
              {r.map((c, i) => <td key={i} className="py-1">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
