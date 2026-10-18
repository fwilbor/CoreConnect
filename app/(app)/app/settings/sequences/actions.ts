"use server";

import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { withUser } from "@/lib/db";
import { requireOwner } from "@/lib/workspace";

export type SequenceResult = { ok: true } | { ok: false; error: string };

export async function setSequenceActiveAction(sequenceId: string, active: boolean): Promise<SequenceResult> {
  const { user, workspace } = await requireOwner();
  await withUser(user.id, (tx) =>
    tx.execute(sql`update sequences set is_active = ${active} where id = ${sequenceId} and workspace_id = ${workspace.id}`));
  revalidatePath("/app/settings/sequences");
  return { ok: true };
}

// Steps are timed from enrollment, so each step's day must come after the one before it.
export async function saveStepsAction(sequenceId: string, steps: { id: string; day: number; templateId: string }[]): Promise<SequenceResult> {
  const { user, workspace } = await requireOwner();
  for (const [i, s] of steps.entries()) {
    if (!Number.isInteger(s.day) || s.day < 0 || s.day > 90) return { ok: false, error: "Days must be whole numbers from 0 to 90" };
    if (i > 0 && s.day <= steps[i - 1].day) return { ok: false, error: "Each step must come after the one before it" };
  }
  const error = await withUser(user.id, async (tx) => {
    for (const s of steps) {
      const [ok] = await tx.execute(sql`
        update sequence_steps st set delay_hours = ${s.day * 24}, template_id = ${s.templateId}
        where st.id = ${s.id} and st.sequence_id = ${sequenceId} and st.workspace_id = ${workspace.id}
          and exists (select 1 from templates t where t.id = ${s.templateId} and t.workspace_id = ${workspace.id} and t.channel = 'email')
        returning st.id`);
      if (!ok) return "A step or its template wasn't found";
    }
    return null;
  });
  if (error) return { ok: false, error };
  revalidatePath("/app/settings/sequences");
  return { ok: true };
}
