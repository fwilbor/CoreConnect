import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { serviceDb, type Database, type Tx } from "@/lib/db";
import { forms, workspaces } from "@/lib/db/schema";
import { FormFields, parseAnswers, type FormField } from "@/lib/intake/fields";
import { advanceToStage, LeadError, moveLeadToStage, type Ctx } from "@/lib/leads/mutations";
import { enroll } from "@/lib/messaging/automations";
import { queueMessage } from "@/lib/messaging/send";
import { verifyToken } from "@/lib/tokens";
import { addToWaitlist } from "@/lib/waitlist";

// Applications (FR-15) and the owner's decision (FR-16).

async function templateId(tx: Tx, workspaceId: string, key: string) {
  const [row] = await tx.execute(sql`select id from templates where workspace_id = ${workspaceId} and system_key = ${key}`);
  if (!row) throw new LeadError(`The ${key.replace(/_/g, " ")} template is missing`);
  return (row as { id: string }).id;
}

// Emails the application link, moves the lead to Application and starts the
// reminders (48 hours, then 5 days) until it's submitted.
export async function sendApplicationLink(tx: Tx, ctx: Ctx, leadId: string) {
  const result = await queueMessage(tx, {
    workspaceId: ctx.workspaceId, leadId, channel: "email", kind: "one_off",
    templateId: await templateId(tx, ctx.workspaceId, "application_link"), createdBy: ctx.userId,
  });
  if (!result.queued) throw new LeadError(result.reason);
  await advanceToStage(tx, ctx, leadId, "application");
  await enroll(tx, { workspaceId: ctx.workspaceId, leadId, sequence: "application_reminder" });
  return result.messageId;
}

export type PublicApplication = {
  leadId: string; workspaceId: string; workspaceName: string; logoUrl: string | null; brandColor: string | null;
  formId: string; title: string; successMessage: string | null; fields: FormField[]; firstName: string | null;
  alreadySubmitted: boolean;
};

// The application behind a token, or null if the token is bad, expired or for
// another workspace.
export async function loadApplication(slug: string, token: string, db: Database = serviceDb()): Promise<PublicApplication | null> {
  const leadId = verifyToken(token, "apply");
  if (!leadId) return null;
  const [row] = await db.execute(sql`
    select l.id as lead_id, w.id as workspace_id, w.name as workspace_name, w.logo_url, w.brand_color, c.first_name,
           f.id as form_id, f.title, f.success_message, f.fields,
           exists (select 1 from form_submissions fs where fs.lead_id = l.id and fs.form_id = f.id) as already
    from leads l join workspaces w on w.id = l.workspace_id join contacts c on c.id = l.contact_id
    join forms f on f.workspace_id = w.id and f.kind = 'application' and f.is_active
    where l.id = ${leadId} and w.slug = ${slug}`);
  if (!row) return null;
  const r = row as Record<string, unknown>;
  const fields = FormFields.safeParse(r.fields);
  return {
    leadId: String(r.lead_id), workspaceId: String(r.workspace_id), workspaceName: String(r.workspace_name),
    logoUrl: (r.logo_url as string | null) ?? null, brandColor: (r.brand_color as string | null) ?? null,
    formId: String(r.form_id), title: String(r.title), successMessage: (r.success_message as string | null) ?? null,
    fields: fields.success ? fields.data : [], firstName: (r.first_name as string | null) ?? null, alreadySubmitted: Boolean(r.already),
  };
}

export type SubmitApplicationResult =
  | { ok: true; successMessage: string | null }
  | { ok: false; reason: "not_found" | "already_submitted" | "invalid"; errors?: Record<string, string> };

// Public submission. One per lead ("single-use where it matters").
export async function submitApplication(
  params: { slug: string; token: string; raw: Record<string, unknown>; userAgent: string | null },
  db: Database = serviceDb(),
): Promise<SubmitApplicationResult> {
  const app = await loadApplication(params.slug, params.token, db);
  if (!app) return { ok: false, reason: "not_found" };
  if (app.alreadySubmitted) return { ok: false, reason: "already_submitted" };
  const answers = parseAnswers(app.fields, params.raw);
  if (!answers.ok) return { ok: false, reason: "invalid", errors: answers.errors };

  const inserted = await db.transaction(async (tx) => {
    // Lock the lead so a double-click can't submit twice.
    await tx.execute(sql`select id from leads where id = ${app.leadId} for update`);
    const [dup] = await tx.execute(sql`select 1 from form_submissions where lead_id = ${app.leadId} and form_id = ${app.formId}`);
    if (dup) return false;
    const [sub] = await tx.execute(sql`
      insert into form_submissions (workspace_id, form_id, lead_id, answers, user_agent)
      values (${app.workspaceId}, ${app.formId}, ${app.leadId}, ${JSON.stringify(answers.answers)}::jsonb, ${params.userAgent?.slice(0, 500) ?? null})
      returning id`);
    await tx.execute(sql`
      insert into activities (workspace_id, lead_id, type, payload)
      values (${app.workspaceId}, ${app.leadId}, 'form',
              ${JSON.stringify({ event: "application_submitted", submission_id: (sub as { id: string }).id })}::jsonb)`);
    await advanceToStage(tx, { workspaceId: app.workspaceId, userId: null }, app.leadId, "application");
    return true;
  });
  if (!inserted) return { ok: false, reason: "already_submitted" };
  return { ok: true, successMessage: app.successMessage };
}

