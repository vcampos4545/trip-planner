import type { OptionCategory } from "@/generated/prisma/enums";

export type ResearchQuery = {
  category: OptionCategory;
  query: string;
  location: string | null;
  limit: number;
};

/**
 * A candidate returned by a live provider. Prices and availability are only present when the
 * provider sent them, and they always come from the result's own source.
 */
export type ResearchResult = {
  title: string;
  description: string | null;
  url: string | null;
  sourceName: string;
  priceAmount: string | null;
  priceCurrency: string | null;
  priceUnit: string | null;
  /** Availability exactly as the source stated it, or null. */
  availabilityNote?: string | null;
  locationName: string | null;
  latitude: number | null;
  longitude: number | null;
  retrievedAt: Date;
  payload?: Record<string, unknown>;
};

/** Live research is off or cannot run with the current configuration. */
export class ResearchUnavailableError extends Error {
  constructor(message = "Live research is not configured.") {
    super(message);
    this.name = "ResearchUnavailableError";
  }
}

/** A configured provider tried to search and failed. No results are available for this search. */
export class ResearchFailedError extends Error {
  constructor(message = "The live search failed.") {
    super(message);
    this.name = "ResearchFailedError";
  }
}

/**
 * A search backend for destinations, stays, activities, and transport. Implementations wrap a
 * specific vendor API. The UI and Atlas only see this interface.
 */
export interface ResearchProvider {
  readonly id: string;
  readonly label: string;
  readonly isConfigured: boolean;
  /** Why a selected provider cannot run, when RESEARCH_PROVIDER is set but incomplete. */
  readonly unavailableReason?: string;
  search(query: ResearchQuery, signal?: AbortSignal): Promise<ResearchResult[]>;
}
