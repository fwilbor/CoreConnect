import Link from "next/link";
import { sql } from "drizzle-orm";
import { withUser } from "@/lib/db";
import { requireWorkspace } from "@/lib/workspace";

export const metadata = { title: "Inbox · CoreConnect" };

type Row = {
  id: string; lead_id: string; channel: string; direction: string; status: string; body: string; subject: string | null;
  last_error: string | null; created_at: string; first_name: string | null; last_name: string | null;
};

// Unread replies across all leads, plus sends that failed after retries
// (Performance and reliability: failed sends are "shown in Inbox and digest").
export default async function InboxPage() {
  const { user, workspace } = await requireWorkspace();
  const { unread, failed } = await withUser(user.id, async (tx) => {
    const base = sql`
      select m.id, m.lead_id, m.channel, m.direction, m.status, m.body, m.subject, m.last_error, m.created_at, c.first_name, c.last_name
      from messages m join leads l on l.id = m.lead_id join contacts c on c.id = l.contact_id
      where m.workspace_id = ${workspace.id}`;
    return {
      unread: (await tx.execute(sql`${base} and m.direction = 'in' and m.read_at is null order by m.created_at desc limit 200`)) as unknown as Row[],
      failed: (await tx.execute(sql`${base} and m.status = 'failed' and m.created_at > now() - interval '14 days' order by m.created_at desc limit 100`)) as unknown as Row[],
    };
  });

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-2xl font-semibold">Inbox</h1>
      <Section title={`Unread replies (${unread.length})`} rows={unread} empty="No unread replies." />
      <Section title={`Failed sends, last 14 days (${failed.length})`} rows={failed} empty="Nothing failed." />
    </main>
  );
}

function Section({ title, rows, empty }: { title: string; rows: Row[]; empty: string }) {
  return (
    <section className="mt-6">
      <h2 className="text-sm font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-500">{empty}</p>
      ) : (
        <ul className="mt-2 divide-y divide-neutral-200 dark:divide-neutral-800">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/app/leads/${r.lead_id}`} className="block py-3 hover:bg-neutral-50 dark:hover:bg-neutral-900">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium">{[r.first_name, r.last_name].filter(Boolean).join(" ") || "Unknown"}</span>
                  <span className="shrink-0 text-xs text-neutral-500">
                    {r.channel === "sms" ? "Text" : "Email"} · {new Date(r.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-sm text-neutral-600 dark:text-neutral-300">{r.subject ? `${r.subject}: ` : ""}{r.body}</p>
                {r.status === "failed" && <p className="mt-0.5 text-xs text-red-600">{r.last_error}</p>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
