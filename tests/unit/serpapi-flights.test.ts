import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EMPTY_DRAFT } from "@/lib/domain/trip-details";
import { describeOffer, flightTitle } from "@/lib/flights";
import { buildInstructions } from "@/server/ai/prompts";
import { toolsFor } from "@/server/ai/tools";
import { DomainError } from "@/server/errors";
import {
  FlightProviderError,
  getFlightProvider,
  getFlightSearchStatus,
  serpApiCacheHours,
} from "@/server/flights";
import { CachedFlightProvider } from "@/server/flights/cache";
import {
  SERPAPI_SOURCE_NAME,
  SerpApiFlightProvider,
  toLocalTimestamp,
} from "@/server/flights/serpapi";
import { searchFlights, searchReturnFlights } from "@/server/services/flights";

import {
  FakeFlightProvider,
  jsonResponse,
  sampleOffer,
} from "../support/duffel";
import {
  GOOGLE_FLIGHTS_URL,
  MemoryFlightCache,
  NEW_YORK_SUGGESTIONS,
  serpItem,
  serpSearch,
} from "../support/serpapi";

const API_KEY = "serp_unit_key_0123456789abcdef";
const NOW = new Date("2026-10-15T12:00:00.000Z");

const oneWay = {
  origin: "JFK",
  destination: "LIS",
  departureDate: "2026-11-20",
  returnDate: null,
  passengers: 2,
  cabin: "economy" as const,
  maxStops: 1,
};

const roundTrip = { ...oneWay, returnDate: "2026-11-27" };

function mockFetch(handler: (url: URL) => Response | Promise<Response>) {
  const calls: URL[] = [];
  const fn = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url);
    return handler(url);
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

function provider(
  fetchImpl: typeof fetch,
  placeCache?: MemoryFlightCache,
): SerpApiFlightProvider {
  return new SerpApiFlightProvider({
    apiKey: API_KEY,
    baseUrl: "https://serpapi.example/",
    fetch: fetchImpl,
    now: () => NOW,
    placeCache,
  });
}

const outbound = serpItem({
  price: 1040,
  legs: [
    {
      from: "JFK",
      to: "LIS",
      depart: "2026-11-20 8:05",
      arrive: "2026-11-20 20:15",
    },
  ],
});

