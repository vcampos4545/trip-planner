import "server-only";

import { NotConfiguredResearchProvider } from "./not-configured";
import type { ResearchProvider } from "./types";

/**
 * Selects the research provider from RESEARCH_PROVIDER. Only "none" ships today. To add a live
 * provider, implement ResearchProvider (see docs/architecture.md) and register it here.
 */
export function getResearchProvider(): ResearchProvider {
  const id = (process.env.RESEARCH_PROVIDER || "none").trim().toLowerCase();
  switch (id) {
    case "none":
    default:
      return new NotConfiguredResearchProvider();
  }
}

export type { ResearchProvider, ResearchQuery, ResearchResult } from "./types";
export { ResearchUnavailableError } from "./types";
