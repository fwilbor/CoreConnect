"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

// Last-resort error page for crashes in the root layout. Reports to Sentry
// when it's configured.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", maxWidth: 480, margin: "15vh auto", padding: 16 }}>
        <h1 style={{ fontSize: 22 }}>Something went wrong</h1>
        <p>We&apos;ve been notified. Please reload the page, or try again in a few minutes.</p>
        {error.digest && <p style={{ color: "#737373", fontSize: 12 }}>Reference: {error.digest}</p>}
      </body>
    </html>
  );
}
