import { describe, expect, it } from "vitest";
import { buildEmail, renderTemplate, unknownMergeFields } from "@/lib/messaging/render";
import { svixSignature, twilioSignature, verifySvix, verifyTwilio } from "@/lib/messaging/signatures";
import { createToken, verifyToken } from "@/lib/tokens";

process.env.APP_TOKEN_SECRET = "test-token-secret-that-is-long-enough-123";

describe("templates", () => {
  it("fills merge fields and blanks unknown ones", () => {
    expect(renderTemplate("Hi {{first_name}}, from {{ business_name }}{{nope}}.", { first_name: "Ann", business_name: "Oak Hill" }))
      .toBe("Hi Ann, from Oak Hill.");
    expect(unknownMergeFields("{{first_name}} {{frist_name}} {{frist_name}}")).toEqual(["frist_name"]);
  });

  it("builds an email with the address and unsubscribe link, escaping HTML", () => {
    const email = buildEmail({
      subject: "Hello\r\nBcc: x", body: "Hi <b>Ann</b>\n\nSee https://example.com/a.", businessName: "Oak & Hill",
      physicalAddress: "1 Main St\nTulsa, OK", unsubscribeUrl: "https://app.example/u/tok",
    });
    expect(email.subject).toBe("Hello Bcc: x");
    expect(email.html).toContain("Hi &lt;b&gt;Ann&lt;/b&gt;");
    expect(email.html).toContain('<a href="https://example.com/a">https://example.com/a</a>.');
    expect(email.html).toContain("Oak &amp; Hill<br>1 Main St<br>Tulsa, OK");
    expect(email.text).toContain("Unsubscribe: https://app.example/u/tok");
  });
});

describe("tokens", () => {
  it("round-trips and rejects tampering, the wrong purpose and expiry", () => {
    const token = createToken("unsubscribe", "contact-1");
    expect(verifyToken(token, "unsubscribe")).toBe("contact-1");
    expect(verifyToken(token, "apply")).toBeNull();
    expect(verifyToken(`${token.slice(0, -1)}x`, "unsubscribe")).toBeNull();
    const [, mac] = token.split(".");
    const forged = `${Buffer.from(JSON.stringify({ p: "unsubscribe", i: "contact-2", e: 9e9 })).toString("base64url")}.${mac}`;
    expect(verifyToken(forged, "unsubscribe")).toBeNull();
    const old = createToken("apply", "lead-1", Date.now() - 31 * 86_400_000);
    expect(verifyToken(old, "apply")).toBeNull();
  });
});

describe("webhook signatures", () => {
  it("verifies Twilio signatures over the URL and sorted params", () => {
    const url = "https://app.example/api/webhooks/twilio/sms";
    const params = { From: "+13125550100", Body: "Hi", To: "+13125550199" };
    const sig = twilioSignature("token", url, params);
    expect(verifyTwilio("token", url, params, sig)).toBe(true);
    expect(verifyTwilio("token", url, { ...params, Body: "Hi!" }, sig)).toBe(false);
    expect(verifyTwilio("other", url, params, sig)).toBe(false);
    expect(verifyTwilio("token", url, params, null)).toBe(false);
  });

  it("verifies Svix signatures and rejects stale timestamps", () => {
    const secret = `whsec_${Buffer.from("resend-secret").toString("base64")}`;
    const ts = String(Math.floor(Date.now() / 1000));
    const body = '{"type":"email.delivered"}';
    const sig = svixSignature(secret, "msg_1", ts, body);
    expect(verifySvix(secret, { id: "msg_1", timestamp: ts, signature: `v1,bogus v1,${sig}` }, body)).toBe(true);
    expect(verifySvix(secret, { id: "msg_1", timestamp: ts, signature: `v1,${sig}` }, `${body} `)).toBe(false);
    const old = String(Math.floor(Date.now() / 1000) - 600);
    expect(verifySvix(secret, { id: "msg_1", timestamp: old, signature: `v1,${svixSignature(secret, "msg_1", old, body)}` }, body)).toBe(false);
  });
});
