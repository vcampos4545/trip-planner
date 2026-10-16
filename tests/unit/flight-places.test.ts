import { describe, expect, it, vi } from "vitest";

import {
  parsePlaceInput,
  pickPlace,
  type PlaceInput,
  type PlaceSuggestion,
} from "@/lib/domain/flight-places";
import { DomainError } from "@/server/errors";
import { RouteLookupError } from "@/server/flights";
import { DuffelFlightProvider } from "@/server/flights/duffel";
import { SerpApiFlightProvider } from "@/server/flights/serpapi";
import { searchFlights } from "@/server/services/flights";

import { jsonResponse } from "../support/duffel";
import {
  MemoryFlightCache,
  SUGGESTIONS_BY_QUERY,
  serpItem,
  serpSearch,
} from "../support/serpapi";

const NOW = new Date("2026-10-15T12:00:00.000Z");

const query = {
  departureDate: "2026-11-20",
  returnDate: null,
  passengers: 1,
  cabin: "economy" as const,
  maxStops: 1,
};

function name(text: string) {
  const input = parsePlaceInput(text);
  if (input?.kind !== "name") throw new Error(`"${text}" is not a name`);
  return input as Extract<PlaceInput, { kind: "name" }>;
}

function city(
  placeName: string,
  codes: string[],
  airportCities: string[],
  detail: string | null = null,
): PlaceSuggestion {
  return { name: placeName, detail, codes, airportCities };
}

describe("reading what was typed as From or To", () => {
  it.each([
    ["JFK", ["JFK"]],
    ["jfk", ["JFK"]],
    [" lis ", ["LIS"]],
    ["jfk, lga", ["JFK", "LGA"]],
    ["JFK or LGA", ["JFK", "LGA"]],
    ["JFK/EWR", ["JFK", "EWR"]],
    ["Boston (BOS)", ["BOS"]],
    ["JFK - John F. Kennedy", ["JFK"]],
    ["Lisbon - LIS", ["LIS"]],
    ["NYC (me)", ["NYC"]],
    // The form's own placeholders, typed as shown.
    ["New York or JFK", ["JFK"]],
    ["Lisbon or LIS", ["LIS"]],
  ])("reads %j as codes", (text, codes) => {
    expect(parsePlaceInput(text)).toEqual({ kind: "codes", codes });
  });

  it.each([
    ["New York", "New York", null, "New York"],
    ["  lisbon ", "lisbon", null, "lisbon"],
    ["Portland, OR", "Portland", "OR", "Portland, OR"],
    ["Lisbon, Portugal", "Lisbon", "Portugal", "Lisbon, Portugal"],
    ["New York City (Vaughn)", "New York City", null, "New York City"],
    ["Boston (my home), MA", "Boston", "MA", "Boston, MA"],
    ["Los Angeles or Burbank", "Los Angeles or Burbank", null, null],
  ])("reads %j as a name", (text, placeName, qualifier, cleaned) => {
    expect(parsePlaceInput(text)).toEqual({
      kind: "name",
      name: placeName,
      qualifier,
      text: cleaned ?? text,
    });
  });

  it("finds nothing usable in brackets alone", () => {
    expect(parsePlaceInput("(Vaughn)")).toBeNull();
    expect(parsePlaceInput("  ")).toBeNull();
  });
});

