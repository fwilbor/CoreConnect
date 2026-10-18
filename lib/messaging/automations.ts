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

  await tx.execute(sql`
    insert into sequence_enrollments (workspace_id, lead_id, sequence_id, next_step, next_run_at)
    select s.workspace_id, ${params.leadId}, s.id, 1, now() + make_interval(hours => st.delay_hours)
    from sequences s join sequence_steps st on st.sequence_id = s.id and st.step_number = 1
    where s.workspace_id = ${params.workspaceId} and s.system_key = 'nurture' and s.is_active
    on conflict do nothing`);
}

type Enrollment = {
  id: string; workspace_id: string; lead_id: string; sequence_id: string; next_step: number; created_at: string;
};

// Why an enrollment should stop now, or null to keep going. Mirrors the
// Nurture row: stops on an inbound reply, a manual message or a closed lead
// (stage changes stop it at move time).
async function stopReason(tx: Tx, e: Enrollment): Promise<string | null> {
  const [row] = (await tx.execute(sql`
    select l.closed_at is not null as closed, s.is_active as active,
      exists (select 1 from messages m where m.lead_id = l.id and m.created_at >= ${e.created_at}::timestamptz
              and (m.direction = 'in' or m.kind = 'one_off')) as engaged
    from leads l, sequences s where l.id = ${e.lead_id} and s.id = ${e.sequence_id}`)) as unknown as {
    closed: boolean; active: boolean; engaged: boolean;
  }[];
  if (!row) return "gone";
  if (row.closed) return "closed";
  if (!row.active) return "sequence_off";
  if (row.engaged) return "engaged";
  return null;
}

// Runs every due sequence step, one enrollment per transaction.
export async function runDueSequenceSteps(db: Database, limit = 100) {
  const counts = { queued: 0, stopped: 0, completed: 0, skipped: 0 };
  for (let i = 0; i < limit; i++) {
    const done = await db.transaction(async (tx) => {
      const [e] = (await tx.execute(sql`
        select id, workspace_id, lead_id, sequence_id, next_step, created_at from sequence_enrollments
        where status = 'active' and next_run_at <= now()
        order by next_run_at limit 1 for update skip locked`)) as unknown as Enrollment[];
      if (!e) return false;

      const reason = await stopReason(tx, e);
      if (reason) {
        await tx.execute(sql`update sequence_enrollments set status = 'stopped' where id = ${e.id}`);
        counts.stopped++;
        return true;
      }

      const steps = (await tx.execute(sql`
        select id, step_number, delay_hours, template_id from sequence_steps
        where sequence_id = ${e.sequence_id} and step_number >= ${e.next_step} order by step_number limit 2`)) as unknown as {
        id: string; step_number: number; delay_hours: number; template_id: string;
      }[];
      const [step, next] = steps;
      if (!step) {
        await tx.execute(sql`update sequence_enrollments set status = 'completed' where id = ${e.id}`);
        counts.completed++;
        return true;
      }

      const result = await queueMessage(tx, {
        workspaceId: e.workspace_id, leadId: e.lead_id, channel: "email", kind: "sequence",
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
