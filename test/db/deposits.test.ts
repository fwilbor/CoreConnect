import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withUser, type Database } from "@/lib/db";
import { connectOnboardingUrl, handleStripeEvent, loadDepositPage, startDepositCheckout, type StripeEvent } from "@/lib/deposits";
import { upsertInquiry } from "@/lib/intake/upsert";
import type { StripeClient } from "@/lib/stripe";
import { createToken } from "@/lib/tokens";
import { addToWaitlist } from "@/lib/waitlist";
import { TEST_DATABASE_URL } from "../global-setup";

process.env.NEXT_PUBLIC_SITE_URL = "https://app.example";

let db: Database;
const owner = randomUUID();
let ws = "";
let slug = "";
const ACCOUNT = "acct_test_breeder";

// Records every Stripe call and returns canned objects.
function fakeStripe() {
  const calls: { method: string; path: string; params: Record<string, unknown>; account?: string; idempotencyKey?: string }[] = [];
  const client: StripeClient = {
    async request<T>(method: "GET" | "POST", path: string, params: Record<string, unknown> = {}, opts: { account?: string; idempotencyKey?: string } = {}) {
      calls.push({ method, path, params, ...opts });
      if (path === "/checkout/sessions") {
        const id = `cs_test_${randomUUID().replace(/-/g, "")}`;
        return { id, url: `https://checkout.stripe.com/c/pay/${id}` } as T;
      }
      if (path === "/accounts") return { id: ACCOUNT } as T;
      if (path === "/account_links") return { url: "https://connect.stripe.com/setup/s/abc" } as T;
      return { charges_enabled: true } as T;
    },
  };
  return { client, calls };
}

const q = async <T = Record<string, unknown>>(query: ReturnType<typeof sql>) => (await db.execute(query)) as unknown as T[];
const event = (type: string, object: Record<string, unknown>, account: string | undefined = ACCOUNT): StripeEvent =>
  ({ id: `evt_${randomUUID()}`, type, account, data: { object } });
let k = 0;
async function waitlistedLead() {
  const { leadId } = await withUser(owner, (tx) => upsertInquiry(tx, {
    workspaceId: ws, firstName: "Dana", email: `dana${++k}-${owner.slice(0, 4)}@example.com`, phone: null, source: "form",
  }), db);
  await withUser(owner, (tx) => addToWaitlist(tx, { workspaceId: ws, userId: owner }, { leadId, litterId: null }), db);
  return { leadId, token: createToken("deposit", leadId) };
}
const stageOf = async (leadId: string) =>
  (await q<{ name: string }>(sql`select s.name from leads l join pipeline_stages s on s.id = l.stage_id where l.id = ${leadId}`))[0].name;

beforeAll(async () => {
  db = createDb(TEST_DATABASE_URL);
  await db.execute(sql`insert into auth.users (id, email) values (${owner}, ${`dep-${owner.slice(0, 6)}@example.com`})`);
  slug = `dep-${owner.slice(0, 8)}`;
  [{ id: ws }] = await q<{ id: string }>(sql`select app.create_workspace('Deposit Kennel', ${slug}, 'breeder', 'America/Chicago', ${owner}, null) as id`);
  await db.execute(sql`update workspaces set physical_address = '1 Main St', deposit_terms = 'Non-refundable.' where id = ${ws}`);
});

afterAll(async () => {
  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
});

describe("Connect onboarding", () => {
  it("creates the Standard account once and returns Stripe's onboarding link", async () => {
    const stripe = fakeStripe();
    const url = await connectOnboardingUrl({ workspaceId: ws, ownerEmail: "o@example.com", businessName: "Deposit Kennel" }, { db, stripe: stripe.client });
    await connectOnboardingUrl({ workspaceId: ws, ownerEmail: "o@example.com", businessName: "Deposit Kennel" }, { db, stripe: stripe.client });
    expect(url).toBe("https://connect.stripe.com/setup/s/abc");
    expect(stripe.calls.filter((c) => c.path === "/accounts")).toHaveLength(1);
    expect(stripe.calls[0].params).toMatchObject({ type: "standard" });
    const [row] = await q(sql`select stripe_account_id from workspaces where id = ${ws}`);
    expect(row.stripe_account_id).toBe(ACCOUNT);
  });

  it("turns deposits on when Stripe reports charges enabled", async () => {
    expect(await handleStripeEvent(event("account.updated", { id: ACCOUNT, charges_enabled: true }), db)).toBe("processed");
    const [row] = await q(sql`select stripe_charges_enabled from workspaces where id = ${ws}`);
    expect(row.stripe_charges_enabled).toBe(true);
  });
});

