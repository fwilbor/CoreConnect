import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// Signed, expiring tokens for public links (Security: "Public links use signed,
// expiring tokens (HMAC, 30 days)"). Stateless: the token carries its purpose,
// the record id and the expiry; nothing is stored.
export type TokenPurpose = "unsubscribe" | "apply" | "deposit" | "reply";

const DAY = 86_400;
export const TOKEN_TTL_DAYS: Record<TokenPurpose, number> = {
  apply: 30,
  deposit: 30,
  unsubscribe: 365, // must keep working for as long as old emails sit in inboxes
  reply: 365,
};

function secret() {
  const s = process.env.APP_TOKEN_SECRET;
  if (!s || s.length < 32) throw new Error("APP_TOKEN_SECRET must be set (32+ characters)");
  return s;
}

const b64 = (buf: Buffer) => buf.toString("base64url");
const sign = (data: string) => createHmac("sha256", secret()).update(data).digest();

export function createToken(purpose: TokenPurpose, id: string, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + TOKEN_TTL_DAYS[purpose] * DAY;
  const payload = b64(Buffer.from(JSON.stringify({ p: purpose, i: id, e: exp })));
  return `${payload}.${b64(sign(payload)).slice(0, 32)}`;
}

// The record id, or null when the token is malformed, tampered with, for
// another purpose, or expired.
export function verifyToken(token: string, purpose: TokenPurpose, now = Date.now()): string | null {
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;
  const expected = Buffer.from(b64(sign(payload)).slice(0, 32));
  const given = Buffer.from(mac);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as { p: string; i: string; e: number };
    if (data.p !== purpose || typeof data.i !== "string" || data.e * 1000 < now) return null;
    return data.i;
  } catch {
    return null;
  }
}
