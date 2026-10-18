import { sql } from "drizzle-orm";
import { withUser } from "@/lib/db";
import { requireOwner } from "@/lib/workspace";
import { SequenceEditor } from "./sequence-editor";

export const metadata = { title: "Sequences · CoreConnect" };

export default async function SequencesPage() {
  const { user, workspace } = await requireOwner();
  const { sequences, steps, templates, active } = await withUser(user.id, async (tx) => ({
    sequences: (await tx.execute(sql`select id, name, is_active from sequences where workspace_id = ${workspace.id} order by name`)) as unknown as {
      id: string; name: string; is_active: boolean;
    }[],
    steps: (await tx.execute(sql`
      select id, sequence_id, step_number, delay_hours, template_id from sequence_steps
      where workspace_id = ${workspace.id} order by step_number`)) as unknown as {
      id: string; sequence_id: string; step_number: number; delay_hours: number; template_id: string;
    }[],
    templates: (await tx.execute(sql`select id, name from templates where workspace_id = ${workspace.id} and channel = 'email' order by name`)) as unknown as {
      id: string; name: string;
    }[],
    active: (await tx.execute(sql`
      select sequence_id, count(*)::int as n from sequence_enrollments
      where workspace_id = ${workspace.id} and status = 'active' group by 1`)) as unknown as { sequence_id: string; n: number }[],
  }));

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-2xl font-semibold">Sequences</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Nurture emails new leads who haven&apos;t heard from you yet. It stops as soon as they reply, you message them,
        or you move them to another stage. Imported leads are never enrolled.
      </p>
      {sequences.map((seq) => (
        <SequenceEditor
          key={seq.id}
          sequence={seq}
          enrolled={active.find((a) => a.sequence_id === seq.id)?.n ?? 0}
          steps={steps.filter((s) => s.sequence_id === seq.id).map((s) => ({ id: s.id, day: Math.round(s.delay_hours / 24), templateId: s.template_id }))}
          templates={templates}
        />
      ))}
    </main>
  );
}
