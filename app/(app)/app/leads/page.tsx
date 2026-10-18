import Link from "next/link";
import { withUser } from "@/lib/db";
import { filterOptions, LEAD_SORTS, listLeads, listStages, type LeadFilters, type LeadSort } from "@/lib/leads/queries";
import { requireWorkspace } from "@/lib/workspace";
import { Board } from "./board";
import { isGoingCold, isOverdue, leadName, relativeDay } from "./lead-flags";

export const metadata = { title: "Leads · CoreConnect" };

type Search = {
  view?: string; q?: string; stage?: string; source?: string; litter?: string; tag?: string;
  contacted?: string; closed?: string; sort?: string; added?: string; review?: string;
};

const select = "rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700";

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { user, workspace } = await requireWorkspace();
  const sp = await searchParams;
  const view = sp.view === "list" ? "list" : "board";
  const filters: LeadFilters = {
    q: sp.q, stageId: sp.stage || undefined, source: sp.source || undefined, litterId: sp.litter || undefined,
    tag: sp.tag || undefined,
    notContacted: (["never", "3", "7", "30"] as const).find((v) => v === sp.contacted),
    includeClosed: sp.closed === "1",
    sort: (sp.sort && sp.sort in LEAD_SORTS ? sp.sort : "newest") as LeadSort,
  };

  const { stages, leads, options } = await withUser(user.id, async (tx) => ({
    stages: await listStages(tx, workspace.id),
    leads: (await listLeads(tx, workspace.id, filters)).filter((l) => !sp.review || l.needs_merge_review),
    options: await filterOptions(tx, workspace.id),
  }));
  const stageName = new Map(stages.map((s) => [s.id, s.name]));
  const keep = (extra: Record<string, string>) => {
    const params = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== "added") as [string, string][]);
    for (const [k, v] of Object.entries(extra)) params.set(k, v);
    return `/app/leads?${params}`;
  };
  const filtered = Boolean(sp.q || sp.stage || sp.source || sp.litter || sp.tag || sp.contacted || sp.closed || sp.review);

  return (
    <main className="mx-auto max-w-[100rem] px-4 py-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{sp.review ? "Possible duplicates" : "Leads"}</h1>
        <div className="flex rounded-md border border-neutral-300 text-sm dark:border-neutral-700">
          <Link href={keep({ view: "board" })} aria-current={view === "board"} className={`px-3 py-1.5 ${view === "board" ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900" : ""}`}>Board</Link>
          <Link href={keep({ view: "list" })} aria-current={view === "list"} className={`px-3 py-1.5 ${view === "list" ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900" : ""}`}>List</Link>
        </div>
        <Link href="/app/leads/new" className="ml-auto rounded-md bg-neutral-900 px-3 py-2 text-sm text-white dark:bg-white dark:text-neutral-900">Quick add</Link>
      </div>
      {sp.added && <p className="mt-3 text-sm text-green-700 dark:text-green-400">Lead {sp.added === "merged" ? "merged into an existing contact" : "added"}.</p>}

      <form method="get" className="mt-4 flex flex-wrap items-end gap-2">
        <input type="hidden" name="view" value={view} />
        <input name="q" defaultValue={sp.q} placeholder="Search name, email, phone, tag" aria-label="Search" className={`${select} w-full sm:w-64`} />
        <select name="stage" defaultValue={sp.stage ?? ""} aria-label="Stage" className={select}>
          <option value="">All stages</option>
          {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select name="source" defaultValue={sp.source ?? ""} aria-label="Source" className={select}>
          <option value="">All sources</option>
          {options.sources.map((s) => <option key={s} value={s} className="capitalize">{s}</option>)}
        </select>
        {options.litters.length > 1 && (
          <select name="litter" defaultValue={sp.litter ?? ""} aria-label="Litter" className={select}>
            <option value="">All litters</option>
            {options.litters.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        )}
        {options.tags.length > 0 && (
          <select name="tag" defaultValue={sp.tag ?? ""} aria-label="Tag" className={select}>
            <option value="">All tags</option>
            {options.tags.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        <select name="contacted" defaultValue={sp.contacted ?? ""} aria-label="Last contacted" className={select}>
          <option value="">Any last contact</option>
          <option value="3">Not contacted in 3 days</option>
          <option value="7">Not contacted in 7 days</option>
          <option value="30">Not contacted in 30 days</option>
          <option value="never">Never contacted</option>
        </select>
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" name="closed" value="1" defaultChecked={sp.closed === "1"} /> Include older closed
        </label>
        <button className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700">Apply</button>
        {filtered && <Link href={`/app/leads?view=${view}`} className="text-sm underline">Clear</Link>}
      </form>

      <p className="mt-3 text-sm text-neutral-500">{leads.length} {leads.length === 1 ? "lead" : "leads"}{leads.length === 1000 ? " (showing the first 1,000)" : ""}</p>

      <div className="mt-3">
        {view === "board" ? (
          <Board stages={stages} leads={leads} />
        ) : leads.length === 0 ? (
          <p className="text-neutral-500">{filtered ? "No leads match these filters." : "No leads yet. Share your inquiry form or add one by hand."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-neutral-500">
                <tr>
                  <th className="py-2 pr-3"><Link href={keep({ sort: "name" })}>Name</Link></th>
                  <th className="pr-3">Stage</th>
                  <th className="pr-3">Source</th>
                  <th className="pr-3"><Link href={keep({ sort: "rating" })}>Rating</Link></th>
                  <th className="pr-3"><Link href={keep({ sort: "last_contacted" })}>Last contact</Link></th>
                  <th className="pr-3"><Link href={keep({ sort: "next_task" })}>Next task</Link></th>
                  <th><Link href={keep({ sort: "newest" })}>Added</Link></th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={l.id} className="border-t border-neutral-200 dark:border-neutral-800">
                    <td className="py-2 pr-3">
                      <Link href={`/app/leads/${l.id}`} className="font-medium hover:underline">{leadName(l)}</Link>
                      <div className="text-xs text-neutral-500">{l.email_norm ?? l.phone_e164}</div>
                    </td>
                    <td className="pr-3">{stageName.get(l.stage_id)}</td>
                    <td className="pr-3 capitalize">{l.source}</td>
                    <td className="pr-3">{l.rating ? "★".repeat(l.rating) : ""}</td>
                    <td className={`pr-3 ${isGoingCold(l) ? "text-amber-700 dark:text-amber-400" : ""}`}>{relativeDay(l.last_contacted_at)}</td>
                    <td className={`pr-3 ${isOverdue(l) ? "font-medium text-red-600" : ""}`}>
                      {l.next_task_due_at ? new Date(l.next_task_due_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}
                    </td>
                    <td className="whitespace-nowrap text-neutral-500">{new Date(l.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
