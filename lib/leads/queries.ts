import "server-only";
import { sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { FormFields, type FormField } from "@/lib/intake/fields";

export type Stage = { id: string; name: string; position: number; kind: "open" | "won" | "lost" };

export type LeadFilters = {
  q?: string;
  stageId?: string;
  source?: string;
  litterId?: string;
  tag?: string;
  // Not contacted within this many days ("never" = no contact logged at all).
  notContacted?: "never" | "3" | "7" | "30";
  includeClosed?: boolean;
  sort?: LeadSort;
};

export const LEAD_SORTS = {
  newest: sql`l.created_at desc`,
  name: sql`lower(coalesce(c.first_name, '')), lower(coalesce(c.last_name, ''))`,
  last_contacted: sql`l.last_contacted_at asc nulls first`,
  next_task: sql`l.next_task_due_at asc nulls last`,
  rating: sql`l.rating desc nulls last`,
} as const;
export type LeadSort = keyof typeof LEAD_SORTS;

export type BoardLead = {
  id: string;
  stage_id: string;
  first_name: string | null;
  last_name: string | null;
  email_norm: string | null;
  phone_e164: string | null;
  source: string;
  tags: string[];
  rating: number | null;
  assignee_name: string | null;
  litter_name: string | null;
  last_contacted_at: string | null;
  next_task_due_at: string | null;
  needs_merge_review: boolean;
  closed_at: string | null;
  created_at: string;
};

export async function listStages(tx: Tx, workspaceId: string): Promise<Stage[]> {
  return (await tx.execute(sql`
    select id, name, position, kind from pipeline_stages where workspace_id = ${workspaceId} order by position`)) as unknown as Stage[];
}

// Board and list data. Closed leads (won or lost) are hidden unless asked for,
// except those closed in the last 30 days, which still show in their column.
export async function listLeads(tx: Tx, workspaceId: string, f: LeadFilters = {}): Promise<BoardLead[]> {
  const where: SQL[] = [sql`l.workspace_id = ${workspaceId}`];
  if (!f.includeClosed) where.push(sql`(l.closed_at is null or l.closed_at > now() - interval '30 days')`);
  if (f.stageId) where.push(sql`l.stage_id = ${f.stageId}`);
  if (f.source) where.push(sql`l.source = ${f.source}`);
  if (f.litterId) where.push(sql`l.litter_id = ${f.litterId}`);
  if (f.tag) where.push(sql`${f.tag.toLowerCase()} = any(l.tags)`);
  if (f.notContacted === "never") where.push(sql`l.last_contacted_at is null`);
  else if (f.notContacted) {
    where.push(sql`(l.last_contacted_at is null or l.last_contacted_at < now() - make_interval(days => ${Number(f.notContacted)}))`);
  }
  const q = f.q?.trim().toLowerCase();
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const digits = q.replace(/\D/g, "");
    where.push(sql`(
      lower(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')) like ${like}
      or c.email_norm like ${like}
      ${digits.length >= 3 ? sql`or c.phone_e164 like ${`%${digits}%`}` : sql``}
      or exists (select 1 from unnest(l.tags) t where t like ${like}))`);
  }

  return (await tx.execute(sql`
    select l.id, l.stage_id, c.first_name, c.last_name, c.email_norm, c.phone_e164, l.source, l.tags, l.rating,
           coalesce(u.name, u.email) as assignee_name, li.name as litter_name,
           l.last_contacted_at, l.next_task_due_at, c.needs_merge_review, l.closed_at, l.created_at
    from leads l
    join contacts c on c.id = l.contact_id
    left join users u on u.id = l.assigned_user_id
    left join litters li on li.id = l.litter_id
    where ${sql.join(where, sql` and `)}
    order by ${LEAD_SORTS[f.sort ?? "newest"] ?? LEAD_SORTS.newest}, l.id
    limit 1000`)) as unknown as BoardLead[];
}

export type FilterOptions = { tags: string[]; litters: { id: string; name: string }[]; sources: string[] };

export async function filterOptions(tx: Tx, workspaceId: string): Promise<FilterOptions> {
  const [tags, litters, sources] = await Promise.all([
    tx.execute(sql`select distinct unnest(tags) as tag from leads where workspace_id = ${workspaceId} order by 1 limit 200`),
    tx.execute(sql`select id, name from litters where workspace_id = ${workspaceId} and status <> 'closed' order by is_general desc, expected_date nulls last`),
    tx.execute(sql`select distinct source from leads where workspace_id = ${workspaceId} order by 1`),
  ]);
  return {
    tags: (tags as unknown as { tag: string }[]).map((r) => r.tag),
    litters: litters as unknown as { id: string; name: string }[],
    sources: (sources as unknown as { source: string }[]).map((r) => r.source),
  };
}

