import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  bookElsewhereUrl,
  describeSlice,
  formatDuration,
  parseIsoDurationMinutes,
} from "@/lib/flights";
import {
  flightSearchDefaults,
  flightSearchFormSchema,
} from "@/lib/validation/flights";
import {
  labelTestData,
  TEST_DATA_REPLY_NOTICE,
} from "@/server/ai/orchestrator";
import { buildInstructions } from "@/server/ai/prompts";
import { toolsFor } from "@/server/ai/tools";
import { EMPTY_DRAFT } from "@/lib/domain/trip-details";
import { DomainError } from "@/server/errors";
import {
  FlightProviderError,
  getFlightProvider,
  getFlightSearchStatus,
} from "@/server/flights";
import {
  DUFFEL_VERSION,
  DuffelFlightProvider,
  MAX_FLIGHT_OFFERS,
} from "@/server/flights/duffel";
import { openOffer, sealOffer } from "@/server/flights/seal";
import { searchFlights } from "@/server/services/flights";

import {
  duffelOffer,
  FakeFlightProvider,
  jsonResponse,
  sampleOffer,
} from "../support/duffel";

const TEST_TOKEN = "duffel_test_unit_token_abc123";
const NOW = new Date("2026-10-15T12:00:00.000Z");

const baseQuery = {
  origin: "JFK",
  destination: "LIS",
  departureDate: "2026-11-20",
  returnDate: "2026-11-27",
  passengers: 2,
  cabin: "economy" as const,
  maxStops: 1,
};

function mockFetch(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init: init ?? {} });
      return handler(url, init ?? {});
    },
  );
  return { fetch: fn as unknown as typeof fetch, calls };
}

function provider(fetchImpl: typeof fetch) {
  return new DuffelFlightProvider({
    accessToken: TEST_TOKEN,
    baseUrl: "https://duffel.example/",
    fetch: fetchImpl,
    now: () => NOW,
  });
}

