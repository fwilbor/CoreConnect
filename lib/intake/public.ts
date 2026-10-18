import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { serviceDb, type Database } from "@/lib/db";
import { forms, workspaces } from "@/lib/db/schema";
import { FormFields, parseAnswers, type FormField } from "./fields";
import { normalizeEmail, normalizePhone } from "./normalize";
import { HONEYPOT_FIELD, hashIp, isRateLimited, verifyTurnstile } from "./spam";
import { upsertInquiry, type LeadSource } from "./upsert";

// "How did you hear about us?" on every inquiry form, mapped to leads.source.
// "Website" becomes the channel the form was submitted through.
export const HEARD_ABOUT = [
  { label: "Facebook", source: "facebook" },
  { label: "Instagram", source: "instagram" },
  { label: "Website", source: null },
  { label: "Referral", source: "referral" },
  { label: "Show or event", source: "show" },
  { label: "Other", source: "other" },
] as const;

export function smsConsentText(businessName: string) {
  return (
    `I agree to receive text messages from ${businessName} about my inquiry. ` +
    "Message frequency varies. Message and data rates may apply. Reply STOP to opt out, HELP for help."
  );
}

export type PublicForm = {
  workspaceId: string;
  workspaceName: string;
  slug: string;
  logoUrl: string | null;
  brandColor: string | null;
  formId: string;
  title: string;
  successMessage: string | null;
  fields: FormField[];
};

// The workspace's active inquiry form, or null. Reads only what the public
// page shows.
export async function loadPublicForm(slug: string, db: Database = serviceDb()): Promise<PublicForm | null> {
  const [row] = await db
    .select({
      workspaceId: workspaces.id, workspaceName: workspaces.name, slug: workspaces.slug,
      logoUrl: workspaces.logoUrl, brandColor: workspaces.brandColor,
      formId: forms.id, title: forms.title, successMessage: forms.successMessage, fields: forms.fields,
    })
    .from(workspaces)
    .innerJoin(forms, and(eq(forms.workspaceId, workspaces.id), eq(forms.kind, "inquiry"), eq(forms.isActive, true)))
    .where(eq(workspaces.slug, slug))
    .limit(1);
  if (!row) return null;
  const fields = FormFields.safeParse(row.fields);
  return { ...row, fields: fields.success ? fields.data : [] };
}

const CoreFields = z.object({
  first_name: z.string().trim().min(1, "Required").max(80),
  last_name: z.string().trim().max(80).optional(),
  email: z.string().trim().min(1, "Required"),
  phone: z.string().trim().min(1, "Required"),
  source: z.enum(HEARD_ABOUT.map((h) => h.label) as [string, ...string[]], { error: "Pick one" }),
  sms_consent: z.union([z.literal("on"), z.literal("true"), z.literal(true)]).optional(),
});

export type PublicSubmitResult =
  | { ok: true; successMessage: string | null }
  | { ok: false; status: 400 | 404 | 429; reason: "not_found" | "invalid" | "captcha" | "rate_limited"; errors?: Record<string, string> };

export async function submitPublicInquiry(
  params: {
    slug: string;
    channel: "form" | "embed";
    raw: Record<string, unknown>;
    turnstileToken: string | null;
    ip: string | null;
    userAgent: string | null;
  },
  deps: { db?: Database; verifyCaptcha?: typeof verifyTurnstile } = {},
): Promise<PublicSubmitResult> {
  const db = deps.db ?? serviceDb();
  const verifyCaptcha = deps.verifyCaptcha ?? verifyTurnstile;

  const form = await loadPublicForm(params.slug, db);
  if (!form) return { ok: false, status: 404, reason: "not_found" };

  // Bots that fill the hidden field get a normal-looking success and nothing is stored.
  if (String(params.raw[HONEYPOT_FIELD] ?? "").trim()) return { ok: true, successMessage: form.successMessage };

  if (!(await verifyCaptcha(params.turnstileToken, params.ip))) {
    return { ok: false, status: 400, reason: "captcha" };
  }

  const errors: Record<string, string> = {};
  const core = CoreFields.safeParse(params.raw);
  if (!core.success) {
    for (const issue of core.error.issues) errors[String(issue.path[0])] ??= issue.message;
  }
  // Checked from the raw input so every bad field is reported at once, even
  // when another core field failed.
  const rawEmail = String(params.raw.email ?? "").trim();
  const rawPhone = String(params.raw.phone ?? "").trim();
  const email = normalizeEmail(rawEmail);
  const phone = normalizePhone(rawPhone);
  if (rawEmail && !email) errors.email = "Enter a valid email address";
  if (rawPhone && !phone) errors.phone = "Enter a valid phone number";
  const answers = parseAnswers(form.fields, params.raw);
  if (!answers.ok) Object.assign(errors, answers.errors);
  if (!core.success || !answers.ok || Object.keys(errors).length) {
    return { ok: false, status: 400, reason: "invalid", errors };
  }

  const heard = HEARD_ABOUT.find((h) => h.label === core.data.source)!;
  const source: LeadSource = heard.source ?? params.channel;
  const ipHash = hashIp(params.ip);

  const limited = await db.transaction(async (tx) => {
    if (await isRateLimited(tx, form.workspaceId, ipHash)) return true;
    await upsertInquiry(tx, {
      workspaceId: form.workspaceId,
      firstName: core.data.first_name,
      lastName: core.data.last_name || null,
      email,
      phone,
      source,
      formId: form.formId,
      answers: answers.answers,
      smsConsent: core.data.sms_consent ? { text: smsConsentText(form.workspaceName), source: `form:${form.formId}` } : null,
      submission: { ipHash, userAgent: params.userAgent?.slice(0, 500) ?? null },
    });
    return false;
  });
  if (limited) return { ok: false, status: 429, reason: "rate_limited" };
  return { ok: true, successMessage: form.successMessage };
}
