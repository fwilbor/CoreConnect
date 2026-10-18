import { sql } from "drizzle-orm";
import { withUser } from "@/lib/db";
import { requireOwner } from "@/lib/workspace";
import { TemplateEditor, type TemplateRow } from "./template-editor";

export const metadata = { title: "Templates · CoreConnect" };

const PURPOSE: Record<string, string> = {
  auto_reply_email: "Sent automatically to every new lead",
  auto_reply_sms: "Texted to new leads who agreed to texts",
  decline: "Sent when you decline an application",
  nurture_1: "Nurture step 1", nurture_2: "Nurture step 2", nurture_3: "Nurture step 3",
};

export default async function TemplatesPage() {
  const { user, workspace } = await requireOwner();
  const rows = (await withUser(user.id, (tx) =>
    tx.execute(sql`
      select id, channel, name, subject, body, system_key from templates
      where workspace_id = ${workspace.id} order by system_key is null, channel, name`),
  )) as unknown as (TemplateRow & { system_key: string | null })[];

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-2xl font-semibold">Templates</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Reusable email and text wording. Emails automatically get your business address and an unsubscribe link at the bottom.
      </p>
      <TemplateEditor
        businessName={workspace.name}
        templates={rows.map((r) => ({ ...r, purpose: r.system_key ? PURPOSE[r.system_key] : null }))}
      />
    </main>
  );
}
