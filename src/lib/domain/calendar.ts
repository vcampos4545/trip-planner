import { addDays, daysBetween, eachDay } from "@/lib/dates";

/**
 * The itinerary's calendar view puts itinerary items and bookings on one grid: days as columns,
 * hours as rows, and an all-day lane for stays and untimed items. Everything here is pure so the
 * layout is the same on the server, in the browser, and in tests. Times are local to the place,
 * as everywhere else in the app.
 */

export type TravelerStatus = "BOOKED" | "CONSIDERING";

export type CalendarTraveler = { name: string; status: TravelerStatus };

export type CalendarItemKind =
  "flight" | "ground" | "stay" | "activity" | "meal" | "free" | "other";

/** "mixed" is a booking where some travelers booked and others are still considering. */
export type CalendarItemStatus =
  "suggested" | "planned" | "confirmed" | "booked" | "considering" | "mixed";

export type CalendarItem = {
  id: string;
  source: "event" | "booking";
  sourceId: string;
  kind: CalendarItemKind;
  title: string;
  detail: string | null;
  status: CalendarItemStatus;
  /** Inclusive local dates (YYYY-MM-DD). */
  startDate: string;
  endDate: string;
  startMinute: number | null;
  endMinute: number | null;
  allDay: boolean;
  travelers: CalendarTraveler[];
};

export type CalendarEventInput = {
  id: string;
  title: string;
  kind: string;
  status: string;
  date: string;
  startMinute: number | null;
  endMinute: number | null;
  locationName: string | null;
  booking: { id: string } | null;
};

export type CalendarBookingInput = {
  id: string;
  title: string;
  category: string;
  status: string;
  provider: string | null;
  startDate: string | null;
  startMinute: number | null;
  endDate: string | null;
  endMinute: number | null;
  fromLocation: string | null;
  toLocation: string | null;
  locationName: string | null;
  participants: { status: TravelerStatus; name: string }[];
};

const DEFAULT_LENGTH = 60;
const DAY = 24 * 60;

const EVENT_KINDS: Record<string, CalendarItemKind> = {
  ACTIVITY: "activity",
  MEAL: "meal",
  TRANSFER: "ground",
  FLIGHT: "flight",
  LODGING: "stay",
  FREE_TIME: "free",
  OTHER: "other",
};

const BOOKING_KINDS: Record<string, CalendarItemKind> = {
  FLIGHT: "flight",
  GROUND_TRANSPORT: "ground",
  ACCOMMODATION: "stay",
  ACTIVITY: "activity",
  OTHER: "other",
};

/** A booking's status as the calendar shows it, from each traveler's own status. */
export function bookingCalendarStatus(
  bookingStatus: string,
  travelers: CalendarTraveler[],
): CalendarItemStatus {
  if (travelers.length === 0)
    return bookingStatus === "BOOKED" || bookingStatus === "CONFIRMED"
      ? "booked"
      : "considering";
  const booked = travelers.filter((traveler) => traveler.status === "BOOKED");
  if (booked.length === travelers.length) return "booked";
  return booked.length === 0 ? "considering" : "mixed";
}

function route(from: string | null, to: string | null) {
  if (!from && !to) return null;
  return `${from ?? "?"} → ${to ?? "?"}`;
}

function shortDay(value: string) {
  return value.slice(0, 10);
}

/**
 * Builds calendar items from itinerary events and bookings. Cancelled records and bookings without
 * a date are left out. An event linked to a booking that is already on the calendar is shown once.
 */
export function calendarItemsFrom(params: {
  events: CalendarEventInput[];
  bookings: CalendarBookingInput[];
}): CalendarItem[] {
  const items: CalendarItem[] = [];
  const shownBookings = new Set<string>();

  for (const booking of params.bookings) {
    if (booking.status === "CANCELLED" || !booking.startDate) continue;
    const kind = BOOKING_KINDS[booking.category] ?? "other";
    const startDate = shortDay(booking.startDate);
    const endDate = shortDay(booking.endDate ?? booking.startDate);
    const travelers = booking.participants.map((participant) => ({
      name: participant.name,
      status: participant.status,
    }));
    const allDay = kind === "stay" || booking.startMinute === null;
    shownBookings.add(booking.id);
    items.push({
      id: `booking:${booking.id}`,
      source: "booking",
      sourceId: booking.id,
      kind,
      title: booking.title,
      detail:
        kind === "stay"
          ? booking.locationName
          : (route(booking.fromLocation, booking.toLocation) ??
            booking.locationName ??
            booking.provider),
      status: bookingCalendarStatus(booking.status, travelers),
      startDate,
      endDate: endDate < startDate ? startDate : endDate,
      startMinute: allDay ? null : booking.startMinute,
      endMinute: allDay ? null : booking.endMinute,
      allDay,
      travelers,
    });
  }

  for (const event of params.events) {
    if (event.status === "CANCELLED") continue;
    if (event.booking && shownBookings.has(event.booking.id)) continue;
    const date = shortDay(event.date);
    const allDay = event.startMinute === null;
    items.push({
      id: `event:${event.id}`,
      source: "event",
      sourceId: event.id,
      kind: EVENT_KINDS[event.kind] ?? "other",
      title: event.title,
      detail: event.locationName,
      status:
        event.status === "SUGGESTED"
          ? "suggested"
          : event.status === "CONFIRMED"
            ? "confirmed"
            : "planned",
      startDate: date,
      endDate: date,
      startMinute: event.startMinute,
      endMinute: allDay ? null : event.endMinute,
      allDay,
      travelers: [],
    });
  }
  return items;
}

