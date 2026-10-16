import "server-only";

import { z } from "zod";

import {
  parsePlaceInput,
  pickPlace,
  type PlaceSuggestion,
} from "@/lib/domain/flight-places";
import {
  type FlightAirport,
  type FlightOffer,
  type FlightSlice,
  type ResolvedPlace,
  parseIsoDurationMinutes,
} from "@/lib/flights";
import { centsToDecimal, toCents } from "@/lib/money";

import { fromPick, resolveRoute, unknownPlace } from "./places";
import {
  FlightProviderError,
  type FlightSearchProvider,
  type FlightSearchQuery,
  type FlightSearchResult,
} from "./types";

/**
 * Flight search through Duffel (https://duffel.com/docs/api/v2). Only offer requests and place
 * suggestions are used: the app never creates orders or takes payment.
 */

export const DUFFEL_API_URL = "https://api.duffel.com";
export const DUFFEL_VERSION = "v2";
export const DUFFEL_TEST_TOKEN_PREFIX = "duffel_test_";
export const MAX_FLIGHT_OFFERS = 10;
const REQUEST_TIMEOUT_MS = 30_000;
// Duffel waits this long for each airline. It must stay below our own request timeout.
const SUPPLIER_TIMEOUT_MS = 15_000;
const IATA_CODE = /^[A-Z]{3}$/;

export function isDuffelTestToken(token: string) {
  return token.startsWith(DUFFEL_TEST_TOKEN_PREFIX);
}

const airportSchema = z.object({
  iata_code: z.string(),
  name: z.string().nullish(),
  city_name: z.string().nullish(),
});

const carrierSchema = z.object({
  name: z.string(),
  iata_code: z.string().nullish(),
});

const segmentSchema = z.object({
  departing_at: z.string(),
  arriving_at: z.string(),
  origin: airportSchema,
  destination: airportSchema,
  marketing_carrier: carrierSchema,
  operating_carrier: carrierSchema.nullish(),
  marketing_carrier_flight_number: z.string().nullish(),
  stops: z.array(z.unknown()).nullish(),
});

const sliceSchema = z.object({
  duration: z.string().nullish(),
  segments: z.array(segmentSchema).min(1),
});

const offerSchema = z.object({
  id: z.string(),
  total_amount: z.string(),
  total_currency: z.string(),
  owner: carrierSchema,
  slices: z.array(sliceSchema).min(1),
  expires_at: z.string().nullish(),
  live_mode: z.boolean().nullish(),
});

const offerRequestSchema = z.object({
  data: z.object({
    live_mode: z.boolean().nullish(),
    offers: z.array(z.unknown()),
  }),
});

const placesSchema = z.object({
  data: z.array(
    z.object({
      type: z.string().nullish(),
      iata_code: z.string().nullish(),
      name: z.string(),
      city_name: z.string().nullish(),
      iata_country_code: z.string().nullish(),
      airports: z
        .array(
          z.object({
            iata_code: z.string().nullish(),
            city_name: z.string().nullish(),
          }),
        )
        .nullish(),
    }),
  ),
});

const errorSchema = z.object({
  errors: z
    .array(
      z.object({
        type: z.string().nullish(),
        code: z.string().nullish(),
        title: z.string().nullish(),
        message: z.string().nullish(),
      }),
    )
    .min(1),
});

type DuffelOffer = z.infer<typeof offerSchema>;

export type DuffelOptions = {
  accessToken: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  now?: () => Date;
};

export class DuffelFlightProvider implements FlightSearchProvider {
  readonly id = "duffel";
  readonly testMode: boolean;
  readonly label: string;
  private readonly accessToken: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(options: DuffelOptions) {
    this.accessToken = options.accessToken;
    this.baseUrl = (options.baseUrl || DUFFEL_API_URL).replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.testMode = isDuffelTestToken(options.accessToken);
    this.label = this.testMode ? "Duffel (test data)" : "Duffel";
  }

