"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/auth";
import { serviceDb } from "@/lib/db";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createWorkspace, CreateWorkspaceInput } from "@/lib/workspaces/create";

export async function createWorkspaceAction(formData: FormData) {
  const admin = await requirePlatformAdmin();

  const parsed = CreateWorkspaceInput.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
    businessType: formData.get("businessType"),
    timezone: formData.get("timezone"),
    ownerEmail: formData.get("ownerEmail"),
    ownerName: formData.get("ownerName") || undefined,
  });
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? "form");
    redirect(`/admin/workspaces?error=invalid&field=${encodeURIComponent(field)}`);
  }

  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL;
  const result = await createWorkspace(serviceDb(), parsed.data, admin.id, async (email, name) => {
    const { data, error } = await createSupabaseAdminClient().auth.admin.inviteUserByEmail(email, {
      redirectTo: `${origin}/auth/confirm?next=/app`,
      data: name ? { name } : undefined,
    });
    if (error || !data.user) throw new Error(`invite failed: ${error?.message ?? "no user returned"}`);
    return data.user.id;
  });

  if (!result.ok) redirect("/admin/workspaces?error=slug_taken");
  redirect(`/admin/workspaces?created=${encodeURIComponent(parsed.data.slug)}${result.invited ? "&invited=1" : ""}`);
}
