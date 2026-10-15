import type { OptionCategory } from "@/generated/prisma/enums";

export type ResearchQuery = {
  category: OptionCategory;
  query: string;
  location: string | null;
  limit: number;
};

/** A candidate returned by a live provider. Prices are only present when the provider sent them. */
export type ResearchResult = {
  title: string;
  description: string | null;
  url: string | null;
  sourceName: string;
  priceAmount: string | null;
  priceCurrency: string | null;
  priceUnit: string | null;
  locationName: string | null;
  latitude: number | null;
  longitude: number | null;
  retrievedAt: Date;
  payload?: Record<string, unknown>;
};

export class ResearchUnavailableError extends Error {
  constructor(message = "Live research is not configured.") {
    super(message);
    this.name = "ResearchUnavailableError";
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
  search(query: ResearchQuery, signal?: AbortSignal): Promise<ResearchResult[]>;
}
