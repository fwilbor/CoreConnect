import Link from "next/link";
import { sql } from "drizzle-orm";
import { withUser } from "@/lib/db";
import { requireWorkspace } from "@/lib/workspace";
import { setNewLeadEmails } from "./actions";

export const metadata = { title: "Notifications · CoreConnect" };

// Personal setting, open to every member (the rest of Settings is owner-only).
export default async function NotificationsPage() {
  const { user, workspace } = await requireWorkspace();
  const [row] = (await withUser(user.id, (tx) => tx.execute(sql`
    select notify_new_leads from memberships where workspace_id = ${workspace.id} and user_id = ${user.id}`))) as unknown as {
    notify_new_leads: boolean;
  }[];
  const on = row?.notify_new_leads ?? false;
  const who = workspace.role === "owner"
    ? "every new lead"
    : "new leads assigned to you";

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      {workspace.role !== "staff" && <Link href="/app/settings" className="text-sm text-neutral-500 hover:underline">← Settings</Link>}
      <h1 className="mt-2 text-2xl font-semibold">Notifications</h1>
      <div className="mt-6 flex items-start justify-between gap-6 rounded-xl border border-neutral-200 p-5 dark:border-neutral-800">
        <div>
          <h2 className="font-medium">New-lead emails</h2>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
            An email to {user.email} for {who}, with their details and a link to the lead. Leads you add yourself and CSV
            imports don&apos;t send one.
          </p>
        </div>
        <form action={setNewLeadEmails}>
          <input type="hidden" name="on" value={on ? "false" : "true"} />
          <button role="switch" aria-checked={on} aria-label="New-lead emails"
            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${on ? "bg-green-600" : "bg-neutral-300 dark:bg-neutral-700"}`}>
            <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${on ? "left-[1.375rem]" : "left-0.5"}`} />
          </button>
        </form>
      </div>
      <p className="mt-2 text-sm text-neutral-500">{on ? "On" : "Off"}</p>
    </main>
  );
}
