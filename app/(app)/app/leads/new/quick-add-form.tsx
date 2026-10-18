"use client";

import { useActionState } from "react";
import { quickAddLead, type QuickAddState } from "./actions";

const SOURCES = [
  ["facebook", "Facebook"], ["instagram", "Instagram"], ["text", "Text"], ["call", "Call"],
  ["show", "Show"], ["referral", "Referral"], ["other", "Other"],
] as const;

const input = "mt-1 w-full rounded-md border border-neutral-300 bg-transparent px-3 py-3 text-base dark:border-neutral-700";

export function QuickAddForm() {
  const [state, action, pending] = useActionState<QuickAddState, FormData>(quickAddLead, {});
  const f = state.fields;

  return (
    <form action={action} className="mt-6 space-y-4">
      <label className="block text-sm font-medium">
        Name
        <input name="name" required autoFocus autoComplete="off" defaultValue={f?.name} className={input} />
      </label>
      <label className="block text-sm font-medium">
        Phone or email
        <input name="contact" required inputMode="email" autoComplete="off" defaultValue={f?.contact} className={input} />
      </label>
      <fieldset>
        <legend className="text-sm font-medium">Source</legend>
        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {SOURCES.map(([value, label]) => (
            <label key={value} className="has-[:checked]:border-neutral-900 has-[:checked]:bg-neutral-900 has-[:checked]:text-white dark:has-[:checked]:bg-white dark:has-[:checked]:text-neutral-900 flex cursor-pointer items-center justify-center rounded-md border border-neutral-300 px-2 py-3 text-sm dark:border-neutral-700">
              <input type="radio" name="source" value={value} required defaultChecked={f?.source === value} className="sr-only" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      {state.error && <p className="text-sm text-red-600" role="alert">{state.error}</p>}
      <button disabled={pending} className="w-full rounded-md bg-neutral-900 px-4 py-3 font-medium text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900">
        {pending ? "Saving…" : "Add lead"}
      </button>
    </form>
  );
}
