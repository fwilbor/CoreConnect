import { NextResponse, type NextRequest } from "next/server";
import { serviceDb } from "@/lib/db";
import { recordDeliveryStatus } from "@/lib/messaging/inbound";
import { siteUrl } from "@/lib/messaging/send";
import { verifyTwilio } from "@/lib/messaging/signatures";

// Delivery receipts for texts we sent.
export async function POST(request: NextRequest) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  const form = await request.formData();
  const params = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  if (!token || !verifyTwilio(token, `${siteUrl()}/api/webhooks/twilio/status`, params, request.headers.get("x-twilio-signature"))) {
    return new NextResponse("Invalid signature", { status: 403 });
  }

  const sid = params.MessageSid;
  const status = params.MessageStatus;
  if (sid && (status === "delivered" || status === "undelivered" || status === "failed")) {
    await recordDeliveryStatus(serviceDb(), {
      provider: "twilio",
      eventId: `status:${sid}:${status}`,
      providerMessageId: sid,
      status: status === "delivered" ? "delivered" : "failed",
      error: params.ErrorCode ? `Twilio error ${params.ErrorCode}` : undefined,
    });
  }
  return new NextResponse(null, { status: 204 });
}
