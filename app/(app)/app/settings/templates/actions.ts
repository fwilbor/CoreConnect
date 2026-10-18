"use server";

import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withUser } from "@/lib/db";
import { unknownMergeFields } from "@/lib/messaging/render";
import { requireOwner } from "@/lib/workspace";

const TemplateInput = z
  .object({
    id: z.uuid().nullable(),
    channel: z.enum(["email", "sms"]),
    name: z.string().trim().min(1, "Name the template").max(80),
    subject: z.string().trim().max(200),
    body: z.string().trim().min(1, "Write the message"),
  })
  .refine((t) => t.channel === "sms" || t.subject.length > 0, { message: "Email templates need a subject", path: ["subject"] })
  .refine((t) => t.channel === "email" || t.body.length <= 1000, { message: "Texts are limited to 1,000 characters", path: ["body"] })
  .refine((t) => t.body.length <= 5000, { message: "Templates are limited to 5,000 characters", path: ["body"] });

export type TemplateResult = { ok: true; id: string } | { ok: false; error: string };

export async function saveTemplateAction(input: z.input<typeof TemplateInput>): Promise<TemplateResult> {
  const { user, workspace } = await requireOwner();
  const parsed = TemplateInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the template" };
  const t = parsed.data;
  const typos = unknownMergeFields(`${t.subject} ${t.body}`);
  if (typos.length) return { ok: false, error: `Unknown merge field: {{${typos[0]}}}` };

  const id = await withUser(user.id, async (tx) => {
    if (t.id) {
      const [row] = await tx.execute(sql`
        update templates set name = ${t.name}, subject = ${t.channel === "email" ? t.subject : null}, body = ${t.body}
        where id = ${t.id} and workspace_id = ${workspace.id} returning id`);
      return (row as { id: string } | undefined)?.id ?? null;
    }
    const [row] = await tx.execute(sql`
      insert into templates (workspace_id, channel, name, subject, body)
      values (${workspace.id}, ${t.channel}, ${t.name}, ${t.channel === "email" ? t.subject : null}, ${t.body}) returning id`);
    return (row as { id: string }).id;
  });
  if (!id) return { ok: false, error: "Template not found" };
  revalidatePath("/app/settings/templates");
  return { ok: true, id };
}

export async function deleteTemplateAction(id: string): Promise<TemplateResult> {
  const { user, workspace } = await requireOwner();
  const error = await withUser(user.id, async (tx) => {
    const [row] = (await tx.execute(sql`
      select system_key, exists (select 1 from sequence_steps s where s.template_id = t.id) as in_sequence
      from templates t where t.id = ${id} and t.workspace_id = ${workspace.id}`)) as unknown as { system_key: string | null; in_sequence: boolean }[];
    if (!row) return "Template not found";
    if (row.system_key) return "This template is used by an automation. Edit its wording instead.";
    if (row.in_sequence) return "This template is a sequence step. Change the step first.";
    await tx.execute(sql`delete from templates where id = ${id} and workspace_id = ${workspace.id}`);
    return null;
  });
  if (error) return { ok: false, error };
  revalidatePath("/app/settings/templates");
  return { ok: true, id };
}
