"use client";

import { useState, useTransition } from "react";
import { deleteContactAction } from "./delete-actions";

// Deletes the person and everything about them, on their request. Payments
// stay on the books with the personal details removed.
export function DeleteContact({ contactId, name }: { contactId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-sm text-red-700 underline dark:text-red-400">
        Delete contact…
      </button>
    );
  }
  return (
    <div className="rounded-md border border-red-300 p-3 text-sm dark:border-red-900">
      <p className="font-medium">Delete {name} permanently?</p>
      <p className="mt-1 text-neutral-600 dark:text-neutral-300">
        This removes their contact details, leads, messages, notes, tasks, form answers and waitlist places. Anyone
        behind them on a waitlist moves up. Payment records are kept for your books with their details removed. This
        can&apos;t be undone.
      </p>
      <label className="mt-3 block">
        Type DELETE to confirm
        <input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off"
          className="mt-1 w-full rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 dark:border-neutral-700" />
      </label>
      {error && <p className="mt-2 text-red-600" role="alert">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button
          disabled={pending || confirm.trim().toUpperCase() !== "DELETE"}
          onClick={() => start(async () => {
            setError(null);
            const r = await deleteContactAction(contactId, confirm);
            if (r?.error) setError(r.error);
          })}
          className="rounded-md bg-red-700 px-3 py-2 text-white disabled:opacity-50"
        >
          {pending ? "Deleting…" : "Delete permanently"}
        </button>
        <button onClick={() => { setOpen(false); setConfirm(""); setError(null); }} className="rounded-md border border-neutral-300 px-3 py-2 dark:border-neutral-700">
          Cancel
        </button>
      </div>
    </div>
  );
}