describe("SerpApi Google Flights provider", () => {
  it("sends one documented one-way request and no place lookup for airport codes", async () => {
    const { fetch, calls } = mockFetch(() =>
      jsonResponse(200, serpSearch({ best: [outbound] })),
    );
    await provider(fetch).search(oneWay);
    expect(calls).toHaveLength(1);
    const url = calls[0]!;
    expect(url.origin + url.pathname).toBe(
      "https://serpapi.example/search.json",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      engine: "google_flights",
      departure_id: "JFK",
      arrival_id: "LIS",
      outbound_date: "2026-11-20",
      type: "2",
      adults: "2",
      travel_class: "1",
      stops: "2",
      currency: "USD",
      hl: "en",
      gl: "us",
      api_key: API_KEY,
    });
  });

  it.each([
    [0, "1"],
    [1, "2"],
    [2, "3"],
  ])("maps at most %i stops to SerpApi stops=%s", async (maxStops, stops) => {
    const { fetch, calls } = mockFetch(() => jsonResponse(200, serpSearch()));
    await provider(fetch).search({ ...oneWay, maxStops });
    expect(calls[0]!.searchParams.get("stops")).toBe(stops);
  });

  it("searches economy for any cabin and says so in the results", async () => {
    const { fetch, calls } = mockFetch(() =>
      jsonResponse(200, serpSearch({ best: [outbound] })),
    );
    const result = await provider(fetch).search({ ...oneWay, cabin: null });
    expect(calls[0]!.searchParams.get("travel_class")).toBe("1");
    expect(result.search.cabin).toBe("economy");
    expect(result.offers[0]!.cabin).toBe("economy");
  });

  it("maps best and other flights with Google's prices, local times, and provenance", async () => {
    const connecting = serpItem({
      price: 812,
      legs: [
        {
          from: "JFK",
          to: "BOS",
          depart: "2026-11-20 06:00",
          arrive: "2026-11-20 07:20",
          airline: "JetBlue",
          flightNumber: "B6 1",
          extensions: ["Operated by Republic Airways"],
        },
        {
          from: "BOS",
          to: "LIS",
          depart: "2026-11-20 21:00",
          arrive: "2026-11-21 08:40",
          flightNumber: "TP 218",
        },
      ],
    });
    const unpriced = serpItem({
      price: null,
      legs: outbound.flights.map(() => ({
        from: "JFK",
        to: "LIS",
        depart: "2026-11-20 10:00",
        arrive: "2026-11-20 22:00",
      })),
    });
    const { fetch } = mockFetch(() =>
      jsonResponse(
        200,
        serpSearch({
          best: [outbound],
          other: [connecting, unpriced, { junk: true }],
        }),
      ),
    );
    const result = await provider(fetch).search(oneWay);

    expect(result).toMatchObject({
      sourceName: "Google Flights via SerpApi",
      testMode: false,
      retrievedAt: NOW.toISOString(),
      priceInsights: {
        sourceName: "Google Flights",
        currency: "USD",
        lowestPrice: "480.00",
        priceLevel: "typical",
        typicalLow: "450.00",
        typicalHigh: "700.00",
      },
    });
    // Sorted by price; the unpriced and unreadable items are left out.
    expect(result.offers.map((offer) => offer.totalAmount)).toEqual([
      "812.00",
      "1040.00",
    ]);
    const [cheap, direct] = result.offers;
    expect(cheap).toMatchObject({
      airline: { name: "JetBlue, TAP Air Portugal", iataCode: null },
      totalCurrency: "USD",
      passengers: 2,
      cabin: "economy",
      expiresAt: null,
      sourceName: SERPAPI_SOURCE_NAME,
      providerId: "serpapi",
      testMode: false,
      pendingReturn: null,
      bookingUrl: GOOGLE_FLIGHTS_URL,
    });
    expect(cheap!.offerId).toMatch(/^gf_[0-9a-f]{24}$/);
    expect(cheap!.slices).toHaveLength(1);
    expect(cheap!.slices[0]).toMatchObject({
      origin: { iataCode: "JFK", cityName: "New York" },
      destination: { iataCode: "LIS", cityName: "Lisbon" },
      departingAt: "2026-11-20T06:00:00",
      arrivingAt: "2026-11-21T08:40:00",
      durationMinutes: 540,
      stops: 1,
    });
    expect(cheap!.slices[0]!.segments[0]).toMatchObject({
      marketingCarrier: "JetBlue",
      flightNumber: "B61",
      operatingCarrier: "Republic Airways",
      origin: { iataCode: "JFK", name: "JFK Airport" },
      destination: { iataCode: "BOS", cityName: null },
    });
    expect(direct).toMatchObject({
      airline: { name: "TAP Air Portugal", iataCode: "TP" },
    });
    expect(direct!.slices[0]).toMatchObject({
      departingAt: "2026-11-20T08:05:00",
      stops: 0,
    });
    expect(flightTitle(direct!)).toBe("TAP Air Portugal: JFK to LIS, one way");
  });

  it("gives the same result the same ID so it is saved once", async () => {
    const { fetch } = mockFetch(() =>
      jsonResponse(200, serpSearch({ best: [outbound] })),
    );
    const first = await provider(fetch).search(oneWay);
    const second = await provider(fetch).search(oneWay);
    expect(first.offers[0]!.offerId).toBe(second.offers[0]!.offerId);
  });

  it("prices a round trip once and leaves the return to load on request", async () => {
    const item = serpItem({
      price: 1300,
      legs: [
        {
          from: "JFK",
          to: "LIS",
          depart: "2026-11-20 08:05",
          arrive: "2026-11-20 20:15",
        },
      ],
      departureToken: "dep_token_1",
    });
    const { fetch, calls } = mockFetch(() =>
      jsonResponse(200, serpSearch({ best: [item] })),
    );
    const result = await provider(fetch).search(roundTrip);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.searchParams.get("type")).toBe("1");
    expect(calls[0]!.searchParams.get("return_date")).toBe("2026-11-27");
    expect(calls[0]!.searchParams.has("departure_token")).toBe(false);
    const offer = result.offers[0]!;
    expect(offer.slices).toHaveLength(1);
    expect(offer.pendingReturn).toEqual({
      date: "2026-11-27",
      token: "dep_token_1",
      originCodes: "JFK",
      destinationCodes: "LIS",
      maxStops: 1,
    });
    expect(flightTitle(offer)).toBe("TAP Air Portugal: JFK to LIS, round trip");
    expect(describeOffer(offer)[1]).toBe(
      "Return on 2026-11-27: flight not chosen yet. The price is the round-trip total.",
    );
  });

  it("loads return options with the departure token and the same search", async () => {
    const returning = serpItem({
      price: 1350,
      legs: [
        {
          from: "LIS",
          to: "JFK",
          depart: "2026-11-27 11:00",
          arrive: "2026-11-27 14:30",
          flightNumber: "TP 201",
        },
      ],
      bookingToken: "book_1",
    });
    const { fetch, calls } = mockFetch(() =>
      jsonResponse(200, serpSearch({ best: [returning], insights: null })),
    );
    const offer = sampleOffer({
      providerId: "serpapi",
      testMode: false,
      sourceName: SERPAPI_SOURCE_NAME,
      cabin: "business",
      pendingReturn: {
        date: "2026-11-27",
        token: "dep_token_1",
        originCodes: "JFK,LGA,EWR",
        destinationCodes: "LIS",
        maxStops: 0,
      },
    });
    const result = await provider(fetch).searchReturns(offer);
    expect(calls).toHaveLength(1);
    expect(Object.fromEntries(calls[0]!.searchParams)).toMatchObject({
      engine: "google_flights",
      departure_id: "JFK,LGA,EWR",
      arrival_id: "LIS",
      outbound_date: "2026-11-20",
      return_date: "2026-11-27",
      type: "1",
      adults: "2",
      travel_class: "3",
      stops: "1",
      departure_token: "dep_token_1",
    });
    expect(result.priceInsights).toBeNull();
    const [both] = result.offers;
    expect(both!.slices).toHaveLength(2);
    expect(both!.slices[0]).toEqual(offer.slices[0]);
    expect(both!.slices[1]).toMatchObject({
      origin: { iataCode: "LIS" },
      destination: { iataCode: "JFK" },
      departingAt: "2026-11-27T11:00:00",
    });
    expect(both).toMatchObject({
      totalAmount: "1350.00",
      pendingReturn: null,
      airline: { name: "Duffel Airways, TAP Air Portugal" },
    });
    expect(both!.offerId).not.toBe(offer.offerId);
  });

  it("refuses to load returns for a result that has none", async () => {
    const { fetch, calls } = mockFetch(() => jsonResponse(200, serpSearch()));
    await expect(
      provider(fetch).searchReturns(sampleOffer()),
    ).rejects.toMatchObject({ kind: "invalid_request" });
    expect(calls).toHaveLength(0);
  });

  it("resolves a city to all of its airports and reuses the lookup", async () => {
    const cache = new MemoryFlightCache();
    const { fetch, calls } = mockFetch((url) =>
      url.searchParams.get("engine") === "google_flights_autocomplete"
        ? jsonResponse(200, NEW_YORK_SUGGESTIONS)
        : jsonResponse(200, serpSearch({ best: [outbound] })),
    );
    const serp = provider(fetch, cache);
    const result = await serp.search({ ...oneWay, origin: "New York, NY" });
    expect(calls.map((url) => url.searchParams.get("engine"))).toEqual([
      "google_flights_autocomplete",
      "google_flights",
    ]);
    expect(calls[0]!.searchParams.get("q")).toBe("New York");
    expect(calls[1]!.searchParams.get("departure_id")).toBe("JFK,LGA,EWR");
    expect(result.search.origin).toEqual({
      query: "New York, NY",
      iataCode: "JFK",
      name: "New York",
      airportCodes: ["JFK", "LGA", "EWR"],
    });

    await serp.search({ ...oneWay, origin: "new york" });
    expect(
      calls.filter(
        (url) =>
          url.searchParams.get("engine") === "google_flights_autocomplete",
      ),
    ).toHaveLength(1);
  });

  it("reports a place it cannot resolve without searching flights", async () => {
    const { fetch, calls } = mockFetch(() =>
      jsonResponse(200, { suggestions: [] }),
    );
    await expect(
      provider(fetch).search({ ...oneWay, destination: "Atlantis" }),
    ).rejects.toMatchObject({
      kind: "unknown_place",
      message: expect.stringContaining('"Atlantis"'),
    });
    expect(
      calls.some((url) => url.searchParams.get("engine") === "google_flights"),
    ).toBe(false);
  });

  it("treats Google's no-results answer as an empty list", async () => {
    const { fetch } = mockFetch(() =>
      jsonResponse(
        200,
        serpSearch({
          error: "Google Flights hasn't returned any results for this query.",
          insights: null,
        }),
      ),
    );
    const result = await provider(fetch).search(oneWay);
    expect(result.offers).toEqual([]);
    expect(result.priceInsights).toBeNull();
  });

  it("passes on only Google Flights links", async () => {
    const { fetch } = mockFetch(() =>
      jsonResponse(
        200,
        serpSearch({
          best: [outbound],
          url: "https://evil.example/travel/flights",
        }),
      ),
    );
    const result = await provider(fetch).search(oneWay);
    expect(result.offers[0]!.bookingUrl).toBeNull();
  });

  it.each([
    [401, { error: "Invalid API key." }, "auth", "SERPAPI_API_KEY"],
    [
      429,
      { error: "Your account has run out of searches." },
      "rate_limit",
      "used all of its flight searches",
    ],
    [429, { error: "Too many requests." }, "rate_limit", "50 an hour"],
    [
      400,
      { error: "Missing `outbound_date` parameter." },
      "invalid_request",
      "Missing `outbound_date` parameter.",
    ],
    [
      503,
      { error: "Internal error" },
      "unavailable",
      "SerpApi is having trouble",
    ],
  ])(
    "maps HTTP %i to a %s error without the key",
    async (status, body, kind, text) => {
      const { fetch } = mockFetch(() => jsonResponse(status, body));
      const error = await provider(fetch)
        .search(oneWay)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(FlightProviderError);
      expect(error).toMatchObject({ kind });
      expect((error as Error).message).toContain(text);
      expect((error as Error).message).not.toContain(API_KEY);
    },
  );

  it("maps failed searches, network failures, and unreadable bodies", async () => {
    const failed = mockFetch(() =>
      jsonResponse(
        200,
        serpSearch({
          status: "Error",
          error: "We couldn't get valid results for this search.",
        }),
      ),
    );
    await expect(provider(failed.fetch).search(oneWay)).rejects.toMatchObject({
      kind: "unavailable",
    });

    const network = mockFetch(() => {
      throw new TypeError(`fetch failed for ?api_key=${API_KEY}`);
    });
    const networkError = await provider(network.fetch)
      .search(oneWay)
      .catch((e: unknown) => e);
    expect(networkError).toMatchObject({ kind: "unavailable" });
    expect((networkError as Error).message).not.toContain(API_KEY);

    const garbled = mockFetch(() => new Response("<html>", { status: 200 }));
    await expect(provider(garbled.fetch).search(oneWay)).rejects.toMatchObject({
      kind: "bad_response",
    });
  });

  it("converts SerpApi times to the app's local timestamps", () => {
    expect(toLocalTimestamp("2026-11-20 8:05")).toBe("2026-11-20T08:05:00");
    expect(toLocalTimestamp("2026-11-20 23:59")).toBe("2026-11-20T23:59:00");
    expect(toLocalTimestamp("tomorrow")).toBeNull();
  });
});

