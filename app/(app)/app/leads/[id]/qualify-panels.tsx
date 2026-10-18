"use client";

import { useState, useTransition } from "react";
import type { PaymentRow } from "@/lib/payments";
import {
  addToWaitlistAction, approveAction, declineAction, recordPaymentAction, removeFromWaitlistAction,
  sendApplicationLinkAction, type QualifyResult,
} from "./qualify-actions";

const input = "w-full rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700";
const button = "rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900";
const outline = "rounded-md border border-neutral-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-neutral-700";

function useRun() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const run = (fn: () => Promise<QualifyResult>, onOk?: () => void) =>
    start(async () => {
      setError(null);
      setNote(null);
      const r = await fn();
      if (!r.ok) return setError(r.error);
      setNote(r.note ?? null);
      onOk?.();
    });
  const messages = (
    <>
      {error && <p className="mt-2 text-sm text-red-600" role="alert">{error}</p>}
      {note && <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300" role="status">{note}</p>}
    </>
  );
  return { pending, run, messages };
}

type Litter = { id: string; name: string; is_general: boolean };

function WaitlistPicker(props: { litters: Litter[]; value: string; onChange: (v: string) => void; allowNone?: boolean }) {
  return (
    <select value={props.value} onChange={(e) => props.onChange(e.target.value)} aria-label="Waitlist" className={input}>
      {props.allowNone && <option value="">Don&apos;t add to a waitlist yet</option>}
      {props.litters.map((l) => <option key={l.id} value={l.is_general ? "general" : l.id}>{l.name}</option>)}
    </select>
  );
}

// FR-16: one-click Approve, Decline or Ask once an application is in.
export function ApplicationPanel(props: {
  leadId: string; status: "not_sent" | "sent" | "submitted"; closed: boolean; litters: Litter[]; depositsReady: boolean;
}) {
  const { pending, run, messages } = useRun();
  const [approving, setApproving] = useState(false);
  const [waitlist, setWaitlist] = useState("general");
  const [sexPref, setSexPref] = useState("");
  const [colorPref, setColorPref] = useState("");

  return (
    <section className="rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
      <h2 className="font-semibold">Application</h2>
      <p className="mt-1 text-neutral-500">
        {props.status === "submitted" ? "Submitted. Answers are under Form answers." : props.status === "sent" ? "Link sent, waiting for it." : "Not sent yet."}
      </p>
      {!props.closed && (
        <div className="mt-2 flex flex-wrap gap-2">
          {props.status !== "submitted" && (
            <button type="button" disabled={pending} onClick={() => run(() => sendApplicationLinkAction(props.leadId))} className={outline}>
              {props.status === "sent" ? "Resend application link" : "Send application link"}
            </button>
          )}
          <button type="button" disabled={pending} onClick={() => setApproving((v) => !v)} className={button}>Approve</button>
          <button type="button" disabled={pending}
            onClick={() => { if (confirm("Decline and close this lead? They'll get your polite decline email.")) run(() => declineAction(props.leadId, true)); }}
            className={outline}>Decline</button>
          <a href="#composer" className={outline}>Ask a question</a>
        </div>
      )}
      {approving && (
        <form className="mt-3 space-y-2 rounded-md bg-neutral-50 p-3 dark:bg-neutral-900" onSubmit={(e) => {
          e.preventDefault();
          run(() => approveAction({ leadId: props.leadId, waitlist: waitlist || null, sexPref, colorPref, sendEmail: true }), () => setApproving(false));
        }}>
          <WaitlistPicker litters={props.litters} value={waitlist} onChange={setWaitlist} allowNone />
          {waitlist && (
            <div className="grid grid-cols-2 gap-2">
              <input value={sexPref} onChange={(e) => setSexPref(e.target.value)} placeholder="Sex preference" aria-label="Sex preference" maxLength={40} className={input} />
              <input value={colorPref} onChange={(e) => setColorPref(e.target.value)} placeholder="Color preference" aria-label="Color preference" maxLength={80} className={input} />
            </div>
          )}
          <p className="text-xs text-neutral-500">
            {props.depositsReady
              ? "They'll get your approval email with the deposit link, and reminders until it's paid."
              : "Deposits aren't set up yet, so no approval email will be sent. Set a deposit amount and connect Stripe in Settings."}
          </p>
          <button disabled={pending} className={button}>Approve</button>
        </form>
      )}
      {messages}
    </section>
  );
}

