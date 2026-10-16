import "server-only";

import {
  cacheKey,
  readThroughCache,
  type FlightCacheStore,
} from "@/server/flights/cache";

import type {
  StaySearchProvider,
  StaySearchQuery,
  StaySearchResult,
} from "./types";

/** The parts of a search that change the answer, normalized so trivial differences share a key. */
function searchKey(query: StaySearchQuery) {
  return {
    location: query.location.trim().toLowerCase().replace(/\s+/g, " "),
    checkIn: query.checkIn,
    checkOut: query.checkOut,
    guests: query.guests,
    kind: query.kind,
    bedrooms: query.kind === "vacation_rental" ? query.bedrooms : null,
    minPrice: query.minPrice,
    maxPrice: query.maxPrice,
    sort: query.sort,
  };
}

/**
 * Answers identical stay searches from the same persisted cache flight search uses, so a repeated
 * search does not spend the shared SerpApi quota again. Cached results keep their original
 * retrieval time and are marked `cached`. Only successful searches are kept.
 */
export class CachedStayProvider implements StaySearchProvider {
  readonly id: string;
  readonly label: string;
  readonly supportsVacationRentals: boolean;

  constructor(
    private readonly inner: StaySearchProvider,
    private readonly store: FlightCacheStore,
    private readonly ttlMs: number,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.id = inner.id;
    this.label = inner.label;
    this.supportsVacationRentals = inner.supportsVacationRentals;
  }

  search(
    query: StaySearchQuery,
    signal?: AbortSignal,
  ): Promise<StaySearchResult> {
    return readThroughCache(
      this.store,
      cacheKey(this.id, "search", searchKey(query)),
      this.ttlMs,
      this.now,
      () => this.inner.search(query, signal),
    );
  }
}
