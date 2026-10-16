import { describe, expect, it } from "vitest";

import {
  applyStopOps,
  classifyStopChange,
  describeAirports,
  describeStops,
  stopListProblem,
  stopOnDate,
  syncStopsWithDestination,
  type TripStopInput,
} from "@/lib/domain/stops";

const stop = (
  name: string,
  startDate: string | null = null,
  endDate: string | null = null,
): TripStopInput => ({ name, startDate, endDate });

const TRIP = { startDate: "2027-02-27", endDate: "2027-03-07" };

describe("applyStopOps", () => {
  it("adds stops in order, at a position or at the end", () => {
    const result = applyStopOps(
      [stop("Park City")],
      [
        {
          op: "add",
          name: "Jackson Hole",
          startDate: "2027-02-27",
          endDate: "2027-03-02",
          position: 0,
        },
        {
          op: "add",
          name: "Salt Lake City",
          startDate: null,
          endDate: null,
          position: null,
        },
      ],
    );
    expect(result).toEqual({
      ok: true,
      stops: [
        stop("Jackson Hole", "2027-02-27", "2027-03-02"),
        stop("Park City"),
        stop("Salt Lake City"),
      ],
    });
  });

  it("treats adding an existing stop as filling in what was said about it", () => {
    const result = applyStopOps(
      [stop("Park City")],
      [
        {
          op: "add",
          name: "park city",
          startDate: "2027-03-02",
          endDate: "2027-03-07",
          position: 0,
        },
      ],
    );
    expect(result).toEqual({
      ok: true,
      stops: [stop("Park City", "2027-03-02", "2027-03-07")],
    });
  });

  it("updates, renames, moves, and removes by name", () => {
    const current = [stop("Jackson"), stop("Park City"), stop("Alta")];
    const result = applyStopOps(current, [
      {
        op: "update",
        name: "jackson",
        newName: "Jackson Hole",
        startDate: "2027-02-27",
        endDate: null,
      },
      { op: "move", name: "Alta", position: 0 },
      { op: "remove", name: "Park City" },
    ]);
    expect(result).toEqual({
      ok: true,
      stops: [stop("Alta"), stop("Jackson Hole", "2027-02-27")],
    });
    // The input list is not modified.
    expect(current[0]!.name).toBe("Jackson");
  });

  it("reports unknown stops and rename clashes without changing anything", () => {
    expect(
      applyStopOps([stop("Park City")], [{ op: "remove", name: "Aspen" }]),
    ).toEqual({ ok: false, error: 'No stop named "Aspen".' });
    expect(
      applyStopOps(
        [stop("Park City"), stop("Alta")],
        [
          {
            op: "update",
            name: "Alta",
            newName: "Park City",
            startDate: null,
            endDate: null,
          },
        ],
      ),
    ).toEqual({
      ok: false,
      error: 'There is already a stop named "Park City".',
    });
  });
});

describe("stopListProblem", () => {
  it("accepts stops in travel order that share a travel day", () => {
    expect(
      stopListProblem(
        [
          stop("Jackson Hole", "2027-02-27", "2027-03-02"),
          stop("Park City", "2027-03-02", "2027-03-07"),
        ],
        TRIP,
      ),
    ).toBeNull();
    expect(stopListProblem([stop("Park City")], TRIP)).toBeNull();
  });

  it("rejects duplicates, backwards ranges, and dates outside the trip", () => {
    expect(
      stopListProblem([stop("Park City"), stop("park city")], TRIP),
    ).toMatch(/listed twice/);
    expect(
      stopListProblem([stop("Park City", "2027-03-05", "2027-03-02")], TRIP),
    ).toBe("Park City ends before it starts.");
    expect(stopListProblem([stop("Park City", "2027-02-20", null)], TRIP)).toBe(
      "Park City is dated before the trip starts.",
    );
    expect(stopListProblem([stop("Park City", null, "2027-03-10")], TRIP)).toBe(
      "Park City is dated after the trip ends.",
    );
  });

  it("rejects stops out of travel order", () => {
    expect(
      stopListProblem(
        [
          stop("Park City", "2027-03-02", "2027-03-07"),
          stop("Jackson Hole", "2027-02-27", "2027-03-02"),
        ],
        TRIP,
      ),
    ).toMatch(/Jackson Hole starts before Park City ends/);
  });

  it("rejects names that are too short and lists that are too long", () => {
    expect(stopListProblem([stop("X")], TRIP)).toMatch(/2 to 120 characters/);
    expect(
      stopListProblem(
        Array.from({ length: 13 }, (_, index) => stop(`Stop ${index}`)),
        TRIP,
      ),
    ).toBe("A trip can have up to 12 stops.");
  });
});