describe("Duffel provider", () => {
  it("creates an offer request with the documented headers and body", async () => {
    const { fetch, calls } = mockFetch(() =>
      jsonResponse(201, {
        data: { live_mode: false, offers: [duffelOffer()] },
      }),
    );
    await provider(fetch).search(baseQuery);

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call!.url).toBe(
      "https://duffel.example/air/offer_requests?return_offers=true&supplier_timeout=15000",
    );
    expect(call!.init.method).toBe("POST");
    expect(call!.init.headers).toMatchObject({
      "Duffel-Version": DUFFEL_VERSION,
      Authorization: `Bearer ${TEST_TOKEN}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(call!.init.body))).toEqual({
      data: {
        slices: [
          { origin: "JFK", destination: "LIS", departure_date: "2026-11-20" },
          { origin: "LIS", destination: "JFK", departure_date: "2026-11-27" },
        ],
        passengers: [{ type: "adult" }, { type: "adult" }],
        cabin_class: "economy",
        max_connections: 1,
      },
    });
  });

  it("maps offers with prices as quoted, stops, durations, and test provenance", async () => {
    const { fetch } = mockFetch(() =>
      jsonResponse(201, {
        data: {
          live_mode: false,
          offers: [
            duffelOffer({ id: "off_b", amount: "980.5", stopsOutbound: 1 }),
            duffelOffer({ id: "off_a", amount: "432.10" }),
            { id: "off_broken", total_amount: "12.00" },
          ],
        },
      }),
    );
    const result = await provider(fetch).search(baseQuery);

    expect(result.testMode).toBe(true);
    expect(result.sourceName).toBe("Duffel (test data)");
    expect(result.retrievedAt).toBe(NOW.toISOString());
    // Malformed offers are skipped, the rest sorted by price.
    expect(result.offers.map((offer) => offer.offerId)).toEqual([
      "off_a",
      "off_b",
    ]);
    const [cheap, pricey] = result.offers;
    expect(cheap).toMatchObject({
      airline: { name: "Duffel Airways", iataCode: "ZZ" },
      totalAmount: "432.10",
      totalCurrency: "USD",
      passengers: 2,
      testMode: true,
      sourceName: "Duffel (test data)",
      retrievedAt: NOW.toISOString(),
    });
    expect(cheap!.slices[0]).toMatchObject({
      origin: { iataCode: "JFK" },
      destination: { iataCode: "LIS" },
      departingAt: "2026-11-20T08:30:00",
      durationMinutes: 435,
      stops: 0,
    });
    expect(cheap!.slices[0]!.segments[0]!.flightNumber).toBe("ZZ100");
    expect(pricey!.totalAmount).toBe("980.50");
    expect(pricey!.slices[0]!.stops).toBe(1);
    expect(pricey!.slices[0]!.destination.iataCode).toBe("LIS");
  });

  it("caps the number of offers", async () => {
    const offers = Array.from({ length: 15 }, (_, index) =>
      duffelOffer({ id: `off_${index}`, amount: `${100 + index}.00` }),
    );
    const { fetch } = mockFetch(() =>
      jsonResponse(201, { data: { live_mode: false, offers } }),
    );
    const result = await provider(fetch).search(baseQuery);
    expect(result.offers).toHaveLength(MAX_FLIGHT_OFFERS);
  });

  it("resolves place names through place suggestions", async () => {
    const { fetch, calls } = mockFetch((url) => {
      if (url.includes("/places/suggestions")) {
        return jsonResponse(200, {
          data: [{ type: "city", iata_code: "LIS", name: "Lisbon" }],
        });
      }
      return jsonResponse(201, { data: { live_mode: false, offers: [] } });
    });
    const result = await provider(fetch).search({
      ...baseQuery,
      destination: "Lisbon, Portugal",
    });
    expect(calls[0]!.url).toBe(
      "https://duffel.example/places/suggestions?query=Lisbon",
    );
    expect(calls[0]!.init.method).toBe("GET");
    expect(result.search.destination).toEqual({
      query: "Lisbon, Portugal",
      iataCode: "LIS",
      name: "Lisbon",
    });
    const body = JSON.parse(String(calls[1]!.init.body));
    expect(body.data.slices[0].destination).toBe("LIS");
  });

  it("reports a place it cannot resolve without searching", async () => {
    const { fetch, calls } = mockFetch(() => jsonResponse(200, { data: [] }));
    await expect(
      provider(fetch).search({ ...baseQuery, destination: "Atlantis" }),
    ).rejects.toMatchObject({ kind: "unknown_place" });
    expect(calls.every((call) => !call.url.includes("offer_requests"))).toBe(
      true,
    );
  });

  it.each([
    [
      401,
      {
        errors: [
          { type: "authentication_error", code: "access_token_not_found" },
        ],
      },
      "auth",
    ],
    [429, { errors: [{ type: "rate_limit_error" }] }, "rate_limit"],
    [
      422,
      {
        errors: [
          {
            type: "validation_error",
            message: "departure_date must be after today",
          },
        ],
      },
      "invalid_request",
    ],
    [
      502,
      { errors: [{ type: "airline_error", code: "airline_internal" }] },
      "unavailable",
    ],
    [500, { errors: [{ type: "api_error" }] }, "unavailable"],
  ] as const)(
    "maps HTTP %i to %s without leaking the token",
    async (status, body, kind) => {
      const { fetch } = mockFetch(() => jsonResponse(status, body));
      const error = await provider(fetch)
        .search(baseQuery)
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(FlightProviderError);
      expect(error).toMatchObject({ kind });
      expect((error as Error).message).not.toContain(TEST_TOKEN);
      if (kind === "invalid_request")
        expect((error as Error).message).toContain(
          "departure_date must be after today",
        );
    },
  );

  it("maps network failures and unreadable bodies", async () => {
    const down = mockFetch(() => {
      throw new TypeError("fetch failed");
    });
    await expect(provider(down.fetch).search(baseQuery)).rejects.toMatchObject({
      kind: "unavailable",
    });
    const garbage = mockFetch(
      () => new Response("<html>oops</html>", { status: 200 }),
    );
    await expect(
      provider(garbage.fetch).search(baseQuery),
    ).rejects.toMatchObject({
      kind: "bad_response",
    });
  });
});

describe("flight search configuration", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.FLIGHT_PROVIDER;
    delete process.env.DUFFEL_ACCESS_TOKEN;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("is not configured without a token", () => {
    expect(getFlightSearchStatus()).toEqual({
      configured: false,
      reason: "DUFFEL_ACCESS_TOKEN is not set on the server.",
    });
    expect(getFlightProvider()).toBeNull();
  });

  it("runs in test mode with a duffel_test_ token", () => {
    process.env.DUFFEL_ACCESS_TOKEN = TEST_TOKEN;
    expect(getFlightSearchStatus()).toMatchObject({
      configured: true,
      testMode: true,
      label: "Duffel (test data)",
    });
    expect(getFlightProvider()?.testMode).toBe(true);
  });

  it("does not accept live tokens yet, and can be turned off", () => {
    process.env.DUFFEL_ACCESS_TOKEN = "duffel_live_abc";
    expect(getFlightSearchStatus().configured).toBe(false);
    process.env.DUFFEL_ACCESS_TOKEN = TEST_TOKEN;
    process.env.FLIGHT_PROVIDER = "none";
    expect(getFlightSearchStatus().configured).toBe(false);
  });
});

describe("searchFlights service", () => {
  it("says flight search is not configured when there is no provider", async () => {
    await expect(
      searchFlights(null, baseQuery, { now: NOW }),
    ).rejects.toMatchObject({
      code: "UNAVAILABLE",
      message: expect.stringContaining("Flight search is not configured"),
    });
  });

  it("rejects past departure dates before calling the provider", async () => {
    const fake = new FakeFlightProvider();
    await expect(
      searchFlights(
        fake,
        { ...baseQuery, departureDate: "2026-10-01" },
        { now: NOW },
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(fake.queries).toHaveLength(0);
  });

  it("turns provider errors into a useful message", async () => {
    const fake = new FakeFlightProvider(
      [],
      new FlightProviderError(
        "rate_limit",
        "Duffel is getting too many searches right now.",
      ),
    );
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = await searchFlights(fake, baseQuery, { now: NOW }).catch(
      (e) => e,
    );
    spy.mockRestore();
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({
      code: "UNAVAILABLE",
      message: "Duffel is getting too many searches right now.",
    });
  });
});

describe("sealed offers", () => {
  const scope = { tripId: "trip_1", userId: "user_1" };
  beforeEach(() => {
    process.env.AUTH_SECRET = "unit-test-secret";
  });

  it("round-trips an offer for the same trip and user", () => {
    const offer = sampleOffer();
    expect(openOffer(sealOffer(offer, scope), scope)).toEqual(offer);
  });

  it("rejects edited offers, other trips or users, and old results", () => {
    const token = sealOffer(sampleOffer(), scope, 1_000);
    const [payload, signature] = token.split(".");
    const edited = JSON.parse(Buffer.from(payload!, "base64url").toString());
    edited.offer.totalAmount = "1.00";
    const forged = `${Buffer.from(JSON.stringify(edited)).toString("base64url")}.${signature}`;
    expect(() => openOffer(forged, scope, 2_000)).toThrow(DomainError);
    expect(() =>
      openOffer(token, { ...scope, tripId: "trip_2" }, 2_000),
    ).toThrow(DomainError);
    expect(() =>
      openOffer(token, { ...scope, userId: "user_2" }, 2_000),
    ).toThrow(DomainError);
    expect(() => openOffer(token, scope, 1_000 + 25 * 60 * 60 * 1000)).toThrow(
      DomainError,
    );
    expect(() => openOffer("garbage", scope)).toThrow(DomainError);
  });
});

describe("flight helpers", () => {
  it("parses ISO durations", () => {
    expect(parseIsoDurationMinutes("PT7H15M")).toBe(435);
    expect(parseIsoDurationMinutes("P1DT2H")).toBe(1560);
    expect(parseIsoDurationMinutes("PT45M")).toBe(45);
    expect(parseIsoDurationMinutes("nonsense")).toBeNull();
    expect(parseIsoDurationMinutes(null)).toBeNull();
    expect(formatDuration(435)).toBe("7h 15m");
    expect(formatDuration(120)).toBe("2h");
  });

  it("describes a slice in local times", () => {
    expect(describeSlice(sampleOffer().slices[0]!)).toBe(
      "JFK 2026-11-20 08:30 to LIS 2026-11-20 20:45 (local times), Nonstop, 7h 15m, Duffel Airways ZZ100",
    );
  });

  it("links out to search the same route elsewhere", () => {
    const url = new URL(
      bookElsewhereUrl({
        origin: "JFK",
        destination: "LIS",
        departureDate: "2026-11-20",
        returnDate: null,
      }),
    );
    expect(url.hostname).toBe("www.google.com");
    expect(url.searchParams.get("q")).toBe(
      "Flights from JFK to LIS on 2026-11-20 one way",
    );
  });

  it("prefills the search from the trip", () => {
    expect(
      flightSearchDefaults(
        {
          departureLocation: "Chicago",
          destination: "Lisbon",
          startDate: "2026-11-20",
          endDate: "2026-11-27",
          groupSize: 14,
        },
        "2026-10-15",
      ),
    ).toEqual({
      origin: "Chicago",
      destination: "Lisbon",
      departureDate: "2026-11-20",
      returnDate: "2026-11-27",
      passengers: "9",
      cabin: "economy",
      maxStops: "1",
    });
    // Past dates are not prefilled.
    expect(
      flightSearchDefaults(
        {
          departureLocation: null,
          destination: null,
          startDate: "2026-01-01",
          endDate: "2026-01-05",
          groupSize: null,
        },
        "2026-10-15",
      ),
    ).toMatchObject({ departureDate: "", returnDate: "", passengers: "1" });
  });

  it("validates search input", () => {
    const valid = flightSearchFormSchema.parse({
      origin: "JFK",
      destination: "LIS",
      departureDate: "2026-11-20",
      returnDate: "",
      passengers: "2",
      cabin: "any",
      maxStops: "0",
    });
    expect(valid).toMatchObject({
      returnDate: null,
      passengers: 2,
      cabin: null,
      maxStops: 0,
    });
    const invalid = flightSearchFormSchema.safeParse({
      origin: "LIS",
      destination: "lis",
      departureDate: "2026-11-20",
      returnDate: "2026-11-01",
      passengers: "12",
      cabin: "economy",
      maxStops: "1",
    });
    expect(invalid.success).toBe(false);
    expect(invalid.error!.issues.map((issue) => issue.path[0]).sort()).toEqual([
      "destination",
      "passengers",
      "returnDate",
    ]);
  });
});

describe("Atlas and test flight data", () => {
  it("offers the flight tools only on a trip", () => {
    expect(toolsFor("trip").map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["search_flights", "save_flight_option"]),
    );
    expect(toolsFor("draft").map((tool) => tool.name)).not.toContain(
      "search_flights",
    );
  });

  it("tells Atlas whether flight results are test data or unavailable", () => {
    const base = {
      phase: "trip" as const,
      startMode: "KNOWN_DESTINATION" as const,
      draft: EMPTY_DRAFT,
      today: "2026-10-15",
      userName: "Riley",
      researchAvailable: false,
    };
    expect(buildInstructions({ ...base, flightSearch: "test" })).toContain(
      "Duffel test data",
    );
    expect(buildInstructions({ ...base, flightSearch: "off" })).toContain(
      "Flight search is not configured",
    );
  });

  it("labels a reply that used test flight data", () => {
    const effect = {
      tool: "search_flights",
      ok: true,
      kind: "searched" as const,
      summary: "Searched",
      testData: true,
    };
    expect(labelTestData("The cheapest is $432.", [effect])).toBe(
      `The cheapest is $432.\n\n${TEST_DATA_REPLY_NOTICE}`,
    );
    expect(labelTestData("These are test data fares.", [effect])).toBe(
      "These are test data fares.",
    );
    expect(labelTestData("No flights here.", [])).toBe("No flights here.");
  });
});