  async search(
    query: FlightSearchQuery,
    signal?: AbortSignal,
  ): Promise<FlightSearchResult> {
    const [origin, destination] = await resolveRoute(query, (place) =>
      this.resolvePlace(place, signal),
    );
    const slices = [
      {
        origin: origin.iataCode,
        destination: destination.iataCode,
        departure_date: query.departureDate,
      },
    ];
    if (query.returnDate) {
      slices.push({
        origin: destination.iataCode,
        destination: origin.iataCode,
        departure_date: query.returnDate,
      });
    }
    const body = {
      data: {
        slices,
        passengers: Array.from({ length: query.passengers }, () => ({
          type: "adult",
        })),
        cabin_class: query.cabin,
        max_connections: query.maxStops,
      },
    };
    const json = await this.request(
      "POST",
      `/air/offer_requests?return_offers=true&supplier_timeout=${SUPPLIER_TIMEOUT_MS}`,
      body,
      signal,
    );
    const retrievedAt = this.now().toISOString();
    const parsed = offerRequestSchema.safeParse(json);
    if (!parsed.success) {
      throw new FlightProviderError(
        "bad_response",
        "Duffel sent a response the app couldn't read. Try again in a moment.",
      );
    }
    const testMode = this.testMode || parsed.data.data.live_mode === false;
    const offers = parsed.data.data.offers
      .map((raw) => offerSchema.safeParse(raw))
      .flatMap((result) => (result.success ? [result.data] : []))
      .map((offer) =>
        this.toOffer(offer, {
          passengers: query.passengers,
          cabin: query.cabin,
          retrievedAt,
          testMode,
        }),
      )
      .filter((offer): offer is FlightOffer => offer !== null)
      .sort(
        (a, b) => (toCents(a.totalAmount) ?? 0) - (toCents(b.totalAmount) ?? 0),
      )
      .slice(0, MAX_FLIGHT_OFFERS);

    return {
      search: {
        origin,
        destination,
        departureDate: query.departureDate,
        returnDate: query.returnDate,
        passengers: query.passengers,
        cabin: query.cabin,
        maxStops: query.maxStops,
      },
      offers,
      retrievedAt,
      sourceName: testMode ? "Duffel (test data)" : "Duffel",
      testMode,
    };
  }

  /**
   * Accepts a 3-letter airport or city code in any case; Duffel searches a city code's airports
   * itself. Otherwise asks Duffel for matching cities and airports. A name that fits several
   * cities is reported with the candidates instead of guessing.
   */
  async resolvePlace(
    query: string,
    signal?: AbortSignal,
  ): Promise<ResolvedPlace> {
    const trimmed = query.trim();
    const input = parsePlaceInput(trimmed);
    if (!input) throw unknownPlace(trimmed);
    if (input.kind === "codes") {
      // A slice has one origin and one destination, so a list searches its first code.
      const code = input.codes[0]!;
      return { query: trimmed, iataCode: code, name: code };
    }
    const json = await this.request(
      "GET",
      `/places/suggestions?query=${encodeURIComponent(input.name)}`,
      undefined,
      signal,
    );
    const parsed = placesSchema.safeParse(json);
    if (!parsed.success) {
      throw new FlightProviderError(
        "bad_response",
        "Duffel sent a response the app couldn't read. Try again in a moment.",
      );
    }
    const suggestions = parsed.data.data.flatMap((place): PlaceSuggestion[] => {
      const code = place.iata_code?.toUpperCase();
      if (!code || !IATA_CODE.test(code)) return [];
      const city = place.type === "city";
      return [
        {
          name: place.name,
          detail: [place.city_name, place.iata_country_code]
            .filter(Boolean)
            .join(" "),
          codes: [code],
          // A city code is the city's own; its airports are listed when Duffel sends them.
          airportCities: city
            ? place.airports?.length
              ? place.airports.map((airport) => airport.city_name ?? place.name)
              : [place.name]
            : [place.city_name ?? ""],
        },
      ];
    });
    return {
      ...fromPick(trimmed, pickPlace(input, suggestions)),
      query: trimmed,
    };
  }

