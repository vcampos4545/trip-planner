import { describe, expect, it } from "vitest";

import {
  eachDay,
  formatTimeRange,
  isDateOnly,
  timeToMinutes,
} from "@/lib/dates";
import { findGaps, groupByDay } from "@/lib/domain/itinerary";
import { normalizeMoneyInput, splitCents, toCents } from "@/lib/money";
import { safeRedirectPath } from "@/lib/safe-redirect";

describe("dates", () => {
  it("validates real calendar dates only", () => {
    expect(isDateOnly("2027-02-28")).toBe(true);
    expect(isDateOnly("2027-02-30")).toBe(false);
    expect(isDateOnly("2027-2-3")).toBe(false);
  });

  it("lists every day of a range inclusively", () => {
    expect(eachDay("2027-05-30", "2027-06-02")).toEqual([
      "2027-05-30",
      "2027-05-31",
      "2027-06-01",
      "2027-06-02",
    ]);
    expect(eachDay("2027-06-02", "2027-05-30")).toEqual([]);
  });

  it("formats times without inventing missing ends", () => {
    expect(timeToMinutes("09:30")).toBe(570);
    expect(formatTimeRange(570, null)).toBe("9:30 AM");
    expect(formatTimeRange(null, null)).toBeNull();
    expect(formatTimeRange(780, 900)).toBe("1 PM to 3 PM");
  });
});

describe("money", () => {
  it("converts decimals to cents exactly", () => {
    expect(toCents("1234.5")).toBe(123450);
    expect(toCents("0.105")).toBe(11);
    expect(toCents(null)).toBeNull();
    expect(toCents("abc")).toBeNull();
  });

  it("normalizes common user input", () => {
    expect(normalizeMoneyInput("$1,200")).toBe("1200.00");
    expect(normalizeMoneyInput("85.5")).toBe("85.50");
    expect(normalizeMoneyInput("twelve")).toBeNull();
  });

  it("splits cents without losing any", () => {
    const parts = splitCents(1000, 3);
    expect(parts).toEqual([334, 333, 333]);
  });
});

describe("itinerary", () => {
  const events = [
    {
      id: "a",
      date: "2027-05-21T00:00:00.000Z",
      startMinute: 600,
      endMinute: 660,
      kind: "MEAL",
    },
    {
      id: "b",
      date: "2027-05-21T00:00:00.000Z",
      startMinute: null,
      endMinute: null,
      kind: "ACTIVITY",
    },
    {
      id: "c",
      date: "2027-05-21T00:00:00.000Z",
      startMinute: 480,
      endMinute: 540,
      kind: "TRANSFER",
    },
    {
      id: "d",
      date: "2027-05-25T00:00:00.000Z",
      startMinute: 600,
      endMinute: null,
      kind: "ACTIVITY",
    },
  ];

  it("groups by day, shows empty trip days, and flags days outside the trip", () => {
    const days = groupByDay(events, "2027-05-20", "2027-05-22");
    expect(days.map((day) => day.date)).toEqual([
      "2027-05-20",
      "2027-05-21",
      "2027-05-22",
      "2027-05-25",
    ]);
    expect(days[1]!.items.map((item) => item.id)).toEqual(["c", "a", "b"]);
    expect(days[3]!.inTrip).toBe(false);
  });

  it("finds open stretches between timed plans only", () => {
    expect(findGaps(events.slice(0, 3))).toEqual([{ start: 660, end: 1260 }]);
  });
});

describe("safeRedirectPath", () => {
  it("only allows same-site relative paths", () => {
    expect(safeRedirectPath("/trips/abc")).toBe("/trips/abc");
    expect(safeRedirectPath("https://evil.example")).toBe("/trips");
    expect(safeRedirectPath("//evil.example")).toBe("/trips");
    expect(safeRedirectPath("/\\evil.example")).toBe("/trips");
    expect(safeRedirectPath(undefined)).toBe("/trips");
  });
});
