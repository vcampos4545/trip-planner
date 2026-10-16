import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import {
  airportsForCode,
  parsePlaceInput,
  pickPlace,
  type PlaceSuggestion,
} from "@/lib/domain/flight-places";
import type {
  CabinClass,
  FlightAirport,
  FlightOffer,
  FlightSearchSummary,
  FlightSegment,
  FlightSlice,
  PriceInsights,
  ResolvedPlace,
} from "@/lib/flights";
import { centsToDecimal } from "@/lib/money";

import type { FlightCacheStore } from "./cache";
import { fromPick, resolveRoute, unknownPlace } from "./places";
import {
  FlightProviderError,
  type FlightSearchProvider,
  type FlightSearchQuery,
  type FlightSearchResult,
} from "./types";

/**
 * Flight search through SerpApi's Google Flights API (https://serpapi.com/google-flights-api).
 * SerpApi returns what Google Flights shows, so prices are Google's at retrieval time and can
 * change. Results link out to Google Flights to book; the app never books.
 *
 * Every request spends the account's search quota (the free plan allows about 250 a month and 50
 * an hour), so a round trip is searched once and its return options are loaded only on request.
 */

export const SERPAPI_URL = "https://serpapi.com";
export const SERPAPI_SOURCE_NAME = "Google Flights via SerpApi";
export const PRICE_INSIGHTS_SOURCE = "Google Flights";
export const MAX_FLIGHT_OFFERS = 10;
const CURRENCY = "USD";
const REQUEST_TIMEOUT_MS = 30_000;
// Place names map to the same airports for a long time, so a lookup is reused for a month.
const PLACE_CACHE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_AIRPORTS_PER_PLACE = 6;
const IATA_CODE = /^[A-Z]{3}$/;
const NO_RESULTS = /hasn't returned any results|no results/i;

const TRAVEL_CLASS: Record<CabinClass, string> = {
  economy: "1",
  premium_economy: "2",
  business: "3",
  first: "4",
};

/** Our "at most N stops" to SerpApi's stops filter: 1 nonstop, 2 up to one stop, 3 up to two. */
function stopsParam(maxStops: number) {
  return String(Math.min(Math.max(maxStops, 0), 2) + 1);
}

const airportTimeSchema = z.object({
  id: z.string(),
  name: z.string().nullish(),
  time: z.string(),
});

const segmentSchema = z.object({
  departure_airport: airportTimeSchema,
  arrival_airport: airportTimeSchema,
  duration: z.number().nullish(),
  airline: z.string().nullish(),
  flight_number: z.string().nullish(),
  extensions: z.array(z.string()).nullish(),
});

const itemSchema = z.object({
  flights: z.array(segmentSchema).min(1),
  layovers: z.array(z.unknown()).nullish(),
  total_duration: z.number().nullish(),
  price: z.number().nullish(),
  departure_token: z.string().nullish(),
  booking_token: z.string().nullish(),
});

const placeSchema = z.object({
  airport: z.object({ id: z.string(), name: z.string().nullish() }),
  city: z.string().nullish(),
});

const searchSchema = z.object({
  search_metadata: z
    .object({
      status: z.string().nullish(),
      google_flights_url: z.string().nullish(),
    })
    .nullish(),
  best_flights: z.array(z.unknown()).nullish(),
  other_flights: z.array(z.unknown()).nullish(),
  price_insights: z
    .object({
      lowest_price: z.number().nullish(),
      price_level: z.string().nullish(),
      typical_price_range: z.array(z.number()).nullish(),
    })
    .nullish(),
  airports: z
    .array(
      z.object({
        departure: z.array(placeSchema).nullish(),
        arrival: z.array(placeSchema).nullish(),
      }),
    )
    .nullish(),
  error: z.string().nullish(),
});

const autocompleteSchema = z.object({
  suggestions: z
    .array(
      z.object({
        name: z.string(),
        type: z.string().nullish(),
        description: z.string().nullish(),
        id: z.string().nullish(),
        airports: z
          .array(
            z.object({
              id: z.string(),
              name: z.string().nullish(),
              city: z.string().nullish(),
            }),
          )
          .nullish(),
      }),
    )
    .nullish(),
  error: z.string().nullish(),
});

const errorSchema = z.object({ error: z.string() });

