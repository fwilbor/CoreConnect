import "server-only";
import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";

export { HONEYPOT_FIELD } from "./honeypot";

export const RATE_LIMIT_PER_HOUR = 5;

// IPs are stored only as a keyed hash (Security: "Store IP addresses hashed, not raw").
export function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  const secret = process.env.IP_HASH_SECRET;
  if (!secret) throw new Error("IP_HASH_SECRET is not set");
  return createHmac("sha256", secret).update(ip).digest("hex");
}

// First address in X-Forwarded-For is the client on Vercel.
export function clientIp(headers: Headers): string | null {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || null;
}

export async function verifyTurnstile(token: string | null, ip: string | null): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) throw new Error("TURNSTILE_SECRET_KEY is not set");
  if (!token) return false;
  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set("remoteip", ip);
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      signal: AbortSignal.timeout(5000),
    });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

// Submissions from this IP to this workspace in the last hour.
export async function isRateLimited(tx: Tx, workspaceId: string, ipHash: string | null): Promise<boolean> {
  if (!ipHash) return false;
  const [row] = await tx.execute(sql`
    select count(*)::int as n from form_submissions
    where workspace_id = ${workspaceId} and ip_hash = ${ipHash} and submitted_at > now() - interval '1 hour'`);
  return (row as { n: number }).n >= RATE_LIMIT_PER_HOUR;
}
