import { describe, expect, it } from "vitest";

import {
  isAutomaticTitle,
  skiDestinationsIn,
  THEME_TASKS,
  themeHint,
  tripMonths,
  type ThemeContext,
} from "@/lib/domain/theme";

function context(overrides: Partial<ThemeContext> = {}): ThemeContext {
  return {
    theme: null,
    tripStyle: null,
    preferences: [],
    destination: null,
    stops: [],
    startDate: null,
    endDate: null,
    dateNotes: null,
    ...overrides,
  };
}

describe("themeHint", () => {
  it("records a theme the user stated instead of asking", () => {
    expect(
      themeHint(
        context({
          destination: "Park City",
          preferences: [{ description: "Wants to ski every day" }],
        }),
      ),
    ).toEqual({
      kind: "stated",
      theme: "SKI",
      reason: "the user mentioned skiing or snowboarding",
    });
    expect(
      themeHint(context({ tripStyle: "snowboarding with friends" })),
    ).toMatchObject({ kind: "stated", theme: "SKI" });
    expect(themeHint(context({ tripStyle: "beach and surf" }))).toMatchObject({
      kind: "stated",
      theme: "BEACH",
    });
  });

  it("asks when ski season and well-known ski towns only imply it", () => {
    expect(
      themeHint(
        context({
          destination: "Park City",
          stops: [{ name: "Jackson Hole" }, { name: "Park City" }],
          startDate: "2027-02-27",
          endDate: "2027-03-07",
        }),
      ),
    ).toEqual({
      kind: "ask",
      theme: "SKI",
      question: "Is this a ski trip?",
      reason:
        "February is ski season and Park City and Jackson Hole are well-known ski destinations",
    });
  });

  it("reads the season from timing notes", () => {
    expect(
      themeHint(
        context({ destination: "Aspen, CO", dateNotes: "early March" }),
      ),
    ).toMatchObject({ kind: "ask", reason: expect.stringMatching(/^March/) });
    expect(
      themeHint(
        context({ destination: "Whistler", dateNotes: "over Christmas" }),
      ),
    ).toMatchObject({ kind: "ask" });
  });

  it("uses the southern season for southern resorts", () => {
    expect(
      themeHint(
        context({
          destination: "Queenstown",
          startDate: "2027-07-10",
          endDate: "2027-07-15",
        }),
      ),
    ).toMatchObject({ kind: "ask", theme: "SKI" });
    expect(
      themeHint(
        context({
          destination: "Queenstown",
          startDate: "2027-01-10",
          endDate: "2027-01-15",
        }),
      ),
    ).toBeNull();
  });

  it("does not ask out of season, without timing, or for other places", () => {
    expect(
      themeHint(
        context({
          destination: "Park City",
          startDate: "2027-07-01",
          endDate: "2027-07-05",
        }),
      ),
    ).toBeNull();
    expect(themeHint(context({ destination: "Park City" }))).toBeNull();
    expect(
      themeHint(
        context({
          destination: "Lisbon",
          startDate: "2027-02-01",
          endDate: "2027-02-05",
        }),
      ),
    ).toBeNull();
  });

  it("stays quiet once a theme is known, including no particular theme", () => {
    const winter = {
      destination: "Park City",
      startDate: "2027-02-27",
      endDate: "2027-03-07",
    };
    expect(themeHint(context({ ...winter, theme: "SKI" }))).toBeNull();
    expect(themeHint(context({ ...winter, theme: "NONE" }))).toBeNull();
  });
});

describe("theme helpers", () => {
  it("matches ski destinations by whole words", () => {
    expect(
      skiDestinationsIn(["Park City, UT", "Altamonte Springs"]).map(
        (place) => place.name,
      ),
    ).toEqual(["Park City"]);
  });

  it("lists the months a trip touches", () => {
    expect(
      tripMonths({
        startDate: "2027-02-27",
        endDate: "2027-03-07",
        dateNotes: null,
      }).sort(),
    ).toEqual([2, 3]);
    expect(
      tripMonths({ startDate: null, endDate: null, dateNotes: "Spring break" }),
    ).toEqual([3]);
  });

  it("knows which titles the app generated", () => {
    const places = {
      destination: "Park City",
      stops: [{ name: "Jackson Hole" }],
    };
    expect(isAutomaticTitle("Park City trip", places)).toBe(true);
    expect(isAutomaticTitle("Jackson Hole trip", places)).toBe(true);
    expect(isAutomaticTitle("New trip", places)).toBe(true);
    expect(isAutomaticTitle(null, places)).toBe(true);
    expect(isAutomaticTitle("Out West ski trip", places)).toBe(false);
  });

  it("has the usual ski tasks", () => {
    expect(THEME_TASKS.SKI!.map((task) => task.title)).toEqual([
      "Reserve ski or snowboard rentals",
      "Buy lift passes",
      "Book ski or snowboard lessons",
      "Check ski gear and warm layers",
    ]);
  });
});
