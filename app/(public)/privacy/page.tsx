import Link from "next/link";
import { LEGAL_EFFECTIVE_DATE, operator } from "@/lib/legal";
import { LegalPage } from "../legal";

export const metadata = { title: "Privacy policy · CoreConnect" };

// CoreConnect's own privacy policy: for the businesses that use it and for the
// people who fill in those businesses' forms.
export default function PrivacyPage() {
  const o = operator();
  return (
    <LegalPage title="CoreConnect privacy policy" effective={LEGAL_EFFECTIVE_DATE}>
      <p>
        {o.product} is a lead and waitlist manager operated by {o.company} (&quot;we&quot;, &quot;us&quot;). This policy
        covers two groups: businesses that use {o.product} (&quot;customers&quot;) and the people who contact those
        businesses through {o.product} forms (&quot;prospects&quot;).
      </p>

      <h2>If you contacted a business through one of our forms</h2>
      <p>
        The business you contacted decides what happens with your information and is responsible for it. We store and
        process it on their behalf, only to run the service for them. Each business has its own privacy policy, linked
        at the bottom of its form. To see, correct or delete your information, contact that business. We&apos;ll help
        them do it.
      </p>

      <h2>Information we handle</h2>
      <ul>
        <li><b>Customer accounts:</b> names and email addresses of owners and staff, business details such as name,
          mailing address, branding and settings, and a log of key account actions.</li>
        <li><b>Prospect information, held for customers:</b> contact details, form and application answers, messages,
          notes, tasks, waitlist positions and payment records.</li>
        <li><b>Technical information:</b> a hashed (scrambled) IP address when a form is submitted, used only for spam
          and rate limiting, and standard server logs.</li>
      </ul>
      <p>Card details are entered on Stripe&apos;s checkout page and never reach our servers.</p>

      <h2>How we use it</h2>
      <ul>
        <li>To provide {o.product}: storing records, sending the emails and texts customers set up, and taking deposits.</li>
        <li>To keep the service secure and working, including spam protection and error monitoring.</li>
        <li>To support customers when they ask for help.</li>
      </ul>
      <p>
        We don&apos;t sell personal information, and we don&apos;t use prospect information for our own marketing. No
        mobile information is shared with third parties or affiliates for marketing or promotional purposes.
      </p>

      <h2>Service providers</h2>
      <p>We use these providers to run {o.product}. Each receives only what it needs for its job:</p>
      <ul>
        <li>Supabase: database and sign-in</li>
        <li>Vercel: application hosting</li>
        <li>Resend: email delivery</li>
        <li>Twilio: text message delivery</li>
        <li>Stripe: deposit payments, paid directly to each customer&apos;s own Stripe account</li>
        <li>Cloudflare Turnstile: spam protection on forms</li>
        <li>Sentry: error monitoring</li>
      </ul>

      <h2>Security</h2>
      <p>
        Each business&apos;s data is kept separate at the database level, so one business can&apos;t see another&apos;s
        records. Links in emails are signed and expire. Data is encrypted in transit, and access by our staff is
        limited to support requests and recorded in an audit log.
      </p>

      <h2>Retention and deletion</h2>
      <p>
        Customers can export all their data at any time and delete any person&apos;s records on request. When a person
        is deleted, their messages, notes and form answers are removed; payment records are kept for accounting with
        personal details removed. When a customer closes their account, we delete their data after a short period
        that allows for recovery and billing.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about this policy: {o.email}, or {o.company}, {o.address}. If we change this policy in a meaningful
        way, we&apos;ll update the date above and tell customers by email.
      </p>
      <p className="text-sm text-neutral-500">See also our <Link href="/terms" className="underline">terms of service</Link>.</p>
    </LegalPage>
  );
}
