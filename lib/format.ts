// Date formatting for the app. Moments in time (created_at, due_at, ...) are
// shown in the workspace's time zone, never the server's: on Vercel the server
// runs in UTC, which would put a Chicago breeder's times six hours off.
// Safe in server and client components alike.

type Style = "date" | "dateYear" | "dateTime" | "dateTimeYear";

const OPTIONS: Record<Style, Intl.DateTimeFormatOptions> = {
  date: { month: "short", day: "numeric" },
  dateYear: { month: "short", day: "numeric", year: "numeric" },
  dateTime: { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
  dateTimeYear: { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" },
};

export function formatInZone(iso: string | Date, timeZone: string, style: Style = "dateTime"): string {
  return new Date(iso).toLocaleString("en-US", { ...OPTIONS[style], timeZone });
}

// A calendar date with no time (YYYY-MM-DD, e.g. a litter's birth date). It is
// the same day everywhere, so it's formatted as UTC to stay on that day.
export function formatDay(ymd: string, style: "date" | "dateYear" | "weekday" = "dateYear"): string {
  const opts: Intl.DateTimeFormatOptions =
    style === "weekday" ? { weekday: "short", month: "short", day: "numeric" } : OPTIONS[style];
  return new Date(`${ymd.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
}