  private toOffer(
    offer: DuffelOffer,
    context: {
      passengers: number;
      cabin: FlightOffer["cabin"];
      retrievedAt: string;
      testMode: boolean;
    },
  ): FlightOffer | null {
    const cents = toCents(offer.total_amount);
    const currency = offer.total_currency.toUpperCase();
    if (cents === null || cents < 0 || !IATA_CODE.test(currency)) return null;
    const slices: FlightSlice[] = offer.slices.map((slice) => {
      const first = slice.segments[0]!;
      const last = slice.segments[slice.segments.length - 1]!;
      const technicalStops = slice.segments.reduce(
        (sum, segment) => sum + (segment.stops?.length ?? 0),
        0,
      );
      return {
        origin: toAirport(first.origin),
        destination: toAirport(last.destination),
        departingAt: first.departing_at,
        arrivingAt: last.arriving_at,
        durationMinutes: parseIsoDurationMinutes(slice.duration),
        stops: slice.segments.length - 1 + technicalStops,
        segments: slice.segments.map((segment) => ({
          marketingCarrier: segment.marketing_carrier.name,
          flightNumber: segment.marketing_carrier_flight_number
            ? `${segment.marketing_carrier.iata_code ?? ""}${segment.marketing_carrier_flight_number}`
            : null,
          // Duffel requires showing the operating carrier's full name.
          operatingCarrier:
            segment.operating_carrier?.name ?? segment.marketing_carrier.name,
          origin: toAirport(segment.origin),
          destination: toAirport(segment.destination),
          departingAt: segment.departing_at,
          arrivingAt: segment.arriving_at,
        })),
      };
    });
    return {
      offerId: offer.id,
      airline: {
        name: offer.owner.name,
        iataCode: offer.owner.iata_code ?? null,
      },
      slices,
      totalAmount: centsToDecimal(cents),
      totalCurrency: currency,
      passengers: context.passengers,
      cabin: context.cabin,
      expiresAt: offer.expires_at ?? null,
      retrievedAt: context.retrievedAt,
      sourceName: context.testMode ? "Duffel (test data)" : "Duffel",
      providerId: "duffel",
      testMode: context.testMode || offer.live_mode === false,
    };
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip",
          "Content-Type": "application/json",
          "Duffel-Version": DUFFEL_VERSION,
          Authorization: `Bearer ${this.accessToken}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === "AbortError" || error.name === "TimeoutError")
      ) {
        throw new FlightProviderError(
          "timeout",
          "Duffel took too long to respond. Try again in a moment.",
        );
      }
      throw new FlightProviderError(
        "unavailable",
        "Couldn't reach Duffel. Try again in a moment.",
      );
    }
    let json: unknown = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    if (!response.ok) throw duffelError(response.status, json);
    if (json === null) {
      throw new FlightProviderError(
        "bad_response",
        "Duffel sent a response the app couldn't read. Try again in a moment.",
      );
    }
    return json;
  }
}

function toAirport(airport: z.infer<typeof airportSchema>): FlightAirport {
  return {
    iataCode: airport.iata_code,
    name: airport.name ?? null,
    cityName: airport.city_name ?? null,
  };
}

/** Maps a Duffel error response to a message a traveler can act on. Tokens never appear in it. */
export function duffelError(status: number, body: unknown) {
  const parsed = errorSchema.safeParse(body);
  const first = parsed.success ? parsed.data.errors[0] : undefined;
  if (status === 401 || status === 403) {
    return new FlightProviderError(
      "auth",
      "Duffel rejected the server's access token. Ask whoever runs this app to check DUFFEL_ACCESS_TOKEN.",
    );
  }
  if (status === 429) {
    return new FlightProviderError(
      "rate_limit",
      "Duffel is getting too many searches right now. Wait a minute and try again.",
    );
  }
  if (status === 400 || status === 404 || status === 422) {
    const detail = (first?.message || first?.title || "").trim().slice(0, 240);
    return new FlightProviderError(
      "invalid_request",
      detail
        ? `Duffel couldn't run this search: ${detail}`
        : "Duffel couldn't run this search. Check the airports and dates.",
    );
  }
  if (first?.type === "airline_error") {
    return new FlightProviderError(
      "unavailable",
      "The airlines didn't answer in time. Try the search again in a moment.",
    );
  }
  return new FlightProviderError(
    "unavailable",
    "Duffel is having trouble right now. Try the search again in a moment.",
  );
}
