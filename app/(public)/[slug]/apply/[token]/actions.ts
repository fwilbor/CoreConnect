"use server";

import { headers } from "next/headers";
import { submitApplication } from "@/lib/applications";

export type ApplyState =
  | { status: "idle" }
  | { status: "success"; message: string | null }
  | { status: "error"; message: string; errors?: Record<string, string> };

export async function submitApplicationAction(slug: string, token: string, _prev: ApplyState, formData: FormData): Promise<ApplyState> {
  const raw: Record<string, unknown> = {};
  for (const key of new Set(formData.keys())) {
    const values = formData.getAll(key).filter((v): v is string => typeof v === "string");
    raw[key] = values.length > 1 ? values : values[0];
  }
  const result = await submitApplication({ slug, token, raw, userAgent: (await headers()).get("user-agent") });
  if (result.ok) return { status: "success", message: result.successMessage };
  if (result.reason === "already_submitted") return { status: "success", message: "We already have your application. Thank you!" };
  if (result.reason === "not_found") return { status: "error", message: "This application link is invalid or has expired." };
  return { status: "error", message: "Please fix the highlighted questions.", errors: result.errors };
}
