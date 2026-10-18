"use client";

import { useState, useTransition } from "react";
import type { Stage, TimelineItem } from "@/lib/leads/queries";
import {
  addNoteAction, addTaskAction, assignLeadAction, clearMergeReviewAction, logContactAction, moveLeadAction,
  setRatingAction, setTagsAction, setTaskDoneAction, updateContactAction, type ActionResult,
} from "../actions";

const input = "w-full rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700";
const button = "rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900";
const CLOSED_REASONS = ["Not a fit", "No response", "Went elsewhere", "Other"];

// Shared pending/error handling for the panels.
function useAction() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<ActionResult>, onOk?: () => void) =>
    start(async () => {
      setError(null);
      const result = await fn();
      if (result.ok) onOk?.();
      else setError(result.error);
    });
  return { pending, error, run };
}

const ErrorText = ({ error }: { error: string | null }) =>
  error ? <p className="mt-1 text-sm text-red-600" role="alert">{error}</p> : null;

export function LeadControls(props: {
  leadId: string; stageId: string; stages: Stage[]; rating: number | null; tags: string[];
  assigneeId: string | null; members: { id: string; name: string }[];
}) {
  const { pending, error, run } = useAction();
  const [closingTo, setClosingTo] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState("");

  const onStage = (stageId: string) => {
    if (props.stages.find((s) => s.id === stageId)?.kind === "lost") setClosingTo(stageId);
    else run(() => moveLeadAction(props.leadId, stageId));
  };
  const addTag = () => {
    const tag = tagDraft.trim();
    if (!tag) return;
    run(() => setTagsAction(props.leadId, [...props.tags, tag]), () => setTagDraft(""));
  };

  return (
    <section className="space-y-4">
      <label className="block text-sm font-medium">
        Stage
        <select value={props.stageId} disabled={pending} onChange={(e) => onStage(e.target.value)} className={`${input} mt-1`}>
          {props.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      {closingTo && (
        <div className="rounded-md border border-neutral-300 p-3 text-sm dark:border-neutral-700">
          <p className="font-medium">Why is this lead closing?</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {CLOSED_REASONS.map((r) => (
              <button key={r} type="button" className="rounded-md border border-neutral-300 px-2 py-1 dark:border-neutral-700"
                onClick={() => run(() => moveLeadAction(props.leadId, closingTo, r), () => setClosingTo(null))}>
                {r}
              </button>
            ))}
            <button type="button" className="px-2 py-1 underline" onClick={() => setClosingTo(null)}>Cancel</button>
          </div>
        </div>
      )}

      <div>
        <p className="text-sm font-medium">Rating</p>
        <div className="mt-1 flex gap-1" role="radiogroup" aria-label="Rating">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" role="radio" aria-checked={props.rating === n} aria-label={`${n} star${n > 1 ? "s" : ""}`}
              disabled={pending}
              onClick={() => run(() => setRatingAction(props.leadId, props.rating === n ? null : n))}
              className={`text-2xl leading-none ${props.rating && n <= props.rating ? "text-amber-500" : "text-neutral-300 dark:text-neutral-700"}`}>
              ★
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-sm font-medium">Tags</p>
        <ul className="mt-1 flex flex-wrap gap-1">
          {props.tags.map((t) => (
            <li key={t} className="flex items-center gap-1 rounded border border-neutral-300 px-1.5 py-0.5 text-xs dark:border-neutral-700">
              {t}
              <button type="button" aria-label={`Remove tag ${t}`} disabled={pending}
                onClick={() => run(() => setTagsAction(props.leadId, props.tags.filter((x) => x !== t)))}>×</button>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex gap-2">
          <input value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} placeholder="Add a tag" aria-label="New tag" maxLength={40}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }} className={input} />
          <button type="button" onClick={addTag} disabled={pending || !tagDraft.trim()} className={button}>Add</button>
        </div>
      </div>

      <label className="block text-sm font-medium">
        Assigned to
        <select value={props.assigneeId ?? ""} disabled={pending}
          onChange={(e) => run(() => assignLeadAction(props.leadId, e.target.value || null))} className={`${input} mt-1`}>
          <option value="">Nobody</option>
          {props.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </label>
      <ErrorText error={error} />
    </section>
  );
}

type ContactFields = { firstName: string; lastName: string; email: string; phone: string; city: string; state: string };

export function ContactCard(props: {
  leadId: string; contactId: string; contact: ContactFields; smsConsent: string | null; unsubscribed: boolean; doNotContact: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(props.contact);
  const { pending, error, run } = useAction();
  const c = props.contact;

  if (!editing) {
    return (
      <section className="rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Contact</h2>
          <button type="button" className="text-sm underline" onClick={() => { setDraft(c); setEditing(true); }}>Edit</button>
        </div>
        <dl className="mt-2 space-y-1">
          {c.email && <div><dt className="sr-only">Email</dt><dd><a href={`mailto:${c.email}`} className="hover:underline">{c.email}</a></dd></div>}
          {c.phone && <div><dt className="sr-only">Phone</dt><dd><a href={`tel:${c.phone}`} className="hover:underline">{c.phone}</a></dd></div>}
          {(c.city || c.state) && <div><dt className="sr-only">Location</dt><dd>{[c.city, c.state].filter(Boolean).join(", ")}</dd></div>}
        </dl>
        <ul className="mt-2 space-y-0.5 text-xs text-neutral-500">
          <li>SMS: {props.smsConsent ? `consented ${new Date(props.smsConsent).toLocaleDateString()}` : "no consent"}</li>
          {props.unsubscribed && <li>Unsubscribed from email</li>}
          {props.doNotContact && <li className="text-red-600">Do not contact</li>}
        </ul>
      </section>
    );
  }

  const field = (key: keyof ContactFields, label: string, type = "text") => (
    <label className="block text-xs">
      {label}
      <input type={type} value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} className={`${input} mt-0.5`} />
    </label>
  );

  return (
    <form className="space-y-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-800"
      onSubmit={(e) => { e.preventDefault(); run(() => updateContactAction(props.leadId, props.contactId, draft), () => setEditing(false)); }}>
      <div className="grid grid-cols-2 gap-2">{field("firstName", "First name")}{field("lastName", "Last name")}</div>
      {field("email", "Email", "email")}
      {field("phone", "Phone", "tel")}
      <div className="grid grid-cols-2 gap-2">{field("city", "City")}{field("state", "State")}</div>
      <ErrorText error={error} />
      <div className="flex gap-2">
        <button disabled={pending} className={button}>Save</button>
        <button type="button" onClick={() => setEditing(false)} className="px-2 text-sm underline">Cancel</button>
      </div>
    </form>
  );
}

export function Composer({ leadId }: { leadId: string }) {
  const [mode, setMode] = useState<"note" | "call" | "text" | "dm" | "in_person">("note");
  const [text, setText] = useState("");
  const { pending, error, run } = useAction();
  const modes = [["note", "Note"], ["call", "Log call"], ["text", "Log text"], ["dm", "Log DM"], ["in_person", "Met in person"]] as const;

  return (
    <section>
      <div className="flex flex-wrap gap-1 text-sm" role="tablist">
        {modes.map(([value, label]) => (
          <button key={value} type="button" role="tab" aria-selected={mode === value} onClick={() => setMode(value)}
            className={`rounded-md px-2 py-1 ${mode === value ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900" : "border border-neutral-300 dark:border-neutral-700"}`}>
            {label}
          </button>
        ))}
      </div>
      <form className="mt-2" onSubmit={(e) => {
        e.preventDefault();
        run(() => (mode === "note" ? addNoteAction(leadId, text) : logContactAction(leadId, mode, text)), () => setText(""));
      }}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={5000}
          aria-label={mode === "note" ? "Note" : "What happened (optional)"}
          placeholder={mode === "note" ? "Add a note" : "What happened? (optional)"} className={input} />
        <ErrorText error={error} />
        <button disabled={pending || (mode === "note" && !text.trim())} className={`${button} mt-2`}>
          {mode === "note" ? "Save note" : "Log it"}
        </button>
        <p className="mt-1 text-xs text-neutral-500">Email and SMS sending arrive with messaging in week 4.</p>
      </form>
    </section>
  );
}

export function TaskList({ leadId, tasks }: { leadId: string; tasks: TimelineItem[] }) {
  const [title, setTitle] = useState("");
  const [due, setDue] = useState(() => new Date(Date.now() + 86_400_000).toLocaleDateString("en-CA"));
  const { pending, error, run } = useAction();
  const open = tasks.filter((t) => !t.done_at);
  const done = tasks.filter((t) => t.done_at);
  const now = Date.now();

  return (
    <section>
      <h2 className="text-sm font-semibold">Tasks</h2>
      <ul className="mt-2 space-y-1 text-sm">
        {[...open, ...done].map((t) => {
          const overdue = !t.done_at && t.due_at && new Date(t.due_at).getTime() < now;
          return (
            <li key={t.id} className="flex items-center gap-2">
              <input type="checkbox" checked={Boolean(t.done_at)} disabled={pending} aria-label={`Done: ${String(t.payload.title)}`}
                onChange={(e) => run(() => setTaskDoneAction(leadId, t.id, e.target.checked))} />
              <span className={t.done_at ? "text-neutral-400 line-through" : ""}>{String(t.payload.title)}</span>
              <span className={`ml-auto text-xs ${overdue ? "font-medium text-red-600" : "text-neutral-500"}`}>
                {t.due_at && new Date(t.due_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </span>
            </li>
          );
        })}
        {tasks.length === 0 && <li className="text-neutral-500">No tasks.</li>}
      </ul>
      <form className="mt-2 flex flex-wrap gap-2" onSubmit={(e) => {
        e.preventDefault();
        run(() => addTaskAction(leadId, title, due), () => setTitle(""));
      }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Call back, send photos, schedule visit…"
          aria-label="Task" maxLength={200} className={`${input} min-w-0 flex-1`} />
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" className={`${input} w-auto`} />
        <button disabled={pending || !title.trim()} className={button}>Add task</button>
      </form>
      <ErrorText error={error} />
    </section>
  );
}

export function MergeReviewBanner({ leadId, contactId }: { leadId: string; contactId: string }) {
  const { pending, error, run } = useAction();
  return (
    <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
      An inquiry for this person used an email and a phone number that belong to two different contacts. Check whether
      they&apos;re the same person. Merging contacts comes in a later update.
      <button type="button" disabled={pending} onClick={() => run(() => clearMergeReviewAction(leadId, contactId))} className="ml-2 underline">
        They&apos;re different people
      </button>
      <ErrorText error={error} />
    </div>
  );
}
