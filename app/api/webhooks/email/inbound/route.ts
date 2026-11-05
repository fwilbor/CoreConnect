import { NextResponse, type NextRequest } from "next/server";
import { serviceDb } from "@/lib/db";
import { handleInboundEmail } from "@/lib/messaging/inbound-email";
import { kickQueue } from "@/lib/messaging/kick";
import { siteUrl } from "@/lib/messaging/send";
import { fetchReceivedEmail } from "@/lib/messaging/resend-inbound";
import { verifySvix } from "@/lib/messaging/signatures";
import { defaultTransports } from "@/lib/messaging/transports";

// Resend "email.received" webhook (signed with Svix). Forwarded inquiries
// become leads; replies thread onto leads. See lib/messaging/inbound-email.ts.
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const secret = process.env.RESEND_INBOUND_WEBHOOK_SECRET || process.env.RESEND_WEBHOOK_SECRET;
  const body = await request.text();
  const headers = {
    id: request.headers.get("svix-id"),
    timestamp: request.headers.get("svix-timestamp"),
    signature: request.headers.get("svix-signature"),
  };
  if (!secret || !verifySvix(secret, headers, body)) {
    return NextResponse.json({ error: { code: "invalid_signature", message: "Invalid signature" } }, { status: 403 });
  }
  let event: { type?: string; data?: { email_id?: string } };
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: { code: "bad_request", message: "Body must be JSON" } }, { status: 400 });
  }
  const emailId = event.data?.email_id;
  if (event.type !== "email.received" || !emailId) return new NextResponse(null, { status: 204 });

  // A failure here returns 500, so Resend retries; handling is idempotent per email id.
  const email = await fetchReceivedEmail(emailId);
  const outcome = await handleInboundEmail(serviceDb(), email);

  if (outcome.kind === "lead" || outcome.kind === "reply") kickQueue();
  if (outcome.kind === "unparsed") {
    // Tell the team member, so a forward never disappears silently.
    const from = process.env.EMAIL_FROM || (process.env.EMAIL_FROM_DOMAIN ? `notifications@${process.env.EMAIL_FROM_DOMAIN}` : null);
    if (from) {
      const text =
        `We couldn't find who your forwarded email "${email.subject ?? "(no subject)"}" is from, so no lead was added to ${outcome.workspaceName}.\n\n` +
        `Forward the original message (not a reply to it), or add the person with Quick add: ${siteUrl()}/app/leads/new`;
      await defaultTransports().email({
        from: `"CoreConnect" <${from}>`, to: outcome.forwarder, subject: "We couldn't add that lead", text,
        html: `<p>${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n\n/g, "</p><p>")}</p>`,
      }).catch((err) => console.error("couldn't send the unparsed-forward notice", err));
    }
  }
  if (outcome.kind === "ignored") console.info(`inbound email ${emailId} ignored: ${outcome.reason}`);
  return new NextResponse(null, { status: 204 });
}
