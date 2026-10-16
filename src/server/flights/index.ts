import "server-only";

import { CachedFlightProvider, DEFAULT_CACHE_HOURS } from "./cache";
import { dbFlightCache } from "./db-cache";
import { DuffelFlightProvider, isDuffelTestToken } from "./duffel";
import { SERPAPI_SOURCE_NAME, SerpApiFlightProvider } from "./serpapi";
import type { FlightSearchProvider } from "./types";

/**
 * Flight search configuration comes from server environment variables only:
 * - FLIGHT_PROVIDER: "serpapi" (default), "duffel", or "none" to turn flight search off
 * - SERPAPI_API_KEY: a SerpApi key, for Google Flights results
 * - SERPAPI_CACHE_HOURS: how long identical SerpApi searches are reused (default 3, 0 to 24)
 * - SERPAPI_API_URL: optional base URL override, used by the end-to-end tests to reach a local stub
 * - DUFFEL_ACCESS_TOKEN: a Duffel test token (duffel_test_...). Live tokens are not accepted yet.
 * - DUFFEL_API_URL: optional base URL override, used by the end-to-end tests to reach a local stub
 */
export type FlightProviderId = "serpapi" | "duffel";

export type FlightSearchStatus =
  | {
      configured: true;
      provider: FlightProviderId;
      label: string;
      testMode: boolean;
    }
  | { configured: false; reason: string };

function selectedProvider() {
  return (process.env.FLIGHT_PROVIDER || "serpapi").trim().toLowerCase();
}

export function getFlightSearchStatus(): FlightSearchStatus {
  const provider = selectedProvider();
  if (provider === "none") {
    return {
      configured: false,
      reason: "Flight search is turned off on the server.",
    };
  }
  if (provider === "serpapi") {
    if (!process.env.SERPAPI_API_KEY?.trim()) {
      return {
        configured: false,
        reason: "SERPAPI_API_KEY is not set on the server.",
      };
    }
    return {
      configured: true,
      provider: "serpapi",
      label: SERPAPI_SOURCE_NAME,
      testMode: false,
    };
  }
  if (provider !== "duffel") {
    return {
      configured: false,
      reason: `FLIGHT_PROVIDER "${provider}" is not supported. Use "serpapi", "duffel", or "none".`,
    };
  }
  const token = process.env.DUFFEL_ACCESS_TOKEN?.trim();
  if (!token) {
    return {
      configured: false,
      reason: "DUFFEL_ACCESS_TOKEN is not set on the server.",
    };
  }
  // Live Duffel tokens return real fares. Until that path is reviewed, only test tokens run.
  if (!isDuffelTestToken(token)) {
    return {
      configured: false,
      reason:
        "DUFFEL_ACCESS_TOKEN is not a Duffel test token (duffel_test_...). Only test mode is supported for now.",
    };
  }
  return {
    configured: true,
    provider: "duffel",
    label: "Duffel (test data)",
    testMode: true,
  };
}

export function serpApiCacheHours() {
  const raw = process.env.SERPAPI_CACHE_HOURS?.trim();
  const value = raw ? Number(raw) : Number.NaN;
  if (!Number.isFinite(value)) return DEFAULT_CACHE_HOURS;
  return Math.min(Math.max(value, 0), 24);
}

/** Returns the configured provider, or null when flight search is not configured. */
export function getFlightProvider(): FlightSearchProvider | null {
  const status = getFlightSearchStatus();
  if (!status.configured) return null;
  if (status.provider === "serpapi") {
    const serpapi = new SerpApiFlightProvider({
      apiKey: process.env.SERPAPI_API_KEY!.trim(),
      baseUrl: process.env.SERPAPI_API_URL?.trim() || undefined,
      placeCache: dbFlightCache,
    });
    return new CachedFlightProvider(
      serpapi,
      dbFlightCache,
      serpApiCacheHours() * 60 * 60 * 1000,
    );
  }
  return new DuffelFlightProvider({
    accessToken: process.env.DUFFEL_ACCESS_TOKEN!.trim(),
    baseUrl: process.env.DUFFEL_API_URL?.trim() || undefined,
  });
}

export type {
  FlightSearchProvider,
  FlightSearchQuery,
  FlightSearchResult,
} from "./types";
export { FlightProviderError, FlightSearchUnavailableError } from "./types";
export { RouteLookupError, type PlaceField, type PlaceIssue } from "./places";
