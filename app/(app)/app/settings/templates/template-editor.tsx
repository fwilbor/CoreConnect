"use client";

import { useRef, useState, useTransition } from "react";
import { MERGE_FIELDS, renderTemplate } from "@/lib/messaging/render";
import { deleteTemplateAction, saveTemplateAction } from "./actions";

export type TemplateRow = { id: string; channel: "email" | "sms"; name: string; subject: string | null; body: string; purpose?: string | null };

const input = "w-full rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700";

export function TemplateEditor({ templates, businessName }: { templates: TemplateRow[]; businessName: string }) {
  const [selected, setSelected] = useState<TemplateRow | null>(templates[0] ?? null);
  const [draft, setDraft] = useState<TemplateRow | null>(templates[0] ?? null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const open = (t: TemplateRow) => { setSelected(t); setDraft(t); setError(null); setSaved(false); };
  const startNew = (channel: "email" | "sms") =>
    open({ id: "", channel, name: "", subject: channel === "email" ? "" : null, body: "" });

  const insertField = (field: string) => {
    if (!draft) return;
    const el = bodyRef.current;
    const token = `{{${field}}}`;
    const at = el?.selectionStart ?? draft.body.length;
    setDraft({ ...draft, body: draft.body.slice(0, at) + token + draft.body.slice(el?.selectionEnd ?? at) });
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + token.length, at + token.length); });
  };

  const save = () => draft && start(async () => {
    setError(null);
    const r = await saveTemplateAction({ id: draft.id || null, channel: draft.channel, name: draft.name, subject: draft.subject ?? "", body: draft.body });
    if (!r.ok) return setError(r.error);
    setSaved(true);
    setSelected({ ...draft, id: r.id });
    setDraft({ ...draft, id: r.id });
  });

  const remove = () => draft?.id && start(async () => {
    if (!confirm(`Delete "${draft.name}"?`)) return;
    const r = await deleteTemplateAction(draft.id);
    if (!r.ok) return setError(r.error);
    setSelected(null);
    setDraft(null);
  });

  const sample = { first_name: "Jamie", last_name: "Rivera", business_name: businessName, application_link: "https://…/apply/…" };

  return (
    <div className="mt-6 grid gap-6 md:grid-cols-[14rem_1fr]">
      <aside>
        <ul className="space-y-1 text-sm">
          {templates.map((t) => (
            <li key={t.id}>
              <button type="button" onClick={() => open(t)}
                className={`w-full rounded-md px-2 py-1.5 text-left ${selected?.id === t.id ? "bg-neutral-100 dark:bg-neutral-800" : ""}`}>
                <span className="block">{t.name}</span>
                <span className="text-xs text-neutral-500">{t.channel === "email" ? "Email" : "SMS"}{t.purpose ? ` · ${t.purpose}` : ""}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex gap-2 text-sm">
          <button type="button" onClick={() => startNew("email")} className="underline">New email</button>
          <button type="button" onClick={() => startNew("sms")} className="underline">New text</button>
        </div>
      </aside>

      {draft && (
        <section className="space-y-3">
          {draft.purpose && <p className="text-sm text-neutral-500">{draft.purpose}.</p>}
          <label className="block text-sm">Name<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={80} className={`${input} mt-1`} /></label>
          {draft.channel === "email" && (
            <label className="block text-sm">Subject<input value={draft.subject ?? ""} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} maxLength={200} className={`${input} mt-1`} /></label>
          )}
          <div>
            <div className="flex flex-wrap items-center gap-1 text-xs">
              <span className="text-neutral-500">Insert:</span>
              {MERGE_FIELDS.map((f) => (
                <button key={f} type="button" onClick={() => insertField(f)} className="rounded border border-neutral-300 px-1.5 py-0.5 dark:border-neutral-700">{f.replace(/_/g, " ")}</button>
              ))}
            </div>
            <textarea ref={bodyRef} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              rows={draft.channel === "sms" ? 4 : 10} aria-label="Message" className={`${input} mt-1`} />
            {draft.channel === "sms" && <p className="text-xs text-neutral-500">{draft.body.length}/1000 characters</p>}
          </div>
          <div className="rounded-md bg-neutral-50 p-3 text-sm dark:bg-neutral-900">
            <p className="text-xs font-medium text-neutral-500">Preview</p>
            {draft.channel === "email" && <p className="mt-1 font-medium">{renderTemplate(draft.subject ?? "", sample)}</p>}
            <p className="mt-1 whitespace-pre-wrap">{renderTemplate(draft.body, sample)}</p>
          </div>
          {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
          {saved && !error && <p className="text-sm text-green-700 dark:text-green-400">Saved.</p>}
          <div className="flex gap-3">
            <button type="button" onClick={save} disabled={pending} className="rounded-md bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900">
              {pending ? "Saving…" : "Save template"}
            </button>
            {draft.id && !draft.purpose && <button type="button" onClick={remove} disabled={pending} className="text-sm text-red-600 underline">Delete</button>}
          </div>
        </section>
      )}
    </div>
  );
}
