import Link from "next/link";
import { sql } from "drizzle-orm";
import { withUser } from "@/lib/db";
import { requireWorkspace } from "@/lib/workspace";

export const metadata = { title: "Today · CoreConnect" };

// Week 2 placeholder. The full Today screen (going cold, tasks, payments,
// go-home dates) arrives in week 6.
export default async function TodayPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { user, workspace } = await requireWorkspace();
  const { error } = await searchParams;
  const [counts] = await withUser(user.id, (tx) =>
    tx.execute(sql`
      select
        (select count(*)::int from leads where workspace_id = ${workspace.id} and created_at > now() - interval '24 hours') as new_24h,
        (select count(*)::int from leads l join pipeline_stages s on s.id = l.stage_id
          where l.workspace_id = ${workspace.id} and s.kind = 'open') as open_leads,
        (select count(*)::int from contacts where workspace_id = ${workspace.id} and needs_merge_review) as merge_review`),
  );
  const c = counts as { new_24h: number; open_leads: number; merge_review: number };

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="text-2xl font-semibold">Today</h1>
      <p className="mt-1 text-sm text-neutral-500">Signed in as {user.email} · {workspace.role}</p>
      {error === "owner_only" && <p className="mt-3 text-sm text-red-600">Only the workspace owner can open that page.</p>}

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Stat label="New leads (24 h)" value={c.new_24h} href="/app/leads" />
        <Stat label="Open leads" value={c.open_leads} href="/app/leads" />
        <Stat label="Possible duplicates to review" value={c.merge_review} href="/app/leads?review=1" />
      </div>
    </main>
  );
}

function Stat({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <Link href={href} className="rounded-lg border border-neutral-200 p-4 hover:border-neutral-400 dark:border-neutral-800">
      <div className="text-3xl font-semibold tabular-nums">{value}</div>
      <div className="mt-1 text-sm text-neutral-500">{label}</div>
    </Link>
  );
}
