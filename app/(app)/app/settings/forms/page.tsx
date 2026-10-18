import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import QRCode from "qrcode";
import { withUser } from "@/lib/db";
import { forms } from "@/lib/db/schema";
import { FormFields } from "@/lib/intake/fields";
import { requireOwner } from "@/lib/workspace";
import { FieldBuilder } from "./field-builder";

export const metadata = { title: "Forms · CoreConnect" };

export default async function FormsSettingsPage() {
  const { user, workspace } = await requireOwner();
  const [form] = await withUser(user.id, (tx) =>
    tx
      .select({ title: forms.title, successMessage: forms.successMessage, fields: forms.fields })
      .from(forms)
      .where(and(eq(forms.workspaceId, workspace.id), eq(forms.kind, "inquiry"))),
  );

  const h = await headers();
  const origin = process.env.NEXT_PUBLIC_SITE_URL && !h.get("host")
    ? process.env.NEXT_PUBLIC_SITE_URL
    : `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const hostedUrl = `${origin}/${workspace.slug}/inquire`;
  const embedCode = `<script src="${origin}/embed.js" data-form="${workspace.slug}" async></script>`;
  const qrSvg = await QRCode.toString(hostedUrl, { type: "svg", margin: 1, width: 160 });
  const fields = FormFields.safeParse(form?.fields);

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-2xl font-semibold">Inquiry form</h1>

      <section className="mt-6 grid gap-6 sm:grid-cols-[1fr_auto]">
        <div className="min-w-0 space-y-4">
          <div>
            <h2 className="text-sm font-medium">Hosted link</h2>
            <a href={hostedUrl} target="_blank" rel="noreferrer" className="mt-1 block break-all text-sm underline">{hostedUrl}</a>
          </div>
          <div>
            <h2 className="text-sm font-medium">Embed on your website</h2>
            <p className="text-sm text-neutral-500">Paste this into a custom code or HTML block on Wix, Squarespace, WordPress or Shopify.</p>
            <pre className="mt-2 overflow-x-auto rounded-md bg-neutral-100 p-3 text-xs dark:bg-neutral-900"><code>{embedCode}</code></pre>
          </div>
        </div>
        <figure className="text-center">
          {/* QRCode returns a self-contained SVG string built from our own URL. */}
          <div className="rounded-md bg-white p-2" dangerouslySetInnerHTML={{ __html: qrSvg }} />
          <figcaption className="mt-1 text-xs text-neutral-500">QR code for show tables</figcaption>
        </figure>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Questions</h2>
        <p className="text-sm text-neutral-500">
          Every form asks for first and last name, email, phone, how they heard about you, and SMS consent.
          Add up to 15 questions of your own below.
        </p>
        <FieldBuilder
          initialTitle={form?.title ?? "Inquiry"}
          initialSuccessMessage={form?.successMessage ?? ""}
          initialFields={fields.success ? fields.data : []}
        />
      </section>
    </main>
  );
}
