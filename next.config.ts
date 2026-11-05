import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  // Lets a production build run beside `pnpm dev` without overwriting its
  // .next folder: NEXT_DIST_DIR=.next-build pnpm build
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

// Source maps are uploaded to Sentry only when SENTRY_AUTH_TOKEN, SENTRY_ORG
// and SENTRY_PROJECT are set (on Vercel). Error reporting itself needs only the
// DSN; see instrumentation.ts.
export default process.env.SENTRY_AUTH_TOKEN
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      silent: !process.env.CI,
      widenClientFileUpload: true,
    })
  : nextConfig;
