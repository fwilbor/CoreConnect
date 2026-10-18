import type { BoardLead } from "@/lib/leads/queries";

const DAY = 86_400_000;

export const leadName = (l: Pick<BoardLead, "first_name" | "last_name">) =>
  [l.first_name, l.last_name].filter(Boolean).join(" ") || "Unnamed";

// Overdue task: flagged red on the board (Automations: "Task due date passes").
export const isOverdue = (l: BoardLead, now = Date.now()) =>
  l.next_task_due_at !== null && new Date(l.next_task_due_at).getTime() < now;

// Going cold: open lead untouched 3+ days (v1 goal: no qualified lead goes
// more than 3 days without a touch). A new lead counts from when it arrived.
export const isGoingCold = (l: BoardLead, now = Date.now()) =>
  l.closed_at === null && now - new Date(l.last_contacted_at ?? l.created_at).getTime() > 3 * DAY;

export function relativeDay(iso: string | null, now = Date.now()): string {
  if (!iso) return "never";
  const days = Math.floor((now - new Date(iso).getTime()) / DAY);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}
