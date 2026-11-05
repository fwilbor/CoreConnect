import "server-only";
import { sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { writeAudit } from "@/lib/export";
import { LeadError, type Ctx } from "@/lib/leads/mutations";
import { vacateForDeletion } from "@/lib/waitlist";

// Deletes a contact on request (FR-28; Privacy: "Contact delete removes
// messages and submissions, keeps payment records with personal data
// redacted"). Owner only: write_audit refuses anyone else, which rolls back
// the whole delete.
//
// Removed (by foreign-key cascade from contacts): leads, messages, timeline
// activities (notes, tasks, stage changes), form submissions, sequence
// enrollments, waitlist entries and their history.
// Kept: payments, with lead_id cleared and the free-text note removed.
// The audit entry records counts only, no personal data.
export async function deleteContact(tx: Tx, ctx: Ctx, contactId: string) {
  const [contact] = await tx.execute(sql`select id from contacts where id = ${contactId} and workspace_id = ${ctx.workspaceId} for update`);
  if (!contact) throw new LeadError("Contact not found");

  const [counts] = (await tx.execute(sql`
    select (select count(*)::int from leads where contact_id = ${contactId}) as leads,
           (select count(*)::int from messages m join leads l on l.id = m.lead_id where l.contact_id = ${contactId}) as messages,
           (select count(*)::int from payments p join leads l on l.id = p.lead_id where l.contact_id = ${contactId}) as payments`)) as unknown as {
    leads: number; messages: number; payments: number;
  }[];

  // First, so a non-owner is refused before anything changes.
  await writeAudit(tx, ctx.workspaceId, "contact.delete", { contact_id: contactId, ...counts });

  const entries = (await tx.execute(sql`
    select e.id from waitlist_entries e join leads l on l.id = e.lead_id
    where l.contact_id = ${contactId} and e.status = 'active'`)) as unknown as { id: string }[];
  for (const e of entries) await vacateForDeletion(tx, ctx, e.id);

  await tx.execute(sql`
    update payments set note = null
    where lead_id in (select id from leads where contact_id = ${contactId} and workspace_id = ${ctx.workspaceId})`);
  await tx.execute(sql`delete from contacts where id = ${contactId} and workspace_id = ${ctx.workspaceId}`);
  return counts;
}
