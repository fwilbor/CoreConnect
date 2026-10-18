import "server-only";
import { sql } from "drizzle-orm";
import { serviceDb, type Database, type Tx } from "@/lib/db";
import { advanceToStage } from "@/lib/leads/mutations";
import { claimWebhookEvent } from "@/lib/messaging/inbound";
import { queueMessage, siteUrl } from "@/lib/messaging/send";
import { stripeClient, type StripeClient } from "@/lib/stripe";
import { createToken, verifyToken } from "@/lib/tokens";

// Stripe deposits (FR-20, FR-22). Checkout runs on the breeder's connected
// Standard account; CoreConnect records the payment and reacts to webhooks.

export type DepositPage =
  | { state: "not_found" }
  | {
      state: "unavailable" | "paid" | "closed" | "ready";
      leadId: string; workspaceId: string; workspaceName: string; logoUrl: string | null; brandColor: string | null;
      amountCents: number | null; terms: string | null; firstName: string | null;
    };

export async function loadDepositPage(slug: string, token: string, db: Database = serviceDb()): Promise<DepositPage> {
  const leadId = verifyToken(token, "deposit");
  if (!leadId) return { state: "not_found" };
  const [row] = await db.execute(sql`
    select l.id as lead_id, w.id as workspace_id, w.name, w.logo_url, w.brand_color, w.deposit_amount_cents, w.deposit_terms,
           w.stripe_account_id, w.stripe_charges_enabled, c.first_name, l.closed_at,
           exists (select 1 from payments p where p.lead_id = l.id and p.kind = 'deposit' and p.status = 'paid') as paid
    from leads l join workspaces w on w.id = l.workspace_id join contacts c on c.id = l.contact_id
    where l.id = ${leadId} and w.slug = ${slug}`);
  if (!row) return { state: "not_found" };
  const r = row as Record<string, unknown>;
  const base = {
    leadId: String(r.lead_id), workspaceId: String(r.workspace_id), workspaceName: String(r.name),
    logoUrl: (r.logo_url as string | null) ?? null, brandColor: (r.brand_color as string | null) ?? null,
    amountCents: (r.deposit_amount_cents as number | null) ?? null, terms: (r.deposit_terms as string | null) ?? null,
    firstName: (r.first_name as string | null) ?? null,
  };
  // Single-use after payment (Security: "deposit tokens are single-use after payment").
  if (r.paid) return { state: "paid", ...base };
  if (r.closed_at) return { state: "closed", ...base };
  if (!r.deposit_amount_cents || !r.stripe_account_id || !r.stripe_charges_enabled) return { state: "unavailable", ...base };
  return { state: "ready", ...base };
}

export type CheckoutResult = { ok: true; url: string } | { ok: false; reason: "not_found" | "unavailable" | "paid" | "closed" | "terms" };

