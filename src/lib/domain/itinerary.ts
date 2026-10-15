import { eachDay } from "@/lib/dates";

export type DayEvent = {
  id: string;
  date: string;
  startMinute: number | null;
  endMinute: number | null;
  kind: string;
};

/** Groups events by local date, ordering timed events first by start time. */
export function groupByDay<T extends DayEvent>(
  events: T[],
  tripStart: string | null,
  tripEnd: string | null,
) {
  const days = new Map<string, T[]>();
  if (tripStart && tripEnd) {
    for (const day of eachDay(tripStart, tripEnd)) days.set(day, []);
  }
  for (const event of events) {
    const key = event.date.slice(0, 10);
    if (!days.has(key)) days.set(key, []);
    days.get(key)!.push(event);
  }
  for (const list of days.values()) {
    list.sort(
      (a, b) => (a.startMinute ?? 24 * 60 + 1) - (b.startMinute ?? 24 * 60 + 1),
    );
  }
  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, items]) => ({
      date,
      items,
      inTrip: !tripStart || !tripEnd || (date >= tripStart && date <= tripEnd),
    }));
}

/**
 * Finds open stretches of at least `minMinutes` between 9:00 and 21:00 on a day, based only on
 * the times people entered. Untimed items are ignored because their timing is unknown.
 */
export function findGaps(
  items: DayEvent[],
  minMinutes = 180,
  dayStart = 9 * 60,
  dayEnd = 21 * 60,
) {
  const timed = items
    .filter((item) => item.startMinute !== null)
    .map((item) => ({
      start: item.startMinute!,
      end: item.endMinute ?? item.startMinute! + 60,
    }))
    .sort((a, b) => a.start - b.start);
  const gaps: { start: number; end: number }[] = [];
  let cursor = dayStart;
  for (const block of timed) {
    if (block.start - cursor >= minMinutes)
      gaps.push({ start: cursor, end: Math.min(block.start, dayEnd) });
    cursor = Math.max(cursor, block.end);
  }
  if (dayEnd - cursor >= minMinutes) gaps.push({ start: cursor, end: dayEnd });
  return gaps.filter((gap) => gap.end - gap.start >= minMinutes);
}

export function partOfDay(minute: number) {
  if (minute < 12 * 60) return "morning";
  if (minute < 17 * 60) return "afternoon";
  return "evening";
}
