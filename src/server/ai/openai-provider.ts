import "server-only";

import OpenAI from "openai";
import type { ResponseInputItem } from "openai/resources/responses/responses";

import {
  openAiModel,
  openAiReasoningEffort,
  type ReasoningEffort,
} from "./config";
import {
  LlmProviderError,
  type GenerateRequest,
  type GenerateResult,
  type LlmProvider,
} from "./types";

type ResponsesClient = Pick<OpenAI, "responses">;

/**
 * OpenAI implementation using the Responses API with function tools. Current OpenAI models only
 * support function calling through this API. Requests use `store: false` so conversations are not
 * retained by the provider; encrypted reasoning items are passed back between tool rounds.
 */
export class OpenAiProvider implements LlmProvider {
  readonly id = "openai";
  readonly model: string;
  private readonly client: ResponsesClient;
  private readonly reasoningEffort: ReasoningEffort | null;

  constructor(
    options: {
      client?: ResponsesClient;
      model?: string;
      reasoningEffort?: ReasoningEffort | null;
    } = {},
  ) {
    this.client =
      options.client ?? new OpenAI({ maxRetries: 1, timeout: 60_000 });
    this.model = options.model ?? openAiModel();
    this.reasoningEffort =
      options.reasoningEffort === undefined
        ? openAiReasoningEffort()
        : options.reasoningEffort;
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const input: ResponseInputItem[] = request.messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));
    const tools = request.tools.map((tool) => ({
      type: "function" as const,
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      strict: true,
    }));

    for (let round = 0; ; round += 1) {
      const lastRound = round >= request.maxToolRounds;
      let response;
      try {
        response = await this.client.responses.create(
          {
            model: this.model,
            instructions: request.instructions,
            input,
            tools,
            tool_choice: lastRound ? "none" : "auto",
            parallel_tool_calls: true,
            store: false,
            include: ["reasoning.encrypted_content"],
            ...(this.reasoningEffort
              ? { reasoning: { effort: this.reasoningEffort } }
              : {}),
          },
          { signal: request.signal },
        );
      } catch (error) {
        throw toProviderError(error);
      }

      if (response.status === "failed" || response.error) {
        throw new LlmProviderError(
          "unavailable",
          response.error?.message ?? "The model request failed.",
        );
      }

      const calls = response.output.filter(
        (item) => item.type === "function_call",
      );
      if (calls.length === 0 || lastRound) {
        const refusal = response.output
          .flatMap((item) => (item.type === "message" ? item.content : []))
          .find((part) => part.type === "refusal");
        const text = (response.output_text ?? "").trim();
        if (!text) {
          if (refusal && refusal.type === "refusal")
            throw new LlmProviderError("refused", refusal.refusal);
          throw new LlmProviderError(
            "bad_response",
            "The model returned an empty reply.",
          );
        }
        return { text, model: response.model ?? this.model, toolRounds: round };
      }

      // Carry the model's own output (reasoning, messages, calls) into the next round.
      input.push(...(response.output as ResponseInputItem[]));
      for (const call of calls) {
        const output = await request.executeTool({
          callId: call.call_id,
          name: call.name,
          arguments: call.arguments,
        });
        input.push({
          type: "function_call_output",
          call_id: call.call_id,
          output,
        });
      }
    }
  }
}

export function toProviderError(error: unknown): LlmProviderError {
  if (error instanceof LlmProviderError) return error;
  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    return new LlmProviderError(
      "timeout",
      "The AI provider took too long to respond.",
    );
  }
  if (
    error instanceof OpenAI.AuthenticationError ||
    error instanceof OpenAI.PermissionDeniedError
  ) {
    return new LlmProviderError(
      "auth",
      "The AI provider rejected the API key.",
    );
  }
  if (error instanceof OpenAI.RateLimitError) {
    return new LlmProviderError(
      "rate_limit",
      "The AI provider is rate limiting requests.",
    );
  }
  if (error instanceof OpenAI.NotFoundError) {
    return new LlmProviderError(
      "unavailable",
      "The configured model was not found. Check OPENAI_MODEL.",
    );
  }
  if (error instanceof OpenAI.BadRequestError) {
    return new LlmProviderError(
      "bad_response",
      "The AI provider could not process the request.",
    );
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return new LlmProviderError(
      "unavailable",
      "Could not reach the AI provider.",
    );
  }
  if (error instanceof OpenAI.APIError) {
    return new LlmProviderError(
      "unavailable",
      "The AI provider returned an error.",
    );
  }
  if (error instanceof Error && error.name === "AbortError") {
    return new LlmProviderError("timeout", "The request was cancelled.");
  }
  return new LlmProviderError(
    "unavailable",
    "The AI provider returned an unexpected error.",
  );
}
