import { describe, expect, it } from "vitest";
import { encodeParams, stripeSignature, verifyStripeSignature } from "@/lib/stripe";

describe("Stripe helpers", () => {
  it("form-encodes nested params the way Stripe expects", () => {
    const encoded = encodeParams({
      mode: "payment",
      line_items: [{ quantity: 1, price_data: { unit_amount: 30000, product_data: { name: "Deposit · A&B" } } }],
      metadata: { lead_id: "x" },
      skipped: undefined,
    });
    expect(encoded.map(decodeURIComponent)).toEqual([
      "mode=payment",
      "line_items[0][quantity]=1",
      "line_items[0][price_data][unit_amount]=30000",
      "line_items[0][price_data][product_data][name]=Deposit · A&B",
      "metadata[lead_id]=x",
    ]);
  });

  it("verifies webhook signatures and rejects tampering and stale events", () => {
    const secret = "whsec_test123";
    const body = '{"id":"evt_1"}';
    const t = String(Math.floor(Date.now() / 1000));
    const sig = stripeSignature(secret, t, body);
    expect(verifyStripeSignature(secret, `t=${t},v1=deadbeef,v1=${sig}`, body)).toBe(true);
    expect(verifyStripeSignature(secret, `t=${t},v1=${sig}`, `${body} `)).toBe(false);
    expect(verifyStripeSignature("whsec_other", `t=${t},v1=${sig}`, body)).toBe(false);
    const old = String(Math.floor(Date.now() / 1000) - 600);
    expect(verifyStripeSignature(secret, `t=${old},v1=${stripeSignature(secret, old, body)}`, body)).toBe(false);
    expect(verifyStripeSignature(secret, null, body)).toBe(false);
  });
});
