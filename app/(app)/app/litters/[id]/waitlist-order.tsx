"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { WaitlistRow } from "@/lib/waitlist";
import { moveEntryAction, notifyWaitlistAction, removeEntryAction, type LitterResult } from "../actions";

const small = "rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-40 dark:border-neutral-700";

type Pending = { entry: WaitlistRow; kind: "move"; to: number } | { entry: WaitlistRow; kind: "matched" | "released" };

// Manual reorder with a required reason (FR-18). Buttons rather than dragging:
// every change has to stop for a reason anyway, and they work one-handed.
export function WaitlistOrder({ entries }: { entries: WaitlistRow[] }) {
  const [pending, start] = useTransition();
  const [dialog, setDialog] = useState<Pending | null>(null);
  const [reason, setReason] = useState("");
  const [moveTo, setMoveTo] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<LitterResult>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) setError(r.error);
      else { setDialog(null); setReason(""); }
    });
  const ask = (p: Pending) => { setError(null); setReason(""); setDialog(p); };

  if (entries.length === 0) return <p className="mt-3 text-sm text-neutral-500">Nobody is waiting yet. Approve an application or add a lead from its page.</p>;

  return (
    <>
      <ol className="mt-3 divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
        {entries.map((e, i) => (
          <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3 text-sm">
            <span className="w-8 text-lg font-semibold tabular-nums">#{e.position}</span>
            <div className="min-w-0 flex-1">
              <Link href={`/app/leads/${e.lead_id}`} className="font-medium hover:underline">{[e.first_name, e.last_name].filter(Boolean).join(" ") || "Unnamed"}</Link>
              <p className="text-xs text-neutral-500">
                {[e.sex_pref, e.color_pref].filter(Boolean).join(", ") || "No preference"} · {e.stage}
                {e.deposit_paid && <span className="ml-1 rounded bg-green-100 px-1.5 py-0.5 text-green-900 dark:bg-green-950 dark:text-green-200">Deposit paid</span>}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <button type="button" disabled={pending || i === 0} onClick={() => ask({ entry: e, kind: "move", to: e.position - 1 })} className={small} aria-label={`Move ${e.first_name} up`}>Up</button>
              <button type="button" disabled={pending || i === entries.length - 1} onClick={() => ask({ entry: e, kind: "move", to: e.position + 1 })} className={small} aria-label={`Move ${e.first_name} down`}>Down</button>
              <input value={moveTo[e.id] ?? ""} onChange={(ev) => setMoveTo({ ...moveTo, [e.id]: ev.target.value })} inputMode="numeric" placeholder="#" aria-label={`New position for ${e.first_name}`} className="w-10 rounded border border-neutral-300 bg-transparent px-1 py-1 text-xs dark:border-neutral-700" />
              <button type="button" disabled={pending || !Number(moveTo[e.id])} onClick={() => ask({ entry: e, kind: "move", to: Number(moveTo[e.id]) })} className={small}>Move</button>
              <button type="button" disabled={pending} onClick={() => ask({ entry: e, kind: "matched" })} className={small}>Matched</button>
              <button type="button" disabled={pending} onClick={() => ask({ entry: e, kind: "released" })} className={small}>Remove</button>
            </div>
          </li>
        ))}
      </ol>
      {error && !dialog && <p className="mt-2 text-sm text-red-600" role="alert">{error}</p>}

      {dialog && (
        <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="reason-title">
          <form className="w-full max-w-sm rounded-lg bg-white p-4 dark:bg-neutral-900" onSubmit={(ev) => {
            ev.preventDefault();
            const d = dialog;
            run(() => (d.kind === "move" ? moveEntryAction(d.entry.id, d.to, reason) : removeEntryAction(d.entry.id, d.kind, reason)));
          }}>
            <h2 id="reason-title" className="font-semibold">
              {dialog.kind === "move" ? `Move ${dialog.entry.first_name} from #${dialog.entry.position} to #${dialog.to}`
                : dialog.kind === "matched" ? `Mark ${dialog.entry.first_name} as matched` : `Remove ${dialog.entry.first_name} from the list`}
            </h2>
            <p className="mt-1 text-sm text-neutral-500">The reason is saved permanently in the position history.</p>
            <textarea value={reason} onChange={(ev) => setReason(ev.target.value)} required={dialog.kind !== "matched"} rows={3} maxLength={500} autoFocus
              placeholder={dialog.kind === "move" ? "Why is the order changing?" : dialog.kind === "matched" ? "Which puppy or spot? (optional)" : "Why are they leaving the list?"}
              aria-label="Reason" className="mt-3 w-full rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700" />
            {error && <p className="mt-1 text-sm text-red-600" role="alert">{error}</p>}
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => setDialog(null)} className="px-3 py-2 text-sm">Cancel</button>
              <button disabled={pending || (dialog.kind !== "matched" && !reason.trim())} className="rounded-md bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900">Save</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

// "Litter status set to Born: email every active waitlist entry. Owner confirms send first."
export function NotifyButton({ litterId, born, count }: { litterId: string; born: boolean; count: number }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="text-right">
      <button type="button" disabled={pending || !born || count === 0}
        title={!born ? "Mark the litter as born first" : undefined}
        onClick={() => {
          if (!confirm(`Email all ${count} families on this list that the litter was born?`)) return;
          start(async () => {
            const r = await notifyWaitlistAction(litterId);
            setMessage(r.ok ? (r.note ?? "Sent.") : r.error);
          });
        }}
        className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm disabled:opacity-40 dark:border-neutral-700">
        Notify waitlist
      </button>
      {message && <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300" role="status">{message}</p>}
    </div>
  );
}
