import "server-only";
import { sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";

// What needs attention today. The Today screen (/app) and the morning digest
// show the same content (Screens: "same content as the digest"):
//   new leads (24 h), going cold, tasks due, payments received, upcoming go-home dates.
// Failed sends are included too (Performance and reliability: "shown in Inbox and digest").

export const GOING_COLD_DAYS = 3;
export const GO_HOME_WINDOW_DAYS = 14;
// When a breeder's litter has a birth date but no go-home date, assume 8 weeks.
export const DEFAULT_GO_HOME_DAYS = 56;
const LIST_LIMIT = 25;

export type TodayLead = { lead_id: string; name: string; source: string; at: string };
export type ColdLead = { lead_id: string; name: string; stage: string; last_touch: string; days: number };
export type DueTask = { task_id: string; lead_id: string; name: string; title: string; due_at: string; overdue: boolean };
export type Payment = { id: string; lead_id: string | null; name: string | null; amount_cents: number; method: string; paid_at: string };
export type GoHome = { litter_id: string; litter: string; date: string; waitlist: number; assumed: boolean };

export type Today = {
  newLeads: TodayLead[];
  goingCold: ColdLead[];
  tasksDue: DueTask[];
  payments: Payment[];
  goHome: GoHome[];
  failedSends: number;
  counts: { newLeads: number; goingCold: number; tasksDue: number; payments: number };
};

const displayName = sql`coalesce(nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), c.email_norm, c.phone_e164, 'Unnamed')`;

// A lead's last touch: when it came in, a logged contact or manual message
// (last_contacted_at), any timeline activity, or an inbound reply. Automated
// sends don't count, so a lead in the Nurture sequence can still go cold.
const lastTouch = sql`greatest(
  l.created_at, l.last_contacted_at,
  (select max(a.created_at) from activities a where a.lead_id = l.id),
  (select max(m.created_at) from messages m where m.lead_id = l.id and m.direction = 'in'))`;

export async function loadToday(tx: Tx, workspaceId: string): Promise<Today> {
  const [ws] = (await tx.execute(sql`
    select timezone, (now() at time zone timezone)::date::text as local_date from workspaces where id = ${workspaceId}`)) as unknown as {
    timezone: string; local_date: string;
  }[];
  if (!ws) throw new Error("Workspace not found");
  // End of today in the workspace's time zone.
  const endOfToday = sql`((${ws.local_date}::date + 1)::timestamp at time zone ${ws.timezone})`;

  const newLeads = (await tx.execute(sql`
    select l.id as lead_id, ${displayName} as name, l.source, l.created_at as at, count(*) over ()::int as total
    from leads l join contacts c on c.id = l.contact_id
    where l.workspace_id = ${workspaceId} and l.created_at > now() - interval '24 hours' and l.closed_at is null
    order by l.created_at desc limit ${LIST_LIMIT}`)) as unknown as (TodayLead & { total: number })[];

  const goingCold = (await tx.execute(sql`
    select lead_id, name, stage, last_touch, floor(extract(epoch from now() - last_touch) / 86400)::int as days,
           count(*) over ()::int as total
    from (
      select l.id as lead_id, ${displayName} as name, s.name as stage, ${lastTouch} as last_touch
      from leads l join contacts c on c.id = l.contact_id join pipeline_stages s on s.id = l.stage_id
      where l.workspace_id = ${workspaceId} and s.kind = 'open' and l.closed_at is null) t
    where last_touch < now() - make_interval(days => ${GOING_COLD_DAYS})
    order by last_touch limit ${LIST_LIMIT}`)) as unknown as (ColdLead & { total: number })[];

  const tasksDue = (await tx.execute(sql`
    select a.id as task_id, a.lead_id, ${displayName} as name, coalesce(a.payload->>'title', 'Task') as title,
           a.due_at, a.due_at < now() as overdue, count(*) over ()::int as total
    from activities a join leads l on l.id = a.lead_id join contacts c on c.id = l.contact_id
    where a.workspace_id = ${workspaceId} and a.type = 'task' and a.done_at is null and a.due_at < ${endOfToday}
    order by a.due_at limit ${LIST_LIMIT}`)) as unknown as (DueTask & { total: number })[];

  const payments = (await tx.execute(sql`
    select p.id, p.lead_id, case when l.id is null then null else ${displayName} end as name,
           p.amount_cents, p.method, p.paid_at, count(*) over ()::int as total
    from payments p left join leads l on l.id = p.lead_id left join contacts c on c.id = l.contact_id
    where p.workspace_id = ${workspaceId} and p.status = 'paid' and p.paid_at > now() - interval '24 hours'
    order by p.paid_at desc limit ${LIST_LIMIT}`)) as unknown as (Payment & { total: number })[];

  const goHome = (await tx.execute(sql`
    select li.id as litter_id, li.name as litter, d.date::text as date, li.go_home_date is null as assumed,
           (select count(*)::int from waitlist_entries e where e.litter_id = li.id and e.status = 'active') as waitlist
    from litters li join workspaces w on w.id = li.workspace_id
    cross join lateral (select coalesce(li.go_home_date,
      case when w.business_type = 'breeder' then li.born_date + ${DEFAULT_GO_HOME_DAYS}::int end) as date) d
    where li.workspace_id = ${workspaceId} and li.status <> 'closed' and not li.is_general
      and d.date between ${ws.local_date}::date and ${ws.local_date}::date + ${GO_HOME_WINDOW_DAYS}::int
    order by d.date`)) as unknown as GoHome[];

  const [failed] = (await tx.execute(sql`
    select count(*)::int as n from messages
    where workspace_id = ${workspaceId} and status = 'failed' and updated_at > now() - interval '24 hours'`)) as unknown as { n: number }[];

  const total = (rows: { total: number }[]) => rows[0]?.total ?? 0;
  const strip = <T extends { total: number }>(rows: T[]) => rows.map((r) => {
    const { total, ...rest } = r;
    void total;
    return rest;
  });
  return {
    newLeads: strip(newLeads), goingCold: strip(goingCold), tasksDue: strip(tasksDue), payments: strip(payments), goHome,
    failedSends: failed?.n ?? 0,
    counts: { newLeads: total(newLeads), goingCold: total(goingCold), tasksDue: total(tasksDue), payments: total(payments) },
  };
}

export const isEmpty = (t: Today) =>
  t.newLeads.length + t.goingCold.length + t.tasksDue.length + t.payments.length + t.goHome.length + t.failedSends === 0;
