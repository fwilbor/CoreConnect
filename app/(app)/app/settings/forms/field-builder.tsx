"use client";

import { useActionState, useState } from "react";
import { FIELD_TYPES, MAX_CUSTOM_FIELDS, type FieldType, type FormField } from "@/lib/intake/fields";
import { saveForm, type SaveFormState } from "./actions";

const TYPE_LABELS: Record<FieldType, string> = {
  text: "Text", select: "Pick one", multi_select: "Pick several", yes_no: "Yes / no", date: "Date",
};

const input = "w-full rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700";

// A field's key is set once, when it's added, and kept when the label changes,
// so earlier answers stay linked to the same question.
function keyFor(label: string, taken: Set<string>) {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30) || "question";
  let key = /^[a-z]/.test(base) ? base : `q_${base}`;
  for (let i = 2; taken.has(key) || ["first_name", "last_name", "name", "email", "phone", "source", "sms_consent"].includes(key); i++) {
    key = `${base}_${i}`;
  }
  return key;
}

type Draft = FormField & { optionsText: string };

export function FieldBuilder(props: { kind: "inquiry" | "application"; initialTitle: string; initialSuccessMessage: string; initialFields: FormField[] }) {
  const [fields, setFields] = useState<Draft[]>(
    props.initialFields.map((f) => ({ ...f, optionsText: (f.options ?? []).join("\n") })),
  );
  const [state, action, pending] = useActionState<SaveFormState, FormData>(saveForm, {});

  const update = (i: number, patch: Partial<Draft>) =>
    setFields((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const move = (i: number, by: number) =>
    setFields((fs) => {
      const next = [...fs];
      const [item] = next.splice(i, 1);
      next.splice(Math.max(0, Math.min(next.length, i + by)), 0, item);
      return next;
    });
  const add = () =>
    setFields((fs) => [
      ...fs,
      { key: keyFor("New question", new Set(fs.map((f) => f.key))), label: "New question", type: "text", required: false, optionsText: "" },
    ]);

  const payload = fields.map(({ optionsText, ...f }) => {
    const needsOptions = f.type === "select" || f.type === "multi_select";
    const options = optionsText.split("\n").map((o) => o.trim()).filter(Boolean);
    return { ...f, options: needsOptions ? options : undefined };
  });

  return (
    <form action={action} className="mt-4 space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          Form title
          <input name="title" defaultValue={props.initialTitle} required maxLength={120} className={input} />
        </label>
        <label className="text-sm">
          Message after submitting
          <input name="successMessage" defaultValue={props.initialSuccessMessage} maxLength={500} className={input} />
        </label>
      </div>

      <ol className="space-y-3">
        {fields.map((f, i) => (
          <li key={f.key} className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
            <div className="grid gap-2 sm:grid-cols-[1fr_10rem]">
              <input aria-label="Question" value={f.label} maxLength={200} onChange={(e) => update(i, { label: e.target.value })} className={input} />
              <select aria-label="Answer type" value={f.type} onChange={(e) => update(i, { type: e.target.value as FieldType })} className={input}>
                {FIELD_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
              </select>
            </div>
            {(f.type === "select" || f.type === "multi_select") && (
              <textarea
                aria-label="Options, one per line"
                placeholder="Options, one per line"
                rows={3}
                value={f.optionsText}
                onChange={(e) => update(i, { optionsText: e.target.value })}
                className={`${input} mt-2`}
              />
            )}
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={f.required} onChange={(e) => update(i, { required: e.target.checked })} /> Required
              </label>
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="underline disabled:opacity-40">Up</button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === fields.length - 1} className="underline disabled:opacity-40">Down</button>
              <button type="button" onClick={() => setFields((fs) => fs.filter((_, j) => j !== i))} className="ml-auto text-red-600 underline">
                Remove
              </button>
            </div>
          </li>
        ))}
      </ol>

      <input type="hidden" name="kind" value={props.kind} />
      <input type="hidden" name="fields" value={JSON.stringify(payload)} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={add} disabled={fields.length >= MAX_CUSTOM_FIELDS} className="rounded-md border border-neutral-300 px-3 py-2 text-sm disabled:opacity-40 dark:border-neutral-700">
          Add question ({fields.length}/{MAX_CUSTOM_FIELDS})
        </button>
        <button disabled={pending} className="rounded-md bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900">
          {pending ? "Saving…" : "Save form"}
        </button>
        {state.ok && <span className="text-sm text-green-700 dark:text-green-400">Saved.</span>}
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
      </div>
    </form>
  );
}
