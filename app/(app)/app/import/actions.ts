"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runImport, type ImportSummary } from "@/lib/intake/import";
import { requireWorkspace } from "@/lib/workspace";

const cell = z.string().max(2000).optional();
const Rows = z
  .array(z.object({
    fullName: cell, firstName: cell, lastName: cell, email: cell, phone: cell, tags: cell, notes: cell,
  }))
  .min(1, "The file has no rows")
  .max(2000, "Import up to 2,000 rows at a time");

export type ImportActionResult = { summary?: ImportSummary; error?: string };

export async function importLeads(rowsJson: string, dryRun: boolean): Promise<ImportActionResult> {
  const { user, workspace } = await requireWorkspace();
  let rows: unknown;
  try {
    rows = JSON.parse(rowsJson);
  } catch {
    return { error: "Couldn't read the rows." };
  }
  const parsed = Rows.safeParse(rows);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the file." };

  const summary = await runImport({ userId: user.id, workspaceId: workspace.id, rows: parsed.data, dryRun });
  if (!dryRun) revalidatePath("/app/leads");
  return { summary };
}
