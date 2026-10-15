import "server-only";

import {
  NotConfiguredResearchProvider,
  UnavailableResearchProvider,
} from "./not-configured";
import { OPENAI_WEB_LABEL, OpenAiWebResearchProvider } from "./openai-web";
import type { ResearchProvider } from "./types";

/**
 * Selects the research provider from RESEARCH_PROVIDER:
 * - "none" (or unset): live search is off.
 * - "openai_web": OpenAI's hosted web search tool, using OPENAI_API_KEY.
 * To add another provider, implement ResearchProvider (see docs/architecture.md) and register it
 * here. A provider that is selected but cannot run reports why instead of falling back.
 */
export function getResearchProvider(): ResearchProvider {
  const id = (process.env.RESEARCH_PROVIDER || "none").trim().toLowerCase();
  switch (id) {
    case "":
    case "none":
      return new NotConfiguredResearchProvider();
    case "openai_web":
      if (!process.env.OPENAI_API_KEY?.trim()) {
        return new UnavailableResearchProvider(
          id,
          OPENAI_WEB_LABEL,
          "RESEARCH_PROVIDER is openai_web, but OPENAI_API_KEY is not set on the server.",
        );
      }
      return new OpenAiWebResearchProvider();
    default:
      return new UnavailableResearchProvider(
        id,
        "Unknown provider",
        `RESEARCH_PROVIDER "${id}" is not supported. Use "none" or "openai_web".`,
      );
  }
}

export type { ResearchProvider, ResearchQuery, ResearchResult } from "./types";
export { ResearchFailedError, ResearchUnavailableError } from "./types";
