import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import { centsToDecimal } from "@/lib/money";
import {
  googleHotelsUrl,
  nightsBetween,
  type StayKind,
  type StayOffer,
  type StayPriceSource,
  type StaySearchSummary,
  type StaySort,
} from "@/lib/stays";
import { SerpApiClient, type SerpApiCopy } from "@/server/serpapi/client";

import {
  StayProviderError,
  type StaySearchProvider,
  type StaySearchQuery,
  type StaySearchResult,
} from "./types";

/**
 * Stay search through SerpApi's Google Hotels API (https://serpapi.com/google-hotels-api). SerpApi
 * returns what Google Hotels shows, so prices are Google's lowest quotes at retrieval time, from
 * whichever listing sites Google compares, and can change. Vacation rentals are a separate search
 * (`vacation_rentals=true`) that can filter on bedrooms. Google Hotels has no room-count filter:
 * prices are for the number of guests. Results link out to Google to book; the app never books.
 *
 * It uses the same SerpApi account and key as flight search, so every request spends the same
 * quota (the free plan allows about 250 a month and 50 an hour).
 */

export const HOTELS_SOURCE_NAME = "Google Hotels via SerpApi";
export const MAX_STAY_OFFERS = 10;
const CURRENCY = "USD";
const NO_RESULTS = /hasn't returned any results|no results/i;
const PROPERTY_DETAILS = /property details/i;

const SORT_BY: Record<StaySort, string | null> = {
  relevance: null,
  lowest_price: "3",
  highest_rating: "8",
  most_reviewed: "13",
};

export const STAY_COPY: SerpApiCopy<StayProviderError> = {
  service: "Google Hotels",
  searches: "searches",
  quotaFallback:
    "Saved stays still work, and you can still add a place from a link.",
  invalidHint: "Check the place and dates.",
  toError: (kind, message) => new StayProviderError(kind, message),
};

const rateSchema = z
  .object({
    lowest: z.string().nullish(),
    extracted_lowest: z.number().nullish(),
  })
  .nullish();

const propertySchema = z.object({
  type: z.string().nullish(),
  name: z.string().trim().min(1),
  description: z.string().nullish(),
  link: z.string().nullish(),
  sponsored: z.boolean().nullish(),
  property_token: z.string().nullish(),
  gps_coordinates: z
    .object({ latitude: z.number(), longitude: z.number() })
    .nullish(),
  check_in_time: z.string().nullish(),
  check_out_time: z.string().nullish(),
  rate_per_night: rateSchema,
  total_rate: rateSchema,
  prices: z
    .array(
      z.object({
        source: z.string().nullish(),
        rate_per_night: rateSchema,
      }),
    )
    .nullish(),
  extracted_hotel_class: z.number().nullish(),
  images: z
    .array(
      z.object({
        thumbnail: z.string().nullish(),
        original_image: z.string().nullish(),
      }),
    )
    .nullish(),
  overall_rating: z.number().nullish(),
  reviews: z.number().nullish(),
  amenities: z.array(z.string()).nullish(),
  essential_info: z.array(z.string()).nullish(),
});

const searchSchema = z.object({
  search_metadata: z.object({ status: z.string().nullish() }).nullish(),
  search_information: z
    .object({ hotels_results_state: z.string().nullish() })
    .nullish(),
  properties: z.array(z.unknown()).nullish(),
  error: z.string().nullish(),
});

type SerpProperty = z.infer<typeof propertySchema>;

export type SerpApiStayOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  now?: () => Date;
};

export class SerpApiStayProvider implements StaySearchProvider {
  readonly id = "serpapi-hotels";
  readonly label = HOTELS_SOURCE_NAME;
  readonly supportsVacationRentals = true;
  private readonly client: SerpApiClient<StayProviderError>;
  private readonly now: () => Date;

  constructor(options: SerpApiStayOptions) {
    this.client = new SerpApiClient(options, STAY_COPY);
    this.now = options.now ?? (() => new Date());
  }

  async search(
    query: StaySearchQuery,
    signal?: AbortSignal,
  ): Promise<StaySearchResult> {
    const rentals = query.kind === "vacation_rental";
    const sortBy = SORT_BY[query.sort];
    const json = await this.client.request(
      {
        engine: "google_hotels",
        q: query.location.trim(),
        check_in_date: query.checkIn,
        check_out_date: query.checkOut,
        adults: String(query.guests),
        currency: CURRENCY,
        hl: "en",
        gl: "us",
        ...(sortBy ? { sort_by: sortBy } : {}),
        ...(query.minPrice !== null
          ? { min_price: String(query.minPrice) }
          : {}),
        ...(query.maxPrice !== null
          ? { max_price: String(query.maxPrice) }
          : {}),
        ...(rentals ? { vacation_rentals: "true" } : {}),
        ...(rentals && query.bedrooms
          ? { bedrooms: String(query.bedrooms) }
          : {}),
      },
      signal,
    );
    const search: StaySearchSummary = {
      location: query.location.trim(),
      checkIn: query.checkIn,
      checkOut: query.checkOut,
      nights: nightsBetween(query.checkIn, query.checkOut),
      guests: query.guests,
      kind: query.kind,
      bedrooms: rentals ? query.bedrooms : null,
      minPrice: query.minPrice,
      maxPrice: query.maxPrice,
      sort: query.sort,
      currency: CURRENCY,
    };
    return this.toResult(json, search);
  }