/** The days the calendar can show: the trip dates, stretched to include every item. */
export function calendarRange(
  items: CalendarItem[],
  tripStart: string | null,
  tripEnd: string | null,
): { start: string; end: string } | null {
  let start = tripStart;
  let end = tripEnd ?? tripStart;
  for (const item of items) {
    if (!start || item.startDate < start) start = item.startDate;
    if (!end || item.endDate > end) end = item.endDate;
  }
  if (!start || !end) return null;
  return { start, end: end < start ? start : end };
}

/** The first day of the page that contains `date`, for pages of `size` days counted from `start`. */
export function pageStart(start: string, date: string, size: number) {
  const offset = Math.max(daysBetween(start, date), 0);
  return addDays(start, Math.floor(offset / size) * size);
}

export function visibleDays(first: string, size: number) {
  return eachDay(first, addDays(first, size - 1), size);
}

export type DaySegment = {
  item: CalendarItem;
  /** Minutes after midnight on this day. */
  start: number;
  end: number;
  /** True when the item started on an earlier day or ends on a later one. */
  continuesBefore: boolean;
  continuesAfter: boolean;
};

/** Timed items on one day, cut at midnight so an overnight flight shows on both days. */
export function timedSegmentsOn(
  items: CalendarItem[],
  date: string,
): DaySegment[] {
  const segments: DaySegment[] = [];
  for (const item of items) {
    if (item.allDay || item.startMinute === null) continue;
    if (date < item.startDate || date > item.endDate) continue;
    const startsToday = date === item.startDate;
    const endsToday = date === item.endDate;
    const start = startsToday ? item.startMinute : 0;
    let end: number;
    if (!endsToday) end = DAY;
    else if (
      item.endMinute !== null &&
      (!startsToday || item.endMinute > start)
    )
      end = item.endMinute;
    else end = Math.min(start + DEFAULT_LENGTH, DAY);
    if (end - start < 15) end = Math.min(start + 15, DAY);
    segments.push({
      item,
      start,
      end,
      continuesBefore: !startsToday,
      continuesAfter: !endsToday,
    });
  }
  return segments.sort((a, b) => a.start - b.start || b.end - a.end);
}

export type PlacedSegment = DaySegment & { column: number; columns: number };

/**
 * Places overlapping segments side by side, like a calendar app: each group of overlapping items
 * shares the day's width, and each item takes the first free column.
 */
export function layoutSegments(segments: DaySegment[]): PlacedSegment[] {
  const sorted = [...segments].sort(
    (a, b) => a.start - b.start || b.end - a.end,
  );
  const placed: PlacedSegment[] = [];
  let group: PlacedSegment[] = [];
  let groupEnd = -1;
  let columnEnds: number[] = [];

  const closeGroup = () => {
    const columns = Math.max(columnEnds.length, 1);
    for (const segment of group) segment.columns = columns;
    placed.push(...group);
    group = [];
    columnEnds = [];
  };

  for (const segment of sorted) {
    if (group.length > 0 && segment.start >= groupEnd) closeGroup();
    let column = columnEnds.findIndex((end) => end <= segment.start);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(segment.end);
    } else {
      columnEnds[column] = segment.end;
    }
    group.push({ ...segment, column, columns: 1 });
    groupEnd = Math.max(groupEnd, segment.end);
  }
  if (group.length > 0) closeGroup();
  return placed;
}

export type AllDayPlacement = {
  item: CalendarItem;
  /** Zero-based index of the first visible day the item covers. */
  startIndex: number;
  span: number;
  row: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
};

/** Lays out all-day items as bars across the visible days, stacking overlaps in rows. */
export function layoutAllDay(
  items: CalendarItem[],
  days: string[],
): AllDayPlacement[] {
  if (days.length === 0) return [];
  const first = days[0]!;
  const last = days[days.length - 1]!;
  const visible = items
    .filter(
      (item) => item.allDay && item.endDate >= first && item.startDate <= last,
    )
    .sort(
      (a, b) =>
        a.startDate.localeCompare(b.startDate) ||
        b.endDate.localeCompare(a.endDate),
    );
  const rows: number[] = [];
  return visible.map((item) => {
    const startIndex = Math.max(daysBetween(first, item.startDate), 0);
    const endIndex = Math.min(
      daysBetween(first, item.endDate),
      days.length - 1,
    );
    let row = rows.findIndex((end) => end < startIndex);
    if (row === -1) {
      row = rows.length;
      rows.push(endIndex);
    } else {
      rows[row] = endIndex;
    }
    return {
      item,
      startIndex,
      span: endIndex - startIndex + 1,
      row,
      continuesBefore: item.startDate < first,
      continuesAfter: item.endDate > last,
    };
  });
}

export type TravelerFlight = {
  item: CalendarItem;
  status: TravelerStatus;
};

/**
 * Each traveler's flights in time order, so everyone's arrival and departure can be read at a
 * glance. Flights nobody is on are left out.
 */
export function flightsByTraveler(items: CalendarItem[]) {
  const flights = items
    .filter((item) => item.kind === "flight")
    .sort(
      (a, b) =>
        a.startDate.localeCompare(b.startDate) ||
        (a.startMinute ?? 0) - (b.startMinute ?? 0),
    );
  const byName = new Map<string, TravelerFlight[]>();
  for (const item of flights) {
    for (const traveler of item.travelers) {
      if (!byName.has(traveler.name)) byName.set(traveler.name, []);
      byName.get(traveler.name)!.push({ item, status: traveler.status });
    }
  }
  return [...byName.entries()]
    .map(([name, list]) => ({ name, flights: list }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
