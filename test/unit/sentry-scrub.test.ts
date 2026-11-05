import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";
import { scrubEvent, scrubText } from "@/lib/sentry-scrub";

describe("Sentry scrubbing", () => {
  it("drops query parameters and masks emails and phone numbers", () => {
    const drizzle = "Failed query: insert into contacts (email_norm) values ($1)\nparams: ann@example.com,+13125551234,Hi there";
    expect(scrubText(drizzle)).toBe("Failed query: insert into contacts (email_norm) values ($1)\nparams: [removed]");
    expect(scrubText("Resend 422: invalid to ann.lee+dogs@mail.example.org")).toBe("Resend 422: invalid to [email]");
    expect(scrubText("Twilio 400 (21211): +1 (312) 555-1234 is not valid")).toBe("Twilio 400 (21211): [phone] is not valid");
    // Ids, counts and timestamps survive.
    expect(scrubText("lead 01a1ad1c-b056-7bcd retried 3 times")).toBe("lead 01a1ad1c-b056-7bcd retried 3 times");
  });

  it("strips request bodies, cookies, query strings and user details", () => {
    const event = {
      type: undefined,
      message: "for bob@example.com",
      exception: { values: [{ type: "Error", value: "params: x\nparams: y" }, { type: "Error", value: "call +13125551234" }] },
      breadcrumbs: [{ message: "sent to bob@example.com", data: { body: "secret" } }],
      request: { url: "https://app.example/core/apply/TOKEN?x=1", data: "first_name=Bob", cookies: { sb: "x" }, query_string: "x=1" },
      user: { id: "u1", email: "owner@example.com", ip_address: "1.2.3.4" },
    } as unknown as ErrorEvent;
    const out = scrubEvent(event);
    expect(out.message).toBe("for [email]");
    expect(out.exception?.values?.[1].value).toBe("call [phone]");
    expect(out.breadcrumbs?.[0]).toEqual({ message: "sent to [email]" });
    expect(out.request).toEqual({ url: "https://app.example/core/apply/TOKEN" });
    expect(out.user).toEqual({ id: "u1" });
  });
});
