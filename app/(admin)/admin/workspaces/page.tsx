import { desc } from "drizzle-orm";
import { requirePlatformAdmin } from "@/lib/auth";
import { serviceDb } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import { inboundWebhookUrl, twilioAccount } from "@/lib/sms-setup";
import { assignSmsNumberAction, createWorkspaceAction, removeSmsNumberAction } from "./actions";

export const metadata = { title: "Workspaces · CoreConnect admin" };

const TIMEZONES = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Phoenix",
  "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu",
];

const input =
  "w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-base dark:border-neutral-700";

export default async function AdminWorkspacesPage({
  searchParams,
}: {
  searchParams: Promise<{
    created?: string; invited?: string; error?: string; field?: string;
    sms?: string; sms_error?: string; number?: string; ws?: string;
  }>;
}) {
  await requirePlatformAdmin();
  const { created, invited, error, field, sms, sms_error: smsError, number, ws } = await searchParams;
  const twilio = await twilioAccount();
  const webhook = inboundWebhookUrl();
  const rows = await serviceDb()
    .select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug, type: workspaces.businessType,
              billing: workspaces.billingStatus, createdAt: workspaces.createdAt,
              smsNumber: workspaces.smsNumberE164, smsService: workspaces.twilioMessagingServiceSid, smsEnabled: workspaces.smsEnabled })
    .from(workspaces)
    .orderBy(desc(workspaces.createdAt));

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Workspaces</h1>

      {created && (
        <p className="mt-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-900 dark:bg-green-950 dark:text-green-100">
          Created {created}.{invited ? " The owner has been emailed an invite." : " The owner already had an account."}
        </p>
      )}
      {error === "slug_taken" && <p className="mt-4 text-sm text-red-600">That slug is already in use.</p>}
      {error === "invalid" && <p className="mt-4 text-sm text-red-600">Check the {field} field.</p>}

      <form action={createWorkspaceAction} className="mt-6 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          Business name
          <input name="name" required maxLength={120} className={input} />
        </label>
        <label className="text-sm">
          Slug (used in form URLs)
          <input name="slug" required pattern="[a-z0-9](-?[a-z0-9])*" minLength={3} maxLength={40} className={input} />
        </label>
        <label className="text-sm">
          Type
          <select name="businessType" className={input} defaultValue="breeder">
            <option value="breeder">Breeder</option>
            <option value="service">Service business</option>
          </select>
        </label>
        <label className="text-sm">
          Time zone
          <select name="timezone" className={input} defaultValue="America/Chicago">
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Owner email
          <input name="ownerEmail" type="email" required className={input} />
        </label>
        <label className="text-sm">
          Owner name (optional)
          <input name="ownerName" maxLength={120} className={input} />
        </label>
        <button
          type="submit"
          className="rounded-md bg-neutral-900 px-3 py-2 text-white sm:col-span-2 dark:bg-white dark:text-neutral-900"
        >
          Create workspace and invite owner
        </button>
      </form>

      <table className="mt-10 w-full text-left text-sm">
        <thead className="text-neutral-500">
          <tr><th className="py-2">Name</th><th>Slug</th><th>Type</th><th>Billing</th></tr>
        </thead>
        <tbody>
          {rows.map((w) => (
            <tr key={w.id} className="border-t border-neutral-200 dark:border-neutral-800">
              <td className="py-2">{w.name}</td><td>{w.slug}</td><td>{w.type}</td><td>{w.billing}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="mt-10 text-lg font-semibold">Texting numbers</h2>
      <div className={`mt-2 rounded-md p-3 text-sm ${twilio.ok ? "bg-neutral-50 dark:bg-neutral-900" : "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100"}`}>
        {twilio.ok ? (
          <>
            <p>
              Twilio connected{twilio.trial ? " (trial account: texts only reach verified numbers and start with a trial notice)" : ""}.
              Buy numbers in Twilio, then assign one to each workspace here. The workspace owner turns texting on in Settings.
            </p>
            <p className="mt-1 text-neutral-500">
              {webhook
                ? <>Saving a number points its incoming texts at <code>{webhook}</code>.</>
                : "This app has no public https URL (NEXT_PUBLIC_SITE_URL), so incoming-text webhooks aren't set. Save the number again after deploying."}
            </p>
          </>
        ) : <p>{twilio.error}</p>}
      </div>
      <ul className="mt-3 space-y-3">
        {rows.map((w) => {
          const here = ws === w.id;
          return (
            <li key={w.id} id={`sms-${w.id}`} className="scroll-mt-4 rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{w.name}</span>
                <span className="text-neutral-500">
                  {w.smsNumber ? `${w.smsNumber}${w.smsService ? ` via ${w.smsService}` : ""} · texting ${w.smsEnabled ? "on" : "off"}` : "No number"}
                </span>
              </div>
              <form action={assignSmsNumberAction} className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <input type="hidden" name="workspaceId" value={w.id} />
                <input name="number" required defaultValue={w.smsNumber ?? ""} placeholder="+13125550100" aria-label={`Texting number for ${w.name}`} className={input} />
                <input name="messagingServiceSid" defaultValue={w.smsService ?? ""} placeholder="Messaging Service SID (optional)" aria-label={`Messaging Service SID for ${w.name}`} className={input} />
                <button disabled={!twilio.ok} className="rounded-md bg-neutral-900 px-3 py-2 text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900">
                  {w.smsNumber ? "Update" : "Assign"}
                </button>
              </form>
              {w.smsNumber && (
                <form action={removeSmsNumberAction} className="mt-2">
                  <input type="hidden" name="workspaceId" value={w.id} />
                  <button className="text-red-700 underline dark:text-red-400">Remove number (turns texting off)</button>
                </form>
              )}
              {here && smsError && <p className="mt-2 text-red-600" role="alert">{smsError}</p>}
              {here && (sms === "set" || sms === "skipped_local") && (
                <p className="mt-2 text-green-700 dark:text-green-400" role="status">
                  Saved {number}.{sms === "set" ? " Incoming texts now come to this app." : " Incoming-text webhook not set (no public URL yet)."}
                </p>
              )}
              {here && sms === "removed" && <p className="mt-2 text-neutral-600" role="status">Number removed and texting turned off.</p>}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
