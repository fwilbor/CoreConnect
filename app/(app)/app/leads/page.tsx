import Link from "next/link";
import { sql } from "drizzle-orm";
import { withUser } from "@/lib/db";
import { requireWorkspace } from "@/lib/workspace";

export const metadata = { title: "Leads · CoreConnect" };

type Row = {
  id: string; first_name: string | null; last_name: string | null; email_norm: string | null;
  phone_e164: string | null; source: string; stage: string; created_at: string; needs_merge_review: boolean;
};

// Week 2: newest-first list so captured leads are visible. Becomes the kanban
// board with filters and search in week 3.
export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ added?: string; review?: string }> }) {
  const { user, workspace } = await requireWorkspace();
  const { added, review } = await searchParams;
  const rows = (await withUser(user.id, (tx) =>
    tx.execute(sql`
      select l.id, c.first_name, c.last_name, c.email_norm, c.phone_e164, l.source, s.name as stage,
             l.created_at, c.needs_merge_review
      from leads l
      join contacts c on c.id = l.contact_id
      join pipeline_stages s on s.id = l.stage_id
      where l.workspace_id = ${workspace.id} ${review ? sql`and c.needs_merge_review` : sql``}
      order by l.created_at desc
      limit 200`),
  )) as unknown as Row[];

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{review ? "Possible duplicates" : "Leads"}</h1>
        <Link href="/app/leads/new" className="rounded-md bg-neutral-900 px-3 py-2 text-sm text-white dark:bg-white dark:text-neutral-900">
          Quick add
        </Link>
      </div>
      {added && <p className="mt-3 text-sm text-green-700 dark:text-green-400">Lead {added === "merged" ? "merged into an existing contact" : "added"}.</p>}

      {rows.length === 0 ? (
        <p className="mt-6 text-neutral-500">No leads yet. Share your inquiry form or add one by hand.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-neutral-500">
              <tr><th className="py-2 pr-3">Name</th><th className="pr-3">Contact</th><th className="pr-3">Source</th><th className="pr-3">Stage</th><th>Added</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-neutral-200 align-top dark:border-neutral-800">
                  <td className="py-2 pr-3 font-medium">
                    {[r.first_name, r.last_name].filter(Boolean).join(" ") || "—"}
                    {r.needs_merge_review && (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900 dark:bg-amber-900 dark:text-amber-100">
                        Check for duplicate
                      </span>
                    )}
                  </td>
                  <td className="pr-3 text-neutral-600 dark:text-neutral-300">
                    {r.email_norm && <div>{r.email_norm}</div>}
                    {r.phone_e164 && <div>{r.phone_e164}</div>}
                  </td>
                  <td className="pr-3 capitalize">{r.source}</td>
                  <td className="pr-3">{r.stage}</td>
                  <td className="whitespace-nowrap text-neutral-500">
                    {new Date(r.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
