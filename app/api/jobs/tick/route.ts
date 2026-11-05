import { timingSafeEqual } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import { NextResponse, type NextRequest } from "next/server";
import { tick } from "@/lib/messaging/worker";

// The 1-minute scheduler tick. Vercel Cron calls it with
// "Authorization: Bearer $CRON_SECRET"; locally `pnpm jobs:dev` does.
export const maxDuration = 60;

// With Sentry configured, every tick checks in to the "job-tick" cron monitor,
// so Sentry raises an alert when ticks stop (the scheduler is down) or fail.
// The schedule matches vercel.json.
const MONITOR = {
  schedule: { type: "crontab" as const, value: "* * * * *" },
  checkinMargin: 5,
  maxRuntime: 2,
  failureIssueThreshold: 3,
  recoveryThreshold: 1,
};

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function handle(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: { code: "unauthorized", message: "Bad cron secret" } }, { status: 401 });
  if (!Sentry.getClient()) return NextResponse.json(await tick());
  try {
    return NextResponse.json(await Sentry.withMonitor("job-tick", () => tick(), MONITOR));
  } finally {
    // Serverless functions can freeze right after responding; send the check-in first.
    await Sentry.flush(2000);
  }
}

export const GET = handle;
export const POST = handle;
