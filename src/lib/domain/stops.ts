import { z } from "zod";

import { formatDateOnly, isDateOnly } from "@/lib/dates";

/**
 * A trip visits an ordered list of stops, each with an optional date range. The airports people
 * fly into and home from are kept on the trip, apart from the stops, so "fly in and out of Salt
 * Lake City, Jackson Hole then Park City" is two stops plus two airports.
 *
 * Atlas changes stops with small operations. They are applied and validated here; a change that
 * only adds stops or fills missing dates applies directly, while one that removes, renames,
 * reorders, or re-dates a stop someone already set needs a member to accept it.
 */

export const MAX_STOPS = 12;

const dateOnly = z.string().refine(isDateOnly, "Use a YYYY-MM-DD date");

export const stopInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  startDate: dateOnly.nullable(),
  endDate: dateOnly.nullable(),
});
export type TripStopInput = z.infer<typeof stopInputSchema>;

export const stopListSchema = z.array(stopInputSchema).max(MAX_STOPS);

export type StopOp =
  | {
      op: "add";
      name: string;
      startDate: string | null;
      endDate: string | null;
      /** Zero-based place in the list, or null to add at the end. */
      position: number | null;
    }
  | {
      op: "update";
      name: string;
      newName: string | null;
      startDate: string | null;
      endDate: string | null;
    }
  | { op: "remove"; name: string }
  | { op: "move"; name: string; position: number };

const key = (name: string) => name.trim().toLowerCase();

function findStop(stops: TripStopInput[], name: string) {
  return stops.findIndex((stop) => key(stop.name) === key(name));
}

/**
 * Applies operations in order. Returns the new list or a message that explains the first problem.
 * Nothing is partially applied: callers either get the whole result or the error.
 */
export function applyStopOps(
  current: TripStopInput[],
  ops: StopOp[],
): { ok: true; stops: TripStopInput[] } | { ok: false; error: string } {
  const stops = current.map((stop) => ({ ...stop }));
  for (const op of ops) {
    const name = op.name.trim();
    if (!name) return { ok: false, error: "A stop needs a name." };
    const index = findStop(stops, name);
    switch (op.op) {
      case "add": {
        if (index >= 0) {
          // Adding a stop that exists already only fills in what was said about it.
          const stop = stops[index]!;
          stop.startDate = op.startDate ?? stop.startDate;
          stop.endDate = op.endDate ?? stop.endDate;
          break;
        }
        const position =
          op.position === null
            ? stops.length
            : Math.min(Math.max(op.position, 0), stops.length);
        stops.splice(position, 0, {
          name,
          startDate: op.startDate,
          endDate: op.endDate,
        });
        break;
      }
      case "update": {
        if (index < 0) return { ok: false, error: `No stop named "${name}".` };
        const stop = stops[index]!;
        if (op.newName?.trim()) {
          const clash = findStop(stops, op.newName);
          if (clash >= 0 && clash !== index)
            return {
              ok: false,
              error: `There is already a stop named "${op.newName.trim()}".`,
            };
          stop.name = op.newName.trim();
        }
        stop.startDate = op.startDate ?? stop.startDate;
        stop.endDate = op.endDate ?? stop.endDate;
        break;
      }
      case "remove": {
        if (index < 0) return { ok: false, error: `No stop named "${name}".` };
        stops.splice(index, 1);
        break;
      }
      case "move": {
        if (index < 0) return { ok: false, error: `No stop named "${name}".` };
        const [stop] = stops.splice(index, 1);
        const position = Math.min(Math.max(op.position, 0), stops.length);
        stops.splice(position, 0, stop!);
        break;
      }
    }
  }
  return { ok: true, stops };
}

/**
 * Checks a whole list of stops: names, date ranges, order, and that they fit the trip dates.
 * Returns a message or null.
 */
export function stopListProblem(
  stops: TripStopInput[],
  trip: { startDate: string | null; endDate: string | null },
): string | null {
  const parsed = stopListSchema.safeParse(stops);
  if (!parsed.success) {
    return stops.length > MAX_STOPS
      ? `A trip can have up to ${MAX_STOPS} stops.`
      : "Each stop needs a name of 2 to 120 characters and dates as YYYY-MM-DD.";
  }
  const seen = new Set<string>();
  for (const stop of stops) {
    if (seen.has(key(stop.name)))
      return `"${stop.name}" is listed twice. Each stop can appear once.`;
    seen.add(key(stop.name));
    if (stop.startDate && stop.endDate && stop.endDate < stop.startDate)
      return `${stop.name} ends before it starts.`;
    for (const date of [stop.startDate, stop.endDate]) {
      if (!date) continue;
      if (trip.startDate && date < trip.startDate)
        return `${stop.name} is dated before the trip starts.`;
      if (trip.endDate && date > trip.endDate)
        return `${stop.name} is dated after the trip ends.`;
    }
  }
  let previous: TripStopInput | null = null;
  for (const stop of stops) {
    const start = stop.startDate ?? stop.endDate;
    if (previous && start) {
      const previousEnd = previous.endDate ?? previous.startDate;
      if (previousEnd && start < previousEnd)
        return `${stop.name} starts before ${previous.name} ends. Put the stops in travel order, or fix their dates.`;
    }
    if (stop.startDate || stop.endDate) previous = stop;
  }
  return null;
}