describe("flight search cache", () => {
  function searchResult(retrievedAt = NOW.toISOString()) {
    return {
      search: {
        origin: { query: "JFK", iataCode: "JFK", name: "JFK" },
        destination: { query: "LIS", iataCode: "LIS", name: "LIS" },
        departureDate: "2026-11-20",
        returnDate: null,
        passengers: 2,
        cabin: "economy" as const,
        maxStops: 1,
      },
      offers: [sampleOffer({ testMode: false, retrievedAt })],
      retrievedAt,
      sourceName: SERPAPI_SOURCE_NAME,
      testMode: false,
    };
  }

  function counting(error?: Error) {
    let calls = 0;
    let returnCalls = 0;
    return {
      get calls() {
        return calls;
      },
      get returnCalls() {
        return returnCalls;
      },
      id: "serpapi",
      label: SERPAPI_SOURCE_NAME,
      testMode: false,
      async search() {
        calls += 1;
        if (error) throw error;
        return searchResult();
      },
      async searchReturns() {
        returnCalls += 1;
        return searchResult();
      },
    };
  }

  it("answers an identical search from the cache with its original retrieval time", async () => {
    const inner = counting();
    let now = NOW;
    const cached = new CachedFlightProvider(
      inner,
      new MemoryFlightCache(),
      3 * 60 * 60 * 1000,
      () => now,
    );
    const first = await cached.search(oneWay);
    now = new Date(NOW.getTime() + 60 * 60 * 1000);
    const second = await cached.search({
      ...oneWay,
      origin: " jfk ",
      destination: "lis",
    });
    expect(inner.calls).toBe(1);
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.retrievedAt).toBe(NOW.toISOString());
    expect(second.offers[0]!.retrievedAt).toBe(NOW.toISOString());

    await cached.search({ ...oneWay, passengers: 3 });
    expect(inner.calls).toBe(2);
  });

  it("searches again once the entry expires, and never caches failures", async () => {
    const inner = counting();
    let now = NOW;
    const store = new MemoryFlightCache();
    const cached = new CachedFlightProvider(inner, store, 60_000, () => now);
    await cached.search(oneWay);
    now = new Date(NOW.getTime() + 61_000);
    await cached.search(oneWay);
    expect(inner.calls).toBe(2);

    const failing = counting(
      new FlightProviderError("rate_limit", "Too many searches."),
    );
    const cachedFailing = new CachedFlightProvider(
      failing,
      new MemoryFlightCache(),
      60_000,
    );
    await expect(cachedFailing.search(oneWay)).rejects.toThrow(
      "Too many searches.",
    );
    await expect(cachedFailing.search(oneWay)).rejects.toThrow(
      "Too many searches.",
    );
    expect(failing.calls).toBe(2);
  });

  it("caches return options separately and keeps working when the store fails", async () => {
    const inner = counting();
    const cached = new CachedFlightProvider(
      inner,
      new MemoryFlightCache(),
      60_000,
      () => NOW,
    );
    const offer = sampleOffer({
      pendingReturn: {
        date: "2026-11-27",
        token: "tok",
        originCodes: "JFK",
        destinationCodes: "LIS",
        maxStops: 1,
      },
    });
    await cached.searchReturns!(offer);
    const again = await cached.searchReturns!(offer);
    expect(inner.returnCalls).toBe(1);
    expect(again.cached).toBe(true);

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = new CachedFlightProvider(
      inner,
      {
        get: () => Promise.reject(new Error("db down")),
        set: () => Promise.reject(new Error("db down")),
      },
      60_000,
    );
    const result = await broken.search(oneWay);
    spy.mockRestore();
    expect(result.cached).toBe(false);
  });

  it("does not offer return loading when the provider has none", () => {
    const cached = new CachedFlightProvider(
      new FakeFlightProvider(),
      new MemoryFlightCache(),
      60_000,
    );
    expect(cached.searchReturns).toBeUndefined();
  });
});

