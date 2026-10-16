import type {
  CabinClass,
  FlightOffer,
  FlightSearchSummary,
  PriceInsights,
} from "@/lib/flights";

export type FlightSearchQuery = {
  /** A 3-letter IATA airport or city code, or a place name the provider resolves. */
  origin: string;
  destination: string;
  departureDate: string;
  returnDate: string | null;
  passengers: number;
  cabin: CabinClass | null;
  /** 0 means nonstop only. */
  maxStops: number;
};

export type FlightSearchResult = {
  search: FlightSearchSummary;
  offers: FlightOffer[];
  retrievedAt: string;
  sourceName: string;
  testMode: boolean;
  /** The source's own price comparison for the route, when it returned one. */
  priceInsights?: PriceInsights | null;
  /** True when this came from the app's search cache instead of a new provider request. */
  cached?: boolean;
};

export type FlightProviderErrorKind =
  | "auth"
  | "rate_limit"
  | "invalid_request"
  | "unknown_place"
  | "unavailable"
  | "timeout"
  | "bad_response";

/** Thrown when no flight provider is configured. The message is safe to show. */
export class FlightSearchUnavailableError extends Error {
  constructor(message = "Flight search is not configured.") {
    super(message);
    this.name = "FlightSearchUnavailableError";
  }
}

/** A vendor failure mapped to a kind and a message that is safe to show to the user. */
export class FlightProviderError extends Error {
  constructor(
    readonly kind: FlightProviderErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "FlightProviderError";
  }
}

/**
 * A flight search backend. Implementations wrap a vendor API and return offers exactly as priced.
 * The UI and Atlas only see this interface, so a live-mode token or a booking-capable provider can
 * be added later without touching them.
 */
export interface FlightSearchProvider {
  readonly id: string;
  readonly label: string;
  readonly testMode: boolean;
  search(
    query: FlightSearchQuery,
    signal?: AbortSignal,
  ): Promise<FlightSearchResult>;
  /**
   * Loads return options for a round trip whose outbound was priced without a chosen return
   * (`offer.pendingReturn`). Each returned offer has both legs. Providers that price whole round
   * trips in one request leave this out.
   */
  searchReturns?(
    offer: FlightOffer,
    signal?: AbortSignal,
  ): Promise<FlightSearchResult>;
}
