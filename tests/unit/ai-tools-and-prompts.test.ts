import { describe, expect, it } from "vitest";

import { EMPTY_DRAFT, EMPTY_TRIP_DETAILS } from "@/lib/domain/trip-details";
import { getAiStatus } from "@/server/ai/config";
import { buildInstructions } from "@/server/ai/prompts";
import { toolsFor } from "@/server/ai/tools";

import { PARK_CITY_FLIGHTS } from "../support/flights";

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

describe("trip tools", () => {
  it("can record bookings, change stops, and suggest theme tasks", () => {
    expect(toolsFor("trip").map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "record_booking",
        "update_trip_stops",
        "suggest_theme_tasks",
      ]),
    );
    expect(toolsFor("draft").map((tool) => tool.name)).not.toContain(
      "record_booking",
    );
  });
});

describe("buildInstructions for a trip", () => {
  const parkCity = {
    ...EMPTY_DRAFT,
    details: {
      ...EMPTY_TRIP_DETAILS,
      title: "Park City trip",
      destination: "Park City",
      startDate: "2027-02-27",
      endDate: "2027-03-07",
      flyIntoAirport: "SLC",
      flyOutOfAirport: "SLC",
    },
    stops: [
      { name: "Jackson Hole", startDate: "2027-02-27", endDate: "2027-03-02" },
      { name: "Park City", startDate: "2027-03-02", endDate: "2027-03-07" },
    ],
  };
  const base = {
    phase: "trip" as const,
    startMode: "KNOWN_DESTINATION" as const,
    today: "2026-10-16",
    userName: "Vaughn",
    researchAvailable: false,
  };

  it("never talks about a group on a one-member trip", () => {
    const solo = buildInstructions({
      ...base,
      draft: parkCity,
      soloTrip: true,
    });
    expect(solo).toContain("This trip has one member: the user.");
    expect(solo).not.toMatch(
      /waiting for the group|wait for the group to confirm/i,
    );
    const group = buildInstructions({
      ...base,
      draft: parkCity,
      soloTrip: false,
      memberNames: ["Vaughn", "Sam"],
    });
    expect(group).toContain(
      "Changes to details someone already set wait for a member to accept them on the Overview tab.",
    );
  });

  it("asks about a ski trip that context only implies, and lists the stops", () => {
    const instructions = buildInstructions({
      ...base,
      draft: parkCity,
      soloTrip: true,
    });
    expect(instructions).toContain('Ask once, briefly: "Is this a ski trip?"');
    expect(instructions).toContain(
      '"stops":["Jackson Hole (Feb 27 to Mar 2)","Park City (Mar 2 to Mar 7)"]',
    );
    expect(instructions).toContain('"titleIsAutomatic":true');
    expect(instructions).toContain("record it with record_booking");
  });

  it("offers a better title and theme tasks once the theme is known", () => {
    const instructions = buildInstructions({
      ...base,
      draft: { ...parkCity, details: { ...parkCity.details, theme: "SKI" } },
      soloTrip: true,
      themeTasksPending: true,
    });
    expect(instructions).not.toContain("Is this a ski trip?");
    expect(instructions).toContain(
      'Title: "Park City trip" was generated automatically.',
    );
    expect(instructions).toContain("suggest_theme_tasks");
  });

  it("lists flights shown earlier so a purchase can be tied to one", () => {
    const instructions = buildInstructions({
      ...base,
      draft: parkCity,
      soloTrip: true,
      flightSearch: "live",
      flightSource: "Google Flights via SerpApi",
      shownFlights: PARK_CITY_FLIGHTS["LGA-SLC"].map((offer, index) => ({
        resultId: `f${index + 1}`,
        offer,
      })),
    });
    expect(instructions).toContain(
      "- f1: Southwest, one way: LGA 2027-02-27 06:00 to SLC 2027-02-27 09:45",
    );
    expect(instructions).toContain("- f2: Delta");
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
