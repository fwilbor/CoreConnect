import Link from "next/link";
import { notFound } from "next/navigation";
import { LEGAL_EFFECTIVE_DATE, loadLegalWorkspace } from "@/lib/legal";
import { LegalPage } from "../../legal";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const ws = await loadLegalWorkspace((await params).slug);
  return { title: ws ? `Terms · ${ws.name}` : "Not found" };
}

// Terms for a workspace's public forms: what submitting means, the SMS program
// terms carriers require, and the business's own deposit terms (FR-22).
export default async function WorkspaceTermsPage({ params }: { params: Promise<{ slug: string }> }) {
  const ws = await loadLegalWorkspace((await params).slug);
  if (!ws) notFound();
  const name = ws.name;

  return (
    <LegalPage title="Terms" subtitle={name} effective={LEGAL_EFFECTIVE_DATE}>
      <p>These terms apply when you use {name}&apos;s online inquiry form, application, waitlist or deposit pages.</p>

      <h2>Inquiries and applications</h2>
      <p>
        Sending an inquiry or application doesn&apos;t reserve anything and doesn&apos;t commit either of us to a sale.
        {" "}{name} decides whether to approve an application and when to offer a place on a waitlist. Please give
        accurate information; we rely on it to make those decisions.
      </p>

      <h2>Waitlists</h2>
      <p>
        Waitlist positions are set by {name}. A position may change if someone ahead of you leaves the list, or for a
        reason we record and can explain if you ask. A place on a waitlist is not a guarantee of a particular animal,
        date or service.
      </p>

      <h2>Deposits</h2>
      {ws.depositTerms ? (
        <>
          <p>These are {name}&apos;s deposit terms. They are shown again at checkout and saved with your payment:</p>
          <blockquote className="whitespace-pre-wrap border-l-2 border-neutral-300 pl-3 dark:border-neutral-700">{ws.depositTerms}</blockquote>
        </>
      ) : (
        <p>The terms that apply to a deposit are shown at checkout before you pay and are saved with your payment.</p>
      )}
      <p>Card payments are processed by Stripe and paid directly to {name}.</p>

      <h2>Text message program</h2>
      <p>
        If you agree to texts on our form, {name} will send you text messages about your inquiry, application, waitlist
        place and deposit. Message frequency varies. Message and data rates may apply. Reply <b>STOP</b> to cancel at any
        time; we&apos;ll send one message confirming you&apos;ve been unsubscribed. Reply <b>START</b> to opt back in.
        Reply <b>HELP</b> for help, or reply to any email from us. Carriers are not liable for delayed or undelivered
        messages. Agreeing to texts is not a condition of any purchase.
      </p>

      <h2>Emails</h2>
      <p>Every email we send includes a link to unsubscribe. Receipts for payments you make are still sent.</p>

      <h2>Your information</h2>
      <p>
        How we handle your information is described in our <Link href={`/${ws.slug}/privacy`} className="underline">privacy policy</Link>.
      </p>

      <h2>Contact</h2>
      <p>Questions about these terms: reply to any email from us{ws.address ? <>, or write to {name}, {ws.address}</> : null}.</p>
    </LegalPage>
  );
}
