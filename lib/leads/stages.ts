import "server-only";
import { sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { LeadError, type Ctx } from "./mutations";

// FR-10: owners rename, reorder, add and remove pipeline stages. Placed/Closed
// (the won and lost stages) can be renamed but not removed, and open stages
// always come before them.

const MAX_STAGES = 15;

function cleanName(name: string) {
  const n = name.trim().replace(/\s+/g, " ");
  if (!n) throw new LeadError("Give the stage a name");
  if (n.length > 40) throw new LeadError("Stage names are limited to 40 characters");
  return n;
}

async function nameTaken(tx: Tx, ctx: Ctx, name: string, exceptId?: string) {
  const [row] = await tx.execute(sql`
    select 1 from pipeline_stages where workspace_id = ${ctx.workspaceId} and lower(name) = lower(${name})
      ${exceptId ? sql`and id <> ${exceptId}` : sql``}`);
  return Boolean(row);
}

export async function renameStage(tx: Tx, ctx: Ctx, stageId: string, name: string) {
  const clean = cleanName(name);
  if (await nameTaken(tx, ctx, clean, stageId)) throw new LeadError("Another stage already has that name");
  const [row] = await tx.execute(sql`
    update pipeline_stages set name = ${clean} where id = ${stageId} and workspace_id = ${ctx.workspaceId} returning id`);
  if (!row) throw new LeadError("Stage not found");
}

// Adds an open stage just before the first won/lost stage.
export async function addStage(tx: Tx, ctx: Ctx, name: string) {
  const clean = cleanName(name);
  if (await nameTaken(tx, ctx, clean)) throw new LeadError("Another stage already has that name");
  const [{ n, first_closed }] = (await tx.execute(sql`
    select count(*)::int as n, min(position) filter (where kind <> 'open') as first_closed
    from pipeline_stages where workspace_id = ${ctx.workspaceId}`)) as unknown as { n: number; first_closed: number | null }[];
  if (n >= MAX_STAGES) throw new LeadError(`Up to ${MAX_STAGES} stages`);
  const position = first_closed ?? n + 1;
  await tx.execute(sql`set constraints all deferred`);
  await tx.execute(sql`
    update pipeline_stages set position = position + 1 where workspace_id = ${ctx.workspaceId} and position >= ${position}`);
  await tx.execute(sql`
    insert into pipeline_stages (workspace_id, name, position, kind) values (${ctx.workspaceId}, ${clean}, ${position}, 'open')`);
}

// Moves an open stage one place up or down among the open stages.
export async function moveStage(tx: Tx, ctx: Ctx, stageId: string, direction: -1 | 1) {
  const stages = (await tx.execute(sql`
    select id, position, kind from pipeline_stages where workspace_id = ${ctx.workspaceId} order by position`)) as unknown as {
    id: string; position: number; kind: string;
  }[];
  const i = stages.findIndex((s) => s.id === stageId);
  if (i < 0) throw new LeadError("Stage not found");
  const j = i + direction;
  if (stages[i].kind !== "open" || !stages[j] || stages[j].kind !== "open") return;
  await tx.execute(sql`set constraints all deferred`);
  await tx.execute(sql`update pipeline_stages set position = ${stages[j].position} where id = ${stages[i].id}`);
  await tx.execute(sql`update pipeline_stages set position = ${stages[i].position} where id = ${stages[j].id}`);
}

export async function setDefaultStage(tx: Tx, ctx: Ctx, stageId: string) {
  const [stage] = await tx.execute(sql`
    select kind from pipeline_stages where id = ${stageId} and workspace_id = ${ctx.workspaceId}`);
  if (!stage) throw new LeadError("Stage not found");
  if (stage.kind !== "open") throw new LeadError("New leads must start in an open stage");
  await tx.execute(sql`update pipeline_stages set is_default = false where workspace_id = ${ctx.workspaceId} and is_default`);
  await tx.execute(sql`update pipeline_stages set is_default = true where id = ${stageId}`);
}

export async function deleteStage(tx: Tx, ctx: Ctx, stageId: string) {
  const [stage] = (await tx.execute(sql`
    select s.kind, s.is_default, s.position, (select count(*)::int from leads l where l.stage_id = s.id) as leads
    from pipeline_stages s where s.id = ${stageId} and s.workspace_id = ${ctx.workspaceId}`)) as unknown as {
    kind: string; is_default: boolean; position: number; leads: number;
  }[];
  if (!stage) throw new LeadError("Stage not found");
  if (stage.kind !== "open") throw new LeadError("The won and lost stages can be renamed but not removed");
  if (stage.is_default) throw new LeadError("Choose another stage for new leads before removing this one");
  if (stage.leads > 0) throw new LeadError(`Move the ${stage.leads} lead${stage.leads === 1 ? "" : "s"} in this stage first`);
  await tx.execute(sql`delete from pipeline_stages where id = ${stageId}`);
  await tx.execute(sql`set constraints all deferred`);
  await tx.execute(sql`
    update pipeline_stages set position = position - 1 where workspace_id = ${ctx.workspaceId} and position > ${stage.position}`);
}
