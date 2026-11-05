import { GOING_COLD_DAYS } from "@/lib/going-cold";
import type { BoardLead } from "@/lib/leads/queries";

const DAY = 86_400_000;

export const leadName = (l: Pick<BoardLead, "first_name" | "last_name">) =>
  [l.first_name, l.last_name].filter(Boolean).join(" ") || "Unnamed";

// Overdue task: flagged red on the board (Automations: "Task due date passes").
export const isOverdue = (l: BoardLead, now = Date.now()) =>
  l.next_task_due_at !== null && new Date(l.next_task_due_at).getTime() < now;

// Going cold: open lead untouched for GOING_COLD_DAYS. Uses the same "last
// touch" as Today and the digest (any activity, logged contact, manual
// message or reply), so the board flag and the Today list always agree.
export const isGoingCold = (l: Pick<BoardLead, "closed_at" | "last_touch_at">, now = Date.now()) =>
  l.closed_at === null && now - new Date(l.last_touch_at).getTime() > GOING_COLD_DAYS * DAY;

export function relativeDay(iso: string | null, now = Date.now()): string {
  if (!iso) return "never";
  const days = Math.floor((now - new Date(iso).getTime()) / DAY);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}
