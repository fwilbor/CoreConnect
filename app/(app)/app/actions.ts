"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireWorkspace, WORKSPACE_COOKIE } from "@/lib/workspace";

export async function switchWorkspace(formData: FormData) {
  const { all } = await requireWorkspace();
  const id = String(formData.get("workspaceId") ?? "");
  if (all.some((w) => w.id === id)) {
    (await cookies()).set(WORKSPACE_COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  }
  redirect("/app");
}