describe("picking the place a name means", () => {
  const lisbon = [
    city("Lisbon, Portugal", ["LIS"], ["Lisbon"]),
    city("Lisbon, Maine", ["PWM", "AUG"], ["Portland", "Augusta"]),
    city("Lisbon, Ohio", ["PIT"], ["Pittsburgh"]),
  ];
  const portland = [
    city("Portland, Oregon", ["PDX"], ["Portland"], "City in Oregon"),
    city("Portland, Maine", ["PWM"], ["Portland"], "City in Maine"),
  ];

  it("takes the city with its own airport over towns with one nearby", () => {
    expect(pickPlace(name("Lisbon"), lisbon)).toEqual({
      kind: "match",
      place: lisbon[0],
    });
  });

  it("asks which one when two cities of that name have their own airport", () => {
    expect(pickPlace(name("portland"), portland)).toEqual({
      kind: "ambiguous",
      candidates: [
        { label: "Portland, Oregon (PDX)", value: "Portland, Oregon" },
        { label: "Portland, Maine (PWM)", value: "Portland, Maine" },
      ],
    });
  });

  it("uses a state, country, or full name to tell them apart", () => {
    expect(pickPlace(name("Portland, OR"), portland)).toMatchObject({
      place: { codes: ["PDX"] },
    });
    expect(pickPlace(name("Portland, Maine"), portland)).toMatchObject({
      place: { codes: ["PWM"] },
    });
    expect(pickPlace(name("Lisbon, Portugal"), lisbon)).toMatchObject({
      place: { codes: ["LIS"] },
    });
  });

  it("offers codes when the names alone don't tell the places apart", () => {
    const sameNames = [
      city("Portland", ["PDX"], ["Portland"], "US"),
      city("Portland", ["PWM"], ["Portland"], "US"),
    ];
    expect(pickPlace(name("Portland"), sameNames)).toEqual({
      kind: "ambiguous",
      candidates: [
        { label: "Portland (PDX)", value: "PDX" },
        { label: "Portland (PWM)", value: "PWM" },
      ],
    });
  });

  it("goes with the first city when it has clearly more airports of its own", () => {
    const london = [
      city("London, UK", ["LHR", "LGW", "LCY"], ["London", "London", "London"]),
      city("London, Ontario", ["YXU"], ["London"]),
    ];
    expect(pickPlace(name("London"), london)).toMatchObject({
      place: { name: "London, UK" },
    });
  });

  it("goes with the source's first suggestion otherwise", () => {
    const newYork = [
      city(
        "New York",
        ["JFK", "LGA", "EWR"],
        ["New York", "New York", "Newark"],
      ),
      city("Buffalo, New York", ["BUF"], ["Buffalo"]),
    ];
    expect(pickPlace(name("New York City"), newYork)).toMatchObject({
      place: { codes: ["JFK", "LGA", "EWR"] },
    });
    const parkCity = [
      city("Park City, Utah", ["SLC"], ["Salt Lake City"]),
      city("Park City, Kansas", ["ICT"], ["Wichita"]),
    ];
    expect(pickPlace(name("Park City"), parkCity)).toMatchObject({
      place: { codes: ["SLC"] },
    });
  });

  it("finds nothing when no suggestion has an airport", () => {
    expect(pickPlace(name("Atlantis"), [])).toEqual({ kind: "none" });
    expect(
      pickPlace(name("New York"), [city("New York", [], [], "State")]),
    ).toEqual({ kind: "none" });
  });
});

function serpApi() {
  const calls: URL[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url);
    if (url.searchParams.get("engine") === "google_flights_autocomplete") {
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      return jsonResponse(200, SUGGESTIONS_BY_QUERY[q] ?? { suggestions: [] });
    }
    const from = url.searchParams.get("departure_id")!.split(",")[0]!;
    const to = url.searchParams.get("arrival_id")!.split(",")[0]!;
    return jsonResponse(
      200,
      serpSearch({
        best: [
          serpItem({
            price: 520,
            legs: [
              {
                from,
                to,
                depart: "2026-11-20 8:05",
                arrive: "2026-11-20 20:15",
              },
            ],
            bookingToken: "book_1",
          }),
        ],
      }),
    );
  });
  const provider = new SerpApiFlightProvider({
    apiKey: "serp_unit_key",
    baseUrl: "https://serpapi.example",
    fetch: fetchImpl as unknown as typeof fetch,
    now: () => NOW,
    placeCache: new MemoryFlightCache(),
  });
  const lookups = () =>
    calls
      .filter(
        (url) =>
          url.searchParams.get("engine") === "google_flights_autocomplete",
      )
      .map((url) => url.searchParams.get("q"));
  const flightSearches = () =>
    calls.filter((url) => url.searchParams.get("engine") === "google_flights");
  return { provider, lookups, flightSearches };
}

