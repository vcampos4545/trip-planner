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

/**
 * Used when RESEARCH_PROVIDER names a provider that cannot run, for example because its API key
 * is missing. Searches fail with the reason instead of quietly falling back to anything else.
 */
export class UnavailableResearchProvider implements ResearchProvider {
  readonly isConfigured = false;

  constructor(
    readonly id: string,
    readonly label: string,
    readonly unavailableReason: string,
  ) {}

  async search(): Promise<never> {
    throw new ResearchUnavailableError(
      `Live research is unavailable: ${this.unavailableReason} There are no real-time results, prices, or availability.`,
    );
  }
}
