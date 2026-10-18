"use client";

import {
  DndContext, KeyboardSensor, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import type { BoardLead, Stage } from "@/lib/leads/queries";
import { moveLeadAction } from "./actions";
import { isGoingCold, isOverdue, leadName, relativeDay } from "./lead-flags";

const CLOSED_REASONS = ["Not a fit", "No response", "Went elsewhere", "Other"];

export function Board({ stages, leads: initial }: { stages: Stage[]; leads: BoardLead[] }) {
  const [leads, setLeads] = useState(initial);
  const [closing, setClosing] = useState<{ leadId: string; stageId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  useEffect(() => setLeads(initial), [initial]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // Press and hold on phones so the board still scrolls normally.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const move = (leadId: string, stageId: string, reason?: string) => {
    const before = leads;
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.stage_id === stageId) return;
    const kind = stages.find((s) => s.id === stageId)?.kind;
    if (kind === "lost" && reason === undefined) return setClosing({ leadId, stageId });

    setError(null);
    setLeads((ls) => ls.map((l) => (l.id === leadId
      ? { ...l, stage_id: stageId, closed_at: kind === "open" ? null : (l.closed_at ?? new Date().toISOString()) }
      : l)));
    startTransition(async () => {
      const result = await moveLeadAction(leadId, stageId, reason);
      if (!result.ok) {
        setLeads(before);
        setError(result.error);
      }
    });
  };

  const onDragEnd = (e: DragEndEvent) => {
    if (e.over) move(String(e.active.id), String(e.over.id));
  };

  return (
    <>
      {error && <p className="mb-2 text-sm text-red-600" role="alert">{error}</p>}
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-4">
          {stages.map((stage) => (
            <Column key={stage.id} stage={stage} stages={stages} leads={leads.filter((l) => l.stage_id === stage.id)} onMove={move} />
          ))}
        </div>
      </DndContext>

      {closing && (
        <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="close-title">
          <form
            className="w-full max-w-sm rounded-lg bg-white p-4 dark:bg-neutral-900"
            onSubmit={(e) => {
              e.preventDefault();
              const reason = new FormData(e.currentTarget).get("reason") as string;
              move(closing.leadId, closing.stageId, reason);
              setClosing(null);
            }}
          >
            <h2 id="close-title" className="font-semibold">Why is this lead closing?</h2>
            <div className="mt-3 space-y-2 text-sm">
              {CLOSED_REASONS.map((r, i) => (
                <label key={r} className="flex items-center gap-2">
                  <input type="radio" name="reason" value={r} defaultChecked={i === 0} /> {r}
                </label>
              ))}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setClosing(null)} className="rounded-md px-3 py-2 text-sm">Cancel</button>
              <button className="rounded-md bg-neutral-900 px-3 py-2 text-sm text-white dark:bg-white dark:text-neutral-900">Close lead</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

function Column(props: { stage: Stage; stages: Stage[]; leads: BoardLead[]; onMove: (leadId: string, stageId: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: props.stage.id });
  return (
    <section
      ref={setNodeRef}
      aria-label={props.stage.name}
      className={`flex w-72 shrink-0 snap-start flex-col rounded-lg p-2 ${isOver ? "bg-neutral-200 dark:bg-neutral-800" : "bg-neutral-100 dark:bg-neutral-900"}`}
    >
      <h2 className="flex items-center justify-between px-1 pb-2 text-sm font-semibold">
        {props.stage.name}
        <span className="font-normal text-neutral-500">{props.leads.length}</span>
      </h2>
      <ul className="flex min-h-16 flex-col gap-2">
        {props.leads.map((lead) => <Card key={lead.id} lead={lead} stages={props.stages} onMove={props.onMove} />)}
      </ul>
    </section>
  );
}

function Card({ lead, stages, onMove }: { lead: BoardLead; stages: Stage[]; onMove: (leadId: string, stageId: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: lead.id });
  const overdue = isOverdue(lead);
  const cold = isGoingCold(lead);

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={`rounded-md border bg-white p-3 text-sm shadow-sm dark:bg-neutral-950 ${isDragging ? "z-10 opacity-80 shadow-lg" : ""} ${overdue ? "border-red-500" : "border-neutral-200 dark:border-neutral-800"}`}
      {...attributes}
      {...listeners}
    >
      <Link href={`/app/leads/${lead.id}`} className="font-medium hover:underline">{leadName(lead)}</Link>
      <div className="mt-1 flex flex-wrap gap-1 text-xs">
        <span className="rounded bg-neutral-100 px-1.5 py-0.5 capitalize dark:bg-neutral-800">{lead.source}</span>
        {lead.rating && <span aria-label={`Rated ${lead.rating} of 5`}>{"★".repeat(lead.rating)}</span>}
        {overdue && <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-800 dark:bg-red-950 dark:text-red-200">Task overdue</span>}
        {cold && !overdue && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-900 dark:bg-amber-950 dark:text-amber-200">Going cold</span>}
        {lead.needs_merge_review && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-900 dark:bg-amber-950 dark:text-amber-200">Duplicate?</span>}
        {lead.tags.slice(0, 2).map((t) => <span key={t} className="rounded border border-neutral-200 px-1.5 py-0.5 dark:border-neutral-700">{t}</span>)}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-neutral-500">
        <span>Contacted {relativeDay(lead.last_contacted_at)}</span>
        {/* One-handed alternative to dragging. */}
        <select
          aria-label={`Move ${leadName(lead)} to stage`}
          value={lead.stage_id}
          onChange={(e) => onMove(lead.id, e.target.value)}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          className="max-w-[8rem] rounded border border-neutral-200 bg-transparent px-1 py-0.5 dark:border-neutral-700"
        >
          {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
    </li>
  );
}