type SerpItem = z.infer<typeof itemSchema>;
type SerpSearch = z.infer<typeof searchSchema>;

export type SerpApiOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  now?: () => Date;
  /** Keeps place lookups so a city name costs a search only the first time. */
  placeCache?: FlightCacheStore;
};

export class SerpApiFlightProvider implements FlightSearchProvider {
  readonly id = "serpapi";
  readonly label = SERPAPI_SOURCE_NAME;
  readonly testMode = false;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly placeCache?: FlightCacheStore;

  constructor(options: SerpApiOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl || SERPAPI_URL).replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.placeCache = options.placeCache;
  }

  async search(
    query: FlightSearchQuery,
    signal?: AbortSignal,
  ): Promise<FlightSearchResult> {
    const [origin, destination] = await resolveRoute(query, (place) =>
      this.resolvePlace(place, signal),
    );
    // Google Flights always searches one cabin. "Any cabin" searches economy and says so.
    const cabin: CabinClass = query.cabin ?? "economy";
    const originCodes = codesOf(origin);
    const destinationCodes = codesOf(destination);
    const json = await this.request({
      engine: "google_flights",
      departure_id: originCodes,
      arrival_id: destinationCodes,
      outbound_date: query.departureDate,
      ...(query.returnDate
        ? { type: "1", return_date: query.returnDate }
        : { type: "2" }),
      adults: String(query.passengers),
      travel_class: TRAVEL_CLASS[cabin],
      stops: stopsParam(query.maxStops),
      currency: CURRENCY,
      hl: "en",
      gl: "us",
    });
    const search: FlightSearchSummary = {
      origin,
      destination,
      departureDate: query.departureDate,
      returnDate: query.returnDate,
      passengers: query.passengers,
      cabin,
      maxStops: query.maxStops,
    };
    return this.toResult(json, search, (item, context) =>
      this.toOffer(item, context, (slice) => ({
        slices: [slice],
        pendingReturn:
          query.returnDate && item.departure_token
            ? {
                date: query.returnDate,
                token: item.departure_token,
                originCodes,
                destinationCodes,
                maxStops: query.maxStops,
              }
            : null,
      })),
    );
  }

  /** Loads the return options for one outbound flight. Spends one search. */
  async searchReturns(
    offer: FlightOffer,
    signal?: AbortSignal,
  ): Promise<FlightSearchResult> {
    const pending = offer.pendingReturn;
    const outbound = offer.slices[0];
    if (!pending || !outbound) {
      throw new FlightProviderError(
        "invalid_request",
        "This flight has no return to load. Search again with a return date.",
      );
    }
    const cabin = offer.cabin ?? "economy";
    const json = await this.request(
      {
        engine: "google_flights",
        departure_id: pending.originCodes,
        arrival_id: pending.destinationCodes,
        outbound_date: outbound.departingAt.slice(0, 10),
        return_date: pending.date,
        type: "1",
        adults: String(offer.passengers),
        travel_class: TRAVEL_CLASS[cabin],
        stops: stopsParam(pending.maxStops),
        currency: CURRENCY,
        hl: "en",
        gl: "us",
        departure_token: pending.token,
      },
      signal,
    );
    const place = (airport: FlightAirport, codes: string): ResolvedPlace => ({
      query: codes,
      iataCode: airport.iataCode,
      name: airport.cityName ?? airport.name ?? airport.iataCode,
      airportCodes: codes.split(","),
    });
    const search: FlightSearchSummary = {
      origin: place(outbound.origin, pending.originCodes),
      destination: place(outbound.destination, pending.destinationCodes),
      departureDate: outbound.departingAt.slice(0, 10),
      returnDate: pending.date,
      passengers: offer.passengers,
      cabin,
      maxStops: pending.maxStops,
    };
    return this.toResult(json, search, (item, context) =>
      this.toOffer(item, context, (slice) => ({
        slices: [outbound, slice],
        pendingReturn: null,
      })),
    );
  }

  /**
   * Accepts 3-letter codes in any case, searching a metro code's airports ("NYC" is JFK, LGA, and
   * EWR). Otherwise asks Google Flights autocomplete and searches all of the matching city's
   * airports, so "New York" covers JFK, LGA, and EWR. A name that fits several cities with their
   * own airports is reported with the candidates instead of guessing.
   */
  async resolvePlace(
    query: string,
    signal?: AbortSignal,
  ): Promise<ResolvedPlace> {
    const trimmed = query.trim();
    const input = parsePlaceInput(trimmed);
    if (!input) throw unknownPlace(trimmed);
    if (input.kind === "codes") {
      const airports = [...new Set(input.codes.flatMap(airportsForCode))].slice(
        0,
        MAX_AIRPORTS_PER_PLACE,
      );
      const [code] = input.codes;
      return {
        query: trimmed,
        iataCode: code!,
        name: input.codes.join(", "),
        ...(airports.length > 1 || airports[0] !== code
          ? { airportCodes: airports }
          : {}),
      };
    }
    const suggestions = await this.suggestions(input.name, signal);
    return {
      ...fromPick(trimmed, pickPlace(input, suggestions)),
      query: trimmed,
    };
  }

  /** Google's suggestions for a name, kept for a month so a name costs a search only once. */
  private async suggestions(
    name: string,
    signal?: AbortSignal,
  ): Promise<PlaceSuggestion[]> {
    const cacheKey = `serpapi:suggestions:${name.toLowerCase()}`;
    const cached = await readCache(this.placeCache, cacheKey, this.now());
    if (Array.isArray(cached)) return cached as PlaceSuggestion[];
    const json = await this.request(
      { engine: "google_flights_autocomplete", q: name, hl: "en", gl: "us" },
      signal,
    );
    const parsed = autocompleteSchema.safeParse(json);
    if (!parsed.success) throw badResponse();
    const suggestions = (parsed.data.suggestions ?? []).map((suggestion) => {
      const airports = (suggestion.airports ?? []).filter((airport) =>
        IATA_CODE.test(airport.id.toUpperCase()),
      );
      const codes = [
        ...new Set(airports.map((airport) => airport.id.toUpperCase())),
      ].slice(0, MAX_AIRPORTS_PER_PLACE);
      if (codes.length === 0 && suggestion.id && IATA_CODE.test(suggestion.id))
        codes.push(suggestion.id);
      return {
        name: suggestion.name,
        detail: suggestion.description ?? null,
        codes,
        airportCities: airports.map((airport) => airport.city ?? ""),
      } satisfies PlaceSuggestion;
    });
    // A name with no airports is not kept, so a fix on Google's side is picked up next time.
    if (suggestions.some((suggestion) => suggestion.codes.length > 0)) {
      await writeCache(
        this.placeCache,
        cacheKey,
        suggestions,
        new Date(this.now().getTime() + PLACE_CACHE_MS),
      );
    }
    return suggestions;
  }

  private toResult(
    json: unknown,
    search: FlightSearchSummary,
    map: (item: SerpItem, context: OfferContext) => FlightOffer | null,
  ): FlightSearchResult {
    const retrievedAt = this.now().toISOString();
    const parsed = searchSchema.safeParse(json);
    if (!parsed.success) throw badResponse();
    const data = parsed.data;
    if (data.search_metadata?.status === "Error") {
      throw new FlightProviderError(
        "unavailable",
        "SerpApi couldn't get Google Flights results for this search. Try again in a moment.",
      );
    }
    if (data.error && !NO_RESULTS.test(data.error)) throw badResponse();
    const context: OfferContext = {
      search,
      retrievedAt,
      cities: cityNames(data),
      bookingUrl: googleFlightsUrl(data.search_metadata?.google_flights_url),
    };
    const offers = [...(data.best_flights ?? []), ...(data.other_flights ?? [])]
      .map((raw) => itemSchema.safeParse(raw))
      .flatMap((result) => (result.success ? [result.data] : []))
      .map((item) => map(item, context))
      .filter((offer): offer is FlightOffer => offer !== null)
      .filter(
        (offer, index, all) =>
          all.findIndex((other) => other.offerId === offer.offerId) === index,
      )
      .sort((a, b) => Number(a.totalAmount) - Number(b.totalAmount))
      .slice(0, MAX_FLIGHT_OFFERS);
    return {
      search,
      offers,
      retrievedAt,
      sourceName: SERPAPI_SOURCE_NAME,
      testMode: false,
      priceInsights: toInsights(data.price_insights),
    };
  }

  private toOffer(
    item: SerpItem,
    context: OfferContext,
    shape: (slice: FlightSlice) => {
      slices: FlightSlice[];
      pendingReturn: FlightOffer["pendingReturn"];
    },
  ): FlightOffer | null {
    // Google sometimes lists a flight without a price. Without one it is not a fare to show.
    if (
      item.price === null ||
      item.price === undefined ||
      !Number.isFinite(item.price) ||
      item.price < 0
    ) {
      return null;
    }
    const segments = item.flights.map((flight) =>
      toSegment(flight, context.cities),
    );
    if (segments.some((segment) => segment === null)) return null;
    const legs = segments as FlightSegment[];
    const first = legs[0]!;
    const last = legs[legs.length - 1]!;
    const slice: FlightSlice = {
      origin: first.origin,
      destination: last.destination,
      departingAt: first.departingAt,
      arrivingAt: last.arrivingAt,
      durationMinutes:
        item.total_duration ??
        item.flights.reduce((sum, flight) => sum + (flight.duration ?? 0), 0),
      stops: Math.max(item.layovers?.length ?? 0, legs.length - 1),
      segments: legs,
    };
    const { slices, pendingReturn } = shape(slice);
    const allSegments = slices.flatMap((s) => s.segments);
    const names = [
      ...new Set(allSegments.map((segment) => segment.marketingCarrier)),
    ];
    const codes = new Set(
      allSegments.map((segment) => segment.flightNumber?.slice(0, 2) ?? null),
    );
    const [code] = codes;
    const totalAmount = centsToDecimal(Math.round(item.price * 100));
    return {
      offerId: offerIdFor(slices, totalAmount, context.search),
      airline: {
        name: names.join(", "),
        iataCode: codes.size === 1 && code ? code : null,
      },
      slices,
      totalAmount,
      totalCurrency: CURRENCY,
      passengers: context.search.passengers,
      cabin: context.search.cabin,
      expiresAt: null,
      retrievedAt: context.retrievedAt,
      sourceName: SERPAPI_SOURCE_NAME,
      providerId: "serpapi",
      testMode: false,
      pendingReturn,
      bookingUrl: context.bookingUrl,
    };
  }

  private async request(
    params: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const url = new URL(`${this.baseUrl}/search.json`);
    for (const [key, value] of Object.entries(params))
      url.searchParams.set(key, value);
    // The key travels in the query string as SerpApi requires. The URL is never logged.
    url.searchParams.set("api_key", this.apiKey);
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === "AbortError" || error.name === "TimeoutError")
      ) {
        throw new FlightProviderError(
          "timeout",
          "Google Flights (via SerpApi) took too long to respond. Try again in a moment.",
        );
      }
      throw new FlightProviderError(
        "unavailable",
        "Couldn't reach SerpApi. Try again in a moment.",
      );
    }
    let json: unknown = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    if (!response.ok) throw serpApiError(response.status, json);
    if (json === null) throw badResponse();
    return json;
  }
}

