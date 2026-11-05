import type { ErrorEvent } from "@sentry/nextjs";

// Removes personal data from error reports before they leave the app. Drizzle
// puts query parameters in its error messages ("Failed query: … params: …"),
// and those can hold a buyer's email, phone or message text. Sentry is also set
// to sendDefaultPii: false, so cookies, IPs and request bodies aren't sent.

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// A run of digits and separators that holds 10 to 15 digits (US and E.164 numbers).
const PHONE = /\+?\(?\d[\d\s().-]{8,}\d/g;
const maskPhone = (m: string) => {
  const digits = m.replace(/\D/g, "").length;
  return digits >= 10 && digits <= 15 ? "[phone]" : m;
};

export function scrubText(text: string): string {
  return text
    .replace(/\nparams: [\s\S]*$/, "\nparams: [removed]")
    .replace(EMAIL, "[email]")
    .replace(PHONE, maskPhone);
}

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.message) event.message = scrubText(event.message);
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = scrubText(ex.value);
  }
  for (const b of event.breadcrumbs ?? []) {
    if (b.message) b.message = scrubText(b.message);
    if (b.data) delete b.data;
  }
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.query_string;
    if (event.request.url) event.request.url = event.request.url.split("?")[0];
  }
  if (event.user) event.user = { id: event.user.id };
  return event;
}

export const sentryOptions = (dsn: string) => ({
  dsn,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  sendDefaultPii: false,
  tracesSampleRate: 0.1,
  beforeSend: scrubEvent,
});
