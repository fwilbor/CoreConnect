"use client";

import { useActionState } from "react";
import { saveBusinessSettings, type BusinessState } from "./actions";

const input = "mt-1 w-full rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700";

export function BusinessForm({ initial }: {
  initial: { name: string; physicalAddress: string | null; brandColor: string | null; logoUrl: string | null; smsEnabled: boolean; smsNumber: string | null };
}) {
  const [state, action, pending] = useActionState<BusinessState, FormData>(saveBusinessSettings, {});
  return (
    <form action={action} className="mt-3 space-y-3">
      <label className="block text-sm">
        Business name
        <input name="name" defaultValue={initial.name} required maxLength={120} className={input} />
      </label>
      <label className="block text-sm">
        Mailing address (shown in every email footer)
        <textarea name="physicalAddress" defaultValue={initial.physicalAddress ?? ""} rows={2} maxLength={300}
          placeholder="123 Main St, Tulsa, OK 74103" className={input} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          Brand color
          <input name="brandColor" defaultValue={initial.brandColor ?? ""} placeholder="#2f6f4e" pattern="#[0-9a-fA-F]{6}" className={input} />
        </label>
        <label className="block text-sm">
          Logo link (https)
          <input name="logoUrl" type="url" defaultValue={initial.logoUrl ?? ""} placeholder="https://…" className={input} />
        </label>
      </div>
      <fieldset className="rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
        <legend className="px-1 font-medium">Text messages</legend>
        <p className="text-neutral-500">
          {initial.smsNumber
            ? `Your texting number is ${initial.smsNumber}.`
            : "No texting number yet. CoreStore sets one up once carrier registration (10DLC) is approved."}
        </p>
        <label className="mt-2 flex items-center gap-2">
          <input type="checkbox" name="smsEnabled" defaultChecked={initial.smsEnabled} disabled={!initial.smsNumber} />
          Send texts to people who agreed to them
        </label>
      </fieldset>
      {state.error && <p className="text-sm text-red-600" role="alert">{state.error}</p>}
      {state.ok && <p className="text-sm text-green-700 dark:text-green-400">Saved.</p>}
      <button disabled={pending} className="rounded-md bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900">
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