export type StopChangeKind = "none" | "fill" | "overwrite";

/**
 * "fill" when every existing stop keeps its name, relative order, and any dates it had, so the
 * change only adds stops or fills in missing dates. Anything else is an "overwrite".
 */
export function classifyStopChange(
  current: TripStopInput[],
  next: TripStopInput[],
): StopChangeKind {
  const same =
    current.length === next.length &&
    current.every(
      (stop, index) =>
        key(stop.name) === key(next[index]!.name) &&
        stop.startDate === next[index]!.startDate &&
        stop.endDate === next[index]!.endDate,
    );
  if (same) return "none";
  let cursor = 0;
  for (const stop of current) {
    let found = -1;
    for (let index = cursor; index < next.length; index += 1) {
      if (key(next[index]!.name) === key(stop.name)) {
        found = index;
        break;
      }
    }
    if (found < 0) return "overwrite";
    const match = next[found]!;
    if (stop.startDate && stop.startDate !== match.startDate)
      return "overwrite";
    if (stop.endDate && stop.endDate !== match.endDate) return "overwrite";
    cursor = found + 1;
  }
  return "fill";
}

/**
 * Keeps a lone stop in step with the destination. A trip without stops gets its destination as
 * the first stop, and a single undated stop that mirrors the old destination follows a rename.
 * Returns null when the stops should stay as they are.
 */
export function syncStopsWithDestination(
  stops: TripStopInput[],
  previousDestination: string | null,
  nextDestination: string | null,
): TripStopInput[] | null {
  const next = nextDestination?.trim();
  if (!next || next.length < 2) return null;
  if (stops.length === 0)
    return [{ name: next.slice(0, 120), startDate: null, endDate: null }];
  const [only] = stops;
  if (
    stops.length === 1 &&
    only &&
    !only.startDate &&
    !only.endDate &&
    previousDestination &&
    key(only.name) === key(previousDestination) &&
    key(only.name) !== key(next)
  ) {
    return [{ name: next.slice(0, 120), startDate: null, endDate: null }];
  }
  return null;
}

function stopDates(stop: TripStopInput) {
  if (stop.startDate && stop.endDate)
    return `${formatDateOnly(stop.startDate, "short")} to ${formatDateOnly(stop.endDate, "short")}`;
  if (stop.startDate) return `from ${formatDateOnly(stop.startDate, "short")}`;
  if (stop.endDate) return `until ${formatDateOnly(stop.endDate, "short")}`;
  return null;
}

export function describeStop(stop: TripStopInput) {
  const dates = stopDates(stop);
  return dates ? `${stop.name} (${dates})` : stop.name;
}

/** "Jackson Hole (Feb 27 to Mar 2), then Park City (Mar 2 to Mar 7)" */
export function describeStops(stops: TripStopInput[]) {
  if (stops.length === 0) return "none";
  return stops.map(describeStop).join(", then ");
}

/** The stop someone is at on a date, preferring the one they arrive at on a travel day. */
export function stopOnDate(stops: TripStopInput[], date: string) {
  let match: TripStopInput | null = null;
  for (const stop of stops) {
    if (!stop.startDate && !stop.endDate) continue;
    const start = stop.startDate ?? stop.endDate!;
    const end = stop.endDate ?? stop.startDate!;
    if (date >= start && date <= end) match = stop;
  }
  return match;
}

/** "In and out of SLC", "Into SLC, home from DEN", or null when neither is known. */
export function describeAirports(
  flyInto: string | null,
  flyOutOf: string | null,
): string | null {
  if (flyInto && flyOutOf)
    return flyInto.trim().toLowerCase() === flyOutOf.trim().toLowerCase()
      ? `In and out of ${flyInto}`
      : `Into ${flyInto}, home from ${flyOutOf}`;
  if (flyInto) return `Into ${flyInto}`;
  if (flyOutOf) return `Home from ${flyOutOf}`;
  return null;
}
