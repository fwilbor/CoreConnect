import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

// Twilio: base64(HMAC-SHA1(authToken, url + each POST param name+value, sorted by name)).
// `url` must be the exact public URL Twilio called.
export function twilioSignature(authToken: string, url: string, params: Record<string, string>) {
  const data = Object.keys(params).sort().reduce((acc, key) => acc + key + params[key], url);
  return createHmac("sha1", authToken).update(data).digest("base64");
}

export function verifyTwilio(authToken: string, url: string, params: Record<string, string>, signature: string | null) {
  return Boolean(signature) && safeEqual(twilioSignature(authToken, url, params), signature!);
}

// Svix (used by Resend webhooks): HMAC-SHA256 over "id.timestamp.body" with the
// base64 secret after "whsec_"; the header may hold several "v1,<sig>" values.
// Rejects timestamps more than 5 minutes off to stop replays.
export function svixSignature(secret: string, id: string, timestamp: string, body: string) {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  return createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
}

export function verifySvix(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  body: string,
  now = Date.now(),
) {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  const expected = svixSignature(secret, id, timestamp, body);
  return signature.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    return version === "v1" && sig !== undefined && safeEqual(sig, expected);
  });
}
