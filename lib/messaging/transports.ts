import "server-only";

// Delivery adapters. Real providers when their keys are set, otherwise a log
// transport that records the send and returns a fake id, so local development
// and tests never email or text anyone.

export type OutboundEmail = {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
  headers?: Record<string, string>;
};
export type OutboundSms = { to: string; body: string; messagingServiceSid?: string | null; from?: string | null; statusCallback?: string };
export type SendResult = { providerId: string };

export interface Transports {
  email(msg: OutboundEmail): Promise<SendResult>;
  sms(msg: OutboundSms): Promise<SendResult>;
}

export class PermanentSendError extends Error {}

export const logTransports = (sink: { email: OutboundEmail[]; sms: OutboundSms[] } = { email: [], sms: [] }): Transports & {
  sink: typeof sink;
} => ({
  sink,
  async email(msg) {
    sink.email.push(msg);
    if (process.env.NODE_ENV === "development") console.info(`[email:log] to=${msg.to} subject="${msg.subject}"`);
    return { providerId: `log-email-${crypto.randomUUID()}` };
  },
  async sms(msg) {
    sink.sms.push(msg);
    if (process.env.NODE_ENV === "development") console.info(`[sms:log] to=${msg.to} body="${msg.body.slice(0, 60)}"`);
    return { providerId: `log-sms-${crypto.randomUUID()}` };
  },
});

async function resendEmail(msg: OutboundEmail): Promise<SendResult> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: msg.from, to: [msg.to], reply_to: msg.replyTo, subject: msg.subject, text: msg.text, html: msg.html,
      headers: msg.headers,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!res.ok || !data.id) {
    const err = `Resend ${res.status}: ${data.message ?? "send failed"}`;
    // 4xx other than rate limits won't succeed on retry.
    throw res.status >= 400 && res.status < 500 && res.status !== 429 ? new PermanentSendError(err) : new Error(err);
  }
  return { providerId: data.id };
}

async function twilioSms(msg: OutboundSms): Promise<SendResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const body = new URLSearchParams({ To: msg.to, Body: msg.body });
  if (msg.messagingServiceSid) body.set("MessagingServiceSid", msg.messagingServiceSid);
  else if (msg.from) body.set("From", msg.from);
  else throw new PermanentSendError("This workspace has no SMS number");
  if (msg.statusCallback) body.set("StatusCallback", msg.statusCallback);
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}` },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };
  if (!res.ok || !data.sid) {
    const err = `Twilio ${res.status}${data.code ? ` (${data.code})` : ""}: ${data.message ?? "send failed"}`;
    throw res.status >= 400 && res.status < 500 && res.status !== 429 ? new PermanentSendError(err) : new Error(err);
  }
  return { providerId: data.sid };
}

let fallback: ReturnType<typeof logTransports> | undefined;

export function defaultTransports(): Transports {
  const log = (fallback ??= logTransports());
  return {
    email: process.env.RESEND_API_KEY ? resendEmail : log.email,
    sms: process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN ? twilioSms : log.sms,
  };
}
