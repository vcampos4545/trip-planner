import { ResearchUnavailableError, type ResearchProvider } from "./types";

/** Used when no search provider is configured. Every search reports that live research is off. */
export class NotConfiguredResearchProvider implements ResearchProvider {
  readonly id = "none";
  readonly label = "Not configured";
  readonly isConfigured = false;

  async search(): Promise<never> {
    throw new ResearchUnavailableError(
      "Live search is not configured, so there are no real-time results, prices, or availability. Options can be added by hand.",
    );
  }
}
