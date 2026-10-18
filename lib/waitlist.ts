import "server-only";
import { sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { advanceToStage, LeadError, type Ctx } from "@/lib/leads/mutations";

// Waitlists (FR-18, FR-19). Active entries on a litter hold positions 1..n with
// no gaps; matched and released entries keep their row with position null.
// Every position change, including the shifts it causes for other entries, is
// written to waitlist_events, which is append-only, so order disputes can be
// settled from the history.

type Entry = { id: string; lead_id: string; position: number; name: string };

async function lockLitter(tx: Tx, ctx: Ctx, litterId: string) {
  const [litter] = await tx.execute(sql`
    select id from litters where id = ${litterId} and workspace_id = ${ctx.workspaceId} for update`);
  if (!litter) throw new LeadError("Litter not found");
  return (await tx.execute(sql`
    select e.id, e.lead_id, e.position, coalesce(nullif(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), ''), 'Unnamed') as name
    from waitlist_entries e join leads l on l.id = e.lead_id join contacts c on c.id = l.contact_id
    where e.litter_id = ${litterId} and e.status = 'active' order by e.position`)) as unknown as Entry[];
}

async function logEvent(tx: Tx, ctx: Ctx, entryId: string, from: number | null, to: number | null, reason: string) {
  await tx.execute(sql`
    insert into waitlist_events (workspace_id, entry_id, from_position, to_position, actor_user_id, reason)
    values (${ctx.workspaceId}, ${entryId}, ${from}, ${to}, ${ctx.userId}, ${reason.slice(0, 500)})`);
}

async function generalLitterId(tx: Tx, ctx: Ctx) {
  const [row] = await tx.execute(sql`select id from litters where workspace_id = ${ctx.workspaceId} and is_general`);
  return (row as { id: string }).id;
}

export async function addToWaitlist(
  tx: Tx,
  ctx: Ctx,
  input: { leadId: string; litterId: string | null; sexPref?: string | null; colorPref?: string | null },
) {
  const litterId = input.litterId ?? (await generalLitterId(tx, ctx));
  const entries = await lockLitter(tx, ctx, litterId);
  if (entries.some((e) => e.lead_id === input.leadId)) throw new LeadError("This lead is already on that waitlist");
  const [lead] = await tx.execute(sql`select closed_at from leads where id = ${input.leadId} and workspace_id = ${ctx.workspaceId}`);
  if (!lead) throw new LeadError("Lead not found");
  if ((lead as { closed_at: string | null }).closed_at) throw new LeadError("Reopen this lead before adding it to a waitlist");

  const position = entries.length + 1;
  const [entry] = await tx.execute(sql`
    insert into waitlist_entries (workspace_id, lead_id, litter_id, position, sex_pref, color_pref)
    values (${ctx.workspaceId}, ${input.leadId}, ${litterId}, ${position},
            ${input.sexPref?.trim().slice(0, 40) || null}, ${input.colorPref?.trim().slice(0, 80) || null})
    returning id`);
  const entryId = (entry as { id: string }).id;
  await logEvent(tx, ctx, entryId, null, position, "Added to waitlist");
  await tx.execute(sql`update leads set litter_id = ${litterId} where id = ${input.leadId}`);
  await advanceToStage(tx, ctx, input.leadId, "waitlisted");
  return { entryId, position };
}

// Manual reorder (FR-18: "manual reorder with a required reason").
export async function moveEntry(tx: Tx, ctx: Ctx, entryId: string, toPosition: number, reason: string) {
  const why = reason.trim();
  if (!why) throw new LeadError("Give a reason for changing the order");
  const [row] = await tx.execute(sql`select litter_id from waitlist_entries where id = ${entryId} and workspace_id = ${ctx.workspaceId}`);
  if (!row) throw new LeadError("Waitlist entry not found");
  const entries = await lockLitter(tx, ctx, (row as { litter_id: string }).litter_id);
  const moving = entries.find((e) => e.id === entryId);
  if (!moving) throw new LeadError("Only active entries can be moved");
  const to = Math.trunc(toPosition);
  if (!(to >= 1 && to <= entries.length)) throw new LeadError(`Pick a position from 1 to ${entries.length}`);
  const from = moving.position;
  if (to === from) return;

  const others = entries.filter((e) => e.id !== entryId);
  others.splice(to - 1, 0, moving);
  await tx.execute(sql`set constraints all deferred`);
  for (const [i, e] of others.entries()) {
    const newPos = i + 1;
    if (newPos === e.position) continue;
    await tx.execute(sql`update waitlist_entries set position = ${newPos} where id = ${e.id}`);
    await logEvent(tx, ctx, e.id, e.position, newPos,
      e.id === entryId ? why : `Shifted when ${moving.name} moved from #${from} to #${to}: ${why}`);
  }
}

// Takes an entry off the active list (matched to a puppy, or released) and
// closes the gap it leaves.
export async function removeEntry(tx: Tx, ctx: Ctx, entryId: string, outcome: "matched" | "released", reason: string) {
  const [row] = await tx.execute(sql`select litter_id, lead_id from waitlist_entries where id = ${entryId} and workspace_id = ${ctx.workspaceId}`);
  if (!row) throw new LeadError("Waitlist entry not found");
  const { litter_id: litterId, lead_id: leadId } = row as { litter_id: string; lead_id: string };
  const entries = await lockLitter(tx, ctx, litterId);
  const leaving = entries.find((e) => e.id === entryId);
  if (!leaving) throw new LeadError("That entry is no longer on the active list");
  const why = reason.trim() || (outcome === "matched" ? "Matched" : "Released");

  await tx.execute(sql`set constraints all deferred`);
  await tx.execute(sql`update waitlist_entries set status = ${outcome}, position = null where id = ${entryId}`);
  await logEvent(tx, ctx, entryId, leaving.position, null, why);
  for (const e of entries.filter((x) => x.position > leaving.position)) {
    await tx.execute(sql`update waitlist_entries set position = ${e.position - 1} where id = ${e.id}`);
    await logEvent(tx, ctx, e.id, e.position, e.position - 1, `Moved up: ${leaving.name} (#${leaving.position}) ${outcome}`);
  }

  if (outcome === "matched") await advanceToStage(tx, ctx, leadId, "matched");
  else await tx.execute(sql`update leads set litter_id = null where id = ${leadId} and litter_id = ${litterId}`);
}

// Moves an active entry to another litter's list (end of the line there).
export async function transferEntry(tx: Tx, ctx: Ctx, entryId: string, toLitterId: string, reason: string) {
  const [row] = await tx.execute(sql`
    select e.lead_id, e.sex_pref, e.color_pref, e.litter_id, li.name as to_name
    from waitlist_entries e, litters li
    where e.id = ${entryId} and e.workspace_id = ${ctx.workspaceId} and li.id = ${toLitterId} and li.workspace_id = ${ctx.workspaceId}`);
  if (!row) throw new LeadError("Entry or litter not found");
  const r = row as { lead_id: string; sex_pref: string | null; color_pref: string | null; litter_id: string; to_name: string };
  if (r.litter_id === toLitterId) return null;
  await removeEntry(tx, ctx, entryId, "released", `Moved to ${r.to_name}${reason.trim() ? `: ${reason.trim()}` : ""}`);
  return addToWaitlist(tx, ctx, { leadId: r.lead_id, litterId: toLitterId, sexPref: r.sex_pref, colorPref: r.color_pref });
}

export type WaitlistRow = {
  id: string; lead_id: string; position: number; sex_pref: string | null; color_pref: string | null;
  first_name: string | null; last_name: string | null; stage: string; deposit_paid: boolean; created_at: string;
};

export async function listWaitlist(tx: Tx, workspaceId: string, litterId: string): Promise<WaitlistRow[]> {
  return (await tx.execute(sql`
    select e.id, e.lead_id, e.position, e.sex_pref, e.color_pref, c.first_name, c.last_name, s.name as stage, e.created_at,
           exists (select 1 from payments p where p.lead_id = e.lead_id and p.kind = 'deposit' and p.status = 'paid') as deposit_paid
    from waitlist_entries e join leads l on l.id = e.lead_id join contacts c on c.id = l.contact_id
    join pipeline_stages s on s.id = l.stage_id
    where e.workspace_id = ${workspaceId} and e.litter_id = ${litterId} and e.status = 'active'
    order by e.position`)) as unknown as WaitlistRow[];
}

export type WaitlistEvent = {
  id: string; entry_id: string; from_position: number | null; to_position: number | null; reason: string | null;
  actor_name: string | null; created_at: string; first_name: string | null; last_name: string | null;
};

export async function waitlistHistory(tx: Tx, workspaceId: string, litterId: string, limit = 200): Promise<WaitlistEvent[]> {
  return (await tx.execute(sql`
    select ev.id, ev.entry_id, ev.from_position, ev.to_position, ev.reason, ev.created_at,
           coalesce(u.name, u.email) as actor_name, c.first_name, c.last_name
    from waitlist_events ev join waitlist_entries e on e.id = ev.entry_id
    join leads l on l.id = e.lead_id join contacts c on c.id = l.contact_id
    left join users u on u.id = ev.actor_user_id
    where ev.workspace_id = ${workspaceId} and e.litter_id = ${litterId}
    order by ev.created_at desc, ev.id desc limit ${limit}`)) as unknown as WaitlistEvent[];
}
