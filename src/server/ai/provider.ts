import "server-only";

import { getAiStatus } from "./config";
import { OpenAiProvider } from "./openai-provider";
import type { LlmProvider } from "./types";

/** Returns the configured provider, or null when AI is not configured. */
export function getLlmProvider(): LlmProvider | null {
  const status = getAiStatus();
  if (!status.configured) return null;
  switch (status.provider) {
    case "openai":
      return new OpenAiProvider({ model: status.model });
  }
}
