import Link from "next/link";
import { eq } from "drizzle-orm";
import { withUser } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import { requireOwner } from "@/lib/workspace";
import { connectStripeAction } from "./actions";
import { BusinessForm } from "./business-form";

export const metadata = { title: "Settings · CoreConnect" };

const LINKS = [
  ["/app/settings/forms", "Inquiry form", "Questions, embed code, QR code"],
  ["/app/settings/stages", "Pipeline stages", "Rename, reorder, add"],
  ["/app/settings/templates", "Templates", "Email and SMS wording"],
  ["/app/settings/sequences", "Sequences", "Nurture follow-ups"],
] as const;

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ stripe?: string }> }) {
  const { stripe } = await searchParams;
  const { user, workspace } = await requireOwner();
  const [ws] = await withUser(user.id, (tx) =>
    tx
      .select({
        name: workspaces.name, physicalAddress: workspaces.physicalAddress, brandColor: workspaces.brandColor,
        logoUrl: workspaces.logoUrl, smsEnabled: workspaces.smsEnabled, smsNumber: workspaces.smsNumberE164,
        depositAmountCents: workspaces.depositAmountCents, depositTerms: workspaces.depositTerms,
        stripeAccountId: workspaces.stripeAccountId, stripeChargesEnabled: workspaces.stripeChargesEnabled,
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
      <h2 className="mt-8 text-lg font-semibold">Online deposits (Stripe)</h2>
      <div className="mt-2 rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
        {ws.stripeChargesEnabled ? (
          <p>Connected. Deposits go straight to your Stripe account{ws.stripeAccountId ? ` (${ws.stripeAccountId})` : ""}.</p>
        ) : (
          <>
            <p className="text-neutral-600 dark:text-neutral-300">
              {ws.stripeAccountId
                ? "Stripe setup isn't finished yet. Stripe needs a few more details before you can take deposits."
                : "Connect your Stripe account to take deposits online. Money goes directly to you; CoreConnect never holds it."}
            </p>
            <form action={connectStripeAction} className="mt-2">
              <button className="rounded-md bg-neutral-900 px-3 py-2 text-white dark:bg-white dark:text-neutral-900">
                {ws.stripeAccountId ? "Finish Stripe setup" : "Connect Stripe"}
              </button>
            </form>
          </>
        )}
        {stripe === "connected" && <p className="mt-2 text-green-700 dark:text-green-400">Stripe is connected.</p>}
        {stripe === "pending" && <p className="mt-2 text-amber-700 dark:text-amber-400">Stripe still needs more information before deposits can start.</p>}
        {(!ws.depositAmountCents) && <p className="mt-2 text-neutral-500">Set your deposit amount below as well.</p>}
      </div>

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
