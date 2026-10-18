import { NextResponse, type NextRequest } from "next/server";
import { serviceDb } from "@/lib/db";
import { contactForProviderMessage, recordDeliveryStatus, unsubscribeEmail } from "@/lib/messaging/inbound";
import { verifySvix } from "@/lib/messaging/signatures";

// Resend delivery events (signed with Svix): delivered, bounced, complained.
// A spam complaint unsubscribes the contact.
export async function POST(request: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const body = await request.text();
  const headers = {
    id: request.headers.get("svix-id"),
    timestamp: request.headers.get("svix-timestamp"),
    signature: request.headers.get("svix-signature"),
  };
  if (!secret || !verifySvix(secret, headers, body)) {
    return NextResponse.json({ error: { code: "invalid_signature", message: "Invalid signature" } }, { status: 403 });
  }

  let event: { type?: string; data?: { email_id?: string; bounce?: { message?: string } } };
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: { code: "bad_request", message: "Body must be JSON" } }, { status: 400 });
  }
  const emailId = event.data?.email_id;
  if (!emailId || !headers.id) return new NextResponse(null, { status: 204 });
  const db = serviceDb();

  if (event.type === "email.delivered") {
    await recordDeliveryStatus(db, { provider: "email", eventId: headers.id, providerMessageId: emailId, status: "delivered" });
  } else if (event.type === "email.bounced") {
    await recordDeliveryStatus(db, {
      provider: "email", eventId: headers.id, providerMessageId: emailId, status: "failed",
      error: `Bounced${event.data?.bounce?.message ? `: ${event.data.bounce.message}` : ""}`,
    });
  } else if (event.type === "email.complained") {
    const contactId = await contactForProviderMessage(db, emailId);
    if (contactId) await unsubscribeEmail(db, contactId, "complaint");
  }
  return new NextResponse(null, { status: 204 });
}
