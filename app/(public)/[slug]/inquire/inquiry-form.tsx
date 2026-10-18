"use client";

import Script from "next/script";
import { useActionState, useEffect, useRef } from "react";
import type { FormField } from "@/lib/intake/fields";
import { CustomField, fieldInputClass as input } from "../../form-fields";
import { HONEYPOT_FIELD } from "@/lib/intake/honeypot";
import { submitInquiryAction, type InquiryState } from "./actions";

declare global {
  interface Window {
    turnstile?: { reset: (el?: string | HTMLElement) => void };
  }
}


export function InquiryForm(props: {
  slug: string;
  channel: "form" | "embed";
  fields: FormField[];
  heardAbout: string[];
  consentText: string;
  siteKey: string;
  brandColor: string | null;
}) {
  const action = submitInquiryAction.bind(null, props.slug, props.channel);
  const [state, formAction, pending] = useActionState<InquiryState, FormData>(action, { status: "idle" });
  const rootRef = useRef<HTMLDivElement>(null);
  const errors = state.status === "error" ? (state.errors ?? {}) : {};

  // A Turnstile token works once; get a fresh one after a failed submit.
  useEffect(() => {
    if (state.status === "error") window.turnstile?.reset();
  }, [state]);

  // Embedded in a breeder's site: tell the parent page how tall to make the iframe.
  useEffect(() => {
    if (props.channel !== "embed" || !rootRef.current || window.parent === window) return;
    const el = rootRef.current;
    const post = () => window.parent.postMessage({ type: "coreconnect:height", height: el.scrollHeight + 32 }, "*");
    const observer = new ResizeObserver(post);
    observer.observe(el);
    post();
    return () => observer.disconnect();
  }, [props.channel, state]);

  const accent = props.brandColor ?? "#171717";
  const fieldError = (key: string) =>
    errors[key] ? <span className="mt-1 block text-sm text-red-600">{errors[key]}</span> : null;

  if (state.status === "success") {
    return (
      <div ref={rootRef} role="status" className="py-6">
        <p className="text-lg font-medium">Thank you!</p>
        <p className="mt-2">{state.message ?? "We received your inquiry and will be in touch soon."}</p>
      </div>
    );
  }

  return (
    <div ref={rootRef}>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" />
      <form action={formAction} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            First name *
            <input name="first_name" required autoComplete="given-name" maxLength={80} className={input} />
            {fieldError("first_name")}
          </label>
          <label className="block text-sm font-medium">
            Last name
            <input name="last_name" autoComplete="family-name" maxLength={80} className={input} />
          </label>
        </div>
        <label className="block text-sm font-medium">
          Email *
          <input name="email" type="email" required autoComplete="email" className={input} />
          {fieldError("email")}
        </label>
        <label className="block text-sm font-medium">
          Phone *
          <input name="phone" type="tel" required autoComplete="tel" className={input} />
          {fieldError("phone")}
        </label>
        <label className="block text-sm font-medium">
          How did you hear about us? *
          <select name="source" required defaultValue="" className={input}>
            <option value="" disabled>Choose one</option>
            {props.heardAbout.map((h) => <option key={h}>{h}</option>)}
          </select>
          {fieldError("source")}
        </label>

        {props.fields.map((f) => (
          <CustomField key={f.key} field={f} error={fieldError(f.key)} />
        ))}

        {/* Hidden from people and screen readers; bots tend to fill it. */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
          <label>
            Company website
            <input name={HONEYPOT_FIELD} tabIndex={-1} autoComplete="off" />
          </label>
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="sms_consent" className="mt-1" />
          <span>{props.consentText} (Optional)</span>
        </label>

        <div className="cf-turnstile" data-sitekey={props.siteKey} />

        {state.status === "error" && <p className="text-sm text-red-600" role="alert">{state.message}</p>}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md px-4 py-3 font-medium text-white disabled:opacity-60"
          style={{ backgroundColor: accent }}
        >
          {pending ? "Sending…" : "Send inquiry"}
        </button>
      </form>
    </div>
  );
}