describe("SerpApi searches the forms the placeholders advertise", () => {
  it.each([
    ["New York", "Lisbon", "JFK,LGA,EWR", "LIS"],
    ["JFK", "LIS", "JFK", "LIS"],
    ["New York", "LIS", "JFK,LGA,EWR", "LIS"],
    ["JFK", "Lisbon", "JFK", "LIS"],
    ["jfk", "lis", "JFK", "LIS"],
    ["new york", "lisbon", "JFK,LGA,EWR", "LIS"],
    ["New York or JFK", "Lisbon or LIS", "JFK", "LIS"],
  ])("%j to %j", async (origin, destination, departureId, arrivalId) => {
    const serp = serpApi();
    const result = await serp.provider.search({
      ...query,
      origin,
      destination,
    });
    const [search] = serp.flightSearches();
    expect(search!.searchParams.get("departure_id")).toBe(departureId);
    expect(search!.searchParams.get("arrival_id")).toBe(arrivalId);
    expect(result.offers).toHaveLength(1);
    expect(result.search.origin.query).toBe(origin);
    expect(result.search.destination.query).toBe(destination);
  });

  it("searches a trip's prefilled place with a note in brackets", async () => {
    const serp = serpApi();
    await serp.provider.search({
      ...query,
      origin: "New York City (Vaughn)",
      destination: "Lisbon, Portugal",
    });
    expect(serp.lookups()).toEqual(["New York City", "Lisbon"]);
    expect(serp.flightSearches()[0]!.searchParams.get("departure_id")).toBe(
      "JFK,LGA,EWR",
    );
  });

  it("searches codes without a lookup, and a metro code's airports", async () => {
    const serp = serpApi();
    const result = await serp.provider.search({
      ...query,
      origin: "nyc",
      destination: "Boston (BOS)",
    });
    expect(serp.lookups()).toEqual([]);
    const [search] = serp.flightSearches();
    expect(search!.searchParams.get("departure_id")).toBe("JFK,LGA,EWR");
    expect(search!.searchParams.get("arrival_id")).toBe("BOS");
    expect(result.search.origin).toMatchObject({
      iataCode: "NYC",
      airportCodes: ["JFK", "LGA", "EWR"],
    });
  });

  it("returns the candidates for an ambiguous city and searches no flights", async () => {
    const serp = serpApi();
    const error = await serp.provider
      .search({ ...query, origin: "JFK", destination: "Portland" })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RouteLookupError);
    expect((error as RouteLookupError).kind).toBe("ambiguous_place");
    expect((error as RouteLookupError).issues).toEqual([
      {
        field: "destination",
        message:
          '"Portland" could be Portland, Oregon (PDX) or Portland, Maine (PWM). Pick one.',
        candidates: [
          { label: "Portland, Oregon (PDX)", value: "Portland, Oregon" },
          { label: "Portland, Maine (PWM)", value: "Portland, Maine" },
        ],
      },
    ]);
    expect(serp.flightSearches()).toHaveLength(0);

    // Picking a candidate searches it without another lookup.
    await serp.provider.search({
      ...query,
      origin: "JFK",
      destination: "Portland, Oregon",
    });
    expect(serp.lookups()).toEqual(["Portland"]);
    expect(serp.flightSearches()[0]!.searchParams.get("arrival_id")).toBe(
      "PDX",
    );
  });

  it("reports every place it cannot resolve, by field", async () => {
    const serp = serpApi();
    const error = (await serp.provider
      .search({ ...query, origin: "Atlantis", destination: "(Vaughn)" })
      .catch((caught: unknown) => caught)) as RouteLookupError;
    expect(error.kind).toBe("unknown_place");
    expect(error.issues.map((issue) => [issue.field, issue.message])).toEqual([
      [
        "origin",
        'No airport or city matches "Atlantis". Try a city name or a 3-letter airport code.',
      ],
      [
        "destination",
        'No airport or city matches "(Vaughn)". Try a city name or a 3-letter airport code.',
      ],
    ]);
    expect(serp.flightSearches()).toHaveLength(0);
  });

  it("turns place problems into inline messages and choices for the form", async () => {
    const serp = serpApi();
    const error = (await searchFlights(
      serp.provider,
      { ...query, origin: "Atlantis", destination: "Portland" },
      { now: NOW },
    ).catch((caught: unknown) => caught)) as DomainError;
    expect(error).toBeInstanceOf(DomainError);
    expect(error.code).toBe("VALIDATION");
    expect(error.message).toBe(
      'No flights were searched. From: No airport or city matches "Atlantis". Try a city name or a 3-letter airport code. To: "Portland" could be Portland, Oregon (PDX) or Portland, Maine (PWM). Pick one.',
    );
    expect(error.fieldErrors).toEqual({
      origin: [
        'No airport or city matches "Atlantis". Try a city name or a 3-letter airport code.',
      ],
      destination: [
        '"Portland" could be Portland, Oregon (PDX) or Portland, Maine (PWM). Pick one.',
      ],
    });
    expect(error.fieldChoices).toEqual({
      destination: [
        { label: "Portland, Oregon (PDX)", value: "Portland, Oregon" },
        { label: "Portland, Maine (PWM)", value: "Portland, Maine" },
      ],
    });
  });
});