export function WaitlistPanel(props: {
  leadId: string; closed: boolean; litters: Litter[];
  entry: { id: string; position: number; litter_name: string; sex_pref: string | null; color_pref: string | null } | null;
}) {
  const { pending, run, messages } = useRun();
  const [litter, setLitter] = useState("general");
  const [sexPref, setSexPref] = useState("");
  const [colorPref, setColorPref] = useState("");
  const e = props.entry;

  return (
    <section className="rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
      <h2 className="font-semibold">Waitlist</h2>
      {e ? (
        <>
          <p className="mt-1"><span className="text-2xl font-semibold tabular-nums">#{e.position}</span> on {e.litter_name}</p>
          {(e.sex_pref || e.color_pref) && <p className="text-neutral-500">{[e.sex_pref, e.color_pref].filter(Boolean).join(", ")}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" disabled={pending} className={outline} onClick={() => {
              const reason = prompt("Matched with which puppy or slot?");
              if (reason !== null) run(() => removeFromWaitlistAction(props.leadId, e.id, "matched", reason));
            }}>Mark matched</button>
            <button type="button" disabled={pending} className={outline} onClick={() => {
              const reason = prompt("Why are they leaving the list?");
              if (reason) run(() => removeFromWaitlistAction(props.leadId, e.id, "released", reason));
            }}>Remove from list</button>
          </div>
        </>
      ) : props.closed ? (
        <p className="mt-1 text-neutral-500">Not on a waitlist.</p>
      ) : (
        <form className="mt-2 space-y-2" onSubmit={(ev) => { ev.preventDefault(); run(() => addToWaitlistAction(props.leadId, litter === "general" ? null : litter, sexPref, colorPref)); }}>
          <WaitlistPicker litters={props.litters} value={litter} onChange={setLitter} />
          <div className="grid grid-cols-2 gap-2">
            <input value={sexPref} onChange={(ev) => setSexPref(ev.target.value)} placeholder="Sex preference" aria-label="Sex preference" maxLength={40} className={input} />
            <input value={colorPref} onChange={(ev) => setColorPref(ev.target.value)} placeholder="Color preference" aria-label="Color preference" maxLength={80} className={input} />
          </div>
          <button disabled={pending} className={button}>Add to waitlist</button>
        </form>
      )}
      {messages}
    </section>
  );
}

const money = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

export function PaymentsPanel({ leadId, payments }: { leadId: string; payments: PaymentRow[] }) {
  const { pending, run, messages } = useRun();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ kind: "deposit", method: "zelle", amount: "", paidOn: new Date().toLocaleDateString("en-CA"), note: "" });

  return (
    <section className="rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Payments</h2>
        <button type="button" onClick={() => setOpen((v) => !v)} className="underline">Record payment</button>
      </div>
      <ul className="mt-2 space-y-1">
        {payments.map((p) => (
          <li key={p.id} className="flex justify-between gap-2">
            <span><span className="capitalize">{p.kind}</span> · {p.method}{p.note ? ` · ${p.note}` : ""}</span>
            <span className={p.status === "paid" ? "" : "text-neutral-500"}>{money(p.amount_cents)} {p.status !== "paid" && `(${p.status})`}</span>
          </li>
        ))}
        {payments.length === 0 && <li className="text-neutral-500">No payments yet.</li>}
      </ul>
      {open && (
        <form className="mt-3 space-y-2 rounded-md bg-neutral-50 p-3 dark:bg-neutral-900" onSubmit={(e) => {
          e.preventDefault();
          run(() => recordPaymentAction({ leadId, ...form } as Parameters<typeof recordPaymentAction>[0]), () => { setOpen(false); setForm({ ...form, amount: "", note: "" }); });
        }}>
          <div className="grid grid-cols-2 gap-2">
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} aria-label="For" className={input}>
              <option value="deposit">Deposit</option><option value="balance">Balance</option><option value="other">Other</option>
            </select>
            <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} aria-label="Method" className={input}>
              <option value="zelle">Zelle</option><option value="cash">Cash</option><option value="other">Other</option>
            </select>
            <input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="Amount ($)" aria-label="Amount" inputMode="decimal" required className={input} />
            <input type="date" value={form.paidOn} onChange={(e) => setForm({ ...form, paidOn: e.target.value })} aria-label="Paid on" required className={input} />
          </div>
          <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Note (Zelle reference, who paid)" aria-label="Note" maxLength={500} className={input} />
          <button disabled={pending} className={button}>Save payment</button>
        </form>
      )}
      {messages}
    </section>
  );
}
