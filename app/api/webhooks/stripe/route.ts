import { NextResponse, type NextRequest } from "next/server";
import { handleStripeEvent, type StripeEvent } from "@/lib/deposits";
import { kickQueue } from "@/lib/messaging/kick";
import { verifyStripeSignature } from "@/lib/stripe";

// Stripe webhooks, including events from connected accounts (event.account).
// Idempotent on the event id; any error returns 500 so Stripe retries.
export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const payload = await request.text();
  if (!secret || !verifyStripeSignature(secret, request.headers.get("stripe-signature"), payload)) {
    return NextResponse.json({ error: { code: "invalid_signature", message: "Invalid signature" } }, { status: 400 });
  }
  let event: StripeEvent;
  try {
    event = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: { code: "bad_request", message: "Body must be JSON" } }, { status: 400 });
  }
  const outcome = await handleStripeEvent(event);
  if (outcome === "processed") kickQueue(); // send the receipt now
  return NextResponse.json({ received: true, outcome });
}
