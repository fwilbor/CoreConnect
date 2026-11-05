import "server-only";
import type { ReceivedEmail } from "./inbound-email";

// Resend's email.received webhook carries only metadata; the body, headers and
// authentication verdicts come from GET /emails/receiving/{id}.
// https://resend.com/docs/api-reference/emails/retrieve-received-email
export async function fetchReceivedEmail(id: string): Promise<ReceivedEmail> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  const res = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Resend ${res.status} fetching received email`);
  const e = (await res.json()) as {
    id: string; from: string; to?: string[]; cc?: string[]; received_for?: string[]; subject?: string | null;
    text?: string | null; html?: string | null; headers?: Record<string, string>;
    authentication?: { spf?: string; dkim?: string; dmarc?: string } | null;
  };
  return {
    id: e.id,
    from: e.from,
    fromHeader: e.headers?.from ?? null,
    // received_for catches mail that arrived by BCC or a forwarding rule.
    to: [...(e.to ?? []), ...(e.cc ?? []), ...(e.received_for ?? [])],
    subject: e.subject ?? null,
    text: e.text ?? null,
    html: e.html ?? null,
    authentication: e.authentication ?? null,
  };
}