export type ApproveInput = {
  leadId: string;
  // Waitlist to join: a litter id, "general", or null to approve without one.
  waitlist: string | "general" | null;
  sexPref?: string;
  colorPref?: string;
  sendEmail: boolean;
};

// Approve: move to Approved, optionally join a waitlist (which moves to
// Waitlisted), and email the approval with the deposit link when deposits are
// set up. The deposit reminder then runs until a deposit is recorded.
export async function approveApplication(tx: Tx, ctx: Ctx, input: ApproveInput) {
  const [lead] = await tx.execute(sql`select closed_at from leads where id = ${input.leadId} and workspace_id = ${ctx.workspaceId}`);
  if (!lead) throw new LeadError("Lead not found");
  await advanceToStage(tx, ctx, input.leadId, "approved");
  await tx.execute(sql`
    insert into activities (workspace_id, lead_id, type, payload, actor_user_id)
    values (${ctx.workspaceId}, ${input.leadId}, 'system', '{"event":"application_approved"}'::jsonb, ${ctx.userId})`);

  let position: number | null = null;
  if (input.waitlist) {
    ({ position } = await addToWaitlist(tx, ctx, {
      leadId: input.leadId, litterId: input.waitlist === "general" ? null : input.waitlist,
      sexPref: input.sexPref, colorPref: input.colorPref,
    }));
  }

  const [ws] = await tx
    .select({ amount: workspaces.depositAmountCents, charges: workspaces.stripeChargesEnabled })
    .from(workspaces)
    .where(eq(workspaces.id, ctx.workspaceId));
  const depositsReady = Boolean(ws?.amount && ws.charges);
  let emailed = false;
  let emailNote: string | null = null;
  if (input.sendEmail) {
    if (!depositsReady) {
      emailNote = "Approval email not sent: set a deposit amount and connect Stripe first, or message them yourself.";
    } else {
      const r = await queueMessage(tx, {
        workspaceId: ctx.workspaceId, leadId: input.leadId, channel: "email", kind: "one_off",
        templateId: await templateId(tx, ctx.workspaceId, "approved"), createdBy: ctx.userId,
      });
      emailed = r.queued;
      if (!r.queued) emailNote = `Approval email not sent: ${r.reason.toLowerCase()}`;
      else await enroll(tx, { workspaceId: ctx.workspaceId, leadId: input.leadId, sequence: "deposit_reminder" });
    }
  }
  return { position, emailed, emailNote };
}

// Decline: send the polite decline template (when consent allows) and close
// the lead as "Not a fit".
export async function declineApplication(tx: Tx, ctx: Ctx, leadId: string, sendEmail: boolean) {
  let emailNote: string | null = null;
  if (sendEmail) {
    const r = await queueMessage(tx, {
      workspaceId: ctx.workspaceId, leadId, channel: "email", kind: "one_off",
      templateId: await templateId(tx, ctx.workspaceId, "decline"), createdBy: ctx.userId,
    });
    if (!r.queued) emailNote = `Decline email not sent: ${r.reason.toLowerCase()}`;
  }
  const [closed] = await tx.execute(sql`select id from pipeline_stages where workspace_id = ${ctx.workspaceId} and system_key = 'closed'`);
  if (!closed) throw new LeadError("No closed stage found");
  await moveLeadToStage(tx, ctx, leadId, (closed as { id: string }).id, "Not a fit");
  return { emailNote };
}

export async function applicationForm(tx: Tx, workspaceId: string) {
  const [row] = await tx
    .select({ id: forms.id, title: forms.title, successMessage: forms.successMessage, fields: forms.fields })
    .from(forms)
    .where(and(eq(forms.workspaceId, workspaceId), eq(forms.kind, "application")));
  return row ?? null;
}
