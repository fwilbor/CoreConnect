"use server";

import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { withUser } from "@/lib/db";
import { requireWorkspace } from "@/lib/workspace";

// Any member, for themselves only (app.set_notify_new_leads checks the caller).
export async function setNewLeadEmails(formData: FormData) {
  const { user, workspace } = await requireWorkspace();
  const on = formData.get("on") === "true";
  await withUser(user.id, (tx) => tx.execute(sql`select app.set_notify_new_leads(${workspace.id}, ${on})`));
  revalidatePath("/app/settings/notifications");
}
