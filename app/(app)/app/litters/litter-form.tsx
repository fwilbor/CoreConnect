"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { LitterInput, LitterStatus } from "@/lib/litters";
import { createLitterAction, updateLitterAction } from "./actions";

const input = "mt-1 w-full rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700";
const STATUS_LABEL: Record<LitterStatus, string> = { planned: "Planned", confirmed: "Confirmed (pregnant)", born: "Born", closed: "Closed" };

export function LitterForm(props: { litterId?: string; initial?: LitterInput; isGeneral?: boolean; serviceBusiness: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState<LitterInput>(props.initial ?? {
    name: "", sire: "", dam: "", expectedDate: "", bornDate: "", expectedCount: "", status: "planned",
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const set = (k: keyof LitterInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setSaved(false); setForm({ ...form, [k]: e.target.value }); };
  const noun = props.serviceBusiness ? "slot" : "litter";

  return (
    <form className="space-y-3" onSubmit={(e) => {
      e.preventDefault();
      start(async () => {
        setError(null);
        const r = props.litterId ? await updateLitterAction(props.litterId, form) : await createLitterAction(form);
        if (!r.ok) return setError(r.error);
        if (!props.litterId && r.id) router.push(`/app/litters/${r.id}`);
        else setSaved(true);
      });
    }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">Name<input value={form.name} onChange={set("name")} required maxLength={80} placeholder={props.serviceBusiness ? "Spring puppy class" : "Bella x Max, spring 2027"} className={input} /></label>
        <label className="block text-sm">Status
          <select value={form.status} onChange={set("status")} disabled={props.isGeneral} className={input}>
            {(Object.keys(STATUS_LABEL) as LitterStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </label>
        {!props.isGeneral && !props.serviceBusiness && (
          <>
            <label className="block text-sm">Sire<input value={form.sire} onChange={set("sire")} maxLength={80} className={input} /></label>
            <label className="block text-sm">Dam<input value={form.dam} onChange={set("dam")} maxLength={80} className={input} /></label>
          </>
        )}
        {!props.isGeneral && (
          <>
            <label className="block text-sm">Expected date<input type="date" value={form.expectedDate} onChange={set("expectedDate")} className={input} /></label>
            <label className="block text-sm">{props.serviceBusiness ? "Start date" : "Born on"}<input type="date" value={form.bornDate} onChange={set("bornDate")} className={input} /></label>
            <label className="block text-sm">{props.serviceBusiness ? "Spots" : "Expected puppies"}<input value={form.expectedCount} onChange={set("expectedCount")} inputMode="numeric" className={input} /></label>
          </>
        )}
      </div>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      {saved && <p className="text-sm text-green-700 dark:text-green-400">Saved.</p>}
      <button disabled={pending} className="rounded-md bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900">
        {props.litterId ? "Save" : `Create ${noun}`}
      </button>
    </form>
  );
}
