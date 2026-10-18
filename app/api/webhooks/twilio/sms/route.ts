import { NextResponse, type NextRequest } from "next/server";
import { serviceDb } from "@/lib/db";
import { handleInboundSms } from "@/lib/messaging/inbound";
import { siteUrl } from "@/lib/messaging/send";
import { verifyTwilio } from "@/lib/messaging/signatures";

// Inbound SMS and STOP/START keywords. Twilio signs the exact URL it called,
// so it's rebuilt from NEXT_PUBLIC_SITE_URL rather than trusting proxy headers.
export async function POST(request: NextRequest) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  const form = await request.formData();
  const params = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  if (!token || !verifyTwilio(token, `${siteUrl()}/api/webhooks/twilio/sms`, params, request.headers.get("x-twilio-signature"))) {
    return new NextResponse("Invalid signature", { status: 403 });
  }

  await handleInboundSms(serviceDb(), {
    messageSid: params.MessageSid ?? params.SmsSid ?? "",
    from: params.From ?? "",
    to: params.To ?? "",
    body: params.Body ?? "",
  });
  // Empty TwiML: no automatic reply (the Messaging Service answers STOP/HELP).
  return new NextResponse("<Response></Response>", { headers: { "Content-Type": "text/xml" } });
}