describe("SerpApi configuration", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.FLIGHT_PROVIDER;
    delete process.env.SERPAPI_API_KEY;
    delete process.env.SERPAPI_CACHE_HOURS;
    delete process.env.DUFFEL_ACCESS_TOKEN;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("uses SerpApi by default and needs a key", () => {
    expect(getFlightSearchStatus()).toEqual({
      configured: false,
      reason: "SERPAPI_API_KEY is not set on the server.",
    });
    expect(getFlightProvider()).toBeNull();

    process.env.SERPAPI_API_KEY = API_KEY;
    expect(getFlightSearchStatus()).toEqual({
      configured: true,
      provider: "serpapi",
      label: "Google Flights via SerpApi",
      testMode: false,
    });
    const flights = getFlightProvider();
    expect(flights).toBeInstanceOf(CachedFlightProvider);
    expect(flights).toMatchObject({ id: "serpapi", testMode: false });
    expect(flights?.searchReturns).toBeTypeOf("function");
  });

  it("keeps Duffel selectable and rejects unknown providers", () => {
    process.env.SERPAPI_API_KEY = API_KEY;
    process.env.FLIGHT_PROVIDER = "duffel";
    process.env.DUFFEL_ACCESS_TOKEN = "duffel_test_abc";
    expect(getFlightSearchStatus()).toMatchObject({
      provider: "duffel",
      testMode: true,
    });
    process.env.FLIGHT_PROVIDER = "kayak";
    expect(getFlightSearchStatus()).toMatchObject({
      configured: false,
      reason: expect.stringContaining('"serpapi", "duffel", or "none"'),
    });
  });

  it("reads the cache window in hours within 0 to 24", () => {
    expect(serpApiCacheHours()).toBe(3);
    process.env.SERPAPI_CACHE_HOURS = "6";
    expect(serpApiCacheHours()).toBe(6);
    process.env.SERPAPI_CACHE_HOURS = "100";
    expect(serpApiCacheHours()).toBe(24);
    process.env.SERPAPI_CACHE_HOURS = "-1";
    expect(serpApiCacheHours()).toBe(0);
    process.env.SERPAPI_CACHE_HOURS = "soon";
    expect(serpApiCacheHours()).toBe(3);
  });
});

