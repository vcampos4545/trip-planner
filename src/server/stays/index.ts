import "server-only";

import { dbFlightCache } from "@/server/flights/db-cache";
import { serpApiCacheHours } from "@/server/flights";

import { CachedStayProvider } from "./cache";
import { HOTELS_SOURCE_NAME, SerpApiStayProvider } from "./serpapi";
import type { StaySearchProvider } from "./types";

/**
 * Stay search configuration comes from server environment variables only:
 * - STAYS_PROVIDER: "serpapi" (default) for Google Hotels results, or "none" to turn it off
 * - SERPAPI_API_KEY: the same SerpApi key flight search uses; both share its search quota
 * - SERPAPI_CACHE_HOURS: how long identical searches are reused (default 3, 0 to 24)
 * - SERPAPI_API_URL: optional base URL override, used by the end-to-end tests to reach a local stub
 */
export type StayProviderId = "serpapi";

export type StaySearchStatus =
  | {
      configured: true;
      provider: StayProviderId;
      label: string;
      supportsVacationRentals: boolean;
    }
  | { configured: false; reason: string };

function selectedProvider() {
  return (process.env.STAYS_PROVIDER || "serpapi").trim().toLowerCase();
}

export function getStaySearchStatus(): StaySearchStatus {
  const provider = selectedProvider();
  if (provider === "none") {
    return {
      configured: false,
      reason: "Stay search is turned off on the server.",
    };
  }
  if (provider !== "serpapi") {
    return {
      configured: false,
      reason: `STAYS_PROVIDER "${provider}" is not supported. Use "serpapi" or "none".`,
    };
  }
  if (!process.env.SERPAPI_API_KEY?.trim()) {
    return {
      configured: false,
      reason: "SERPAPI_API_KEY is not set on the server.",
    };
  }
  return {
    configured: true,
    provider: "serpapi",
    label: HOTELS_SOURCE_NAME,
    supportsVacationRentals: true,
  };
}

/** Returns the configured provider, or null when stay search is not configured. */
export function getStayProvider(): StaySearchProvider | null {
  const status = getStaySearchStatus();
  if (!status.configured) return null;
  const serpapi = new SerpApiStayProvider({
    apiKey: process.env.SERPAPI_API_KEY!.trim(),
    baseUrl: process.env.SERPAPI_API_URL?.trim() || undefined,
  });
  return new CachedStayProvider(
    serpapi,
    dbFlightCache,
    serpApiCacheHours() * 60 * 60 * 1000,
  );
}

export type {
  StaySearchProvider,
  StaySearchQuery,
  StaySearchResult,
} from "./types";
export { StayProviderError } from "./types";
