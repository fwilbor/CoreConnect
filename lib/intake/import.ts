import "server-only";
import { withUser, type Database } from "@/lib/db";
import { normalizeEmail, normalizePhone, splitName } from "./normalize";
import { upsertInquiry } from "./upsert";

export const MAX_IMPORT_ROWS = 2000;

// One CSV row after the user's column mapping. Any field may be missing.
export type ImportRow = {
  fullName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  tags?: string;
  notes?: string;
};

export type ImportSummary = {
  total: number;
  created: number;
  merged: number;
  conflicts: number;
  invalid: { row: number; reason: string }[];
  committed: boolean;
};

class Rollback extends Error {}

// FR-07. Every row goes through the same intake as the forms, in one
// transaction as the importing user. A dry run does the real work and rolls
// back, so the preview's counts are exactly what the import will do (including
// duplicates within the file). Imported leads get source 'import', which the
// automations treat as opted out unless the importer turns them on.
export async function runImport(
  params: { userId: string; workspaceId: string; rows: ImportRow[]; dryRun: boolean },
  db?: Database,
): Promise<ImportSummary> {
  const summary: ImportSummary = {
    total: params.rows.length, created: 0, merged: 0, conflicts: 0, invalid: [], committed: false,
  };
  if (params.rows.length > MAX_IMPORT_ROWS) throw new Error(`imports are limited to ${MAX_IMPORT_ROWS} rows`);

  try {
    await withUser(
      params.userId,
      async (tx) => {
        for (const [i, row] of params.rows.entries()) {
          const rowNumber = i + 2; // header is row 1 in the spreadsheet
          const name = row.firstName?.trim()
            ? { firstName: row.firstName.trim(), lastName: row.lastName?.trim() || null }
            : splitName(row.fullName ?? "");
          const email = normalizeEmail(row.email);
          const phone = normalizePhone(row.phone);
          if (!name.firstName) {
            summary.invalid.push({ row: rowNumber, reason: "No name" });
            continue;
          }
          if (!email && !phone) {
            summary.invalid.push({
              row: rowNumber,
              reason: row.email?.trim() || row.phone?.trim() ? "Email and phone are both invalid" : "No email or phone",
            });
            continue;
          }
          const tags = (row.tags ?? "")
            .split(/[;,]/)
            .map((t) => t.trim().toLowerCase())
            .filter(Boolean)
            .slice(0, 20);
          const result = await upsertInquiry(tx, {
            workspaceId: params.workspaceId, firstName: name.firstName, lastName: name.lastName,
            email, phone, source: "import", tags, note: row.notes, actorUserId: params.userId,
          });
          if (result.contactCreated) summary.created++;
          else summary.merged++;
          if (result.mergeConflict) summary.conflicts++;
        }
        if (params.dryRun) throw new Rollback();
      },
      db,
    );
    summary.committed = true;
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
  }
  return summary;
}
