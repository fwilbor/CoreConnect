"use server";

import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { withUser, type Tx } from "@/lib/db";
import {
  addNote, addTask, assignLead, clearMergeReview, LeadError, logContact, moveLeadToStage, setRating, setTags,
  setTaskDone, updateContact, type ContactUpdate, type Ctx,
} from "@/lib/leads/mutations";
import { requireWorkspace } from "@/lib/workspace";

export type ActionResult = { ok: true } | { ok: false; error: string };

// Runs a lead mutation as the signed-in user in their current workspace and
// turns validation errors into a message for the UI.
async function run(leadId: string | null, fn: (tx: Tx, ctx: Ctx) => Promise<unknown>): Promise<ActionResult> {
  const { user, workspace } = await requireWorkspace();
  try {
    await withUser(user.id, (tx) => fn(tx, { workspaceId: workspace.id, userId: user.id }));
  } catch (err) {
    if (err instanceof LeadError) return { ok: false, error: err.message };
    throw err;
  }
  revalidatePath("/app/leads");
  if (leadId) revalidatePath(`/app/leads/${leadId}`);
  return { ok: true };
}

export async function moveLeadAction(leadId: string, stageId: string, closedReason?: string) {
  return run(leadId, (tx, ctx) => moveLeadToStage(tx, ctx, leadId, stageId, closedReason));
}

export async function addNoteAction(leadId: string, text: string) {
  return run(leadId, (tx, ctx) => addNote(tx, ctx, leadId, text));
}

export async function logContactAction(leadId: string, channel: "call" | "text" | "dm" | "in_person", note: string) {
  if (!["call", "text", "dm", "in_person"].includes(channel)) return { ok: false, error: "Pick how you reached them" } as const;
  return run(leadId, (tx, ctx) => logContact(tx, ctx, leadId, channel, note));
}

// dueDate is the user's local date (YYYY-MM-DD); tasks are due at 9 am in the
// workspace's time zone, computed by Postgres.
export async function addTaskAction(leadId: string, title: string, dueDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return { ok: false, error: "Pick a due date" } as const;
  return run(leadId, async (tx, ctx) => {
    const [row] = await tx.execute(sql`
      select extract(epoch from (${dueDate}::date + time '09:00') at time zone w.timezone)::float8 as epoch
      from workspaces w where w.id = ${ctx.workspaceId}`);
    return addTask(tx, ctx, leadId, title, new Date(Number((row as { epoch: number }).epoch) * 1000));
  });
}

export async function setTaskDoneAction(leadId: string, taskId: string, done: boolean) {
  return run(leadId, (tx, ctx) => setTaskDone(tx, ctx, taskId, done));
}

export async function setTagsAction(leadId: string, tags: string[]) {
  return run(leadId, (tx, ctx) => setTags(tx, ctx, leadId, tags));
}

export async function setRatingAction(leadId: string, rating: number | null) {
  return run(leadId, (tx, ctx) => setRating(tx, ctx, leadId, rating));
}

export async function assignLeadAction(leadId: string, assigneeId: string | null) {
  return run(leadId, (tx, ctx) => assignLead(tx, ctx, leadId, assigneeId));
}

export async function updateContactAction(leadId: string, contactId: string, input: ContactUpdate) {
  return run(leadId, (tx, ctx) => updateContact(tx, ctx, contactId, input));
}

export async function clearMergeReviewAction(leadId: string, contactId: string) {
  return run(leadId, (tx, ctx) => clearMergeReview(tx, ctx, contactId));
}
