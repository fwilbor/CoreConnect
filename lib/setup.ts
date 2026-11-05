import "server-only";
import { sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";

// First-run checklist on Today (owners only). Each step is detected from the
// workspace's real state, so it ticks itself and the card goes away when all
// steps are done. Order matters: no email of any kind goes out until the
// mailing address is set (CAN-SPAM), so it comes first.

export type SetupStep = { key: string; title: string; why: string; href: string; done: boolean };

export async function loadSetup(tx: Tx, workspaceId: string, slug: string): Promise<SetupStep[]> {
  const [s] = (await tx.execute(sql`
    select
      coalesce(length(trim(w.physical_address)), 0) > 0 as address,
      exists (select 1 from templates t where t.workspace_id = w.id and t.system_key = 'auto_reply_email'
              and t.updated_at > t.created_at + interval '1 minute') as auto_reply,
      w.deposit_amount_cents is not null and coalesce(length(trim(w.deposit_terms)), 0) > 0 as deposits,
      w.stripe_charges_enabled as stripe,
      exists (select 1 from leads l where l.workspace_id = w.id and l.source in ('form', 'embed')) as inquiry
    from workspaces w where w.id = ${workspaceId}`)) as unknown as {
    address: boolean; auto_reply: boolean; deposits: boolean; stripe: boolean; inquiry: boolean;
  }[];
  if (!s) return [];
  return [
    { key: "address", title: "Add your mailing address", done: s.address, href: "/app/settings",
      why: "US law requires it in every email, so auto-replies and follow-ups wait until it's set." },
    { key: "auto_reply", title: "Make the auto-reply sound like you", done: s.auto_reply, href: "/app/settings/templates",
      why: "It's the first thing every new lead hears from you, within minutes." },
    { key: "deposits", title: "Set your deposit amount and terms", done: s.deposits, href: "/app/settings",
      why: "Buyers see the terms at checkout, and they're saved with each deposit." },
    { key: "stripe", title: "Connect Stripe", done: s.stripe, href: "/app/settings",
      why: "Approved buyers can then pay their deposit online. Money goes straight to you." },
    { key: "inquiry", title: "Send yourself a test inquiry", done: s.inquiry, href: `/${slug}/inquire`,
      why: "See exactly what buyers see, then add the form to your website from Settings › Inquiry form." },
  ];
}
