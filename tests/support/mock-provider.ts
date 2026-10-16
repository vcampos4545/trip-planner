import {
  LlmProviderError,
  type GenerateRequest,
  type GenerateResult,
  type LlmProvider,
} from "@/server/ai/types";

/**
 * A scripted stand-in for the LLM used in tests. Each turn lists the tool calls the "model" makes
 * and the reply it gives. Tool calls go through the real tool execution path.
 */
export type ScriptedTurn = {
  calls?: { name: string; args: unknown; raw?: string }[];
  reply?: string;
  fail?: LlmProviderError;
  failAfterTools?: LlmProviderError;
};

export class ScriptedProvider implements LlmProvider {
  readonly id = "mock";
  readonly model = "scripted";
  readonly requests: GenerateRequest[] = [];
  readonly toolOutputs: { name: string; output: unknown }[] = [];

  constructor(private readonly turns: ScriptedTurn[]) {}

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    this.requests.push(request);
    const turn = this.turns.shift();
    if (!turn) throw new Error("ScriptedProvider ran out of turns");
    if (turn.fail) throw turn.fail;
    let index = 0;
    for (const call of turn.calls ?? []) {
      index += 1;
      const output = await request.executeTool({
        callId: `call_${index}`,
        name: call.name,
        arguments: call.raw ?? JSON.stringify(call.args),
      });
      this.toolOutputs.push({ name: call.name, output: JSON.parse(output) });
    }
    if (turn.failAfterTools) throw turn.failAfterTools;
    return {
      text: turn.reply ?? "Done.",
      model: "scripted",
      toolRounds: turn.calls?.length ? 1 : 0,
    };
  }
}

/** Full set of nullable detail fields for update_trip_details, as a strict-mode model sends them. */
export function detailChanges(values: Record<string, unknown>) {
  const keys = [
    "title",
    "summary",
    "destination",
    "destinationConfirmed",
    "departureLocation",
    "flyIntoAirport",
    "flyOutOfAirport",
    "tripStyle",
    "theme",
    "startDate",
    "endDate",
    "dateFlexibility",
    "dateNotes",
    "durationDays",
    "groupSize",
    "groupNotes",
    "budgetAmount",
    "budgetCurrency",
    "budgetBasis",
    "budgetIncludes",
    "budgetNotes",
    "flightsStatus",
    "lodgingStatus",
    "localTransportStatus",
    "activitiesStatus",
  ];
  return Object.fromEntries(
    keys.map((key) => [key, key in values ? values[key] : null]),
  );
}

export function updateCall(
  values: Record<string, unknown>,
  extra: { preferences?: unknown[]; candidateDestinations?: unknown[] } = {},
) {
  return {
    name: "update_trip_details",
    args: {
      changes: detailChanges(values),
      preferences: extra.preferences ?? [],
      candidateDestinations: extra.candidateDestinations ?? [],
    },
  };
}
