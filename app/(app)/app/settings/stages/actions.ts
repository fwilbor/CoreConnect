"use server";

import { revalidatePath } from "next/cache";
import { withUser, type Tx } from "@/lib/db";
import { LeadError, type Ctx } from "@/lib/leads/mutations";
import { addStage, deleteStage, moveStage, renameStage, setDefaultStage } from "@/lib/leads/stages";
import { requireOwner } from "@/lib/workspace";

export type StageActionResult = { ok: true } | { ok: false; error: string };

async function run(fn: (tx: Tx, ctx: Ctx) => Promise<unknown>): Promise<StageActionResult> {
  const { user, workspace } = await requireOwner();
  try {
    await withUser(user.id, (tx) => fn(tx, { workspaceId: workspace.id, userId: user.id }));
  } catch (err) {
    if (err instanceof LeadError) return { ok: false, error: err.message };
    throw err;
  }
  revalidatePath("/app/settings/stages");
  revalidatePath("/app/leads");
  return { ok: true };
}

export async function renameStageAction(stageId: string, name: string) {
  return run((tx, ctx) => renameStage(tx, ctx, stageId, name));
}
export async function addStageAction(name: string) {
  return run((tx, ctx) => addStage(tx, ctx, name));
}
export async function moveStageAction(stageId: string, direction: -1 | 1) {
  return run((tx, ctx) => moveStage(tx, ctx, stageId, direction === -1 ? -1 : 1));
}
export async function setDefaultStageAction(stageId: string) {
  return run((tx, ctx) => setDefaultStage(tx, ctx, stageId));
}
export async function deleteStageAction(stageId: string) {
  return run((tx, ctx) => deleteStage(tx, ctx, stageId));
}
