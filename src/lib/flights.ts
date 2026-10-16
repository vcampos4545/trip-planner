/**
 * Flight search shapes and formatting shared by the server, the UI, and Atlas. Nothing here
 * depends on a specific vendor: providers map their responses into these types.
 */

export const CABIN_CLASSES = [
  "economy",
  "premium_economy",
  "business",
  "first",
] as const;
export type CabinClass = (typeof CABIN_CLASSES)[number];

export const CABIN_LABELS: Record<CabinClass, string> = {
  economy: "Economy",
  premium_economy: "Premium economy",
  business: "Business",
  first: "First",
};

export const MAX_FLIGHT_PASSENGERS = 9;

/** Shown on every result that came from a provider's test environment. */
export const TEST_DATA_NOTICE =
  "Duffel test data: not real fares or availability";

export type FlightAirport = {
  iataCode: string;
  name: string | null;
  cityName: string | null;
};

export type FlightSegment = {
  marketingCarrier: string;
  flightNumber: string | null;
  operatingCarrier: string;
  origin: FlightAirport;
  destination: FlightAirport;
  /** Local time at the airport, as the provider sent it (YYYY-MM-DDTHH:MM:SS, no offset). */
  departingAt: string;
  arrivingAt: string;
};

export type FlightSlice = {
  origin: FlightAirport;
  destination: FlightAirport;
  departingAt: string;
  arrivingAt: string;
  durationMinutes: number | null;
  stops: number;
  segments: FlightSegment[];
};

/** One priced itinerary returned by a flight search provider. */
export type FlightOffer = {
  offerId: string;
  airline: { name: string; iataCode: string | null };
  slices: FlightSlice[];
  /** Decimal string for all passengers together, exactly as the provider priced it. */
  totalAmount: string;
  totalCurrency: string;
  passengers: number;
  cabin: CabinClass | null;
  expiresAt: string | null;
  /** ISO timestamp of the search that returned this offer. */
  retrievedAt: string;
  sourceName: string;
  /** True when the provider's test environment produced it. Test offers are never real. */
  testMode: boolean;
};

export type ResolvedPlace = { query: string; iataCode: string; name: string };

export type FlightSearchSummary = {
  origin: ResolvedPlace;
  destination: ResolvedPlace;
  departureDate: string;
  returnDate: string | null;
  passengers: number;
  cabin: CabinClass | null;
  maxStops: number;
};

/** Parses an ISO 8601 duration such as "PT7H25M" or "P1DT2H" into minutes. */
export function parseIsoDurationMinutes(
  value: string | null | undefined,
): number | null {
  if (!value) return null;
  const match =
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(
      value,
    );
  if (!match || value === "P" || value.endsWith("T")) return null;
  const [, days, hours, minutes] = match;
  return (
    Number(days ?? 0) * 1440 + Number(hours ?? 0) * 60 + Number(minutes ?? 0)
  );
}

export function formatDuration(minutes: number | null): string | null {
  if (minutes === null) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** "08:30" from a provider's local timestamp. The value is local to the airport, so no zone math. */
export function localClock(value: string): string {
  return /T(\d{2}:\d{2})/.exec(value)?.[1] ?? value;
}

export function localDate(value: string): string {
  return value.slice(0, 10);
}

export function stopsLabel(stops: number): string {
  if (stops === 0) return "Nonstop";
  return stops === 1 ? "1 stop" : `${stops} stops`;
}

export function flightTitle(offer: FlightOffer): string {
  const first = offer.slices[0];
  if (!first) return offer.airline.name;
  const route = `${first.origin.iataCode} to ${first.destination.iataCode}`;
  const kind = offer.slices.length > 1 ? "round trip" : "one way";
  return `${offer.airline.name}: ${route}, ${kind}`;
}

/** One line per slice, used as the saved option's description and in Atlas tool output. */
export function describeSlice(slice: FlightSlice): string {
  const carriers = [
    ...new Set(
      slice.segments.map((segment) =>
        segment.flightNumber
          ? `${segment.marketingCarrier} ${segment.flightNumber}`
          : segment.marketingCarrier,
      ),
    ),
  ].join(", ");
  const duration = formatDuration(slice.durationMinutes);
  return [
    `${slice.origin.iataCode} ${localDate(slice.departingAt)} ${localClock(slice.departingAt)} to ${slice.destination.iataCode} ${localDate(slice.arrivingAt)} ${localClock(slice.arrivingAt)} (local times)`,
    stopsLabel(slice.stops),
    duration,
    carriers || null,
  ]
    .filter(Boolean)
    .join(", ");
}

export function travelersLabel(count: number): string {
  return count === 1 ? "1 traveler" : `${count} travelers`;
}

/**
 * A link to search the same route and dates on a public flight search site. The app never
 * books; this is where a traveler goes to compare and book on their own.
 */
export function bookElsewhereUrl(search: {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate: string | null;
}): string {
  const q = `Flights from ${search.origin} to ${search.destination} on ${search.departureDate}${
    search.returnDate ? ` through ${search.returnDate}` : " one way"
  }`;
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}`;
}