// POST /api/public/:slug/deposits/:token/checkout
export async function startDepositCheckout(
  params: { slug: string; token: string; agreedToTerms: boolean },
  deps: { db?: Database; stripe?: StripeClient } = {},
): Promise<CheckoutResult> {
  const db = deps.db ?? serviceDb();
  const page = await loadDepositPage(params.slug, params.token, db);
  if (page.state !== "ready") return { ok: false, reason: page.state };
  if (page.terms && !params.agreedToTerms) return { ok: false, reason: "terms" };

  const [ws] = await db.execute(sql`select stripe_account_id from workspaces where id = ${page.workspaceId}`);
  const account = (ws as { stripe_account_id: string }).stripe_account_id;
  const [contact] = await db.execute(sql`select c.email_norm from leads l join contacts c on c.id = l.contact_id where l.id = ${page.leadId}`);

  // The terms shown on the page are stored with the payment (FR-22).
  const [payment] = await db.execute(sql`
    insert into payments (workspace_id, lead_id, kind, amount_cents, method, status, terms_snapshot)
    values (${page.workspaceId}, ${page.leadId}, 'deposit', ${page.amountCents}, 'stripe', 'pending', ${page.terms})
    returning id`);
  const paymentId = (payment as { id: string }).id;
  const pageUrl = `${siteUrl()}/${params.slug}/deposit/${params.token}`;
  const metadata = { payment_id: paymentId, lead_id: page.leadId, workspace_id: page.workspaceId };

  let session: { id: string; url: string };
  try {
    session = await (deps.stripe ?? stripeClient()).request<{ id: string; url: string }>(
    "POST",
    "/checkout/sessions",
    {
      mode: "payment",
      line_items: [{
        quantity: 1,
        price_data: { currency: "usd", unit_amount: page.amountCents, product_data: { name: `Deposit · ${page.workspaceName}` } },
      }],
      customer_email: (contact as { email_norm: string | null } | undefined)?.email_norm ?? undefined,
      client_reference_id: paymentId,
      metadata,
      payment_intent_data: { metadata, description: `Deposit for ${page.workspaceName}` },
      success_url: `${pageUrl}?paid=1`,
      cancel_url: `${pageUrl}?canceled=1`,
    },
    { account, idempotencyKey: `checkout-${paymentId}` },
    );
  } catch (err) {
    // Don't leave a pending payment behind for a checkout that never started.
    await db.execute(sql`update payments set status = 'failed', note = 'Checkout could not start' where id = ${paymentId}`);
    throw err;
  }
  await db.execute(sql`update payments set stripe_session_id = ${session.id} where id = ${paymentId}`);
  return { ok: true, url: session.url };
}

type CheckoutSession = { id: string; payment_status: string; payment_intent: string | null; metadata?: Record<string, string> };

async function markPaid(tx: Tx, session: CheckoutSession, account: string | undefined) {
  const [payment] = (await tx.execute(sql`
    select p.id, p.lead_id, p.workspace_id, p.status, p.amount_cents, w.stripe_account_id
    from payments p join workspaces w on w.id = p.workspace_id
    where p.stripe_session_id = ${session.id} for update of p`)) as unknown as {
    id: string; lead_id: string | null; workspace_id: string; status: string; amount_cents: number; stripe_account_id: string | null;
  }[];
  // Only trust events from the account that owns this payment.
  if (!payment || payment.status === "paid" || (account && payment.stripe_account_id !== account)) return false;

  await tx.execute(sql`
    update payments set status = 'paid', paid_at = now(), stripe_payment_intent_id = ${session.payment_intent}
    where id = ${payment.id}`);
  if (!payment.lead_id) return true;
  const ctx = { workspaceId: payment.workspace_id, userId: null };
  await tx.execute(sql`
    insert into activities (workspace_id, lead_id, type, payload)
    values (${payment.workspace_id}, ${payment.lead_id}, 'payment',
            ${JSON.stringify({ payment_id: payment.id, kind: "deposit", amount_cents: payment.amount_cents, method: "stripe", status: "paid" })}::jsonb)`);
  await advanceToStage(tx, ctx, payment.lead_id, "deposit_paid");
  // "Mark payment paid, move to Deposit paid, send receipt and position confirmation."
  const [tpl] = await tx.execute(sql`select id from templates where workspace_id = ${payment.workspace_id} and system_key = 'deposit_receipt'`);
  if (tpl) {
    await queueMessage(tx, {
      workspaceId: payment.workspace_id, leadId: payment.lead_id, channel: "email", kind: "system", templateId: (tpl as { id: string }).id,
    });
  }
  return true;
}

export type StripeEvent = { id: string; type: string; account?: string; data: { object: Record<string, unknown> } };

