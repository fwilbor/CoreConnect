"use client";

import { useState, useTransition } from "react";
import { saveStepsAction, setSequenceActiveAction } from "./actions";

type Step = { id: string; day: number; templateId: string };
const input = "rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700";

export function SequenceEditor(props: {
  sequence: { id: string; name: string; is_active: boolean };
  enrolled: number;
  steps: Step[];
  templates: { id: string; name: string }[];
}) {
  const [steps, setSteps] = useState(props.steps);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const update = (i: number, patch: Partial<Step>) => { setSaved(false); setSteps(steps.map((s, j) => (j === i ? { ...s, ...patch } : s))); };

  return (
    <section className="mt-6 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">{props.sequence.name}</h2>
        <span className="text-sm text-neutral-500">{props.enrolled} lead{props.enrolled === 1 ? "" : "s"} in it now</span>
        <label className="ml-auto flex items-center gap-2 text-sm">
          <input type="checkbox" checked={props.sequence.is_active} disabled={pending}
            onChange={(e) => start(async () => { await setSequenceActiveAction(props.sequence.id, e.target.checked); })} />
          {props.sequence.is_active ? "On" : "Off"}
        </label>
      </div>
      <ol className="mt-4 space-y-2">
        {steps.map((s, i) => (
          <li key={s.id} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="w-14 text-neutral-500">Step {i + 1}</span>
            <span>Day</span>
            <input type="number" min={0} max={90} value={s.day} aria-label={`Step ${i + 1} day`}
              onChange={(e) => update(i, { day: Number(e.target.value) })} className={`${input} w-20`} />
            <select value={s.templateId} aria-label={`Step ${i + 1} template`} onChange={(e) => update(i, { templateId: e.target.value })} className={`${input} min-w-0 flex-1`}>
              {props.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </li>
        ))}
      </ol>
      {error && <p className="mt-2 text-sm text-red-600" role="alert">{error}</p>}
      {saved && <p className="mt-2 text-sm text-green-700 dark:text-green-400">Saved. Leads already in the sequence follow the new timing from their next step.</p>}
      <button type="button" disabled={pending}
        onClick={() => start(async () => {
          setError(null);
          const r = await saveStepsAction(props.sequence.id, steps);
          if (r.ok) setSaved(true);
          else setError(r.error);
        })}
        className="mt-3 rounded-md bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900">
        Save steps
      </button>
    </section>
  );
}
