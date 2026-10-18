"use server";

import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { serviceDb, withUser } from "@/lib/db";
import { deliverDueMessages, queueMessage } from "@/lib/messaging/send";
import { defaultTransports } from "@/lib/messaging/transports";
import { requireWorkspace } from "@/lib/workspace";

export type SendResult = { ok: true; status: "sent" | "queued" | "failed"; error?: string } | { ok: false; error: string };

// One-off email or SMS from the lead page (FR-23). Queued as the signed-in
// user (RLS + consent checks), then delivered right away so the result shows.
export async function sendMessageAction(input: {
  leadId: string; channel: "email" | "sms"; templateId: string | null; subject: string; body: string;
}): Promise<SendResult> {
  const { user, workspace } = await requireWorkspace();
  if (input.channel !== "email" && input.channel !== "sms") return { ok: false, error: "Pick email or SMS" };

  const queued = await withUser(user.id, (tx) =>
    queueMessage(tx, {
      workspaceId: workspace.id, leadId: input.leadId, channel: input.channel, kind: "one_off",
      templateId: input.templateId ?? undefined,
      subject: input.channel === "email" ? input.subject : undefined,
      body: input.body, createdBy: user.id,
    }),
  );
  if (!queued.queued) return { ok: false, error: queued.reason };

  await deliverDueMessages(serviceDb(), defaultTransports(), 1, queued.messageId);
  const [row] = await serviceDb().execute(sql`select status, last_error from messages where id = ${queued.messageId}`);
  const { status, last_error } = row as { status: "sent" | "queued" | "failed"; last_error: string | null };
  revalidatePath(`/app/leads/${input.leadId}`);
  return { ok: true, status, error: last_error ?? undefined };
}
