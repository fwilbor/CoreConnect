"use server";

import { revalidatePath } from "next/cache";
import { withUser, type Tx } from "@/lib/db";
import { sql } from "drizzle-orm";
import { approveApplication, declineApplication, sendApplicationLink, type ApproveInput } from "@/lib/applications";
import { enroll } from "@/lib/messaging/automations";
import { queueMessage } from "@/lib/messaging/send";
import { LeadError, type Ctx } from "@/lib/leads/mutations";
import { kickQueue } from "@/lib/messaging/kick";
import { recordManualPayment, type ManualPaymentInput } from "@/lib/payments";
import { addToWaitlist, removeEntry } from "@/lib/waitlist";
import { requireWorkspace } from "@/lib/workspace";

export type QualifyResult = { ok: true; note?: string | null } | { ok: false; error: string };

async function run(leadId: string, fn: (tx: Tx, ctx: Ctx) => Promise<string | null | void>, sends = false): Promise<QualifyResult> {
  const { user, workspace } = await requireWorkspace();
  let note: string | null | void;
  try {
    note = await withUser(user.id, (tx) => fn(tx, { workspaceId: workspace.id, userId: user.id }));
  } catch (err) {
    if (err instanceof LeadError) return { ok: false, error: err.message };
    throw err;
  }
  if (sends) kickQueue();
  revalidatePath(`/app/leads/${leadId}`);
  revalidatePath("/app/leads");
  revalidatePath("/app/litters", "layout");
  return { ok: true, note: note ?? null };
}

export async function sendApplicationLinkAction(leadId: string) {
  return run(leadId, async (tx, ctx) => { await sendApplicationLink(tx, ctx, leadId); }, true);
}

export async function approveAction(input: ApproveInput) {
  return run(input.leadId, async (tx, ctx) => {
    const r = await approveApplication(tx, ctx, input);
    const placed = r.position ? `Added to the waitlist at #${r.position}.` : null;
    return [placed, r.emailed ? "Approval email sent with the deposit link." : r.emailNote].filter(Boolean).join(" ") || null;
  }, true);
}

export async function declineAction(leadId: string, sendEmail: boolean) {
  return run(leadId, async (tx, ctx) => (await declineApplication(tx, ctx, leadId, sendEmail)).emailNote, true);
}

export async function addToWaitlistAction(leadId: string, litterId: string | null, sexPref: string, colorPref: string) {
  return run(leadId, async (tx, ctx) => {
    const { position } = await addToWaitlist(tx, ctx, { leadId, litterId, sexPref, colorPref });
    return `Added at #${position}.`;
  });
}

export async function removeFromWaitlistAction(leadId: string, entryId: string, outcome: "matched" | "released", reason: string) {
  return run(leadId, async (tx, ctx) => { await removeEntry(tx, ctx, entryId, outcome, reason); });
}

export async function recordPaymentAction(input: ManualPaymentInput) {
  return run(input.leadId, async (tx, ctx) => { await recordManualPayment(tx, ctx, input); });
}

// Emails the deposit link and starts the deposit reminders (3 and 7 days).
export async function sendDepositLinkAction(leadId: string) {
  return run(leadId, async (tx, ctx) => {
    const [tpl] = await tx.execute(sql`select id from templates where workspace_id = ${ctx.workspaceId} and system_key = 'deposit_link'`);
    if (!tpl) throw new LeadError("The deposit link template is missing");
    const r = await queueMessage(tx, {
      workspaceId: ctx.workspaceId, leadId, channel: "email", kind: "one_off", templateId: (tpl as { id: string }).id, createdBy: ctx.userId,
    });
    if (!r.queued) throw new LeadError(r.reason);
    await enroll(tx, { workspaceId: ctx.workspaceId, leadId, sequence: "deposit_reminder" });
    return "Deposit link sent.";
  }, true);
}
