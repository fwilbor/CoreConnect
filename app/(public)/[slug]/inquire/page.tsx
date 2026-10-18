import { notFound } from "next/navigation";
import { HEARD_ABOUT, loadPublicForm, smsConsentText } from "@/lib/intake/public";
import { InquiryForm } from "./inquiry-form";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const form = await loadPublicForm((await params).slug);
  return { title: form ? `Inquiry · ${form.workspaceName}` : "Form not found" };
}

// FR-01 hosted form at /{slug}/inquire; ?embed=1 is the bare version that
// public/embed.js puts in an iframe on the breeder's own site (FR-02).
export default async function InquirePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ embed?: string }>;
}) {
  const [{ slug }, { embed }] = await Promise.all([params, searchParams]);
  const form = await loadPublicForm(slug);
  if (!form) notFound();

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  if (!siteKey) throw new Error("NEXT_PUBLIC_TURNSTILE_SITE_KEY is not set");
  const isEmbed = embed === "1";

  const formEl = (
    <InquiryForm
      slug={form.slug}
      channel={isEmbed ? "embed" : "form"}
      fields={form.fields}
      heardAbout={HEARD_ABOUT.map((h) => h.label)}
      consentText={smsConsentText(form.workspaceName)}
      siteKey={siteKey}
      brandColor={form.brandColor}
    />
  );

  if (isEmbed) return <main className="p-4">{formEl}</main>;

  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <header className="mb-6 flex items-center gap-3">
        {form.logoUrl && (
          // Logos are user-supplied URLs on any host, so a plain img rather than next/image.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={form.logoUrl} alt="" className="h-12 w-12 rounded-full object-cover" />
        )}
        <div>
          <h1 className="text-2xl font-semibold">{form.workspaceName}</h1>
          <p className="text-sm text-neutral-500">{form.title}</p>
        </div>
      </header>
      {formEl}
    </main>
  );
}
