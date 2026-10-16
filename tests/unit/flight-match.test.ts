import { describe, expect, it } from "vitest";

import {
  describeMatch,
  isShownFlight,
  matchShownFlights,
  nextResultId,
  type FlightReference,
  type ShownFlight,
} from "@/lib/domain/flight-match";

import { sampleOffer } from "../support/duffel";
import { PARK_CITY_FLIGHTS } from "../support/flights";

const shown: ShownFlight[] = [
  ...PARK_CITY_FLIGHTS["LGA-SLC"],
  ...PARK_CITY_FLIGHTS["SLC-JFK"],
].map((offer, index) => ({ resultId: `f${index + 1}`, offer }));

function ref(values: Partial<FlightReference>): FlightReference {
  return {
    resultId: null,
    airline: null,
    flightNumber: null,
    date: null,
    departureTime: null,
    arrivalTime: null,
    origin: null,
    destination: null,
    leg: null,
    ...values,
  };
}

describe("matchShownFlights", () => {
  it("finds the one flight an airline name points to", () => {
    const matches = matchShownFlights(shown, ref({ airline: "southwest" }));
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ resultId: "f1", leg: "one way" });
  });

  it("reports an ambiguous reference instead of guessing", () => {
    const matches = matchShownFlights(shown, ref({ airline: "American" }));
    expect(matches.map((match) => match.resultId)).toEqual(["f3", "f4"]);
  });

  it("uses times, dates, flight numbers, and airports to narrow it down", () => {
    expect(
      matchShownFlights(
        shown,
        ref({ airline: "American", arrivalTime: "14:59" }),
      ).map((match) => match.resultId),
    ).toEqual(["f3"]);
    expect(
      matchShownFlights(shown, ref({ flightNumber: "1880" })).map(
        (match) => match.resultId,
      ),
    ).toEqual(["f4"]);
    expect(
      matchShownFlights(shown, ref({ flightNumber: "DL 455" })).map(
        (match) => match.resultId,
      ),
    ).toEqual(["f2"]);
    expect(
      matchShownFlights(
        shown,
        ref({ origin: "Salt Lake City", departureTime: "12:30" }),
      ).map((match) => match.resultId),
    ).toEqual(["f4"]);
    expect(
      matchShownFlights(
        shown,
        ref({ airline: "American", date: "2027-02-27" }),
      ),
    ).toEqual([]);
  });

  it("does not match a flight number from another airline", () => {
    expect(matchShownFlights(shown, ref({ flightNumber: "UA1234" }))).toEqual(
      [],
    );
  });

  it("counts the same flight shown in two searches once, using the latest", () => {
    const repeated = [
      ...shown,
      { resultId: "f9", offer: PARK_CITY_FLIGHTS["LGA-SLC"][0]! },
    ];
    const matches = matchShownFlights(repeated, ref({ airline: "Southwest" }));
    expect(matches.map((match) => match.resultId)).toEqual(["f9"]);
  });

  it("picks one leg of a round trip when the reference is about that leg", () => {
    const roundTrip = sampleOffer({
      slices: [
        sampleOffer().slices[0]!,
        {
          ...sampleOffer().slices[0]!,
          origin: { iataCode: "LIS", name: null, cityName: "Lisbon" },
          destination: { iataCode: "JFK", name: null, cityName: "New York" },
          departingAt: "2026-11-27T11:00:00",
          arrivingAt: "2026-11-27T14:20:00",
        },
      ],
    });
    const list = [{ resultId: "f1", offer: roundTrip }];
    expect(matchShownFlights(list, ref({ airline: "Duffel" }))[0]!.leg).toBe(
      "round trip",
    );
    expect(
      matchShownFlights(list, ref({ arrivalTime: "14:20" }))[0],
    ).toMatchObject({
      leg: "return",
      slices: [{ departingAt: "2026-11-27T11:00:00" }],
    });
    expect(matchShownFlights(list, ref({ leg: "outbound" }))[0]!.leg).toBe(
      "outbound",
    );
  });

  it("limits the search to a given result ID", () => {
    expect(
      matchShownFlights(
        shown,
        ref({ resultId: "f4", airline: "American" }),
      ).map((match) => match.resultId),
    ).toEqual(["f4"]);
  });

  it("describes a match for asking which one", () => {
    expect(
      describeMatch(matchShownFlights(shown, ref({ resultId: "f3" }))[0]!),
    ).toBe(
      "American Airlines, one way: SLC 2027-03-07 07:05 to JFK 2027-03-07 14:59 (local times), Nonstop, 4h, American Airlines AA2210",
    );
  });
});

describe("stored results", () => {
  it("only trusts results with the expected shape", () => {
    expect(isShownFlight(shown[0])).toBe(true);
    expect(isShownFlight({ resultId: "r1", offer: shown[0]!.offer })).toBe(
      false,
    );
    expect(isShownFlight({ resultId: "f1", offer: { offerId: "x" } })).toBe(
      false,
    );
    expect(isShownFlight(null)).toBe(false);
  });

  it("continues result IDs after the highest one used", () => {
    expect(nextResultId([])).toBe("f1");
    expect(nextResultId(["f3", "f12", "f7"])).toBe("f13");
  });
});
