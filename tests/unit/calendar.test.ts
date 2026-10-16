import { describe, expect, it } from "vitest";

import {
  bookingCalendarStatus,
  calendarItemsFrom,
  calendarRange,
  flightsByTraveler,
  layoutAllDay,
  layoutSegments,
  pageStart,
  timedSegmentsOn,
  visibleDays,
  type CalendarBookingInput,
  type CalendarEventInput,
} from "@/lib/domain/calendar";

function booking(
  overrides: Partial<CalendarBookingInput> & { id: string },
): CalendarBookingInput {
  return {
    title: overrides.id,
    category: "FLIGHT",
    status: "BOOKED",
    provider: null,
    startDate: "2027-02-27",
    startMinute: 6 * 60,
    endDate: "2027-02-27",
    endMinute: 9 * 60 + 45,
    fromLocation: "LGA",
    toLocation: "SLC",
    locationName: null,
    participants: [{ name: "Vaughn", status: "BOOKED" }],
    ...overrides,
  };
}

function event(
  overrides: Partial<CalendarEventInput> & { id: string },
): CalendarEventInput {
  return {
    title: overrides.id,
    kind: "ACTIVITY",
    status: "PLANNED",
    date: "2027-02-28",
    startMinute: 10 * 60,
    endMinute: 12 * 60,
    locationName: null,
    booking: null,
    ...overrides,
  };
}

describe("calendarItemsFrom", () => {
  it("turns bookings and events into calendar items with travelers", () => {
    const items = calendarItemsFrom({
      bookings: [
        booking({ id: "wn" }),
        booking({
          id: "stay",
          category: "ACCOMMODATION",
          startDate: "2027-02-27",
          endDate: "2027-03-02",
          startMinute: null,
          endMinute: null,
          locationName: "Teton Village",
        }),
        booking({ id: "cancelled", status: "CANCELLED" }),
        booking({ id: "undated", startDate: null }),
      ],
      events: [
        event({ id: "idea", status: "SUGGESTED" }),
        event({ id: "lunch", kind: "MEAL", startMinute: null }),
        event({ id: "linked", booking: { id: "wn" } }),
        event({ id: "gone", status: "CANCELLED" }),
      ],
    });
    expect(
      items.map((item) => [item.id, item.kind, item.status, item.allDay]),
    ).toEqual([
      ["booking:wn", "flight", "booked", false],
      ["booking:stay", "stay", "booked", true],
      ["event:idea", "activity", "suggested", false],
      ["event:lunch", "meal", "planned", true],
    ]);
    expect(items[0]).toMatchObject({
      detail: "LGA → SLC",
      travelers: [{ name: "Vaughn", status: "BOOKED" }],
    });
    expect(items[1]).toMatchObject({
      endDate: "2027-03-02",
      detail: "Teton Village",
    });
  });

  it("labels each booking from its travelers' own status", () => {
    const traveler = (status: "BOOKED" | "CONSIDERING") => ({
      name: "A",
      status,
    });
    expect(bookingCalendarStatus("PLANNED", [traveler("CONSIDERING")])).toBe(
      "considering",
    );
    expect(bookingCalendarStatus("BOOKED", [traveler("BOOKED")])).toBe(
      "booked",
    );
    expect(
      bookingCalendarStatus("PLANNED", [
        traveler("BOOKED"),
        traveler("CONSIDERING"),
      ]),
    ).toBe("mixed");
    expect(bookingCalendarStatus("PLANNED", [])).toBe("considering");
    expect(bookingCalendarStatus("CONFIRMED", [])).toBe("booked");
  });
});

