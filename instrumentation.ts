import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/sentry-scrub";

// Server and edge error reporting (Week 6: Sentry). Does nothing until
// SENTRY_DSN (or NEXT_PUBLIC_SENTRY_DSN) is set.
export async function register() {
  const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (dsn) Sentry.init(sentryOptions(dsn));
}

// Errors thrown while rendering pages, server actions and route handlers.
export const onRequestError = Sentry.captureRequestError;