type OfferContext = {
  search: FlightSearchSummary;
  retrievedAt: string;
  cities: Map<string, string>;
  bookingUrl: string | null;
};

function codesOf(place: ResolvedPlace) {
  return (place.airportCodes?.length ? place.airportCodes : [place.iataCode])
    .map((code) => code.toUpperCase())
    .join(",");
}

/** "2026-11-20 8:05" as SerpApi sends it, to the app's local "2026-11-20T08:05:00". */
export function toLocalTimestamp(value: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return null;
  return `${match[1]}T${match[2]!.padStart(2, "0")}:${match[3]}:00`;
}

function toSegment(
  flight: z.infer<typeof segmentSchema>,
  cities: Map<string, string>,
): FlightSegment | null {
  const departingAt = toLocalTimestamp(flight.departure_airport.time);
  const arrivingAt = toLocalTimestamp(flight.arrival_airport.time);
  if (!departingAt || !arrivingAt) return null;
  const airline = flight.airline?.trim() || "Unknown airline";
  const operated = flight.extensions
    ?.map((extension) => /^Operated by (.+)$/i.exec(extension.trim())?.[1])
    .find(Boolean);
  return {
    marketingCarrier: airline,
    flightNumber: flight.flight_number?.replace(/\s+/g, "") || null,
    operatingCarrier: operated?.trim() || airline,
    origin: toAirport(flight.departure_airport, cities),
    destination: toAirport(flight.arrival_airport, cities),
    departingAt,
    arrivingAt,
  };
}

