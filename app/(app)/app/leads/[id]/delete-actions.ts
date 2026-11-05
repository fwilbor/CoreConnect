"use server";

import { redirect } from "next/navigation";
import { deleteContact } from "@/lib/contacts";
import { withUser } from "@/lib/db";
import { LeadError } from "@/lib/leads/mutations";
import { requireOwner } from "@/lib/workspace";

// Owner only (Admin: "delete a contact and their messages on request").
export async function deleteContactAction(contactId: string, confirm: string): Promise<{ error: string }> {
  const { user, workspace } = await requireOwner();
  if (confirm.trim().toUpperCase() !== "DELETE") return { error: "Type DELETE to confirm" };
  try {
    await withUser(user.id, (tx) => deleteContact(tx, { workspaceId: workspace.id, userId: user.id }, contactId));
  } catch (err) {
    if (err instanceof LeadError) return { error: err.message };
    throw err;
  }
  redirect("/app/leads?deleted=1");
}
