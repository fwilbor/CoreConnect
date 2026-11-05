import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { serviceDb } from "@/lib/db";

// Uptime check (Week 6: uptime alerts). Point an uptime monitor here; it
// should alert on anything but 200. Returns 503 when the database can't be
// reached, or when messages have sat in the queue for 15+ minutes (the
// scheduler has stopped). Reports status only, no data.
export const dynamic = "force-dynamic";

const STUCK_MINUTES = 15;

export async function GET() {
  const started = Date.now();
  let database = false;
  let queueStuck = false;
  try {
    const [row] = (await Promise.race([
      serviceDb().execute(sql`
        select exists (
          select 1 from messages where status = 'queued'
            and coalesce(send_after, created_at) < now() - make_interval(mins => ${STUCK_MINUTES})) as stuck`),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
    ])) as { stuck: boolean }[];
    database = true;
    queueStuck = row.stuck;
  } catch {
    database = false;
  }
  const ok = database && !queueStuck;
  return NextResponse.json(
    { status: ok ? "ok" : "degraded", database, queue: queueStuck ? "stuck" : database ? "ok" : "unknown", ms: Date.now() - started },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
