import OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";

import { OpenAiProvider } from "@/server/ai/openai-provider";
import { LlmProviderError, type GenerateRequest } from "@/server/ai/types";

type CreateFn = (
  body: Record<string, unknown>,
  options?: unknown,
) => Promise<unknown>;

function fakeClient(
  responses: unknown[] | ((body: Record<string, unknown>) => unknown),
) {
  const calls: Record<string, unknown>[] = [];
  const create = vi.fn<CreateFn>(async (body) => {
    calls.push(structuredClone(body));
    if (typeof responses === "function") return responses(body);
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  });
  return {
    client: { responses: { create } } as unknown as Pick<OpenAI, "responses">,
    calls,
    create,
  };
}

function textResponse(text: string) {
  return {
    status: "completed",
    error: null,
    model: "gpt-test",
    output: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text }],
      },
    ],
    output_text: text,
  };
}

function toolCallResponse(
  calls: { name: string; args: unknown; id: string }[],
) {
  return {
    status: "completed",
    error: null,
    model: "gpt-test",
    output: [
      {
        type: "reasoning",
        id: "rs_1",
        summary: [],
        encrypted_content: "opaque",
      },
      ...calls.map((call) => ({
        type: "function_call",
        id: `fc_${call.id}`,
        call_id: call.id,
        name: call.name,
        arguments: JSON.stringify(call.args),
      })),
    ],
    output_text: "",
  };
}

function request(overrides: Partial<GenerateRequest> = {}): GenerateRequest {
  return {
    instructions: "You are Atlas.",
    messages: [{ role: "user", content: "We want to go to Lisbon" }],
    tools: [
      {
        name: "update_trip_details",
        description: "Record details",
        parameters: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        },
      },
    ],
    executeTool: async () => JSON.stringify({ ok: true }),
    maxToolRounds: 3,
    ...overrides,
  };
}

describe("OpenAiProvider", () => {
  it("sends strict function tools through the Responses API without storing the conversation", async () => {
    const { client, calls } = fakeClient([textResponse("Sounds great.")]);
    const provider = new OpenAiProvider({
      client,
      model: "gpt-test",
      reasoningEffort: null,
    });
    const result = await provider.generate(request());
    expect(result).toEqual({
      text: "Sounds great.",
      model: "gpt-test",
      toolRounds: 0,
    });
    const body = calls[0]!;
    expect(body.model).toBe("gpt-test");
    expect(body.store).toBe(false);
    expect(body.instructions).toBe("You are Atlas.");
    expect(body.include).toEqual(["reasoning.encrypted_content"]);
    expect(body.tools).toEqual([
      expect.objectContaining({
        type: "function",
        name: "update_trip_details",
        strict: true,
      }),
    ]);
    expect(body.input).toEqual([
      { role: "user", content: "We want to go to Lisbon" },
    ]);
    expect(body).not.toHaveProperty("reasoning");
  });

  it("runs tool calls and passes their outputs back with the model's own items", async () => {
    const { client, calls } = fakeClient([
      toolCallResponse([
        {
          name: "update_trip_details",
          args: { destination: "Lisbon" },
          id: "call_1",
        },
      ]),
      textResponse("Saved Lisbon."),
    ]);
    const executeTool = vi.fn(async () =>
      JSON.stringify({ ok: true, result: { saved: ["destination"] } }),
    );
    const provider = new OpenAiProvider({
      client,
      model: "gpt-test",
      reasoningEffort: "low",
    });
    const result = await provider.generate(request({ executeTool }));

    expect(executeTool).toHaveBeenCalledWith({
      callId: "call_1",
      name: "update_trip_details",
      arguments: JSON.stringify({ destination: "Lisbon" }),
    });
    expect(result.text).toBe("Saved Lisbon.");
    expect(result.toolRounds).toBe(1);
    const second = calls[1]!;
    const input = second.input as Record<string, unknown>[];
    expect(input.map((item) => item.type ?? item.role)).toEqual([
      "user",
      "reasoning",
      "function_call",
      "function_call_output",
    ]);
    expect(input[3]).toEqual({
      type: "function_call_output",
      call_id: "call_1",
      output: JSON.stringify({ ok: true, result: { saved: ["destination"] } }),
    });
    expect(second.reasoning).toEqual({ effort: "low" });
  });

  it("stops calling tools after the round limit", async () => {
    const { client, calls } = fakeClient((body) =>
      body.tool_choice === "none"
        ? textResponse("Here is where we are.")
        : toolCallResponse([
            { name: "get_trip_state", args: {}, id: `c${Math.random()}` },
          ]),
    );
    const provider = new OpenAiProvider({
      client,
      model: "gpt-test",
      reasoningEffort: null,
    });
    const result = await provider.generate(request({ maxToolRounds: 2 }));
    expect(calls).toHaveLength(3);
    expect(calls[2]!.tool_choice).toBe("none");
    expect(result.text).toBe("Here is where we are.");
  });

  it("treats an empty reply as a bad response instead of inventing text", async () => {
    const { client } = fakeClient([{ ...textResponse(""), output: [] }]);
    const provider = new OpenAiProvider({
      client,
      model: "gpt-test",
      reasoningEffort: null,
    });
    await expect(provider.generate(request())).rejects.toMatchObject({
      kind: "bad_response",
    });
  });

  it("maps SDK errors to provider error kinds", async () => {
    const cases: [Error, string][] = [
      [
        new OpenAI.AuthenticationError(
          401,
          undefined,
          "bad key",
          new Headers(),
        ),
        "auth",
      ],
      [
        new OpenAI.RateLimitError(429, undefined, "slow down", new Headers()),
        "rate_limit",
      ],
      [new OpenAI.APIConnectionTimeoutError(), "timeout"],
      [new OpenAI.APIConnectionError({ message: "offline" }), "unavailable"],
      [
        new OpenAI.NotFoundError(404, undefined, "no model", new Headers()),
        "unavailable",
      ],
    ];
    for (const [error, kind] of cases) {
      const { client } = fakeClient([error]);
      const provider = new OpenAiProvider({
        client,
        model: "gpt-test",
        reasoningEffort: null,
      });
      const failure = await provider
        .generate(request())
        .catch((caught: unknown) => caught);
      expect(failure).toBeInstanceOf(LlmProviderError);
      expect((failure as LlmProviderError).kind).toBe(kind);
    }
  });
});