function toAirport(
  airport: z.infer<typeof airportTimeSchema>,
  cities: Map<string, string>,
): FlightAirport {
  const code = airport.id.toUpperCase();
  return {
    iataCode: code,
    name: airport.name ?? null,
    cityName: cities.get(code) ?? null,
  };
}

function cityNames(data: SerpSearch) {
  const cities = new Map<string, string>();
  for (const group of data.airports ?? []) {
    for (const place of [
      ...(group.departure ?? []),
      ...(group.arrival ?? []),
    ]) {
      if (place.city) cities.set(place.airport.id.toUpperCase(), place.city);
    }
  }
  return cities;
}

/** Only Google Flights links are passed on, so a response can't send travelers elsewhere. */
function googleFlightsUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === "www.google.com" &&
      url.pathname.startsWith("/travel/flights")
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function toInsights(value: SerpSearch["price_insights"]): PriceInsights | null {
  if (!value) return null;
  const amount = (n: number | null | undefined) =>
    typeof n === "number" && Number.isFinite(n) && n >= 0
      ? centsToDecimal(Math.round(n * 100))
      : null;
  const [low, high] = value.typical_price_range ?? [];
  const insights: PriceInsights = {
    sourceName: PRICE_INSIGHTS_SOURCE,
    currency: CURRENCY,
    lowestPrice: amount(value.lowest_price),
    priceLevel: value.price_level?.trim().slice(0, 40) || null,
    typicalLow: amount(low),
    typicalHigh: amount(high),
  };
  return insights.lowestPrice ||
    insights.priceLevel ||
    (insights.typicalLow && insights.typicalHigh)
    ? insights
    : null;
}

