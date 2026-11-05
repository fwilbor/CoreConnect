import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { exportWorkspace, writeAudit, zipFiles } from "@/lib/export";
import { siteUrl } from "@/lib/messaging/send";
import { getWorkspaceContext } from "@/lib/workspace";

// Downloads every table of the workspace as CSV files in one zip (FR-28).
// POST from the Settings page, so a link alone can't start an export; the
// session cookie is SameSite=Lax, so another site can't post here as the owner.
export const maxDuration = 60;

export async function POST() {
  const ctx = await getWorkspaceContext(await requireUser());
  if (!ctx || ctx.workspace.role === "staff") return NextResponse.redirect(`${siteUrl()}/app?error=owner_only`, 303);
  const { user, workspace } = ctx;

  const { files } = await withUser(user.id, async (tx) => {
    const result = await exportWorkspace(tx, workspace.id);
    await writeAudit(tx, workspace.id, "export", { rows: result.rows, files: Object.keys(result.files).length });
    return result;
  });
  const zip = zipFiles(files);
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(Buffer.from(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="coreconnect-${workspace.slug}-${date}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