// Webhook handler body: idempotent on the event id.
export async function handleStripeEvent(event: StripeEvent, db: Database = serviceDb()): Promise<"processed" | "duplicate" | "ignored"> {
  return db.transaction(async (tx) => {
    if (!(await claimWebhookEvent(tx, "stripe", event.id, { type: event.type, account: event.account }))) return "duplicate";
    const obj = event.data.object;

    switch (event.type) {
      case "checkout.session.completed": {
        // Card payments are paid now; bank debits arrive later as async_payment_succeeded.
        const session = obj as unknown as CheckoutSession;
        if (session.payment_status !== "paid") return "ignored";
        return (await markPaid(tx, session, event.account)) ? "processed" : "ignored";
      }
      case "checkout.session.async_payment_succeeded":
        return (await markPaid(tx, obj as unknown as CheckoutSession, event.account)) ? "processed" : "ignored";
      case "checkout.session.async_payment_failed":
      case "checkout.session.expired": {
        const rows = await tx.execute(sql`
          update payments set status = 'failed' where stripe_session_id = ${String(obj.id)} and status = 'pending' returning id`);
        return rows.length ? "processed" : "ignored";
      }
      case "charge.refunded": {
        if (obj.refunded !== true) return "ignored"; // partial refunds stay paid
        const rows = await tx.execute(sql`
          update payments set status = 'refunded' where stripe_payment_intent_id = ${String(obj.payment_intent)} and status = 'paid' returning id`);
        return rows.length ? "processed" : "ignored";
      }
      case "account.updated": {
        const rows = await tx.execute(sql`
          update workspaces set stripe_charges_enabled = ${obj.charges_enabled === true}
          where stripe_account_id = ${String(obj.id)} returning id`);
        return rows.length ? "processed" : "ignored";
      }
      default:
        return "ignored";
    }
  });
}

// Connect onboarding (Standard): create the breeder's account once, then send
// them to Stripe's hosted onboarding. They own the account and its payouts.
export async function connectOnboardingUrl(
  params: { workspaceId: string; ownerEmail: string; businessName: string },
  deps: { db?: Database; stripe?: StripeClient } = {},
) {
  const db = deps.db ?? serviceDb();
  const stripe = deps.stripe ?? stripeClient();
  const [ws] = await db.execute(sql`select stripe_account_id from workspaces where id = ${params.workspaceId}`);
  let account = (ws as { stripe_account_id: string | null }).stripe_account_id;
  if (!account) {
    const created = await stripe.request<{ id: string }>("POST", "/accounts", {
      type: "standard", email: params.ownerEmail, business_profile: { name: params.businessName },
      metadata: { workspace_id: params.workspaceId },
    }, { idempotencyKey: `connect-${params.workspaceId}` });
    account = created.id;
    await db.execute(sql`update workspaces set stripe_account_id = ${account} where id = ${params.workspaceId} and stripe_account_id is null`);
  }
  const link = await stripe.request<{ url: string }>("POST", "/account_links", {
    account, type: "account_onboarding",
    refresh_url: `${siteUrl()}/app/settings/stripe?refresh=1`,
    return_url: `${siteUrl()}/app/settings/stripe?return=1`,
  });
  return link.url;
}

// Re-reads charges_enabled after onboarding (account.updated also keeps it current).
export async function refreshConnectStatus(workspaceId: string, deps: { db?: Database; stripe?: StripeClient } = {}) {
  const db = deps.db ?? serviceDb();
  const [ws] = await db.execute(sql`select stripe_account_id from workspaces where id = ${workspaceId}`);
  const account = (ws as { stripe_account_id: string | null }).stripe_account_id;
  if (!account) return false;
  const info = await (deps.stripe ?? stripeClient()).request<{ charges_enabled: boolean }>("GET", `/accounts/${account}`);
  await db.execute(sql`update workspaces set stripe_charges_enabled = ${info.charges_enabled} where id = ${workspaceId}`);
  return info.charges_enabled;
}

export function depositLink(slug: string, leadId: string) {
  return `${siteUrl()}/${slug}/deposit/${createToken("deposit", leadId)}`;
}
