"use client";

import { useState, useTransition } from "react";
import {
  addStageAction, deleteStageAction, moveStageAction, renameStageAction, setDefaultStageAction, type StageActionResult,
} from "./actions";

type Row = { id: string; name: string; kind: "open" | "won" | "lost"; is_default: boolean; leads: number };

const input = "min-w-0 flex-1 rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700";
const KIND_LABEL = { open: "", won: "Won", lost: "Lost" } as const;

export function StageEditor({ stages }: { stages: Row[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState("");

  const run = (fn: () => Promise<StageActionResult>, onOk?: () => void) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (r.ok) onOk?.();
      else setError(r.error);
    });

  const open = stages.filter((s) => s.kind === "open");

  return (
    <div className="mt-6">
      <ol className="space-y-2">
        {stages.map((s) => {
          const draft = names[s.id] ?? s.name;
          const openIndex = open.findIndex((o) => o.id === s.id);
          return (
            <li key={s.id} className="rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
              <form className="flex items-center gap-2" onSubmit={(e) => {
                e.preventDefault();
                run(() => renameStageAction(s.id, draft), () => setNames((prev) => { const next = { ...prev }; delete next[s.id]; return next; }));
              }}>
                <input value={draft} onChange={(e) => setNames({ ...names, [s.id]: e.target.value })} aria-label={`Name of ${s.name}`} maxLength={40} className={input} />
                {draft !== s.name && <button disabled={pending} className="text-sm underline">Save</button>}
              </form>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-neutral-500">
                <span>{s.leads} lead{s.leads === 1 ? "" : "s"}</span>
                {KIND_LABEL[s.kind] && <span className="rounded bg-neutral-100 px-1.5 py-0.5 dark:bg-neutral-800">{KIND_LABEL[s.kind]}</span>}
                {s.is_default ? (
                  <span className="rounded bg-neutral-100 px-1.5 py-0.5 dark:bg-neutral-800">New leads start here</span>
                ) : s.kind === "open" ? (
                  <button type="button" disabled={pending} onClick={() => run(() => setDefaultStageAction(s.id))} className="underline">Start new leads here</button>
                ) : null}
                {s.kind === "open" && (
                  <span className="ml-auto flex gap-3">
                    <button type="button" disabled={pending || openIndex === 0} onClick={() => run(() => moveStageAction(s.id, -1))} className="underline disabled:opacity-40">Up</button>
                    <button type="button" disabled={pending || openIndex === open.length - 1} onClick={() => run(() => moveStageAction(s.id, 1))} className="underline disabled:opacity-40">Down</button>
                    <button type="button" disabled={pending} onClick={() => {
                      if (confirm(`Remove the stage "${s.name}"?`)) run(() => deleteStageAction(s.id));
                    }} className="text-red-600 underline">Remove</button>
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); run(() => addStageAction(newName), () => setNewName("")); }}>
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New stage name" aria-label="New stage name" maxLength={40} className={input} />
        <button disabled={pending || !newName.trim()} className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900">Add stage</button>
      </form>
      {error && <p className="mt-2 text-sm text-red-600" role="alert">{error}</p>}
    </div>
  );
}