export type TimelineItem = {
  id: string;
  type: "note" | "stage_change" | "task" | "call_logged" | "form" | "payment" | "system";
  payload: Record<string, unknown>;
  actor_name: string | null;
  due_at: string | null;
  done_at: string | null;
  created_at: string;
};

export type Submission = { id: string; submitted_at: string; form_title: string; answers: { label: string; value: string }[] };

export type LeadDetail = {
  lead: BoardLead & { contact_id: string; closed_reason: string | null; assigned_user_id: string | null; city: string | null;
                      state: string | null; sms_consent_at: string | null; email_unsubscribed_at: string | null; do_not_contact: boolean };
  stages: Stage[];
  timeline: TimelineItem[];
  tasks: TimelineItem[];
  submissions: Submission[];
  members: { id: string; name: string }[];
};

function formatAnswer(field: FormField | undefined, value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (field?.type === "date" && typeof value === "string") {
    return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }
  return String(value);
}

export async function getLeadDetail(tx: Tx, workspaceId: string, leadId: string): Promise<LeadDetail | null> {
  const [lead] = (await tx.execute(sql`
    select l.id, l.stage_id, l.contact_id, c.first_name, c.last_name, c.email_norm, c.phone_e164, c.city, c.state,
           c.sms_consent_at, c.email_unsubscribed_at, c.do_not_contact, c.needs_merge_review,
           l.source, l.tags, l.rating, l.assigned_user_id, coalesce(u.name, u.email) as assignee_name,
           li.name as litter_name, l.last_contacted_at, l.next_task_due_at, l.closed_at, l.closed_reason, l.created_at
    from leads l join contacts c on c.id = l.contact_id
    left join users u on u.id = l.assigned_user_id
    left join litters li on li.id = l.litter_id
    where l.id = ${leadId} and l.workspace_id = ${workspaceId}`)) as unknown as LeadDetail["lead"][];
  if (!lead) return null;

  const [stages, timeline, submissions, members] = await Promise.all([
    listStages(tx, workspaceId),
    tx.execute(sql`
      select a.id, a.type, a.payload, coalesce(u.name, u.email) as actor_name, a.due_at, a.done_at, a.created_at
      from activities a left join users u on u.id = a.actor_user_id
      where a.lead_id = ${leadId} and a.workspace_id = ${workspaceId}
      order by a.created_at desc, a.id desc
      limit 500`),
    tx.execute(sql`
      select fs.id, fs.submitted_at, f.title as form_title, f.fields, fs.answers
      from form_submissions fs join forms f on f.id = fs.form_id
      where fs.lead_id = ${leadId} and fs.workspace_id = ${workspaceId}
      order by fs.submitted_at desc`),
    tx.execute(sql`
      select u.id, coalesce(u.name, u.email) as name from memberships m join users u on u.id = m.user_id
      where m.workspace_id = ${workspaceId} and m.role in ('owner', 'staff') order by 2`),
  ]);

  const items = timeline as unknown as TimelineItem[];
  return {
    lead,
    stages,
    timeline: items,
    tasks: items.filter((i) => i.type === "task").sort((a, b) => (a.due_at ?? "").localeCompare(b.due_at ?? "")),
    submissions: (submissions as unknown as { id: string; submitted_at: string; form_title: string; fields: unknown; answers: Record<string, unknown> }[]).map((s) => {
      const fields = FormFields.safeParse(s.fields);
      const defs = fields.success ? fields.data : [];
      // Answers in the form's current order; answers to removed questions are kept under their key.
      const known = defs.filter((d) => s.answers[d.key] !== undefined).map((d) => ({ label: d.label, value: formatAnswer(d, s.answers[d.key]) }));
      const orphans = Object.entries(s.answers)
        .filter(([k]) => !defs.some((d) => d.key === k))
        .map(([k, v]) => ({ label: k.replace(/_/g, " "), value: formatAnswer(undefined, v) }));
      return { id: s.id, submitted_at: s.submitted_at, form_title: s.form_title, answers: [...known, ...orphans] };
    }),
    members: members as unknown as { id: string; name: string }[],
  };
}