/** Google Flights results have no ID, so one is derived from the flights, price, and search. */
function offerIdFor(
  slices: FlightSlice[],
  totalAmount: string,
  search: FlightSearchSummary,
) {
  const key = JSON.stringify([
    slices.map((slice) =>
      slice.segments.map((segment) => [
        segment.flightNumber,
        segment.origin.iataCode,
        segment.departingAt,
      ]),
    ),
    totalAmount,
    search.passengers,
    search.cabin,
    search.returnDate,
  ]);
  return `gf_${createHash("sha256").update(key).digest("hex").slice(0, 24)}`;
}

function badResponse() {
  return new FlightProviderError(
    "bad_response",
    "SerpApi sent a response the app couldn't read. Try again in a moment.",
  );
}

/** Maps a SerpApi error to a message a traveler can act on. The key never appears in it. */
export function serpApiError(status: number, body: unknown) {
  const parsed = errorSchema.safeParse(body);
  const detail = parsed.success ? parsed.data.error.trim() : "";
  if (status === 401 || status === 403) {
    return new FlightProviderError(
      "auth",
      "SerpApi rejected the server's API key. Ask whoever runs this app to check SERPAPI_API_KEY.",
    );
  }
  if (status === 429) {
    return new FlightProviderError(
      "rate_limit",
      /run out of searches|searches for the month|plan/i.test(detail)
        ? "The app's SerpApi account has used all of its flight searches for now (the free plan allows about 250 a month). Saved flights still work. Try again after the quota resets, or add flights you find yourself."
        : "Too many flight searches in the last hour (SerpApi's free plan allows about 50 an hour). Wait a while and try again.",
    );
  }
  if (status === 400) {
    return new FlightProviderError(
      "invalid_request",
      detail
        ? `Google Flights couldn't run this search: ${detail.replace(/api_key\S*/gi, "").slice(0, 240)}`
        : "Google Flights couldn't run this search. Check the airports and dates.",
    );
  }
  return new FlightProviderError(
    "unavailable",
    "SerpApi is having trouble right now. Try the search again in a moment.",
  );
}

async function readCache(
  store: FlightCacheStore | undefined,
  key: string,
  now: Date,
) {
  if (!store) return null;
  try {
    return await store.get(key, now);
  } catch {
    return null;
  }
}

async function writeCache(
  store: FlightCacheStore | undefined,
  key: string,
  value: unknown,
  expiresAt: Date,
) {
  if (!store) return;
  try {
    await store.set(key, value, expiresAt);
  } catch {
    // A cache that can't be written only costs a later search.
  }
}
