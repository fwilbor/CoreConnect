import "server-only";
import { sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { advanceToStage, LeadError, type Ctx } from "@/lib/leads/mutations";

// Payments (FR-20 to FR-22). Deposits go straight to the breeder's own Stripe
// account; CoreConnect only records what happened.

export const PAYMENT_KINDS = ["deposit", "balance", "other"] as const;
export const MANUAL_METHODS = ["zelle", "cash", "other"] as const;

export type ManualPaymentInput = {
  leadId: string;
  kind: (typeof PAYMENT_KINDS)[number];
  method: (typeof MANUAL_METHODS)[number];
  amount: string; // dollars as typed, e.g. "300" or "300.00"
  paidOn: string; // YYYY-MM-DD
  note: string;
};

export function parseDollars(amount: string): number {
  const clean = amount.trim().replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) throw new LeadError("Enter an amount like 300 or 300.00");
  const cents = Math.round(Number(clean) * 100);
  if (cents < 1 || cents > 10_000_000) throw new LeadError("Amount must be between $0.01 and $100,000");
  return cents;
}

// FR-21: record a Zelle, cash or other payment. A paid deposit stores the
// deposit terms in force (FR-22) and moves the lead to Deposit paid.
export async function recordManualPayment(tx: Tx, ctx: Ctx, input: ManualPaymentInput) {
  if (!PAYMENT_KINDS.includes(input.kind)) throw new LeadError("Pick what the payment is for");
  if (!MANUAL_METHODS.includes(input.method)) throw new LeadError("Pick how they paid");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.paidOn)) throw new LeadError("Pick the date it was paid");
  const cents = parseDollars(input.amount);

  const [row] = await tx.execute(sql`
    insert into payments (workspace_id, lead_id, kind, amount_cents, method, status, terms_snapshot, note, recorded_by, paid_at)
    select ${ctx.workspaceId}, l.id, ${input.kind}, ${cents}, ${input.method}, 'paid',
           case when ${input.kind} = 'deposit' then w.deposit_terms end,
           ${input.note.trim().slice(0, 500) || null}, ${ctx.userId},
           (${input.paidOn}::date + time '12:00') at time zone w.timezone
    from leads l join workspaces w on w.id = l.workspace_id
    where l.id = ${input.leadId} and l.workspace_id = ${ctx.workspaceId}
    returning id`);
  if (!row) throw new LeadError("Lead not found");
  const paymentId = (row as { id: string }).id;

  await tx.execute(sql`
    insert into activities (workspace_id, lead_id, type, payload, actor_user_id)
    values (${ctx.workspaceId}, ${input.leadId}, 'payment',
            ${JSON.stringify({ payment_id: paymentId, kind: input.kind, amount_cents: cents, method: input.method, status: "paid" })}::jsonb,
            ${ctx.userId})`);
  if (input.kind === "deposit") await advanceToStage(tx, ctx, input.leadId, "deposit_paid");
  return paymentId;
}

export type PaymentRow = {
  id: string; kind: string; amount_cents: number; method: string; status: string; note: string | null;
  paid_at: string | null; created_at: string; terms_snapshot: string | null; recorded_by_name: string | null;
};

export async function listPayments(tx: Tx, workspaceId: string, leadId: string): Promise<PaymentRow[]> {
  return (await tx.execute(sql`
    select p.id, p.kind, p.amount_cents, p.method, p.status, p.note, p.paid_at, p.created_at, p.terms_snapshot,
           coalesce(u.name, u.email) as recorded_by_name
    from payments p left join users u on u.id = p.recorded_by
    where p.workspace_id = ${workspaceId} and p.lead_id = ${leadId}
    order by p.created_at desc`)) as unknown as PaymentRow[];
}
