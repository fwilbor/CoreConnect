import Link from "next/link";
import { eq } from "drizzle-orm";
import { withUser } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import { requireOwner } from "@/lib/workspace";
import { BusinessForm } from "./business-form";

export const metadata = { title: "Settings · CoreConnect" };

const LINKS = [
  ["/app/settings/forms", "Inquiry form", "Questions, embed code, QR code"],
  ["/app/settings/stages", "Pipeline stages", "Rename, reorder, add"],
  ["/app/settings/templates", "Templates", "Email and SMS wording"],
  ["/app/settings/sequences", "Sequences", "Nurture follow-ups"],
] as const;

export default async function SettingsPage() {
  const { user, workspace } = await requireOwner();
  const [ws] = await withUser(user.id, (tx) =>
    tx
      .select({
        name: workspaces.name, physicalAddress: workspaces.physicalAddress, brandColor: workspaces.brandColor,
        logoUrl: workspaces.logoUrl, smsEnabled: workspaces.smsEnabled, smsNumber: workspaces.smsNumberE164,
      })
      .from(workspaces)
      .where(eq(workspaces.id, workspace.id)),
  );

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <nav className="mt-4 grid gap-2 sm:grid-cols-2">
        {LINKS.map(([href, title, sub]) => (
          <Link key={href} href={href} className="rounded-md border border-neutral-200 p-3 hover:border-neutral-400 dark:border-neutral-800">
            <span className="block font-medium">{title}</span>
            <span className="text-sm text-neutral-500">{sub}</span>
          </Link>
        ))}
      </nav>
      <h2 className="mt-8 text-lg font-semibold">Business</h2>
      {!ws.physicalAddress && (
        <p className="mt-2 rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          Add your mailing address. US law (CAN-SPAM) requires it in every email, so auto-replies and follow-ups won&apos;t
          send until it&apos;s set.
        </p>
      )}
      <BusinessForm initial={ws} />
    </main>
  );
}
