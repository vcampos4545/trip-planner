import { describe, expect, it } from "vitest";

import { EMPTY_DRAFT, EMPTY_TRIP_DETAILS } from "@/lib/domain/trip-details";
import { getAiStatus } from "@/server/ai/config";
import { buildInstructions } from "@/server/ai/prompts";
import { toolsFor } from "@/server/ai/tools";

function walk(node: unknown, visit: (object: Record<string, unknown>) => void) {
  if (Array.isArray(node)) node.forEach((item) => walk(item, visit));
  else if (node && typeof node === "object") {
    visit(node as Record<string, unknown>);
    Object.values(node).forEach((value) => walk(value, visit));
  }
}

describe("tool schemas", () => {
  it("are strict: every object forbids extra keys and requires all of its properties", () => {
    for (const phase of ["draft", "trip"] as const) {
      for (const tool of toolsFor(phase)) {
        expect(tool.parameters.type).toBe("object");
        expect(tool.parameters).not.toHaveProperty("$schema");
        walk(tool.parameters, (object) => {
          if (object.type === "object") {
            expect(object.additionalProperties).toBe(false);
            expect(object.required).toEqual(
              Object.keys((object.properties as object) ?? {}),
            );
          }
        });
      }
    }
  });

  it("only exposes detail tools before the trip exists", () => {
    expect(
      toolsFor("draft")
        .map((tool) => tool.name)
        .sort(),
    ).toEqual(["get_trip_state", "update_trip_details", "update_trip_stops"]);
    expect(toolsFor("trip").map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "search_options",
        "save_research_option",
        "list_saved_research",
        "suggest_task",
        "propose_itinerary_event",
        "summarize_outstanding_decisions",
      ]),
    );
  });
});

describe("buildInstructions", () => {
  it("names Atlas, lists what is known, and only asks about unknowns", () => {
    const instructions = buildInstructions({
      phase: "draft",
      startMode: "KNOWN_DESTINATION",
      draft: {
        ...EMPTY_DRAFT,
        details: { ...EMPTY_TRIP_DETAILS, destination: "Lisbon", groupSize: 3 },
      },
      today: "2026-10-15",
      userName: "Riley",
      researchAvailable: false,
    });
    expect(instructions).toContain("You are Atlas");
    expect(instructions).toContain('"destination":"Lisbon"');
    const asking =
      instructions.split("Worth asking next, in order:").at(-1) ?? "";
    expect(asking).not.toContain("where they want to go");
    expect(asking).not.toContain("who is coming");
    expect(asking).toContain("when they can travel");
    expect(instructions).toMatch(/no live prices/i);
  });
});

describe("getAiStatus", () => {
  it("reports that a key is needed when none is set", () => {
    const previous = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "";
    expect(getAiStatus()).toEqual({
      configured: false,
      reason: "OPENAI_API_KEY is not set on the server.",
    });
    process.env.OPENAI_API_KEY = "sk-test";
    expect(getAiStatus()).toMatchObject({
      configured: true,
      provider: "openai",
    });
    process.env.OPENAI_API_KEY = previous;
  });
});
