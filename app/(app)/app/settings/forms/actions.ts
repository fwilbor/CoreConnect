"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withUser } from "@/lib/db";
import { forms } from "@/lib/db/schema";
import { FormFields } from "@/lib/intake/fields";
import { requireOwner } from "@/lib/workspace";

const SaveInput = z.object({
  title: z.string().trim().min(1).max(120),
  successMessage: z.string().trim().max(500),
  fields: FormFields,
});

export type SaveFormState = { ok?: boolean; error?: string };

export async function saveInquiryForm(_prev: SaveFormState, formData: FormData): Promise<SaveFormState> {
  const { user, workspace } = await requireOwner();
  let fields: unknown;
  try {
    fields = JSON.parse(String(formData.get("fields") ?? "[]"));
  } catch {
    return { error: "Couldn't read the fields. Reload and try again." };
  }
  const parsed = SaveInput.safeParse({
    title: formData.get("title"),
    successMessage: formData.get("successMessage") ?? "",
    fields,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: issue ? `${issue.path.join(" ")}: ${issue.message}` : "Check the form." };
  }

  await withUser(user.id, (tx) =>
    tx
      .update(forms)
      .set({ title: parsed.data.title, successMessage: parsed.data.successMessage || null, fields: parsed.data.fields })
      .where(and(eq(forms.workspaceId, workspace.id), eq(forms.kind, "inquiry"))),
  );
  revalidatePath("/app/settings/forms");
  return { ok: true };
}
