import { describe, expect, it } from "vitest";

import {
  applyChanges,
  classifyPatch,
  crossFieldProblem,
  deriveTitle,
  EMPTY_DRAFT,
  EMPTY_TRIP_DETAILS,
  isEstablishable,
  mergeCandidates,
  mergePreferences,
  parseDraft,
  tripDetailsPatchSchema,
  type TripDraft,
} from "@/lib/domain/trip-details";

function draft(
  details: Partial<TripDraft["details"]>,
  extra: Partial<TripDraft> = {},
): TripDraft {
  return {
    ...EMPTY_DRAFT,
    ...extra,
    details: { ...EMPTY_TRIP_DETAILS, ...details },
  };
}

describe("classifyPatch", () => {
  it("fills unknown fields and flags changes to known ones", () => {
    const current = {
      ...EMPTY_TRIP_DETAILS,
      destination: "Lisbon",
      groupSize: 4,
    };
    const { fills, overwrites } = classifyPatch(current, {
      destination: "Porto",
      groupSize: 4,
      startDate: "2027-05-20",
      dateFlexibility: "FIXED",
    });
    expect(fills.map((change) => change.field).sort()).toEqual([
      "dateFlexibility",
      "startDate",
    ]);
    expect(overwrites).toEqual([
      { field: "destination", from: "Lisbon", to: "Porto" },
    ]);
  });

  it("treats UNKNOWN enums, false flags, and empty lists as unknown", () => {
    const { fills, overwrites } = classifyPatch(EMPTY_TRIP_DETAILS, {
      lodgingStatus: "BOOKED",
      destinationConfirmed: true,
      budgetIncludes: ["FLIGHTS"],
    });
    expect(overwrites).toHaveLength(0);
    expect(fills).toHaveLength(3);
  });

  it("ignores values that clear a field or repeat what is known", () => {
    const current = {
      ...EMPTY_TRIP_DETAILS,
      tripStyle: "food",
      budgetIncludes: ["FLIGHTS", "LODGING"] as ("FLIGHTS" | "LODGING")[],
    };
    const { fills, overwrites } = classifyPatch(current, {
      tripStyle: " food ",
      budgetIncludes: ["LODGING", "FLIGHTS"],
      lodgingStatus: "UNKNOWN",
    });
    expect(fills).toHaveLength(0);
    expect(overwrites).toHaveLength(0);
  });
});

describe("tripDetailsPatchSchema", () => {
  it("rejects impossible dates and malformed money", () => {
    expect(
      tripDetailsPatchSchema.safeParse({ startDate: "2027-02-30" }).success,
    ).toBe(false);
    expect(
      tripDetailsPatchSchema.safeParse({ budgetAmount: "about 2k" }).success,
    ).toBe(false);
    expect(tripDetailsPatchSchema.safeParse({ groupSize: 0 }).success).toBe(
      false,
    );
    expect(
      tripDetailsPatchSchema.safeParse({
        startDate: "2027-02-28",
        budgetAmount: "2000",
      }).success,
    ).toBe(true);
  });
});

describe("crossFieldProblem", () => {
  it("catches an end date before the start date", () => {
    const details = applyChanges(EMPTY_TRIP_DETAILS, [
      { field: "startDate", from: null, to: "2027-05-10" },
      { field: "endDate", from: null, to: "2027-05-01" },
    ]);
    expect(crossFieldProblem(details)).toMatch(/end date/i);
  });
});

describe("isEstablishable", () => {
  it("accepts a named destination on its own", () => {
    expect(isEstablishable(draft({ destination: "Lisbon" }))).toBe(true);
  });

  it("needs a second anchor when only a vibe is known", () => {
    expect(isEstablishable(draft({ tripStyle: "beach and food" }))).toBe(false);
    expect(
      isEstablishable(
        draft({ tripStyle: "beach and food", departureLocation: "Chicago" }),
      ),
    ).toBe(true);
  });

  it("accepts candidate destinations plus timing", () => {
    expect(
      isEstablishable(
        draft(
          { dateNotes: "late May" },
          {
            candidateDestinations: [
              { name: "Porto", reason: null, suggestedBy: "user" },
            ],
          },
        ),
      ),
    ).toBe(true);
  });

  it("does not create a trip from nothing", () => {
    expect(isEstablishable(EMPTY_DRAFT)).toBe(false);
  });
});

describe("deriveTitle", () => {
  it("prefers an explicit title, then destination, then candidates, then vibe", () => {
    expect(
      deriveTitle(draft({ title: "Bachelor weekend", destination: "Austin" })),
    ).toBe("Bachelor weekend");
    expect(deriveTitle(draft({ destination: "Austin" }))).toBe("Austin trip");
    expect(
      deriveTitle(
        draft(
          {},
          {
            candidateDestinations: [
              { name: "Lisbon", reason: null, suggestedBy: "atlas" },
              { name: "Porto", reason: null, suggestedBy: "atlas" },
            ],
          },
        ),
      ),
    ).toBe("Lisbon or Porto?");
    expect(deriveTitle(draft({ tripStyle: "ski trip with friends" }))).toBe(
      "Ski trip with friends",
    );
    expect(deriveTitle(EMPTY_DRAFT, "DISCOVER")).toBe("Trip to be discovered");
  });
});

describe("merging", () => {
  it("dedupes candidates and preferences case-insensitively", () => {
    expect(
      mergeCandidates(
        [{ name: "Lisbon", reason: null, suggestedBy: "user" }],
        [{ name: "lisbon ", reason: "x", suggestedBy: "atlas" }],
      ),
    ).toHaveLength(1);
    expect(
      mergePreferences(
        [
          {
            kind: "DIETARY",
            strength: "REQUIREMENT",
            description: "Vegetarian",
          },
        ],
        [
          {
            kind: "DIETARY",
            strength: "PREFERENCE",
            description: "vegetarian",
          },
          { kind: "INTEREST", strength: "PREFERENCE", description: "Museums" },
        ],
      ),
    ).toHaveLength(2);
  });
});

describe("parseDraft", () => {
  it("falls back to an empty draft for corrupt JSON", () => {
    expect(parseDraft({ details: { destination: 42 } })).toEqual(EMPTY_DRAFT);
    expect(parseDraft(null)).toEqual(EMPTY_DRAFT);
    // Drafts saved before stops, airports, and themes existed still load.
    const stored = {
      details: { ...EMPTY_TRIP_DETAILS, destination: "Park City" } as Record<
        string,
        unknown
      >,
      preferences: [],
      candidateDestinations: [],
    };
    delete stored.details.flyIntoAirport;
    delete stored.details.flyOutOfAirport;
    delete stored.details.theme;
    expect(parseDraft(stored)).toEqual({
      ...EMPTY_DRAFT,
      details: { ...EMPTY_TRIP_DETAILS, destination: "Park City" },
    });
  });
});