  private toResult(json: unknown, search: StaySearchSummary): StaySearchResult {
    const retrievedAt = this.now().toISOString();
    const parsed = searchSchema.safeParse(json);
    if (!parsed.success) throw this.client.badResponse();
    const data = parsed.data;
    if (data.search_metadata?.status === "Error") {
      throw new StayProviderError(
        "unavailable",
        "SerpApi couldn't get Google Hotels results for this search. Try again in a moment.",
      );
    }
    if (data.error && !NO_RESULTS.test(data.error))
      throw this.client.badResponse();
    // A query that names one property exactly gets that property's details instead of a list.
    const raw = PROPERTY_DETAILS.test(
      data.search_information?.hotels_results_state ?? "",
    )
      ? [json]
      : (data.properties ?? []);
    const offers = raw
      .map((item) => propertySchema.safeParse(item))
      .flatMap((result) => (result.success ? [result.data] : []))
      .map((property) => toOffer(property, search, retrievedAt))
      .filter((offer): offer is StayOffer => offer !== null)
      .filter(
        (offer, index, all) =>
          all.findIndex((other) => other.offerId === offer.offerId) === index,
      )
      .slice(0, MAX_STAY_OFFERS);
    return {
      search,
      offers,
      retrievedAt,
      sourceName: HOTELS_SOURCE_NAME,
    };
  }
}

function amountOf(value: number | null | undefined): string | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? centsToDecimal(Math.round(value * 100))
    : null;
}

function kindOf(property: SerpProperty, searched: StayKind): StayKind {
  if (!property.type) return searched;
  return /vacation|rental/i.test(property.type) ? "vacation_rental" : "hotel";
}

/** Only https links are passed on, and never Google ad redirects. */
function safeUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (
      /(^|\.)google\.[a-z.]+$/i.test(url.hostname) &&
      url.pathname === "/aclk"
    )
      return null;
    return url.toString();
  } catch {
    return null;
  }
}

function priceSources(property: SerpProperty): StayPriceSource[] {
  return (property.prices ?? [])
    .flatMap((price) => {
      const source = price.source?.trim();
      if (!source) return [];
      return [
        {
          source: source.slice(0, 80),
          nightlyAmount: amountOf(price.rate_per_night?.extracted_lowest),
        },
      ];
    })
    .sort(
      (a, b) =>
        Number(a.nightlyAmount ?? Infinity) -
        Number(b.nightlyAmount ?? Infinity),
    )
    .slice(0, 4);
}

function toOffer(
  property: SerpProperty,
  search: StaySearchSummary,
  retrievedAt: string,
): StayOffer | null {
  const nightlyAmount = amountOf(property.rate_per_night?.extracted_lowest);
  const totalAmount = amountOf(property.total_rate?.extracted_lowest);
  // Google lists some places without a rate for the dates. Without one there is nothing to price.
  if (!nightlyAmount && !totalAmount) return null;
  const name = property.name.slice(0, 160);
  const coordinates = property.gps_coordinates;
  const validCoordinates =
    coordinates &&
    Math.abs(coordinates.latitude) <= 90 &&
    Math.abs(coordinates.longitude) <= 180;
  const hotelClass = property.extracted_hotel_class;
  const rating = property.overall_rating;
  const kind = kindOf(property, search.kind);
  const identity = property.property_token ?? [
    name,
    coordinates?.latitude,
    coordinates?.longitude,
  ];
  const offerId = `gh_${createHash("sha256")
    .update(
      JSON.stringify([
        identity,
        search.checkIn,
        search.checkOut,
        search.guests,
        kind,
        nightlyAmount,
        totalAmount,
      ]),
    )
    .digest("hex")
    .slice(0, 24)}`;
  return {
    offerId,
    name,
    kind,
    description: property.description?.trim().slice(0, 400) || null,
    hotelClass:
      typeof hotelClass === "number" && hotelClass >= 1 && hotelClass <= 5
        ? Math.round(hotelClass)
        : null,
    rating:
      typeof rating === "number" && rating >= 0 && rating <= 5
        ? Math.round(rating * 10) / 10
        : null,
    reviews:
      typeof property.reviews === "number" && property.reviews >= 0
        ? Math.round(property.reviews)
        : null,
    essentialInfo: (property.essential_info ?? [])
      .map((item) => item.trim().slice(0, 60))
      .filter(Boolean)
      .slice(0, 6),
    amenities: (property.amenities ?? [])
      .map((item) => item.trim().slice(0, 60))
      .filter(Boolean)
      .slice(0, 8),
    nightlyAmount,
    totalAmount,
    currency: search.currency,
    priceSources: priceSources(property),
    sponsored: property.sponsored === true,
    latitude: validCoordinates ? coordinates.latitude : null,
    longitude: validCoordinates ? coordinates.longitude : null,
    checkInTime: property.check_in_time?.trim().slice(0, 20) || null,
    checkOutTime: property.check_out_time?.trim().slice(0, 20) || null,
    imageUrl: safeUrl(property.images?.[0]?.thumbnail),
    propertyUrl: safeUrl(property.link),
    bookingUrl: googleHotelsUrl(name, search.location),
    propertyToken: property.property_token?.slice(0, 200) ?? null,
    location: search.location,
    checkIn: search.checkIn,
    checkOut: search.checkOut,
    nights: search.nights,
    guests: search.guests,
    retrievedAt,
    sourceName: HOTELS_SOURCE_NAME,
    providerId: "serpapi",
  };
}
