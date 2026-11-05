import Link from "next/link";
import { notFound } from "next/navigation";
import { LEGAL_EFFECTIVE_DATE, loadLegalWorkspace } from "@/lib/legal";
import { LegalPage } from "../../legal";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const ws = await loadLegalWorkspace((await params).slug);
  return { title: ws ? `Privacy policy · ${ws.name}` : "Not found" };
}

// The privacy policy template every workspace's public form links to. The
// business is responsible for the information; CoreConnect processes it for them.
// The "no mobile information shared" wording is what carriers look for when
// reviewing a 10DLC SMS campaign.
export default async function WorkspacePrivacyPage({ params }: { params: Promise<{ slug: string }> }) {
  const ws = await loadLegalWorkspace((await params).slug);
  if (!ws) notFound();
  const name = ws.name;

  return (
    <LegalPage title="Privacy policy" subtitle={name} effective={LEGAL_EFFECTIVE_DATE}>
      <p>
        This policy explains how {name} (&quot;we&quot;, &quot;us&quot;) collects and uses information when you send us an
        inquiry, fill in an application, join a waitlist or pay a deposit through our online forms.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>Your name, email address, phone number and, if you give them, your city and state.</li>
        <li>Your answers to our inquiry and application questions, and how you heard about us.</li>
        <li>Messages you send us and messages we send you by email or text.</li>
        <li>Your place on any waitlist, and the deposits and payments you make.</li>
        <li>Basic technical information when you submit a form: your browser type and a scrambled (hashed) version of your
          IP address, used only to stop spam. We don&apos;t keep your IP address itself.</li>
      </ul>
      <p>
        Card payments are handled by Stripe. Your card number goes straight to Stripe; we never see or store it.
      </p>

      <h2>How we use it</h2>
      <ul>
        <li>To reply to your inquiry and follow up with you about it.</li>
        <li>To review your application and manage our waitlists.</li>
        <li>To take deposits, send receipts and keep our business records.</li>
        <li>To send reminders about an application or deposit you started.</li>
      </ul>
      <p>We don&apos;t sell your information, and we don&apos;t use it for advertising.</p>

      <h2>Text messages</h2>
      <p>
        We only text you if you tick the box agreeing to it on our form. Texts are about your inquiry, application,
        waitlist place or deposit. Message frequency varies. Message and data rates may apply. Reply <b>STOP</b> to any
        text to stop receiving them, or <b>HELP</b> for help. Consent to texts is not a condition of any purchase.
      </p>
      <p>
        No mobile information will be shared with third parties or affiliates for marketing or promotional purposes.
        Text messaging opt-in data and consent are never shared with any third party.
      </p>

      <h2>Who we share it with</h2>
      <p>
        We use CoreConnect to manage inquiries and waitlists. CoreConnect and the service providers it relies on store and
        process your information only to provide that service to us: hosting and database, email delivery, text message
        delivery, payment processing (Stripe) and spam protection. They aren&apos;t allowed to use it for anything else.
        We may also disclose information when the law requires it.
      </p>

      <h2>How long we keep it</h2>
      <p>
        We keep your information while we&apos;re in touch about a current or future litter or service and for as long as
        we need it for our records. Payment records are kept as tax and accounting rules require.
      </p>

      <h2>Your choices</h2>
      <ul>
        <li>Unsubscribe from our emails with the link at the bottom of any email.</li>
        <li>Stop texts by replying STOP.</li>
        <li>Ask us for a copy of your information, to correct it, or to delete it. When we delete your information we keep
          only payment records, with your personal details removed.</li>
      </ul>

      <h2>Contact us</h2>
      <p>
        Reply to any email you&apos;ve received from us
        {ws.address ? <>, or write to us at {name}, {ws.address}</> : null}.
      </p>
      <p className="text-sm text-neutral-500">
        See also our <Link href={`/${ws.slug}/terms`} className="underline">terms</Link>. This form is provided by{" "}
        <Link href="/privacy" className="underline">CoreConnect</Link>.
      </p>
    </LegalPage>
  );
}
