import "server-only";

/**
 * AI configuration comes from server environment variables only:
 * - AI_PROVIDER: "openai" (the only provider implemented today)
 * - OPENAI_API_KEY: required for Atlas to work
 * - OPENAI_MODEL: optional, defaults to DEFAULT_OPENAI_MODEL
 * - OPENAI_BASE_URL: optional, for gateways or compatible proxies (read by the SDK)
 * - OPENAI_REASONING_EFFORT: optional reasoning effort for models that support it
 */

export const DEFAULT_OPENAI_MODEL = "gpt-6.1-sol";

const REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export type AiStatus =
  | { configured: true; provider: "openai"; model: string }
  | { configured: false; reason: string };

export function getAiStatus(): AiStatus {
  const provider = (process.env.AI_PROVIDER || "openai").trim().toLowerCase();
  if (provider !== "openai") {
    return {
      configured: false,
      reason: `AI_PROVIDER "${provider}" is not supported. Use "openai".`,
    };
  }
  if (!process.env.OPENAI_API_KEY?.trim()) {
    return {
      configured: false,
      reason: "OPENAI_API_KEY is not set on the server.",
    };
  }
  return { configured: true, provider: "openai", model: openAiModel() };
}

export function openAiModel() {
  return process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
}

export function openAiReasoningEffort(): ReasoningEffort | null {
  const value = process.env.OPENAI_REASONING_EFFORT?.trim().toLowerCase();
  return value && (REASONING_EFFORTS as readonly string[]).includes(value)
    ? (value as ReasoningEffort)
    : null;
}
