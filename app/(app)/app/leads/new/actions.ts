"use server";

import { redirect } from "next/navigation";
import { withUser } from "@/lib/db";
import { normalizeEmail, normalizePhone, splitName } from "@/lib/intake/normalize";
import { upsertInquiry, type LeadSource } from "@/lib/intake/upsert";
import { kickQueue } from "@/lib/messaging/kick";
import { requireWorkspace } from "@/lib/workspace";

const QUICK_ADD_SOURCES =["facebook", "instagram", "text", "call", "show", "referral", "other"] as const;

export type QuickAddState = { error?: string; fields?: { name: string; contact: string; source: string } };

// FR-05: name, phone-or-email, source. Runs as the signed-in user, so RLS applies.
export async function quickAddLead(_prev: QuickAddState, formData: FormData): Promise<QuickAddState> {
  const { user, workspace } = await requireWorkspace();
  const name = String(formData.get("name") ?? "").trim();
  const contact = String(formData.get("contact") ?? "").trim();
  const source = String(formData.get("source") ?? "");
  const fields = { name, contact, source };

  if (!name) return { error: "Enter a name.", fields };
  if (!(QUICK_ADD_SOURCES as readonly string[]).includes(source)) return { error: "Pick where they came from.", fields };
  const email = contact.includes("@") ? normalizeEmail(contact) : null;
  const phone = contact.includes("@") ? null : normalizePhone(contact);
  if (!email && !phone) return { error: "Enter a valid phone number or email.", fields };

  const { firstName, lastName } = splitName(name);
  const result = await withUser(user.id, (tx) =>
    upsertInquiry(tx, {
      workspaceId: workspace.id, firstName, lastName, email, phone,
      source: source as LeadSource, actorUserId: user.id,
    }),
  );
  kickQueue();
  redirect(`/app/leads?added=${result.leadCreated ? "new" : "merged"}`);
}
