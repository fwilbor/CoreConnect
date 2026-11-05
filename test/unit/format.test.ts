import { describe, expect, it } from "vitest";
import { formatDay, formatInZone } from "@/lib/format";

describe("formatInZone", () => {
  // 02:30 UTC on Nov 6 is still the evening of Nov 5 in Chicago.
  const iso = "2026-11-06T02:30:00Z";

  it("shows a moment in the workspace's zone, not the server's", () => {
    expect(formatInZone(iso, "America/Chicago")).toBe("Nov 5, 8:30 PM");
    expect(formatInZone(iso, "America/Los_Angeles", "date")).toBe("Nov 5");
    expect(formatInZone(iso, "UTC", "dateYear")).toBe("Nov 6, 2026");
  });
});

describe("formatDay", () => {
  it("keeps a calendar date on its day in every zone", () => {
    expect(formatDay("2027-03-01")).toBe("Mar 1, 2027");
    expect(formatDay("2027-03-01T00:00:00", "weekday")).toBe("Mon, Mar 1");
  });
});
