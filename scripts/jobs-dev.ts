// Local stand-in for Vercel Cron: calls the scheduler tick every minute.
//   pnpm jobs:dev        (with `pnpm dev` running)
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const url = `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/api/jobs/tick`;
const secret = process.env.CRON_SECRET;
if (!secret) throw new Error("Set CRON_SECRET in .env.local");

async function run() {
  try {
    const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${secret}` } });
    console.log(new Date().toLocaleTimeString(), res.status, await res.text());
  } catch (err) {
    console.error(new Date().toLocaleTimeString(), "tick failed:", (err as Error).message);
  }
}

run();
setInterval(run, 60_000);
