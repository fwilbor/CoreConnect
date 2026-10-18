import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withUser } from "@/lib/db";
import type { LitterStatus } from "@/lib/litters";
import { listWaitlist, waitlistHistory } from "@/lib/waitlist";
import { requireWorkspace } from "@/lib/workspace";
import { LitterForm } from "../litter-form";
import { NotifyButton, WaitlistOrder } from "./waitlist-order";

export const metadata = { title: "Litter · CoreConnect" };

export default async function LitterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { user, workspace } = await requireWorkspace();
  const data = await withUser(user.id, async (tx) => {
    const [litter] = (await tx.execute(sql`
      select id, name, is_general, sire, dam, expected_date::text, born_date::text, expected_count, status
      from litters where id = ${id} and workspace_id = ${workspace.id}`)) as unknown as {
      id: string; name: string; is_general: boolean; sire: string | null; dam: string | null; expected_date: string | null;
      born_date: string | null; expected_count: number | null; status: LitterStatus;
    }[];
    if (!litter) return null;
    return { litter, entries: await listWaitlist(tx, workspace.id, id), history: await waitlistHistory(tx, workspace.id, id) };
  });
  if (!data) notFound();
  const { litter, entries, history } = data;
  const service = workspace.businessType === "service";

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <Link href="/app/litters" className="text-sm text-neutral-500 hover:underline">← {service ? "Slots" : "Litters"}</Link>
      <h1 className="mt-2 text-2xl font-semibold">{litter.name}</h1>

      <section className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Waitlist ({entries.length})</h2>
          {!litter.is_general && <NotifyButton litterId={litter.id} born={litter.status === "born"} count={entries.length} />}
        </div>
        <WaitlistOrder entries={entries} />
      </section>

      <section className="mt-10">
          <h2 className="text-lg font-semibold">Details</h2>
          <div className="mt-3">
            <LitterForm
              litterId={litter.id}
              isGeneral={litter.is_general}
              serviceBusiness={service}
              initial={{
                name: litter.name, sire: litter.sire ?? "", dam: litter.dam ?? "", expectedDate: litter.expected_date ?? "",
                bornDate: litter.born_date ?? "", expectedCount: litter.expected_count?.toString() ?? "", status: litter.status,
              }}
            />
          </div>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Position history</h2>
        <p className="text-sm text-neutral-500">Every change to this list, permanently recorded.</p>
        <ol className="mt-3 space-y-2 text-sm">
          {history.map((h) => (
            <li key={h.id} className="border-l-2 border-neutral-200 pl-3 dark:border-neutral-800">
              <p>
                <span className="font-medium">{[h.first_name, h.last_name].filter(Boolean).join(" ")}</span>{" "}
                {h.from_position === null ? `added at #${h.to_position}` : h.to_position === null ? `left the list from #${h.from_position}` : `#${h.from_position} → #${h.to_position}`}
              </p>
              {h.reason && <p className="text-neutral-600 dark:text-neutral-300">{h.reason}</p>}
              <p className="text-xs text-neutral-500">
                {h.actor_name ?? "System"} · {new Date(h.created_at).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
              </p>
            </li>
          ))}
          {history.length === 0 && <li className="text-neutral-500">No changes yet.</li>}
        </ol>
      </section>
    </main>
  );
}
