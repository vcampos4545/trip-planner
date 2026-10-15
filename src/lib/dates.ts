/**
 * Date-only helpers. Trip dates, itinerary days, and booking dates are calendar dates in the
 * destination's local time, stored as UTC midnight. Formatting always uses UTC so a date never
 * shifts by a day in the viewer's time zone.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isDateOnly(value: string): boolean {
  if (!DATE_ONLY.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export function parseDateOnly(value: string): Date {
  if (!isDateOnly(value)) throw new Error(`Invalid date: ${value}`);
  return new Date(`${value}T00:00:00.000Z`);
}

/** Accepts a Date or an ISO string (as produced by JSON serialization) and returns YYYY-MM-DD. */
export function toDateOnly(value: Date | string): string {
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function asDate(value: Date | string): Date {
  return typeof value === "string" ? parseDateOnly(value.slice(0, 10)) : value;
}

const formatters = {
  short: new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }),
  medium: new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }),
  weekday: new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }),
  long: new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }),
};

export type DateStyle = keyof typeof formatters;

export function formatDateOnly(
  value: Date | string,
  style: DateStyle = "medium",
): string {
  return formatters[style].format(asDate(value));
}

export function formatDateRange(
  start: Date | string | null,
  end: Date | string | null,
): string | null {
  if (start && end)
    return formatters.medium.formatRange(asDate(start), asDate(end));
  if (start) return `From ${formatDateOnly(start)}`;
  if (end) return `Until ${formatDateOnly(end)}`;
  return null;
}

export function addDays(value: Date | string, days: number): string {
  const date = asDate(value);
  return toDateOnly(new Date(date.getTime() + days * 86_400_000));
}

/** Whole days from `start` to `end`. */
export function daysBetween(start: Date | string, end: Date | string): number {
  return Math.round(
    (asDate(end).getTime() - asDate(start).getTime()) / 86_400_000,
  );
}

/** Every date from start to end inclusive, capped so a bad range cannot explode the UI. */
export function eachDay(
  start: Date | string,
  end: Date | string,
  max = 62,
): string[] {
  const total = Math.min(daysBetween(start, end), max - 1);
  if (total < 0) return [];
  return Array.from({ length: total + 1 }, (_, index) => addDays(start, index));
}

export function todayDateOnly(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function isTimeOfDay(value: string): boolean {
  return TIME_OF_DAY.test(value);
}

export function timeToMinutes(value: string): number {
  const match = TIME_OF_DAY.exec(value);
  if (!match) throw new Error(`Invalid time: ${value}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const suffix = h < 12 ? "AM" : "PM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0
    ? `${hour12} ${suffix}`
    : `${hour12}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function formatTimeRange(
  start: number | null,
  end: number | null,
): string | null {
  if (start == null && end == null) return null;
  if (start != null && end != null)
    return `${formatMinutes(start)} to ${formatMinutes(end)}`;
  if (start != null) return formatMinutes(start);
  return `Until ${formatMinutes(end!)}`;
}

const relative = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

export function formatRelativeTime(
  value: Date | string,
  now = new Date(),
): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return "just now";
  if (abs < 3600) return relative.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), "hour");
  if (abs < 86_400 * 7)
    return relative.format(Math.round(seconds / 86_400), "day");
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function formatTimestamp(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
