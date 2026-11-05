import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/sentry-scrub";

// Browser error reporting. Does nothing until NEXT_PUBLIC_SENTRY_DSN is set.
// Session replay is left off: screens show buyers' personal details.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) Sentry.init(sentryOptions(dsn));

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
