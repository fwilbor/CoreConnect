import { desc } from "drizzle-orm";
import { requirePlatformAdmin } from "@/lib/auth";
import { serviceDb } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import { createWorkspaceAction } from "./actions";

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
  searchParams: Promise<{ created?: string; invited?: string; error?: string; field?: string }>;
}) {
  await requirePlatformAdmin();
  const { created, invited, error, field } = await searchParams;
  const rows = await serviceDb()
    .select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug, type: workspaces.businessType,
              billing: workspaces.billingStatus, createdAt: workspaces.createdAt })
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
    </main>
  );
}
