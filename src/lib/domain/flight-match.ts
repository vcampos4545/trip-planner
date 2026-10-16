import {
  describeSlice,
  localClock,
  localDate,
  type FlightOffer,
  type FlightSlice,
} from "@/lib/flights";

/**
 * Atlas keeps the flight results it showed in a conversation, so "I bought the Southwest flight"
 * a few messages later can be tied to the exact result. Matching happens here, in code: a
 * reference that fits more than one shown flight is reported as ambiguous so Atlas asks which one
 * instead of guessing.
 */

export type ShownFlight = { resultId: string; offer: FlightOffer };

export type FlightLeg = "outbound" | "return" | "both";

export type FlightReference = {
  resultId: string | null;
  airline: string | null;
  flightNumber: string | null;
  /** Departure date of the flight the user means (YYYY-MM-DD). */
  date: string | null;
  /** Local departure or arrival time as HH:MM. */
  departureTime: string | null;
  arrivalTime: string | null;
  /** Airport codes or city names. */
  origin: string | null;
  destination: string | null;
  leg: FlightLeg | null;
};

export type FlightMatch = {
  resultId: string;
  offer: FlightOffer;
  slices: FlightSlice[];
  leg: "one way" | "outbound" | "return" | "round trip";
};

const norm = (value: string) => value.trim().toLowerCase();

function flightNumbers(slice: FlightSlice) {
  return slice.segments
    .map((segment) => segment.flightNumber)
    .filter((value): value is string => Boolean(value));
}

function sameFlightNumber(given: string, actual: string) {
  const compact = (value: string) => value.replace(/\s+/g, "").toUpperCase();
  const a = compact(given);
  const b = compact(actual);
  if (a === b) return true;
  const digits = (value: string) => /(\d+)$/.exec(value)?.[1] ?? null;
  return digits(a) !== null && digits(a) === digits(b) && !/^[A-Z]{2}/.test(a);
}

function airlineMatches(
  offer: FlightOffer,
  slices: FlightSlice[],
  name: string,
) {
  const wanted = norm(name);
  if (!wanted) return true;
  if (norm(offer.airline.name).includes(wanted)) return true;
  if (offer.airline.iataCode && norm(offer.airline.iataCode) === wanted)
    return true;
  return slices.some((slice) =>
    slice.segments.some(
      (segment) =>
        norm(segment.marketingCarrier).includes(wanted) ||
        norm(segment.operatingCarrier).includes(wanted),
    ),
  );
}

function placeMatches(
  airport: FlightSlice["origin"],
  wanted: string | null,
): boolean {
  if (!wanted?.trim()) return true;
  const value = norm(wanted);
  return (
    norm(airport.iataCode) === value ||
    Boolean(airport.cityName && norm(airport.cityName).includes(value)) ||
    Boolean(airport.name && norm(airport.name).includes(value))
  );
}

function sliceMatches(slice: FlightSlice, ref: FlightReference) {
  if (
    ref.flightNumber &&
    !flightNumbers(slice).some((number) =>
      sameFlightNumber(ref.flightNumber!, number),
    )
  )
    return false;
  if (ref.date && localDate(slice.departingAt) !== ref.date) return false;
  if (ref.departureTime && localClock(slice.departingAt) !== ref.departureTime)
    return false;
  if (ref.arrivalTime && localClock(slice.arrivingAt) !== ref.arrivalTime)
    return false;
  if (!placeMatches(slice.origin, ref.origin)) return false;
  if (!placeMatches(slice.destination, ref.destination)) return false;
  return true;
}

function sliceSpecific(ref: FlightReference) {
  return Boolean(
    ref.flightNumber ||
    ref.date ||
    ref.departureTime ||
    ref.arrivalTime ||
    ref.origin ||
    ref.destination,
  );
}

function candidatesFor(offer: FlightOffer, ref: FlightReference) {
  const [outbound, inbound] = offer.slices;
  if (!outbound) return [];
  if (!inbound) {
    if (ref.leg === "return") return [];
    return [
      {
        slices: [outbound],
        leg: offer.pendingReturn ? ("outbound" as const) : ("one way" as const),
      },
    ];
  }
  const outboundOnly = { slices: [outbound], leg: "outbound" as const };
  const returnOnly = { slices: [inbound], leg: "return" as const };
  const both = { slices: [outbound, inbound], leg: "round trip" as const };
  if (ref.leg === "outbound") return [outboundOnly];
  if (ref.leg === "return") return [returnOnly];
  if (ref.leg === "both") return [both];
  return sliceSpecific(ref) ? [outboundOnly, returnOnly] : [both];
}

function signature(match: FlightMatch) {
  return [
    match.offer.airline.name,
    ...match.slices.map(
      (slice) => `${flightNumbers(slice).join("+")}@${slice.departingAt}`,
    ),
  ].join("|");
}

/**
 * Finds the shown flights a reference could mean. Returns one match when it is clear, several
 * when it is ambiguous, and none when nothing shown fits. The same flight shown in two searches
 * counts once, using the most recent result.
 */
export function matchShownFlights(
  shown: ShownFlight[],
  ref: FlightReference,
): FlightMatch[] {
  const pool = ref.resultId
    ? shown.filter((item) => item.resultId === ref.resultId)
    : shown;
  const matches = new Map<string, FlightMatch>();
  for (const item of pool) {
    for (const candidate of candidatesFor(item.offer, ref)) {
      if (
        ref.airline &&
        !airlineMatches(item.offer, candidate.slices, ref.airline)
      )
        continue;
      if (
        sliceSpecific(ref) &&
        !candidate.slices.some((slice) => sliceMatches(slice, ref))
      )
        continue;
      const match: FlightMatch = {
        resultId: item.resultId,
        offer: item.offer,
        slices: candidate.slices,
        leg: candidate.leg,
      };
      const key = signature(match);
      matches.delete(key);
      matches.set(key, match);
    }
  }
  return [...matches.values()];
}

/** A one-line summary for Atlas and for asking which flight the user meant. */
export function describeMatch(match: FlightMatch) {
  return `${match.offer.airline.name}, ${match.leg}: ${match.slices.map(describeSlice).join("; ")}`;
}

/** Checks the shape of a stored result before it is trusted again. */
export function isShownFlight(value: unknown): value is ShownFlight {
  if (!value || typeof value !== "object") return false;
  const item = value as { resultId?: unknown; offer?: unknown };
  if (typeof item.resultId !== "string" || !/^f\d+$/.test(item.resultId))
    return false;
  const offer = item.offer as Partial<FlightOffer> | null;
  return Boolean(
    offer &&
    typeof offer.offerId === "string" &&
    typeof offer.totalAmount === "string" &&
    typeof offer.totalCurrency === "string" &&
    offer.airline &&
    typeof offer.airline.name === "string" &&
    Array.isArray(offer.slices) &&
    offer.slices.length > 0 &&
    offer.slices.every(
      (slice) =>
        slice &&
        typeof slice.departingAt === "string" &&
        typeof slice.arrivingAt === "string" &&
        Array.isArray(slice.segments) &&
        slice.origin &&
        slice.destination,
    ),
  );
}

/** The next free result ID, so IDs stay unique across turns of one conversation. */
export function nextResultId(existing: Iterable<string>) {
  let max = 0;
  for (const id of existing) {
    const number = Number(/^f(\d+)$/.exec(id)?.[1] ?? 0);
    if (number > max) max = number;
  }
  return `f${max + 1}`;
}
