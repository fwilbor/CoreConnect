"use server";

import { revalidatePath } from "next/cache";
import { withUser, type Tx } from "@/lib/db";
import { LeadError, type Ctx } from "@/lib/leads/mutations";
import { createLitter, notifyWaitlist, updateLitter, type LitterInput } from "@/lib/litters";
import { kickQueue } from "@/lib/messaging/kick";
import { moveEntry, removeEntry } from "@/lib/waitlist";
import { requireWorkspace } from "@/lib/workspace";

export type LitterResult = { ok: true; id?: string; note?: string } | { ok: false; error: string };

async function run<T>(fn: (tx: Tx, ctx: Ctx) => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  const { user, workspace } = await requireWorkspace();
  try {
    const value = await withUser(user.id, (tx) => fn(tx, { workspaceId: workspace.id, userId: user.id }));
    revalidatePath("/app/litters", "layout");
    revalidatePath("/app/leads");
    return { ok: true, value };
  } catch (err) {
    if (err instanceof LeadError) return { ok: false, error: err.message };
    throw err;
  }
}

export async function createLitterAction(input: LitterInput): Promise<LitterResult> {
  const r = await run((tx, ctx) => createLitter(tx, ctx, input));
  return r.ok ? { ok: true, id: r.value } : r;
}

export async function updateLitterAction(litterId: string, input: LitterInput): Promise<LitterResult> {
  const r = await run((tx, ctx) => updateLitter(tx, ctx, litterId, input));
  return r.ok ? { ok: true } : r;
}

export async function moveEntryAction(entryId: string, toPosition: number, reason: string): Promise<LitterResult> {
  const r = await run((tx, ctx) => moveEntry(tx, ctx, entryId, toPosition, reason));
  return r.ok ? { ok: true } : r;
}

export async function removeEntryAction(entryId: string, outcome: "matched" | "released", reason: string): Promise<LitterResult> {
  const r = await run((tx, ctx) => removeEntry(tx, ctx, entryId, outcome, reason));
  return r.ok ? { ok: true } : r;
}

export async function notifyWaitlistAction(litterId: string): Promise<LitterResult> {
  const r = await run((tx, ctx) => notifyWaitlist(tx, ctx, litterId));
  if (!r.ok) return r;
  kickQueue();
  const { queued, skipped } = r.value;
  return { ok: true, note: `Emailed ${queued} ${queued === 1 ? "family" : "families"}${skipped ? `; ${skipped} skipped (no email, unsubscribed or do not contact)` : ""}.` };
}
