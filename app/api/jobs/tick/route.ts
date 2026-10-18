import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { tick } from "@/lib/messaging/worker";

// The 1-minute scheduler tick. Vercel Cron calls it with
// "Authorization: Bearer $CRON_SECRET"; locally `pnpm jobs:dev` does.
export const maxDuration = 60;

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function handle(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: { code: "unauthorized", message: "Bad cron secret" } }, { status: 401 });
  return NextResponse.json(await tick());
}

export const GET = handle;
export const POST = handle;
