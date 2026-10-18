import { loadDepositPage } from "@/lib/deposits";

export const metadata = { title: "Deposit" };

const money = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const ERRORS: Record<string, string> = {
  terms: "Please agree to the deposit terms to continue.",
  unavailable: "Deposits aren't available right now. Please contact us.",
  failed: "We couldn't start the payment. Please try again.",
};

// FR-20/FR-22: the deposit link. Shows the amount and terms, then hands off
// to Stripe Checkout on the breeder's own account.
export default async function DepositPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; token: string }>;
  searchParams: Promise<{ paid?: string; canceled?: string; error?: string }>;
}) {
  const [{ slug, token }, sp] = await Promise.all([params, searchParams]);
  const page = await loadDepositPage(slug, token);

  if (page.state === "not_found") {
    return (
      <main className="mx-auto max-w-md px-4 py-10">
        <h1 className="text-2xl font-semibold">Link expired</h1>
        <p className="mt-2 text-neutral-600 dark:text-neutral-300">This deposit link is invalid or has expired. Please ask for a new one.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <header className="mb-6 flex items-center gap-3">
        {page.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={page.logoUrl} alt="" className="h-12 w-12 rounded-full object-cover" />
        )}
        <h1 className="text-2xl font-semibold">{page.workspaceName}</h1>
      </header>

      {page.state === "paid" || sp.paid ? (
        <div role="status">
          <p className="text-lg font-medium">Deposit received. Thank you{page.firstName ? `, ${page.firstName}` : ""}!</p>
          <p className="mt-2 text-neutral-600 dark:text-neutral-300">A receipt with your place on the list is on its way by email.</p>
        </div>
      ) : page.state === "closed" ? (
        <p>This inquiry is closed. Please contact {page.workspaceName} if you think that&apos;s a mistake.</p>
      ) : page.state === "unavailable" ? (
        <p>Deposits aren&apos;t available online right now. Please contact {page.workspaceName}.</p>
      ) : (
        <form method="post" action={`/api/public/${slug}/deposits/${token}/checkout`} className="space-y-4">
          <p className="text-neutral-600 dark:text-neutral-300">{page.firstName ? `Hi ${page.firstName}, your` : "Your"} deposit holds your place on the waitlist.</p>
          <p className="text-4xl font-semibold tabular-nums">{money(page.amountCents!)}</p>
          {page.terms && (
            <>
              <div className="max-h-60 overflow-y-auto whitespace-pre-wrap rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">{page.terms}</div>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="agree" value="yes" required className="mt-1" />
                I have read and agree to the deposit terms and refund policy above.
              </label>
            </>
          )}
          {sp.canceled && <p className="text-sm text-neutral-600 dark:text-neutral-300">Payment canceled. You can try again whenever you&apos;re ready.</p>}
          {sp.error && <p className="text-sm text-red-600" role="alert">{ERRORS[sp.error] ?? ERRORS.failed}</p>}
          <button className="w-full rounded-md px-4 py-3 font-medium text-white" style={{ backgroundColor: page.brandColor ?? "#171717" }}>
            Pay deposit securely with Stripe
          </button>
          <p className="text-xs text-neutral-500">Payment is processed by Stripe and goes directly to {page.workspaceName}.</p>
        </form>
      )}
    </main>
  );
}
