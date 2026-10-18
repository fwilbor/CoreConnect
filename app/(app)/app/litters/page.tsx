import Link from "next/link";
import { withUser } from "@/lib/db";
import { listLitters } from "@/lib/litters";
import { requireWorkspace } from "@/lib/workspace";
import { LitterForm } from "./litter-form";

export const metadata = { title: "Litters · CoreConnect" };

const fmt = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null);

export default async function LittersPage({ searchParams }: { searchParams: Promise<{ closed?: string }> }) {
  const { user, workspace } = await requireWorkspace();
  const { closed } = await searchParams;
  const litters = await withUser(user.id, (tx) => listLitters(tx, workspace.id, closed === "1"));
  const service = workspace.businessType === "service";

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{service ? "Slots" : "Litters"}</h1>
        <Link href={closed === "1" ? "/app/litters" : "/app/litters?closed=1"} className="text-sm underline">
          {closed === "1" ? "Hide closed" : "Show closed"}
        </Link>
      </div>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {litters.map((l) => (
          <li key={l.id}>
            <Link href={`/app/litters/${l.id}`} className="block rounded-lg border border-neutral-200 p-4 hover:border-neutral-400 dark:border-neutral-800">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{l.name}</span>
                <span className="text-xs capitalize text-neutral-500">{l.is_general ? "general" : l.status}</span>
              </div>
              <p className="mt-1 text-sm text-neutral-500">
                {[l.sire && l.dam ? `${l.sire} × ${l.dam}` : null, fmt(l.born_date) ? `born ${fmt(l.born_date)}` : fmt(l.expected_date) ? `due ${fmt(l.expected_date)}` : null]
                  .filter(Boolean).join(" · ") || (l.is_general ? "Approved families not yet assigned to a litter" : "")}
              </p>
              <p className="mt-2 text-sm"><span className="font-semibold tabular-nums">{l.active}</span> waiting · {l.deposits} deposit{l.deposits === 1 ? "" : "s"} paid</p>
            </Link>
          </li>
        ))}
      </ul>
      <section className="mt-10">
        <h2 className="text-lg font-semibold">New {service ? "slot" : "litter"}</h2>
        <div className="mt-3"><LitterForm serviceBusiness={service} /></div>
      </section>
    </main>
  );
}
