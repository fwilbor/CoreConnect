import "server-only";
import { sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";

// Dashboard (FR-27): leads by source, stage conversion, median first-response
// time, deposits collected this month. The period covers leads that came in
// during the last N days; CSV imports are left out so an import doesn't read
// as a flood of new leads. Deposits are by calendar month in the workspace's
// time zone.

export const PERIODS = [30, 90, 365] as const;
export type PeriodDays = (typeof PERIODS)[number];

// goal: the Deposit paid stage. Steps after it are fulfilment (waiting for a
// litter), not drop-off, so the leak search stops there.
export type FunnelStep = { stage: string; reached: number; goal?: boolean; afterGoal?: boolean };
export type SourceRow = { source: string; leads: number; deposits: number };

export type Dashboard = {
  days: PeriodDays;
  deposits: { cents: number; count: number; lastMonthToDateCents: number; monthLabel: string };
  leads: { count: number; previous: number };
  // Time from inquiry to the first personal touch: a one-off message or a
  // logged call/text. Auto-replies and sequences don't count.
  response: { medianSeconds: number | null; previousMedianSeconds: number | null; waiting: number };
  conversion: { paid: number; of: number };
  funnel: FunnelStep[];
  sources: SourceRow[];
};

export async function loadDashboard(tx: Tx, workspaceId: string, days: PeriodDays): Promise<Dashboard> {
  const [ws] = (await tx.execute(sql`
    select timezone, to_char(now() at time zone timezone, 'FMMonth') as month_label
    from workspaces where id = ${workspaceId}`)) as unknown as { timezone: string; month_label: string }[];
  if (!ws) throw new Error("Workspace not found");
  const tz = ws.timezone;
  const since = sql`now() - make_interval(days => ${days})`;
  const before = sql`now() - make_interval(days => ${days * 2})`;
  const monthStart = sql`(date_trunc('month', now() at time zone ${tz}) at time zone ${tz})`;

  const [dep] = (await tx.execute(sql`
    select
      coalesce(sum(amount_cents) filter (where paid_at >= ${monthStart}), 0)::bigint as cents,
      count(*) filter (where paid_at >= ${monthStart})::int as count,
      coalesce(sum(amount_cents) filter (
        where paid_at >= ${monthStart} - interval '1 month' and paid_at < now() - interval '1 month'), 0)::bigint as last_cents
    from payments
    where workspace_id = ${workspaceId} and kind = 'deposit' and status = 'paid'
      and paid_at >= ${monthStart} - interval '1 month'`)) as unknown as { cents: string; count: number; last_cents: string }[];

  const response = sql`
    select l.id, l.created_at, l.closed_at,
      least(
        (select min(m.created_at) from messages m where m.lead_id = l.id and m.direction = 'out' and m.kind = 'one_off'),
        (select min(a.created_at) from activities a where a.lead_id = l.id and a.type = 'call_logged')) as first_touch
    from leads l where l.workspace_id = ${workspaceId} and l.source <> 'import'`;
  const [resp] = (await tx.execute(sql`
    with r as (${response})
    select
      count(*) filter (where created_at >= ${since})::int as leads,
      count(*) filter (where created_at >= ${before} and created_at < ${since})::int as previous,
      percentile_cont(0.5) within group (order by extract(epoch from first_touch - created_at))
        filter (where created_at >= ${since} and first_touch is not null) as median,
      percentile_cont(0.5) within group (order by extract(epoch from first_touch - created_at))
        filter (where created_at >= ${before} and created_at < ${since} and first_touch is not null) as previous_median,
      count(*) filter (where created_at >= ${since} and first_touch is null and closed_at is null)::int as waiting
    from r where created_at >= ${before}`)) as unknown as {
    leads: number; previous: number; median: number | null; previous_median: number | null; waiting: number;
  }[];

  // How far each lead got: the furthest open or won stage it has ever been in
  // (its current stage or any stage in its history). A lead that skipped a
  // stage counts as having passed it. Lost stages are left out of the funnel.
  const funnel = (await tx.execute(sql`
    with cohort as (
      select id, stage_id from leads
      where workspace_id = ${workspaceId} and source <> 'import' and created_at >= ${since}),
    seen as (
      select id as lead_id, stage_id from cohort
      union all
      select a.lead_id, (a.payload->>'to_stage_id')::uuid from activities a join cohort c on c.id = a.lead_id
      where a.type = 'stage_change' and a.payload ? 'to_stage_id'
      union all
      select a.lead_id, (a.payload->>'from_stage_id')::uuid from activities a join cohort c on c.id = a.lead_id
      where a.type = 'stage_change' and a.payload ? 'from_stage_id'),
    stages as (select id, name, position, system_key from pipeline_stages where workspace_id = ${workspaceId} and kind <> 'lost'),
    reach as (
      select c.id, coalesce(max(s.position), (select min(position) from stages)) as furthest
      from cohort c left join seen on seen.lead_id = c.id left join stages s on s.id = seen.stage_id
      group by c.id)
    select s.name as stage, (select count(*)::int from reach where furthest >= s.position) as reached,
      s.system_key = 'deposit_paid' as goal
    from stages s order by s.position`)) as unknown as (FunnelStep & { goal: boolean | null })[];
  const goalAt = funnel.findIndex((s) => s.goal);
  const steps: FunnelStep[] = funnel.map((s, i) => ({
    stage: s.stage, reached: s.reached, goal: Boolean(s.goal), afterGoal: goalAt >= 0 && i > goalAt,
  }));

  const sources = (await tx.execute(sql`
    select l.source, count(*)::int as leads,
      count(*) filter (where exists (
        select 1 from payments p where p.lead_id = l.id and p.kind = 'deposit' and p.status = 'paid'))::int as deposits
    from leads l
    where l.workspace_id = ${workspaceId} and l.source <> 'import' and l.created_at >= ${since}
    group by l.source order by leads desc, l.source`)) as unknown as SourceRow[];

  const num = (v: number | string | null) => (v === null ? null : Number(v));
  return {
    days,
    deposits: {
      cents: Number(dep.cents), count: dep.count, lastMonthToDateCents: Number(dep.last_cents), monthLabel: ws.month_label,
    },
    leads: { count: resp.leads, previous: resp.previous },
    response: { medianSeconds: num(resp.median), previousMedianSeconds: num(resp.previous_median), waiting: resp.waiting },
    conversion: { paid: sources.reduce((n, s) => n + s.deposits, 0), of: resp.leads },
    funnel: steps,
    sources,
  };
}

// The step where the most people drop out, or null when there's nothing to say.
export function biggestLeak(funnel: FunnelStep[]): { from: string; to: string; lost: number; rate: number } | null {
  let leak: { from: string; to: string; lost: number; rate: number } | null = null;
  for (let i = 1; i < funnel.length; i++) {
    if (funnel[i].afterGoal) break;
    const prev = funnel[i - 1].reached;
    const lost = prev - funnel[i].reached;
    if (prev < 3 || lost <= 0) continue;
    const rate = lost / prev;
    if (!leak || rate > leak.rate) leak = { from: funnel[i - 1].stage, to: funnel[i].stage, lost, rate };
  }
  return leak;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return "under a minute";
  const min = seconds / 60;
  if (min < 60) return `${Math.round(min)} min`;
  const hours = min / 60;
  if (hours < 24) return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)} h`;
  const d = hours / 24;
  return `${d < 10 ? d.toFixed(1) : Math.round(d)} days`;
}