describe("classifyStopChange", () => {
  const current = [stop("Park City")];

  it("calls adding stops or missing dates a fill", () => {
    expect(classifyStopChange(current, current)).toBe("none");
    expect(classifyStopChange([], [stop("Park City")])).toBe("fill");
    expect(
      classifyStopChange(current, [stop("Jackson Hole"), stop("Park City")]),
    ).toBe("fill");
    expect(classifyStopChange(current, [stop("Park City", "2027-03-02")])).toBe(
      "fill",
    );
  });

  it("calls removing, renaming, reordering, or re-dating an overwrite", () => {
    const two = [stop("Jackson Hole", "2027-02-27"), stop("Park City")];
    expect(classifyStopChange(two, [stop("Park City")])).toBe("overwrite");
    expect(
      classifyStopChange(two, [
        stop("Jackson", "2027-02-27"),
        stop("Park City"),
      ]),
    ).toBe("overwrite");
    expect(
      classifyStopChange(two, [
        stop("Park City"),
        stop("Jackson Hole", "2027-02-27"),
      ]),
    ).toBe("overwrite");
    expect(
      classifyStopChange(two, [
        stop("Jackson Hole", "2027-02-28"),
        stop("Park City"),
      ]),
    ).toBe("overwrite");
  });
});

describe("syncStopsWithDestination", () => {
  it("makes the destination the first stop of a trip without stops", () => {
    expect(syncStopsWithDestination([], null, "Park City")).toEqual([
      stop("Park City"),
    ]);
  });

  it("renames a lone undated stop that mirrored the old destination", () => {
    expect(
      syncStopsWithDestination([stop("Park City")], "Park City", "Salt Lake"),
    ).toEqual([stop("Salt Lake")]);
  });

  it("leaves real stop lists alone", () => {
    expect(
      syncStopsWithDestination(
        [stop("Jackson Hole"), stop("Park City")],
        "Park City",
        "Utah",
      ),
    ).toBeNull();
    expect(
      syncStopsWithDestination(
        [stop("Park City", "2027-03-02")],
        "Park City",
        "Utah",
      ),
    ).toBeNull();
    expect(syncStopsWithDestination([], null, null)).toBeNull();
  });
});

describe("describing stops and airports", () => {
  it("reads naturally", () => {
    expect(
      describeStops([
        stop("Jackson Hole", "2027-02-27", "2027-03-02"),
        stop("Park City"),
      ]),
    ).toBe("Jackson Hole (Feb 27 to Mar 2), then Park City");
    expect(describeAirports("SLC", "slc")).toBe("In and out of SLC");
    expect(describeAirports("SLC", "DEN")).toBe("Into SLC, home from DEN");
    expect(describeAirports(null, "DEN")).toBe("Home from DEN");
    expect(describeAirports(null, null)).toBeNull();
  });

  it("finds the stop for a date, preferring the arrival on a travel day", () => {
    const stops = [
      stop("Jackson Hole", "2027-02-27", "2027-03-02"),
      stop("Park City", "2027-03-02", "2027-03-07"),
    ];
    expect(stopOnDate(stops, "2027-02-28")?.name).toBe("Jackson Hole");
    expect(stopOnDate(stops, "2027-03-02")?.name).toBe("Park City");
    expect(stopOnDate(stops, "2027-03-09")).toBeNull();
  });
});
