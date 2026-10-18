import "server-only";
import { sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { LeadError, type Ctx } from "@/lib/leads/mutations";
import { queueMessage } from "@/lib/messaging/send";

// Litters (FR-17). Service businesses use them as slots or cohorts.
export const LITTER_STATUSES = ["planned", "confirmed", "born", "closed"] as const;
export type LitterStatus = (typeof LITTER_STATUSES)[number];

export type LitterInput = {
  name: string;
  sire: string;
  dam: string;
  expectedDate: string; // YYYY-MM-DD or ""
  bornDate: string;
  expectedCount: string;
  status: LitterStatus;
};

function clean(input: LitterInput) {
  const name = input.name.trim();
  if (!name) throw new LeadError("Name the litter");
  if (name.length > 80) throw new LeadError("Litter names are limited to 80 characters");
  if (!LITTER_STATUSES.includes(input.status)) throw new LeadError("Pick a status");
  const date = (d: string) => {
    if (!d) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new LeadError("Use a valid date");
    return d;
  };
  const count = input.expectedCount.trim() ? Number(input.expectedCount) : null;
  if (count !== null && !(Number.isInteger(count) && count >= 0 && count <= 30)) throw new LeadError("Expected count is 0 to 30");
  return {
    name, sire: input.sire.trim().slice(0, 80) || null, dam: input.dam.trim().slice(0, 80) || null,
    expectedDate: date(input.expectedDate), bornDate: date(input.bornDate), count, status: input.status,
  };
}

export async function createLitter(tx: Tx, ctx: Ctx, input: LitterInput) {
  const l = clean(input);
  const [row] = await tx.execute(sql`
    insert into litters (workspace_id, name, sire, dam, expected_date, born_date, expected_count, status)
    values (${ctx.workspaceId}, ${l.name}, ${l.sire}, ${l.dam}, ${l.expectedDate}, ${l.bornDate}, ${l.count}, ${l.status})
    returning id`);
  return (row as { id: string }).id;
}

export async function updateLitter(tx: Tx, ctx: Ctx, litterId: string, input: LitterInput) {
  const l = clean(input);
  const [current] = await tx.execute(sql`select is_general from litters where id = ${litterId} and workspace_id = ${ctx.workspaceId}`);
  if (!current) throw new LeadError("Litter not found");
  if ((current as { is_general: boolean }).is_general && l.status === "closed") throw new LeadError("The general waitlist can't be closed");
  await tx.execute(sql`
    update litters set name = ${l.name}, sire = ${l.sire}, dam = ${l.dam}, expected_date = ${l.expectedDate},
      born_date = ${l.bornDate}, expected_count = ${l.count}, status = ${l.status}
    where id = ${litterId} and workspace_id = ${ctx.workspaceId}`);
}

// "Litter status set to Born: email every active waitlist entry for that
// litter. Owner confirms send first." The confirmation happens in the UI.
export async function notifyWaitlist(tx: Tx, ctx: Ctx, litterId: string) {
  const [litter] = await tx.execute(sql`select status from litters where id = ${litterId} and workspace_id = ${ctx.workspaceId}`);
  if (!litter) throw new LeadError("Litter not found");
  if ((litter as { status: string }).status !== "born") throw new LeadError("Mark the litter as born first");
  const [tpl] = await tx.execute(sql`select id from templates where workspace_id = ${ctx.workspaceId} and system_key = 'litter_born'`);
  if (!tpl) throw new LeadError("The litter-born template is missing");

  const leads = (await tx.execute(sql`
    select lead_id from waitlist_entries where litter_id = ${litterId} and status = 'active' order by position`)) as unknown as { lead_id: string }[];
  let queued = 0;
  const skipped: string[] = [];
  for (const { lead_id } of leads) {
    const r = await queueMessage(tx, {
      workspaceId: ctx.workspaceId, leadId: lead_id, channel: "email", kind: "system",
      templateId: (tpl as { id: string }).id, createdBy: ctx.userId,
    });
    if (r.queued) queued++;
    else skipped.push(r.reason);
  }
  return { queued, skipped: skipped.length };
}

export type LitterSummary = {
  id: string; name: string; is_general: boolean; sire: string | null; dam: string | null; expected_date: string | null;
  born_date: string | null; expected_count: number | null; status: LitterStatus; active: number; deposits: number;
};

export async function listLitters(tx: Tx, workspaceId: string, includeClosed = false): Promise<LitterSummary[]> {
  return (await tx.execute(sql`
    select li.id, li.name, li.is_general, li.sire, li.dam, li.expected_date, li.born_date, li.expected_count, li.status,
      (select count(*)::int from waitlist_entries e where e.litter_id = li.id and e.status = 'active') as active,
      (select count(*)::int from waitlist_entries e where e.litter_id = li.id and e.status = 'active'
         and exists (select 1 from payments p where p.lead_id = e.lead_id and p.kind = 'deposit' and p.status = 'paid')) as deposits
    from litters li where li.workspace_id = ${workspaceId} ${includeClosed ? sql`` : sql`and li.status <> 'closed'`}
    order by li.is_general desc, li.expected_date nulls last, li.created_at`)) as unknown as LitterSummary[];
}
