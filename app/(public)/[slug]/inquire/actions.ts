"use server";

import { headers } from "next/headers";
import { clientIp } from "@/lib/intake/spam";
import { submitPublicInquiry } from "@/lib/intake/public";
import { kickQueue } from "@/lib/messaging/kick";

export type InquiryState =
  | { status: "idle" }
  | { status: "success"; message: string | null }
  | { status: "error"; message: string; errors?: Record<string, string> };

const MESSAGES = {
  captcha: "We couldn't confirm you're not a bot. Please try again.",
  rate_limited: "Too many submissions from this connection. Please try again in an hour.",
  invalid: "Please fix the highlighted fields.",
  not_found: "This form is no longer available.",
} as const;

export async function submitInquiryAction(
  slug: string,
  channel: "form" | "embed",
  _prev: InquiryState,
  formData: FormData,
): Promise<InquiryState> {
  const h = await headers();
  // Multi-selects arrive as repeated keys.
  const raw: Record<string, unknown> = {};
  for (const key of new Set(formData.keys())) {
    const values = formData.getAll(key).filter((v): v is string => typeof v === "string");
    raw[key] = values.length > 1 ? values : values[0];
  }
  const result = await submitPublicInquiry({
    slug,
    channel,
    raw,
    turnstileToken: (formData.get("cf-turnstile-response") as string | null) ?? null,
    ip: clientIp(h),
    userAgent: h.get("user-agent"),
  });
  if (result.ok) kickQueue();
  if (result.ok) return { status: "success", message: result.successMessage };
  return { status: "error", message: MESSAGES[result.reason], errors: result.errors };
}
