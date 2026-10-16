import type {
  StayKind,
  StayOffer,
  StaySearchSummary,
  StaySort,
} from "@/lib/stays";
import type { SerpApiErrorKind } from "@/server/serpapi/client";

export type StaySearchQuery = {
  /** A town, area, or address, such as "Park City, Utah". */
  location: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  kind: StayKind;
  /** Minimum bedrooms. Only vacation rental searches can filter on it. */
  bedrooms: number | null;
  /** Nightly price bounds in the search currency, whole units. */
  minPrice: number | null;
  maxPrice: number | null;
  sort: StaySort;
};

export type StaySearchResult = {
  search: StaySearchSummary;
  offers: StayOffer[];
  retrievedAt: string;
  sourceName: string;
  /** True when this came from the app's search cache instead of a new provider request. */
  cached?: boolean;
};

export type StayProviderErrorKind = SerpApiErrorKind;

/** A vendor failure mapped to a kind and a message that is safe to show to the user. */
export class StayProviderError extends Error {
  constructor(
    readonly kind: StayProviderErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "StayProviderError";
  }
}

/**
 * A stay search backend. Implementations wrap a vendor API and return places with prices exactly
 * as the vendor quoted them. The UI and Atlas only see this interface, so Booking.com or Expedia
 * can replace SerpApi later without touching them.
 */
export interface StaySearchProvider {
  readonly id: string;
  readonly label: string;
  /** False when the provider can only search hotels. The UI and Atlas then say so. */
  readonly supportsVacationRentals: boolean;
  search(
    query: StaySearchQuery,
    signal?: AbortSignal,
  ): Promise<StaySearchResult>;
}
