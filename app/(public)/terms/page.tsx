import Link from "next/link";
import { LEGAL_EFFECTIVE_DATE, operator } from "@/lib/legal";
import { LegalPage } from "../legal";

export const metadata = { title: "Terms of service · CoreConnect" };

// Terms for businesses that use CoreConnect.
export default function TermsPage() {
  const o = operator();
  return (
    <LegalPage title="CoreConnect terms of service" effective={LEGAL_EFFECTIVE_DATE}>
      <p>
        These terms are an agreement between {o.company} (&quot;we&quot;) and the business that uses {o.product}
        (&quot;you&quot;). By using {o.product} you agree to them.
      </p>

      <h2>The service</h2>
      <p>
        {o.product} helps you capture inquiries, manage leads and waitlists, message prospects and take deposits. We
        may improve or change features over time. We&apos;ll tell you in advance about changes that take away
        something you rely on.
      </p>

      <h2>Your account</h2>
      <p>
        Accounts are by invitation. You&apos;re responsible for who you add as staff and for what happens under your
        account. Tell us right away if you think someone has accessed it without permission.
      </p>

      <h2>Your responsibilities when messaging people</h2>
      <ul>
        <li>Only email and text people who contacted you or agreed to hear from you.</li>
        <li>Keep your business mailing address up to date; it appears in every email, as US law (CAN-SPAM) requires.</li>
        <li>Texts go only to people who ticked the consent box. Don&apos;t add consent for someone who didn&apos;t give it.
          {" "}{o.product} honors STOP, START and HELP automatically.</li>
        <li>Follow the laws that apply to your business, including consumer protection, animal sale and privacy laws.</li>
      </ul>

      <h2>Acceptable use</h2>
      <p>
        Don&apos;t use {o.product} to send spam, to mislead or harass anyone, to collect information you have no right
        to, or to try to get into another business&apos;s data or our systems. We may suspend an account that does,
        and we&apos;ll tell you why.
      </p>

      <h2>Payments and deposits</h2>
      <p>
        Deposits are processed by Stripe and paid directly into your own Stripe account; we never hold your money.
        Your agreement with Stripe covers those payments, refunds and disputes. You set your deposit terms and refund
        policy, and you&apos;re responsible for honoring them. Fees for {o.product} are as agreed when you sign up.
      </p>

      <h2>Your data</h2>
      <p>
        You own the data you and your prospects put into {o.product}. We use it only to provide the service, as
        described in our <Link href="/privacy" className="underline">privacy policy</Link>. You can export everything at
        any time. You&apos;re responsible for having the right to collect the information you put in, and for
        responding to people who ask you to see or delete theirs; {o.product} gives you the tools to do it.
      </p>

      <h2>Availability</h2>
      <p>
        We work to keep {o.product} running and monitor it around the clock, but we can&apos;t promise it will never
        be interrupted. Email and text delivery also depend on providers and carriers outside our control.
      </p>

      <h2>Ending the agreement</h2>
      <p>
        You can stop using {o.product} at any time. Export your data first; we delete it after a short period that
        allows for recovery and billing. We may end the agreement for a serious or repeated breach of these terms.
      </p>

      <h2>Disclaimers and liability</h2>
      <p>
        {o.product} is provided &quot;as is&quot;. To the extent the law allows, we aren&apos;t liable for indirect
        or consequential losses, such as lost sales, and our total liability is limited to the fees you paid us in
        the 12 months before the claim.
      </p>

      <h2>Changes and governing law</h2>
      <p>
        If we change these terms in a meaningful way, we&apos;ll update the date above and tell you by email before
        the change applies. These terms are governed by the laws of {o.state}.
      </p>

      <h2>Contact</h2>
      <p>{o.email} · {o.company}, {o.address}</p>
    </LegalPage>
  );
}
