import "server-only";
import { sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { normalizeEmail, normalizePhone } from "@/lib/intake/normalize";

// All of these run inside withUser(), so RLS limits them to the user's
// workspaces; workspaceId is still passed so every statement names its tenant.
// userId is null for system actions (e.g. a Stripe webhook).
export type Ctx = { workspaceId: string; userId: string | null };

export class LeadError extends Error {}

export const CLOSED_REASONS = ["Not a fit", "No response", "Went elsewhere", "Other"] as const;
export const MAX_TAGS = 20;

const first = async <T>(tx: Tx, q: ReturnType<typeof sql>) => (await tx.execute(q))[0] as T | undefined;

async function activity(tx: Tx, ctx: Ctx, leadId: string, type: string, payload: object, dueAt: Date | null = null) {
  const row = await first<{ id: string }>(tx, sql`
    insert into activities (workspace_id, lead_id, type, payload, actor_user_id, due_at)
    values (${ctx.workspaceId}, ${leadId}, ${type}, ${JSON.stringify(payload)}::jsonb, ${ctx.userId},
            ${dueAt ? dueAt.toISOString() : null}::timestamptz)
    returning id`);
  await tx.execute(sql`update leads set updated_at = now() where id = ${leadId} and workspace_id = ${ctx.workspaceId}`);
  return row!.id;
}

async function requireLead(tx: Tx, ctx: Ctx, leadId: string) {
  const lead = await first<{ id: string; stage_id: string }>(tx, sql`
    select id, stage_id from leads where id = ${leadId} and workspace_id = ${ctx.workspaceId}`);
  if (!lead) throw new LeadError("Lead not found");
  return lead;
}

// Moving into a won or lost stage closes the lead; moving back to an open
// stage reopens it. Any stage change stops Nurture (Automations: Nurture stops
// on stage change); reminders have their own stop conditions.
export async function moveLeadToStage(tx: Tx, ctx: Ctx, leadId: string, stageId: string, closedReason?: string | null) {
  const lead = await requireLead(tx, ctx, leadId);
  if (lead.stage_id === stageId) return;
  const stages = (await tx.execute(sql`
    select id, name, kind from pipeline_stages
    where workspace_id = ${ctx.workspaceId} and id in (${lead.stage_id}, ${stageId})`)) as unknown as {
    id: string; name: string; kind: "open" | "won" | "lost";
  }[];
  const from = stages.find((s) => s.id === lead.stage_id);
  const to = stages.find((s) => s.id === stageId);
  if (!to) throw new LeadError("Stage not found");
  const reason = to.kind === "lost" ? (closedReason?.trim() || "Other").slice(0, 200) : null;

  await tx.execute(sql`
    update leads set stage_id = ${stageId},
      closed_at = ${to.kind === "open" ? null : sql`coalesce(closed_at, now())`},
      closed_reason = ${reason}
    where id = ${leadId} and workspace_id = ${ctx.workspaceId}`);
  await tx.execute(sql`
    update sequence_enrollments set status = 'stopped'
    where lead_id = ${leadId} and workspace_id = ${ctx.workspaceId} and status = 'active'
      and sequence_id in (select id from sequences where system_key = 'nurture')`);
  await activity(tx, ctx, leadId, "stage_change", {
    from_stage_id: from?.id, from: from?.name, to_stage_id: to.id, to: to.name, ...(reason ? { reason } : {}),
  });
}

export async function addNote(tx: Tx, ctx: Ctx, leadId: string, text: string) {
  const body = text.trim();
  if (!body) throw new LeadError("Write a note first");
  if (body.length > 5000) throw new LeadError("Notes are limited to 5,000 characters");
  await requireLead(tx, ctx, leadId);
  return activity(tx, ctx, leadId, "note", { text: body });
}

// A call, text or DM handled outside the app. Counts as a touch for "going cold".
export async function logContact(tx: Tx, ctx: Ctx, leadId: string, channel: "call" | "text" | "dm" | "in_person", note: string) {
  await requireLead(tx, ctx, leadId);
  await tx.execute(sql`update leads set last_contacted_at = now() where id = ${leadId} and workspace_id = ${ctx.workspaceId}`);
  return activity(tx, ctx, leadId, "call_logged", { channel, text: note.trim().slice(0, 5000) || null });
}

async function refreshNextTask(tx: Tx, ctx: Ctx, leadId: string) {
  await tx.execute(sql`
    update leads set next_task_due_at = (
      select min(due_at) from activities
      where lead_id = ${leadId} and workspace_id = ${ctx.workspaceId} and type = 'task' and done_at is null)
    where id = ${leadId} and workspace_id = ${ctx.workspaceId}`);
}

export async function addTask(tx: Tx, ctx: Ctx, leadId: string, title: string, dueAt: Date) {
  const text = title.trim();
  if (!text) throw new LeadError("Describe the task");
  if (Number.isNaN(dueAt.getTime())) throw new LeadError("Pick a due date");
  await requireLead(tx, ctx, leadId);
  const id = await activity(tx, ctx, leadId, "task", { title: text.slice(0, 200) }, dueAt);
  await refreshNextTask(tx, ctx, leadId);
  return id;
}

export async function setTaskDone(tx: Tx, ctx: Ctx, taskId: string, done: boolean) {
  const task = await first<{ lead_id: string }>(tx, sql`
    update activities set done_at = ${done ? sql`now()` : null}
    where id = ${taskId} and workspace_id = ${ctx.workspaceId} and type = 'task'
    returning lead_id`);
  if (!task) throw new LeadError("Task not found");
  await refreshNextTask(tx, ctx, task.lead_id);
}

export function normalizeTags(tags: string[]): string[] {
  const clean = [...new Set(tags.map((t) => t.trim().toLowerCase().replace(/\s+/g, " ")).filter(Boolean))];
  if (clean.some((t) => t.length > 40)) throw new LeadError("Tags are limited to 40 characters");
  if (clean.length > MAX_TAGS) throw new LeadError(`Up to ${MAX_TAGS} tags per lead`);
  return clean;
}

export async function setTags(tx: Tx, ctx: Ctx, leadId: string, tags: string[]) {
  const clean = normalizeTags(tags);
  await requireLead(tx, ctx, leadId);
  await tx.execute(sql`
    update leads set tags = array(select jsonb_array_elements_text(${JSON.stringify(clean)}::jsonb))::text[]
    where id = ${leadId} and workspace_id = ${ctx.workspaceId}`);
}

export async function setRating(tx: Tx, ctx: Ctx, leadId: string, rating: number | null) {
  if (rating !== null && !(Number.isInteger(rating) && rating >= 1 && rating <= 5)) throw new LeadError("Rating is 1 to 5");
  await requireLead(tx, ctx, leadId);
  await tx.execute(sql`update leads set rating = ${rating} where id = ${leadId} and workspace_id = ${ctx.workspaceId}`);
}

export async function assignLead(tx: Tx, ctx: Ctx, leadId: string, assigneeId: string | null) {
  await requireLead(tx, ctx, leadId);
  if (assigneeId) {
    const member = await first(tx, sql`
      select 1 from memberships where workspace_id = ${ctx.workspaceId} and user_id = ${assigneeId} and role in ('owner', 'staff')`);
    if (!member) throw new LeadError("That person isn't on this workspace");
  }
  await tx.execute(sql`update leads set assigned_user_id = ${assigneeId} where id = ${leadId} and workspace_id = ${ctx.workspaceId}`);
}

export type ContactUpdate = {
  firstName: string; lastName: string; email: string; phone: string; city: string; state: string;
};

export async function updateContact(tx: Tx, ctx: Ctx, contactId: string, input: ContactUpdate) {
  const email = input.email.trim() ? normalizeEmail(input.email) : null;
  const phone = input.phone.trim() ? normalizePhone(input.phone) : null;
  if (input.email.trim() && !email) throw new LeadError("That email isn't valid");
  if (input.phone.trim() && !phone) throw new LeadError("That phone number isn't valid");
  if (!email && !phone) throw new LeadError("Keep an email or a phone number");
  if (!input.firstName.trim()) throw new LeadError("First name is required");

  const clash = await first<{ id: string }>(tx, sql`
    select id from contacts where workspace_id = ${ctx.workspaceId} and id <> ${contactId}
      and ((${email}::text is not null and email_norm = ${email}) or (${phone}::text is not null and phone_e164 = ${phone}))
    limit 1`);
  if (clash) throw new LeadError("Another contact already has that email or phone");

  const updated = await first(tx, sql`
    update contacts set first_name = ${input.firstName.trim().slice(0, 80)}, last_name = ${input.lastName.trim().slice(0, 80) || null},
      email_norm = ${email}, phone_e164 = ${phone},
      city = ${input.city.trim().slice(0, 80) || null}, state = ${input.state.trim().slice(0, 40) || null}
    where id = ${contactId} and workspace_id = ${ctx.workspaceId}
    returning id`);
  if (!updated) throw new LeadError("Contact not found");
}

// After a person reviews a possible duplicate and decides they're different people.
export async function clearMergeReview(tx: Tx, ctx: Ctx, contactId: string) {
  await tx.execute(sql`update contacts set needs_merge_review = false where id = ${contactId} and workspace_id = ${ctx.workspaceId}`);
}

export type StageKey = "new" | "contacted" | "application" | "approved" | "waitlisted" | "deposit_paid" | "matched" | "placed" | "closed";

// Moves an open lead forward to a keyed stage; never moves it back or reopens
// it. Used when a payment, waitlist or application event implies progress.
export async function advanceToStage(tx: Tx, ctx: Ctx, leadId: string, key: StageKey) {
  const [row] = (await tx.execute(sql`
    select t.id as target_id, t.position as target_position, cur.position as current_position, l.closed_at
    from leads l join pipeline_stages cur on cur.id = l.stage_id
    join pipeline_stages t on t.workspace_id = l.workspace_id and t.system_key = ${key}
    where l.id = ${leadId} and l.workspace_id = ${ctx.workspaceId}`)) as unknown as {
    target_id: string; target_position: number; current_position: number; closed_at: string | null;
  }[];
  if (!row || row.closed_at || row.current_position >= row.target_position) return false;
  await moveLeadToStage(tx, ctx, leadId, row.target_id);
  return true;
}