describe("return flights service", () => {
  it("refuses a result without a pending return before calling the provider", async () => {
    const fake = new FakeFlightProvider();
    const error = await searchReturnFlights(fake, sampleOffer()).catch(
      (e) => e,
    );
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({ code: "VALIDATION" });
  });

  it("says flight search is not configured without a provider", async () => {
    await expect(
      searchReturnFlights(null, sampleOffer()),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });

  it("turns a quota error into a message that says nothing changed", async () => {
    const fake = new FakeFlightProvider(
      [],
      new FlightProviderError("rate_limit", "Out of searches."),
    );
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = await searchFlights(fake, oneWay, { now: NOW }).catch(
      (e) => e,
    );
    spy.mockRestore();
    expect(error).toMatchObject({
      code: "UNAVAILABLE",
      message: "Out of searches. Nothing in the trip was changed.",
    });
  });
});

describe("Atlas with SerpApi", () => {
  const base = {
    phase: "trip" as const,
    startMode: "KNOWN_DESTINATION" as const,
    draft: EMPTY_DRAFT,
    today: "2026-10-15",
    userName: "Riley",
    researchAvailable: false,
  };

  it("names Google Flights via SerpApi as the source, not Duffel test data", () => {
    const text = buildInstructions({
      ...base,
      flightSearch: "live",
      flightSource: SERPAPI_SOURCE_NAME,
    });
    expect(text).toContain("Its results come from Google Flights via SerpApi.");
    expect(text).toContain("search_return_flights only when the user asks");
    expect(text).toContain("only when the user asks for flights");
    expect(text).not.toContain("Duffel");
  });

  it("offers the return flight tool on a trip only", () => {
    expect(toolsFor("trip").map((tool) => tool.name)).toContain(
      "search_return_flights",
    );
    expect(toolsFor("draft").map((tool) => tool.name)).not.toContain(
      "search_return_flights",
    );
  });
});
