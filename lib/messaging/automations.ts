import "server-only";
import { sql } from "drizzle-orm";
import type { Database, Tx } from "@/lib/db";
import { queueMessage } from "./send";

// New lead (Automations table): auto-reply email, SMS too if consent was given,
// and enrollment in the Nurture sequence. Runs inside the transaction that
// created the lead, so the messages exist exactly when the lead does. CSV
// imports skip all of it (FR-07).
export async function onLeadCreated(tx: Tx, params: { workspaceId: string; leadId: string; source: string }) {
  if (params.source === "import") return;

  const templates = (await tx.execute(sql`
    select id, system_key from templates
    where workspace_id = ${params.workspaceId} and system_key in ('auto_reply_email', 'auto_reply_sms')`)) as unknown as {
    id: string; system_key: string;
  }[];
  for (const t of templates) {
    // A blocked channel (no email, no SMS consent, SMS off) is simply skipped.
    await queueMessage(tx, {
      workspaceId: params.workspaceId, leadId: params.leadId, kind: "auto_reply", templateId: t.id,
      channel: t.system_key === "auto_reply_sms" ? "sms" : "email",
    });
  }

  await enroll(tx, { workspaceId: params.workspaceId, leadId: params.leadId, sequence: "nurture" });
}

type Enrollment = {
  id: string; workspace_id: string; lead_id: string; sequence_id: string; next_step: number; created_at: string;
  system_key: string | null;
};

// Enrolls a lead in one of the workspace's system sequences, timed from now.
// A lead already active in that sequence is left as is.
export async function enroll(tx: Tx, params: { workspaceId: string; leadId: string; sequence: "nurture" | "application_reminder" | "deposit_reminder" }) {
  await tx.execute(sql`
    insert into sequence_enrollments (workspace_id, lead_id, sequence_id, next_step, next_run_at)
    select s.workspace_id, ${params.leadId}, s.id, 1, now() + make_interval(hours => st.delay_hours)
    from sequences s join sequence_steps st on st.sequence_id = s.id and st.step_number = 1
    where s.workspace_id = ${params.workspaceId} and s.system_key = ${params.sequence} and s.is_active
    on conflict do nothing`);
}

// Why an enrollment should stop now, or null to keep going. Each sequence has
// its own rule (Automations table):
//   Nurture: an inbound reply or a manual message (stage changes stop it at move time)
//   Application reminder: the application was submitted
//   Deposit reminder: a deposit was recorded
async function stopReason(tx: Tx, e: Enrollment): Promise<string | null> {
  const [row] = (await tx.execute(sql`
    select l.closed_at is not null as closed, s.is_active as active,
      exists (select 1 from messages m where m.lead_id = l.id and m.created_at >= ${e.created_at}::timestamptz
              and (m.direction = 'in' or m.kind = 'one_off')) as engaged,
      exists (select 1 from form_submissions fs join forms f on f.id = fs.form_id
              where fs.lead_id = l.id and f.kind = 'application') as applied,
      exists (select 1 from payments p where p.lead_id = l.id and p.kind = 'deposit' and p.status = 'paid') as paid
    from leads l, sequences s where l.id = ${e.lead_id} and s.id = ${e.sequence_id}`)) as unknown as {
    closed: boolean; active: boolean; engaged: boolean; applied: boolean; paid: boolean;
  }[];
  if (!row) return "gone";
  if (row.closed) return "closed";
  if (!row.active) return "sequence_off";
  if (e.system_key === "application_reminder") return row.applied ? "applied" : null;
  if (e.system_key === "deposit_reminder") return row.paid ? "paid" : null;
  return row.engaged ? "engaged" : null;
}

// Runs every due sequence step, one enrollment per transaction.
export async function runDueSequenceSteps(db: Database, limit = 100) {
  const counts = { queued: 0, stopped: 0, completed: 0, skipped: 0 };
  for (let i = 0; i < limit; i++) {
    const done = await db.transaction(async (tx) => {
      const [e] = (await tx.execute(sql`
        select e.id, e.workspace_id, e.lead_id, e.sequence_id, e.next_step, e.created_at, s.system_key
        from sequence_enrollments e join sequences s on s.id = e.sequence_id
        where e.status = 'active' and e.next_run_at <= now()
        order by e.next_run_at limit 1 for update of e skip locked`)) as unknown as Enrollment[];
      if (!e) return false;

      const reason = await stopReason(tx, e);
      if (reason) {
        await tx.execute(sql`update sequence_enrollments set status = 'stopped' where id = ${e.id}`);
        counts.stopped++;
        return true;
      }

      const steps = (await tx.execute(sql`
        select st.id, st.step_number, st.delay_hours, st.template_id, t.channel
        from sequence_steps st join templates t on t.id = st.template_id
        where st.sequence_id = ${e.sequence_id} and st.step_number >= ${e.next_step} order by st.step_number limit 2`)) as unknown as {
        id: string; step_number: number; delay_hours: number; template_id: string; channel: "email" | "sms";
      }[];
      const [step, next] = steps;
      if (!step) {
        await tx.execute(sql`update sequence_enrollments set status = 'completed' where id = ${e.id}`);
        counts.completed++;
        return true;
      }

      const result = await queueMessage(tx, {
        workspaceId: e.workspace_id, leadId: e.lead_id, channel: step.channel,
        kind: e.system_key === "nurture" ? "sequence" : "reminder",
        templateId: step.template_id, sequenceStepId: step.id,
      });
      if (result.queued) counts.queued++;
      else counts.skipped++;

      // Delays are measured from enrollment: day 1, day 3, day 7.
      if (next) {
        await tx.execute(sql`
          update sequence_enrollments set next_step = ${next.step_number},
            next_run_at = created_at + make_interval(hours => ${next.delay_hours})
          where id = ${e.id}`);
      } else {
        await tx.execute(sql`update sequence_enrollments set status = 'completed', next_run_at = null where id = ${e.id}`);
        counts.completed++;
      }
      return true;
    });
    if (!done) break;
  }
  return counts;
}
