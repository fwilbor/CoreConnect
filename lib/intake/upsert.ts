import "server-only";
import { sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { onLeadCreated } from "@/lib/messaging/automations";
import type { Answers } from "./fields";

export const LEAD_SOURCES = [
  "form", "embed", "email", "facebook", "instagram", "text", "call", "show", "referral", "import", "other",
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export type IntakeInput = {
  workspaceId: string;
  firstName: string;
  lastName?: string | null;
  // Already normalized (normalizeEmail / normalizePhone). At least one is required.
  email: string | null;
  phone: string | null;
  source: LeadSource;
  formId?: string | null;
  answers?: Answers;
  smsConsent?: { text: string; source: string } | null;
  tags?: string[];
  note?: string | null;
  actorUserId?: string | null;
  submission?: { ipHash: string | null; userAgent: string | null };
};

export type IntakeResult = {
  contactId: string;
  leadId: string;
  contactCreated: boolean;
  leadCreated: boolean;
  // Email matched one contact and phone another: attached to the email match,
  // both flagged for a manual merge (FR-06).
  mergeConflict: boolean;
};

type ContactRow = { id: string; first_name: string | null; last_name: string | null; email_norm: string | null; phone_e164: string | null };

const one = async <T>(tx: Tx, query: ReturnType<typeof sql>) => (await tx.execute(query))[0] as T | undefined;

// drizzle expands JS arrays into parameter lists, so pass text arrays as JSON.
const textArray = (values: string[]) =>
  sql`array(select jsonb_array_elements_text(${JSON.stringify(values)}::jsonb))::text[]`;

// Creates or merges a contact and lead from one inquiry. Runs inside the
// caller's transaction: withUser() for staff actions (RLS applies) or
// serviceDb().transaction() for public intake, already scoped to one workspace.
export async function upsertInquiry(tx: Tx, input: IntakeInput): Promise<IntakeResult> {
  const { workspaceId, email, phone } = input;
  if (!email && !phone) throw new Error("an inquiry needs an email or a phone number");

  // Serialize concurrent inquiries for the same email or phone in this
  // workspace. Keys are sorted so two transactions always lock in the same order.
  const lockKeys = [email && `${workspaceId}:e:${email}`, phone && `${workspaceId}:p:${phone}`]
    .filter((k): k is string => Boolean(k))
    .sort();
  for (const key of lockKeys) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
  }

  const byEmail = email
    ? await one<ContactRow>(tx, sql`select id, first_name, last_name, email_norm, phone_e164 from contacts
                                    where workspace_id = ${workspaceId} and email_norm = ${email}`)
    : undefined;
  const byPhone = phone
    ? await one<ContactRow>(tx, sql`select id, first_name, last_name, email_norm, phone_e164 from contacts
                                    where workspace_id = ${workspaceId} and phone_e164 = ${phone}`)
    : undefined;

  const existing = byEmail ?? byPhone;
  const mergeConflict = Boolean(byEmail && byPhone && byEmail.id !== byPhone.id);
  let contactId: string;

  if (!existing) {
    const row = await one<{ id: string }>(tx, sql`
      insert into contacts (workspace_id, first_name, last_name, email_norm, phone_e164)
      values (${workspaceId}, ${input.firstName}, ${input.lastName ?? null}, ${email}, ${phone})
      returning id`);
    contactId = row!.id;
  } else {
    contactId = existing.id;
    // Fill gaps only; never overwrite what the breeder already has. A phone or
    // email that belongs to another contact is not copied (unique per workspace).
    await tx.execute(sql`
      update contacts set
        first_name = coalesce(first_name, ${input.firstName}),
        last_name  = coalesce(last_name, ${input.lastName ?? null}),
        email_norm = coalesce(email_norm, ${byEmail ? null : email}),
        phone_e164 = coalesce(phone_e164, ${byPhone ? null : phone}),
        needs_merge_review = needs_merge_review or ${mergeConflict}
      where id = ${contactId}`);
    if (mergeConflict) {
      await tx.execute(sql`update contacts set needs_merge_review = true where id = ${byPhone!.id}`);
    }
  }

  if (input.smsConsent) {
    await tx.execute(sql`
      update contacts set sms_consent_at = now(), sms_consent_text = ${input.smsConsent.text},
                          sms_consent_source = ${input.smsConsent.source}
      where id = ${contactId}`);
  }

  // One open lead per contact: a repeat inquiry joins it; otherwise start a new
  // lead at the workspace's default stage.
  const openLead = await one<{ id: string }>(tx, sql`
    select l.id from leads l join pipeline_stages s on s.id = l.stage_id
    where l.workspace_id = ${workspaceId} and l.contact_id = ${contactId}
      and l.closed_at is null and s.kind = 'open'
    order by l.created_at desc limit 1`);

  let leadId: string;
  const tags = input.tags ?? [];
  if (openLead) {
    leadId = openLead.id;
    if (tags.length) {
      await tx.execute(sql`
        update leads set tags = array(select distinct unnest(tags || ${textArray(tags)})) where id = ${leadId}`);
    }
  } else {
    const row = await one<{ id: string }>(tx, sql`
      insert into leads (workspace_id, contact_id, stage_id, source, tags)
      select ${workspaceId}, ${contactId}, s.id, ${input.source}, ${textArray(tags)}
      from pipeline_stages s where s.workspace_id = ${workspaceId} and s.is_default
      returning id`);
    if (!row) throw new Error(`workspace ${workspaceId} has no default stage`);
    leadId = row.id;
  }

  let submissionId: string | null = null;
  if (input.formId) {
    const row = await one<{ id: string }>(tx, sql`
      insert into form_submissions (workspace_id, form_id, lead_id, answers, ip_hash, user_agent)
      values (${workspaceId}, ${input.formId}, ${leadId}, ${JSON.stringify(input.answers ?? {})}::jsonb,
              ${input.submission?.ipHash ?? null}, ${input.submission?.userAgent ?? null})
      returning id`);
    submissionId = row!.id;
  }

  const event = openLead ? "inquiry_merged" : "lead_created";
  await tx.execute(sql`
    insert into activities (workspace_id, lead_id, type, payload, actor_user_id)
    values (${workspaceId}, ${leadId}, ${input.formId ? "form" : "system"},
            ${JSON.stringify({ event, source: input.source, submission_id: submissionId, merge_conflict: mergeConflict,
                               submitted: { email, phone } })}::jsonb,
            ${input.actorUserId ?? null})`);
  if (input.note?.trim()) {
    await tx.execute(sql`
      insert into activities (workspace_id, lead_id, type, payload, actor_user_id)
      values (${workspaceId}, ${leadId}, 'note', ${JSON.stringify({ text: input.note.trim() })}::jsonb,
              ${input.actorUserId ?? null})`);
  }

  if (!openLead) await onLeadCreated(tx, { workspaceId, leadId, source: input.source });

  return { contactId, leadId, contactCreated: !existing, leadCreated: !openLead, mergeConflict };
}
