import { sql } from "drizzle-orm";
import { withUser } from "@/lib/db";
import { requireOwner } from "@/lib/workspace";
import { StageEditor } from "./stage-editor";

export const metadata = { title: "Stages · CoreConnect" };

export default async function StagesPage() {
  const { user, workspace } = await requireOwner();
  const stages = (await withUser(user.id, (tx) =>
    tx.execute(sql`
      select s.id, s.name, s.kind, s.is_default, (select count(*)::int from leads l where l.stage_id = s.id) as leads
      from pipeline_stages s where s.workspace_id = ${workspace.id} order by s.position`),
  )) as unknown as { id: string; name: string; kind: "open" | "won" | "lost"; is_default: boolean; leads: number }[];

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-2xl font-semibold">Pipeline stages</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Rename, reorder or add stages to match how you work. The last two stages mark a lead as won or lost and are
        always at the end.
      </p>
      <StageEditor stages={stages} />
    </main>
  );
}
