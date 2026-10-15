/**
 * Provider-neutral types for Atlas. Nothing here depends on a specific LLM vendor.
 */

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type ToolSpec = {
  name: string;
  description: string;
  /** JSON Schema for the arguments, already in strict form (all properties required). */
  parameters: Record<string, unknown>;
};

export type ToolCall = { callId: string; name: string; arguments: string };

export type GenerateRequest = {
  instructions: string;
  messages: ChatTurn[];
  tools: ToolSpec[];
  /** Runs one tool call and returns the JSON string handed back to the model. */
  executeTool: (call: ToolCall) => Promise<string>;
  maxToolRounds: number;
  signal?: AbortSignal;
};

export type GenerateResult = {
  text: string;
  model: string;
  toolRounds: number;
};

export type ProviderErrorKind =
  | "auth"
  | "rate_limit"
  | "unavailable"
  | "timeout"
  | "bad_response"
  | "refused";

export class LlmProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "LlmProviderError";
  }
}

/** A chat model with function calling, hidden behind a small interface. */
export interface LlmProvider {
  readonly id: string;
  readonly model: string;
  generate(request: GenerateRequest): Promise<GenerateResult>;
}