const DUFFEL_PLACES: Record<string, unknown[]> = {
  "new york": [
    {
      type: "city",
      iata_code: "NYC",
      name: "New York",
      iata_country_code: "US",
      airports: [
        { iata_code: "JFK", city_name: "New York" },
        { iata_code: "LGA", city_name: "New York" },
        { iata_code: "EWR", city_name: "Newark" },
      ],
    },
    {
      type: "airport",
      iata_code: "JFK",
      name: "John F. Kennedy International Airport",
      city_name: "New York",
    },
  ],
  lisbon: [
    { type: "city", iata_code: "LIS", name: "Lisbon", iata_country_code: "PT" },
  ],
  portland: [
    {
      type: "city",
      iata_code: "PDX",
      name: "Portland",
      iata_country_code: "US",
    },
    {
      type: "city",
      iata_code: "PWM",
      name: "Portland",
      iata_country_code: "US",
    },
  ],
};

DUFFEL_PLACES["new york city"] = DUFFEL_PLACES["new york"]!;

function duffel() {
  const slices: { origin: string; destination: string }[][] = [];
  const lookups: string[] = [];
  const fetchImpl = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/places/suggestions") {
        const q = url.searchParams.get("query") ?? "";
        lookups.push(q);
        return jsonResponse(200, {
          data: DUFFEL_PLACES[q.toLowerCase()] ?? [],
        });
      }
      slices.push(JSON.parse(String(init?.body)).data.slices);
      return jsonResponse(201, { data: { live_mode: false, offers: [] } });
    },
  );
  const provider = new DuffelFlightProvider({
    accessToken: "duffel_test_unit",
    baseUrl: "https://duffel.example",
    fetch: fetchImpl as unknown as typeof fetch,
    now: () => NOW,
  });
  return { provider, slices, lookups };
}

describe("Duffel searches the same forms", () => {
  it.each([
    ["New York", "Lisbon", "NYC", "LIS"],
    ["JFK", "LIS", "JFK", "LIS"],
    ["New York", "LIS", "NYC", "LIS"],
    ["JFK", "Lisbon", "JFK", "LIS"],
    ["jfk", "lis", "JFK", "LIS"],
    ["New York City (Vaughn)", "Lisbon, Portugal", "NYC", "LIS"],
    ["New York or JFK", "Lisbon or LIS", "JFK", "LIS"],
  ])("%j to %j", async (origin, destination, from, to) => {
    const run = duffel();
    await run.provider.search({ ...query, origin, destination });
    expect(run.slices[0]![0]).toMatchObject({ origin: from, destination: to });
  });

  it("returns the candidates for an ambiguous city", async () => {
    const run = duffel();
    const error = (await run.provider
      .search({ ...query, origin: "Portland", destination: "LIS" })
      .catch((caught: unknown) => caught)) as RouteLookupError;
    expect(error.issues).toEqual([
      {
        field: "origin",
        message:
          '"Portland" could be Portland (PDX) or Portland (PWM). Pick one.',
        candidates: [
          { label: "Portland (PDX)", value: "PDX" },
          { label: "Portland (PWM)", value: "PWM" },
        ],
      },
    ]);
    expect(run.slices).toHaveLength(0);
  });
});