describe("timed layout", () => {
  it("cuts an overnight flight at midnight so it shows on both days", () => {
    const [redEye] = calendarItemsFrom({
      bookings: [
        booking({
          id: "red-eye",
          startDate: "2027-03-07",
          startMinute: 22 * 60,
          endDate: "2027-03-08",
          endMinute: 6 * 60,
        }),
      ],
      events: [],
    });
    expect(timedSegmentsOn([redEye!], "2027-03-07")).toEqual([
      expect.objectContaining({ start: 1320, end: 1440, continuesAfter: true }),
    ]);
    expect(timedSegmentsOn([redEye!], "2027-03-08")).toEqual([
      expect.objectContaining({ start: 0, end: 360, continuesBefore: true }),
    ]);
  });

  it("gives items without an end time an hour", () => {
    const items = calendarItemsFrom({
      bookings: [],
      events: [event({ id: "dinner", startMinute: 19 * 60, endMinute: null })],
    });
    expect(timedSegmentsOn(items, "2027-02-28")[0]).toMatchObject({
      start: 1140,
      end: 1200,
    });
  });

  it("puts overlapping items side by side", () => {
    const items = calendarItemsFrom({
      bookings: [],
      events: [
        event({ id: "a", startMinute: 600, endMinute: 720 }),
        event({ id: "b", startMinute: 660, endMinute: 690 }),
        event({ id: "c", startMinute: 700, endMinute: 780 }),
        event({ id: "d", startMinute: 900, endMinute: 960 }),
      ],
    });
    const placed = layoutSegments(timedSegmentsOn(items, "2027-02-28"));
    const byId = Object.fromEntries(
      placed.map((segment) => [
        segment.item.sourceId,
        [segment.column, segment.columns],
      ]),
    );
    expect(byId).toEqual({ a: [0, 2], b: [1, 2], c: [1, 2], d: [0, 1] });
  });
});

describe("all-day layout and paging", () => {
  const days = visibleDays("2027-02-27", 7);

  it("shows the visible days of a page", () => {
    expect(days).toEqual([
      "2027-02-27",
      "2027-02-28",
      "2027-03-01",
      "2027-03-02",
      "2027-03-03",
      "2027-03-04",
      "2027-03-05",
    ]);
    expect(pageStart("2027-02-27", "2027-03-06", 7)).toBe("2027-03-06");
    expect(pageStart("2027-02-27", "2027-03-01", 3)).toBe("2027-02-27");
    expect(pageStart("2027-02-27", "2027-03-02", 3)).toBe("2027-03-02");
  });

  it("spans stays across days and stacks overlaps", () => {
    const items = calendarItemsFrom({
      bookings: [
        booking({
          id: "jackson",
          category: "ACCOMMODATION",
          startDate: "2027-02-27",
          endDate: "2027-03-02",
          startMinute: null,
          endMinute: null,
        }),
        booking({
          id: "park-city",
          category: "ACCOMMODATION",
          startDate: "2027-03-02",
          endDate: "2027-03-07",
          startMinute: null,
          endMinute: null,
        }),
      ],
      events: [],
    });
    expect(
      layoutAllDay(items, days).map((placement) => [
        placement.item.sourceId,
        placement.startIndex,
        placement.span,
        placement.row,
        placement.continuesAfter,
      ]),
    ).toEqual([
      ["jackson", 0, 4, 0, false],
      ["park-city", 3, 4, 1, true],
    ]);
  });

  it("stretches the range to every item", () => {
    const items = calendarItemsFrom({
      bookings: [
        booking({
          id: "early",
          startDate: "2027-02-26",
          endDate: "2027-02-26",
        }),
      ],
      events: [],
    });
    expect(calendarRange(items, "2027-02-27", "2027-03-07")).toEqual({
      start: "2027-02-26",
      end: "2027-03-07",
    });
    expect(calendarRange([], null, null)).toBeNull();
  });
});

describe("flightsByTraveler", () => {
  it("lists each traveler's flights in time order with their own status", () => {
    const items = calendarItemsFrom({
      bookings: [
        booking({
          id: "home",
          startDate: "2027-03-07",
          participants: [
            { name: "Vaughn", status: "BOOKED" },
            { name: "Sam", status: "CONSIDERING" },
          ],
        }),
        booking({ id: "out" }),
        booking({ id: "ride", category: "GROUND_TRANSPORT" }),
      ],
      events: [],
    });
    expect(
      flightsByTraveler(items).map((traveler) => [
        traveler.name,
        traveler.flights.map(
          (flight) => `${flight.item.sourceId}:${flight.status}`,
        ),
      ]),
    ).toEqual([
      ["Sam", ["home:CONSIDERING"]],
      ["Vaughn", ["out:BOOKED", "home:BOOKED"]],
    ]);
  });
});
