import "server-only";

import { DuffelFlightProvider, isDuffelTestToken } from "./duffel";
import type { FlightSearchProvider } from "./types";

/**
 * Flight search configuration comes from server environment variables only:
 * - FLIGHT_PROVIDER: "duffel" (default) or "none" to turn flight search off
 * - DUFFEL_ACCESS_TOKEN: a Duffel test token (duffel_test_...). Live tokens are not accepted yet.
 * - DUFFEL_API_URL: optional base URL override, used by the end-to-end tests to reach a local stub
 */
export type FlightSearchStatus =
  | { configured: true; provider: "duffel"; label: string; testMode: boolean }
  | { configured: false; reason: string };

export function getFlightSearchStatus(): FlightSearchStatus {
  const provider = (process.env.FLIGHT_PROVIDER || "duffel")
    .trim()
    .toLowerCase();
  if (provider === "none") {
    return {
      configured: false,
      reason: "Flight search is turned off on the server.",
    };
  }
  if (provider !== "duffel") {
    return {
      configured: false,
      reason: `FLIGHT_PROVIDER "${provider}" is not supported. Use "duffel" or "none".`,
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

/** Returns the configured provider, or null when flight search is not configured. */
export function getFlightProvider(): FlightSearchProvider | null {
  const status = getFlightSearchStatus();
  if (!status.configured) return null;
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
