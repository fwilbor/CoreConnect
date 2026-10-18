import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// Minimal Stripe REST client (Connect Standard accounts, Checkout, webhooks).
// Deposits are created on the breeder's own connected account, so the money
// never passes through CoreConnect (Third-party services: Payments).

export class StripeError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

type Params = Record<string, unknown>;

// Stripe's form encoding: nested objects as a[b][c]=v, arrays as a[0][b]=v.
export function encodeParams(params: Params, prefix = ""): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((v, i) => {
        if (v !== null && typeof v === "object") out.push(...encodeParams(v as Params, `${name}[${i}]`));
        else out.push(`${encodeURIComponent(`${name}[${i}]`)}=${encodeURIComponent(String(v))}`);
      });
    } else if (typeof value === "object") {
      out.push(...encodeParams(value as Params, name));
    } else {
      out.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
    }
  }
  return out;
}

export type StripeClient = {
  request<T>(method: "GET" | "POST", path: string, params?: Params, opts?: { account?: string; idempotencyKey?: string }): Promise<T>;
};

export function stripeClient(secretKey = process.env.STRIPE_SECRET_KEY): StripeClient {
  return {
    async request<T>(method: "GET" | "POST", path: string, params: Params = {}, opts: { account?: string; idempotencyKey?: string } = {}) {
      if (!secretKey) throw new StripeError("Stripe isn't configured (STRIPE_SECRET_KEY)", 500);
      const body = encodeParams(params).join("&");
      const headers: Record<string, string> = { Authorization: `Bearer ${secretKey}`, "Stripe-Version": "2024-06-20" };
      if (opts.account) headers["Stripe-Account"] = opts.account;
      if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
      if (method === "POST") headers["Content-Type"] = "application/x-www-form-urlencoded";
      const url = `https://api.stripe.com/v1${path}${method === "GET" && body ? `?${body}` : ""}`;
      const res = await fetch(url, { method, headers, body: method === "POST" ? body : undefined, signal: AbortSignal.timeout(20_000) });
      const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
      if (!res.ok) throw new StripeError(data.error?.message ?? `Stripe ${res.status}`, res.status);
      return data;
    },
  };
}

// Webhook signature: header "t=<ts>,v1=<sig>[,v1=...]", HMAC-SHA256 of
// "<ts>.<raw body>" keyed with the whole whsec_ secret. Rejects timestamps
// more than 5 minutes off to stop replays.
export function stripeSignature(secret: string, timestamp: string, payload: string) {
  return createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
}

export function verifyStripeSignature(secret: string, header: string | null, payload: string, now = Date.now()) {
  if (!header) return false;
  const parts = header.split(",").map((p) => p.split("=") as [string, string]);
  const t = parts.find(([k]) => k === "t")?.[1];
  if (!t || Math.abs(now / 1000 - Number(t)) > 300) return false;
  const expected = Buffer.from(stripeSignature(secret, t, payload));
  return parts.some(([k, v]) => {
    if (k !== "v1" || !v) return false;
    const given = Buffer.from(v);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
