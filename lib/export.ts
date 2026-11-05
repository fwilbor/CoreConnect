import "server-only";
import { sql } from "drizzle-orm";
import { strToU8, zipSync } from "fflate";
import Papa from "papaparse";
import type { Tx } from "@/lib/db";
import { LeadError } from "@/lib/leads/mutations";

// Export all workspace data as CSV (FR-28): one file per table, plus
// leads_summary.csv with the columns a person would want in a spreadsheet.
// Runs as the signed-in owner, so RLS limits every query to their workspace.
// Every export is written to audit_log (Security: "every export").

const TABLES = [
  "contacts", "leads", "activities", "messages", "form_submissions", "forms", "payments", "litters",
  "waitlist_entries", "waitlist_events", "pipeline_stages", "templates", "sequences", "sequence_steps",
  "sequence_enrollments", "audit_log",
] as const;

const cell = (v: unknown) =>
  v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : v;

export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  return Papa.unparse(rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, cell(v)]))), {
    // Stops a cell like "=HYPERLINK(...)" running as a formula when opened in Excel.
    escapeFormulae: true,
  });
}

export async function exportWorkspace(tx: Tx, workspaceId: string): Promise<{ files: Record<string, string>; rows: number }> {
  const files: Record<string, string> = {};
  let rows = 0;

  const summary = (await tx.execute(sql`
    select c.first_name, c.last_name, c.email_norm as email, c.phone_e164 as phone, s.name as stage, l.source,
           li.name as litter, l.rating, array_to_string(l.tags, ', ') as tags, l.created_at, l.last_contacted_at,
           l.closed_at, l.closed_reason, c.sms_consent_at, c.email_unsubscribed_at, c.do_not_contact
    from leads l join contacts c on c.id = l.contact_id join pipeline_stages s on s.id = l.stage_id
    left join litters li on li.id = l.litter_id
    where l.workspace_id = ${workspaceId} order by l.created_at`)) as unknown as Record<string, unknown>[];
  files["leads_summary.csv"] = toCsv(summary);

  for (const table of TABLES) {
    // Table names come from the fixed list above, never from input.
    const data = (await tx.execute(sql`
      select * from ${sql.identifier(table)} where workspace_id = ${workspaceId} order by created_at`)) as unknown as Record<string, unknown>[];
    files[`${table}.csv`] = toCsv(data);
    rows += data.length;
  }
  return { files, rows };
}

export function zipFiles(files: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)])));
}

export async function writeAudit(tx: Tx, workspaceId: string, action: "export" | "contact.delete", details: Record<string, unknown>) {
  try {
    await tx.execute(sql`select app.write_audit(${workspaceId}, ${action}, ${JSON.stringify(details)}::jsonb)`);
  } catch (err) {
    // insufficient_privilege: not an owner of this workspace.
    if ((err as { cause?: { code?: string } }).cause?.code === "42501") throw new LeadError("Only the workspace owner can do that");
    throw err;
  }
}
