import "server-only";

import { createHash } from "node:crypto";

import type { FlightOffer } from "@/lib/flights";

import type {
  FlightSearchProvider,
  FlightSearchQuery,
  FlightSearchResult,
} from "./types";

/**
 * Identical flight searches within a short window are answered from a cache so they do not spend
 * the provider's quota again. Cached results keep their original retrieval time, so they are never
 * shown as fresher than they are, and they are marked `cached`. Only successful searches are kept.
 */

export interface FlightCacheStore {
  /** Returns the stored value, or null when it is missing or expired at `now`. */
  get(key: string, now: Date): Promise<unknown | null>;
  set(key: string, value: unknown, expiresAt: Date): Promise<void>;
}

export const DEFAULT_CACHE_HOURS = 3;

export function cacheKey(providerId: string, kind: string, value: unknown) {
  const digest = createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
  return `${providerId}:${kind}:${digest}`;
}

/** The parts of a search that change the answer, normalized so trivial differences share a key. */
function searchKey(query: FlightSearchQuery) {
  return {
    origin: query.origin.trim().toLowerCase(),
    destination: query.destination.trim().toLowerCase(),
    departureDate: query.departureDate,
    returnDate: query.returnDate,
    passengers: query.passengers,
    cabin: query.cabin,
    maxStops: query.maxStops,
  };
}

function returnsKey(offer: FlightOffer) {
  return {
    pendingReturn: offer.pendingReturn,
    passengers: offer.passengers,
    cabin: offer.cabin,
    outbound: offer.slices[0]?.departingAt,
  };
}

export class CachedFlightProvider implements FlightSearchProvider {
  readonly id: string;
  readonly label: string;
  readonly testMode: boolean;
  readonly searchReturns?: FlightSearchProvider["searchReturns"];

  constructor(
    private readonly inner: FlightSearchProvider,
    private readonly store: FlightCacheStore,
    private readonly ttlMs: number,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.id = inner.id;
    this.label = inner.label;
    this.testMode = inner.testMode;
    if (inner.searchReturns) {
      this.searchReturns = (offer, signal) =>
        this.cached(cacheKey(this.id, "returns", returnsKey(offer)), () =>
          inner.searchReturns!(offer, signal),
        );
    }
  }

  search(
    query: FlightSearchQuery,
    signal?: AbortSignal,
  ): Promise<FlightSearchResult> {
    return this.cached(cacheKey(this.id, "search", searchKey(query)), () =>
      this.inner.search(query, signal),
    );
  }

  private async cached(
    key: string,
    load: () => Promise<FlightSearchResult>,
  ): Promise<FlightSearchResult> {
    try {
      const hit = (await this.store.get(
        key,
        this.now(),
      )) as FlightSearchResult | null;
      if (hit) return { ...hit, cached: true };
    } catch (error) {
      // A cache that can't be read only costs a search; it never blocks one.
      console.error(
        "[flights] cache read failed:",
        error instanceof Error ? error.message : "unknown",
      );
    }
    const result = await load();
    if (this.ttlMs > 0) {
      try {
        await this.store.set(
          key,
          { ...result, cached: false },
          new Date(this.now().getTime() + this.ttlMs),
        );
      } catch (error) {
        console.error(
          "[flights] cache write failed:",
          error instanceof Error ? error.message : "unknown",
        );
      }
    }
    return { ...result, cached: false };
  }
}