describe("deposit page and checkout", () => {
  it("is unavailable until a deposit amount is set", async () => {
    const { token } = await waitlistedLead();
    expect((await loadDepositPage(slug, token, db)).state).toBe("unavailable");
    await db.execute(sql`update workspaces set deposit_amount_cents = 30000 where id = ${ws}`);
    expect((await loadDepositPage(slug, token, db)).state).toBe("ready");
    expect((await loadDepositPage("wrong-slug", token, db)).state).toBe("not_found");
    expect((await loadDepositPage(slug, createToken("apply", "x"), db)).state).toBe("not_found");
  });

  it("requires agreeing to the terms, then creates the session on the breeder's account", async () => {
    const { leadId, token } = await waitlistedLead();
    const stripe = fakeStripe();
    expect(await startDepositCheckout({ slug, token, agreedToTerms: false }, { db, stripe: stripe.client })).toEqual({ ok: false, reason: "terms" });

    const result = await startDepositCheckout({ slug, token, agreedToTerms: true }, { db, stripe: stripe.client });
    expect(result).toMatchObject({ ok: true, url: expect.stringContaining("checkout.stripe.com") });
    const call = stripe.calls.find((c) => c.path === "/checkout/sessions")!;
    expect(call.account).toBe(ACCOUNT);
    expect(call.params).toMatchObject({ mode: "payment", line_items: [{ price_data: { unit_amount: 30000 } }] });
    const [p] = await q(sql`select status, amount_cents, terms_snapshot, stripe_session_id, method from payments where lead_id = ${leadId}`);
    expect(p).toMatchObject({ status: "pending", amount_cents: 30000, terms_snapshot: "Non-refundable.", method: "stripe" });
    expect(call.idempotencyKey).toMatch(/^checkout-/);
  });
});

describe("webhooks", () => {
  async function checkout() {
    const lead = await waitlistedLead();
    const stripe = fakeStripe();
    await startDepositCheckout({ slug, token: lead.token, agreedToTerms: true }, { db, stripe: stripe.client });
    const [{ stripe_session_id }] = await q<{ stripe_session_id: string }>(sql`select stripe_session_id from payments where lead_id = ${lead.leadId}`);
    return { ...lead, sessionId: stripe_session_id };
  }

  it("marks a card deposit paid, moves to Deposit paid and queues a receipt with the position", async () => {
    const { leadId, token, sessionId } = await checkout();
    const paid = event("checkout.session.completed", { id: sessionId, payment_status: "paid", payment_intent: `pi_${randomUUID()}` });
    expect(await handleStripeEvent(paid, db)).toBe("processed");
    expect(await handleStripeEvent(paid, db)).toBe("duplicate");

    const [p] = await q(sql`select status, paid_at is not null as has_paid_at from payments where lead_id = ${leadId}`);
    expect(p).toEqual({ status: "paid", has_paid_at: true });
    expect(await stageOf(leadId)).toBe("Deposit paid");
    const [receipt] = await q<{ subject: string; body: string }>(sql`select subject, body from messages where lead_id = ${leadId} and kind = 'system'`);
    expect(receipt.subject).toBe("Deposit received: thank you!");
    expect(receipt.body).toMatch(/You are number \d+ on the General waitlist list/);
    // The link is single-use once paid.
    expect((await loadDepositPage(slug, token, db)).state).toBe("paid");
    expect(await startDepositCheckout({ slug, token, agreedToTerms: true }, { db, stripe: fakeStripe().client })).toEqual({ ok: false, reason: "paid" });
  });

  it("waits for delayed bank payments to clear", async () => {
    const { leadId, sessionId } = await checkout();
    expect(await handleStripeEvent(event("checkout.session.completed", { id: sessionId, payment_status: "unpaid", payment_intent: "pi_x" }), db)).toBe("ignored");
    expect(await stageOf(leadId)).toBe("Waitlisted");
    expect(await handleStripeEvent(event("checkout.session.async_payment_succeeded", { id: sessionId, payment_status: "paid", payment_intent: `pi_${randomUUID()}` }), db)).toBe("processed");
    expect(await stageOf(leadId)).toBe("Deposit paid");
  });

  it("ignores events from a different Stripe account", async () => {
    const { leadId, sessionId } = await checkout();
    const spoof = event("checkout.session.completed", { id: sessionId, payment_status: "paid", payment_intent: "pi_y" }, "acct_someone_else");
    expect(await handleStripeEvent(spoof, db)).toBe("ignored");
    const [p] = await q(sql`select status from payments where lead_id = ${leadId}`);
    expect(p.status).toBe("pending");
  });

  it("records expired sessions and full refunds", async () => {
    const expired = await checkout();
    await handleStripeEvent(event("checkout.session.expired", { id: expired.sessionId }), db);
    expect((await q(sql`select status from payments where lead_id = ${expired.leadId}`))[0].status).toBe("failed");

    const refunded = await checkout();
    const pi = `pi_${randomUUID()}`;
    await handleStripeEvent(event("checkout.session.completed", { id: refunded.sessionId, payment_status: "paid", payment_intent: pi }), db);
    expect(await handleStripeEvent(event("charge.refunded", { payment_intent: pi, refunded: false }), db)).toBe("ignored");
    expect(await handleStripeEvent(event("charge.refunded", { payment_intent: pi, refunded: true }), db)).toBe("processed");
    expect((await q(sql`select status from payments where lead_id = ${refunded.leadId}`))[0].status).toBe("refunded");
  });
});
