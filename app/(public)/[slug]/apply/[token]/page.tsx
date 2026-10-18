import { loadApplication } from "@/lib/applications";
import { ApplicationForm } from "./application-form";

export const metadata = { title: "Application" };

// FR-15: the application, sent by link. The token is signed, names the lead
// and expires after 30 days; one submission per lead.
export default async function ApplyPage({ params }: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = await params;
  const app = await loadApplication(slug, token);

  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      {!app ? (
        <>
          <h1 className="text-2xl font-semibold">Link expired</h1>
          <p className="mt-2 text-neutral-600 dark:text-neutral-300">
            This application link is invalid or has expired. Reply to the email you received and we&apos;ll send a new one.
          </p>
        </>
      ) : (
        <>
          <header className="mb-6 flex items-center gap-3">
            {app.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={app.logoUrl} alt="" className="h-12 w-12 rounded-full object-cover" />
            )}
            <div>
              <h1 className="text-2xl font-semibold">{app.workspaceName}</h1>
              <p className="text-sm text-neutral-500">{app.title}{app.firstName ? ` for ${app.firstName}` : ""}</p>
            </div>
          </header>
          {app.alreadySubmitted ? (
            <p>We already have your application. Thank you! We&apos;ll be in touch.</p>
          ) : (
            <ApplicationForm slug={slug} token={token} fields={app.fields} brandColor={app.brandColor} />
          )}
        </>
      )}
    </main>
  );
}
