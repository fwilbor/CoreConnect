"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { connectOnboardingUrl } from "@/lib/deposits";
import { z } from "zod";
import { withUser } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import { requireOwner } from "@/lib/workspace";

const BusinessInput = z.object({
  name: z.string().trim().min(1, "Business name is required").max(120),
  physicalAddress: z.string().trim().max(300),
  brandColor: z.union([z.literal(""), z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a color like #2f6f4e")]),
  logoUrl: z.union([z.literal(""), z.url({ protocol: /^https$/, error: "Use an https:// link" }).max(500)]),
  smsEnabled: z.boolean(),
  depositAmount: z.union([z.literal(""), z.string().regex(/^\$?\d{1,6}(\.\d{1,2})?$/, "Enter a deposit like 300 or 300.00")]),
  depositTerms: z.string().trim().max(4000),
});

export type BusinessState = { ok?: boolean; error?: string };

export async function saveBusinessSettings(_prev: BusinessState, formData: FormData): Promise<BusinessState> {
  const { user, workspace } = await requireOwner();
  const parsed = BusinessInput.safeParse({
    name: formData.get("name"),
    physicalAddress: formData.get("physicalAddress") ?? "",
    brandColor: formData.get("brandColor") ?? "",
    logoUrl: formData.get("logoUrl") ?? "",
    smsEnabled: formData.get("smsEnabled") === "on",
    depositAmount: String(formData.get("depositAmount") ?? "").trim(),
    depositTerms: formData.get("depositTerms") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form" };
  const d = parsed.data;

  const error = await withUser(user.id, async (tx) => {
    const [current] = await tx.select({ number: workspaces.smsNumberE164 }).from(workspaces).where(eq(workspaces.id, workspace.id));
    if (d.smsEnabled && !current?.number) return "SMS can be turned on once a number is set up for this workspace";
    await tx
      .update(workspaces)
      .set({
        name: d.name, physicalAddress: d.physicalAddress || null, brandColor: d.brandColor || null,
        logoUrl: d.logoUrl || null, smsEnabled: d.smsEnabled,
        depositAmountCents: d.depositAmount ? Math.round(Number(d.depositAmount.replace("$", "")) * 100) : null,
        depositTerms: d.depositTerms || null,
      })
      .where(eq(workspaces.id, workspace.id));
    return null;
  });
  if (error) return { error };
  revalidatePath("/app", "layout");
  return { ok: true };
}

// Starts (or resumes) Stripe Connect onboarding for this workspace.
export async function connectStripeAction() {
  const { user, workspace } = await requireOwner();
  const url = await connectOnboardingUrl({ workspaceId: workspace.id, ownerEmail: user.email, businessName: workspace.name });
  redirect(url);
}
