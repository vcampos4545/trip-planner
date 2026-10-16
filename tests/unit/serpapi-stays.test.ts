import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EMPTY_DRAFT } from "@/lib/domain/trip-details";
import { buildInstructions } from "@/server/ai/prompts";
import { toolsFor } from "@/server/ai/tools";
import { DomainError } from "@/server/errors";
import { searchStays } from "@/server/services/stays";
import {
  StayProviderError,
  getStayProvider,
  getStaySearchStatus,
  type StaySearchQuery,
} from "@/server/stays";
import { CachedStayProvider } from "@/server/stays/cache";
import {
  HOTELS_SOURCE_NAME,
  SerpApiStayProvider,
} from "@/server/stays/serpapi";

import { jsonResponse } from "../support/duffel";
import { MemoryFlightCache } from "../support/serpapi";
import {
  FakeStayProvider,
  hotelProperty,
  hotelsSearch,
  rentalProperty,
  sampleStay,
} from "../support/stays";

const API_KEY = "serp_unit_key_0123456789abcdef";
const NOW = new Date("2026-10-15T12:00:00.000Z");

const hotels: StaySearchQuery = {
  location: "Park City, Utah",
  checkIn: "2027-03-05",
  checkOut: "2027-03-07",
  guests: 4,
  kind: "hotel",
  bedrooms: null,
  minPrice: null,
  maxPrice: null,
  sort: "relevance",
};

const rentals: StaySearchQuery = {
  ...hotels,
  kind: "vacation_rental",
  bedrooms: 4,
  minPrice: 200,
  maxPrice: 900,
  sort: "lowest_price",
};

function mockFetch(handler: (url: URL) => Response | Promise<Response>) {
  const calls: URL[] = [];
  const fn = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url);
    return handler(url);
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

function provider(fetchImpl: typeof fetch) {
  return new SerpApiStayProvider({
    apiKey: API_KEY,
    baseUrl: "https://serpapi.example/",
    fetch: fetchImpl,
    now: () => NOW,
  });
}

describe("SerpApi Google Hotels provider", () => {
  it("sends one documented hotel request without rental-only filters", async () => {
    const { fetch, calls } = mockFetch(() =>
      jsonResponse(200, hotelsSearch([hotelProperty()])),
    );
    await provider(fetch).search({ ...hotels, bedrooms: 3 });
    expect(calls).toHaveLength(1);
    const url = calls[0]!;
    expect(url.origin + url.pathname).toBe(
      "https://serpapi.example/search.json",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      engine: "google_hotels",
      q: "Park City, Utah",
      check_in_date: "2027-03-05",
      check_out_date: "2027-03-07",
      adults: "4",
      currency: "USD",
      hl: "en",
      gl: "us",
      api_key: API_KEY,
    });
  });

  it("searches vacation rentals with bedrooms, a nightly price range, and a sort", async () => {
    const { fetch, calls } = mockFetch(() =>
      jsonResponse(200, hotelsSearch([rentalProperty()])),
    );
    const result = await provider(fetch).search(rentals);
    expect(Object.fromEntries(calls[0]!.searchParams)).toMatchObject({
      vacation_rentals: "true",
      bedrooms: "4",
      min_price: "200",
      max_price: "900",
      sort_by: "3",
    });
    expect(result.search).toMatchObject({
      kind: "vacation_rental",
      bedrooms: 4,
      nights: 2,
      currency: "USD",
    });
  });

  it.each([
    ["highest_rating", "8"],
    ["most_reviewed", "13"],
  ] as const)("maps the %s sort to sort_by=%s", async (sort, sortBy) => {
    const { fetch, calls } = mockFetch(() =>
      jsonResponse(200, hotelsSearch([])),
    );
    await provider(fetch).search({ ...hotels, sort });
    expect(calls[0]!.searchParams.get("sort_by")).toBe(sortBy);
  });

  it("maps a hotel with Google's nightly and total prices, sources, coordinates, and provenance", async () => {
    const { fetch } = mockFetch(() =>
      jsonResponse(200, hotelsSearch([hotelProperty()])),
    );
    const result = await provider(fetch).search(hotels);
    expect(result.sourceName).toBe(HOTELS_SOURCE_NAME);
    expect(result.retrievedAt).toBe(NOW.toISOString());
    expect(result.offers).toHaveLength(1);
    const offer = result.offers[0]!;
    expect(offer).toMatchObject({
      name: "Grand Summit Lodge",
      kind: "hotel",
      hotelClass: 4,
      rating: 4.6,
      reviews: 812,
      nightlyAmount: "412.00",
      totalAmount: "824.00",
      currency: "USD",
      latitude: 40.6514,
      longitude: -111.5079,
      checkInTime: "4:00 PM",
      checkOutTime: "11:00 AM",
      propertyUrl: "https://www.grandsummit.example/stay",
      propertyToken: "ChkIv_HyiNKHpf6yARoML2cvMXozdGJnZ3BzEAE",
      location: "Park City, Utah",
      checkIn: "2027-03-05",
      checkOut: "2027-03-07",
      nights: 2,
      guests: 4,
      retrievedAt: NOW.toISOString(),
      sourceName: HOTELS_SOURCE_NAME,
      providerId: "serpapi",
      sponsored: false,
    });
    // Cheapest source first.
    expect(offer.priceSources).toEqual([
      { source: "Booking.com", nightlyAmount: "412.00" },
      { source: "Expedia", nightlyAmount: "430.00" },
    ]);
    expect(offer.imageUrl).toMatch(/^https:\/\/lh3\.googleusercontent\.com\//);
    expect(offer.bookingUrl).toBe(
      "https://www.google.com/travel/search?q=Grand%20Summit%20Lodge%2C%20Park%20City%2C%20Utah",
    );
    expect(offer.offerId).toMatch(/^gh_[0-9a-f]{24}$/);
  });

  it("maps a vacation rental with its bedrooms and sleeps as listed", async () => {
    const { fetch } = mockFetch(() =>
      jsonResponse(200, hotelsSearch([rentalProperty()])),
    );
    const [offer] = (await provider(fetch).search(rentals)).offers;
    expect(offer).toMatchObject({
      kind: "vacation_rental",
      hotelClass: null,
      essentialInfo: ["Entire house", "Sleeps 10", "4 bedrooms", "3 bathrooms"],
      nightlyAmount: "690.00",
      totalAmount: "1380.00",
      propertyUrl: null,
      priceSources: [{ source: "Vrbo", nightlyAmount: "690.00" }],
    });
  });

  it("leaves out places without a rate, ads, and duplicates, and keeps Google's order", async () => {
    const { fetch } = mockFetch(() =>
      jsonResponse(
        200,
        hotelsSearch([
          hotelProperty({ name: "Pricier Inn", property_token: "a" }),
          hotelProperty({
            name: "No Rate Lodge",
            property_token: "b",
            rate_per_night: undefined,
            total_rate: undefined,
          }),
          hotelProperty({
            name: "Cheaper Inn",
            property_token: "c",
            rate_per_night: { extracted_lowest: 150 },
            total_rate: { extracted_lowest: 300 },
          }),
          hotelProperty({ name: "Pricier Inn", property_token: "a" }),
          { name: "" },
        ]),
      ),
    );
    const result = await provider(fetch).search(hotels);
    expect(result.offers.map((offer) => offer.name)).toEqual([
      "Pricier Inn",
      "Cheaper Inn",
    ]);
  });

  it("keeps a rate without a total and says nothing is invented", async () => {
    const { fetch } = mockFetch(() =>
      jsonResponse(
        200,
        hotelsSearch([hotelProperty({ total_rate: undefined })]),
      ),
    );
    const [offer] = (await provider(fetch).search(hotels)).offers;
    expect(offer!.nightlyAmount).toBe("412.00");
    expect(offer!.totalAmount).toBeNull();
  });

  it("marks sponsored results and drops unsafe links and images", async () => {
    const { fetch } = mockFetch(() =>
      jsonResponse(
        200,
        hotelsSearch([
          hotelProperty({
            sponsored: true,
            link: "https://www.google.com/aclk?sa=l&ai=xyz",
            images: [{ thumbnail: "http://insecure.example/a.jpg" }],
            gps_coordinates: { latitude: 120, longitude: 10 },
          }),
        ]),
      ),
    );
    const [offer] = (await provider(fetch).search(hotels)).offers;
    expect(offer).toMatchObject({
      sponsored: true,
      propertyUrl: null,
      imageUrl: null,
      latitude: null,
      longitude: null,
    });
  });

  it("reads a search that matched one property exactly", async () => {
    const { fetch } = mockFetch(() =>
      jsonResponse(200, {
        search_metadata: { status: "Success" },
        search_information: {
          hotels_results_state: "Showing results for property details",
        },
        ...hotelProperty({ name: "H10 Port Vell" }),
      }),
    );
    const result = await provider(fetch).search({
      ...hotels,
      location: "H10 Port Vell",
    });
    expect(result.offers.map((offer) => offer.name)).toEqual(["H10 Port Vell"]);
  });

  it("treats Google's no-results answer as an empty list", async () => {
    const { fetch } = mockFetch(() =>
      jsonResponse(200, {
        search_metadata: { status: "Success" },
        error: "Google Hotels hasn't returned any results for this query.",
      }),
    );
    expect((await provider(fetch).search(hotels)).offers).toEqual([]);
  });

  it.each([
    [401, { error: "Invalid API key." }, "auth", "SERPAPI_API_KEY"],
    [
      429,
      { error: "Your account has run out of searches." },
      "rate_limit",
      "shared by flight and stay search",
    ],
    [429, { error: "Too many requests." }, "rate_limit", "50 an hour"],
    [
      400,
      { error: "Missing `check_in_date` parameter." },
      "invalid_request",
      "Google Hotels couldn't run this search: Missing `check_in_date` parameter.",
    ],
    [
      503,
      { error: "Internal error" },
      "unavailable",
      "SerpApi is having trouble",
    ],
  ])(
    "maps HTTP %i to a %s error that never shows the key",
    async (status, body, kind, message) => {
      const { fetch } = mockFetch(() => jsonResponse(status, body));
      const error = await provider(fetch)
        .search(hotels)
        .catch((caught) => caught);
      expect(error).toBeInstanceOf(StayProviderError);
      expect(error.kind).toBe(kind);
      expect(error.message).toContain(message);
      expect(error.message).not.toContain(API_KEY);
    },
  );

  it("reports a SerpApi error status and an unreadable body", async () => {
    const failed = mockFetch(() =>
      jsonResponse(200, { search_metadata: { status: "Error" } }),
    );
    await expect(provider(failed.fetch).search(hotels)).rejects.toMatchObject({
      kind: "unavailable",
    });
    const garbled = mockFetch(() =>
      jsonResponse(200, { error: "Something odd" }),
    );
    await expect(provider(garbled.fetch).search(hotels)).rejects.toMatchObject({
      kind: "bad_response",
    });
  });

  it("reports a timeout in words", async () => {
    const { fetch } = mockFetch(() => {
      const error = new Error("timed out");
      error.name = "TimeoutError";
      throw error;
    });
    await expect(provider(fetch).search(hotels)).rejects.toMatchObject({
      kind: "timeout",
      message: expect.stringContaining(
        "Google Hotels (via SerpApi) took too long",
      ),
    });
  });
});

describe("stay search cache", () => {
  it("reuses an identical search, keeps its retrieval time, and marks it cached", async () => {
    const fake = new FakeStayProvider([sampleStay()]);
    const cache = new MemoryFlightCache();
    const cached = new CachedStayProvider(fake, cache, 60_000, () => NOW);
    const first = await cached.search(hotels);
    const second = await cached.search({
      ...hotels,
      location: "  park city,   utah ",
    });
    expect(fake.queries).toHaveLength(1);
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.retrievedAt).toBe(first.retrievedAt);
    expect([...cache.entries.keys()][0]).toMatch(/^serpapi-hotels:search:/);
  });

  it("searches again when anything that changes the answer differs", async () => {
    const fake = new FakeStayProvider([sampleStay()]);
    const cached = new CachedStayProvider(
      fake,
      new MemoryFlightCache(),
      60_000,
      () => NOW,
    );
    await cached.search(hotels);
    await cached.search({ ...hotels, guests: 6 });
    await cached.search({ ...hotels, kind: "vacation_rental" });
    await cached.search({ ...hotels, maxPrice: 300 });
    expect(fake.queries).toHaveLength(4);
  });

  it("never keeps a failed search", async () => {
    const cache = new MemoryFlightCache();
    const failing = new CachedStayProvider(
      new FakeStayProvider([], new StayProviderError("unavailable", "Down.")),
      cache,
      60_000,
      () => NOW,
    );
    await expect(failing.search(hotels)).rejects.toThrow("Down.");
    expect(cache.entries.size).toBe(0);
  });
});

describe("searchStays", () => {
  const now = new Date("2027-01-10T12:00:00.000Z");

  it("says stay search is not configured instead of returning results", async () => {
    await expect(searchStays(null, hotels, { now })).rejects.toMatchObject({
      code: "UNAVAILABLE",
      message: expect.stringContaining("Stay search is not configured."),
    });
  });

  it("rejects a check-in in the past before spending a search", async () => {
    const fake = new FakeStayProvider([sampleStay()]);
    await expect(
      searchStays(fake, { ...hotels, checkIn: "2027-01-09" }, { now }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(fake.queries).toHaveLength(0);
  });

  it("refuses rentals when the provider only searches hotels", async () => {
    const hotelsOnly = new FakeStayProvider([], undefined, false);
    await expect(
      searchStays(hotelsOnly, rentals, { now }),
    ).rejects.toMatchObject({
      code: "VALIDATION",
      message: expect.stringContaining("can only search hotels"),
    });
    expect(hotelsOnly.queries).toHaveLength(0);
  });

  it("turns a quota failure into a safe message that says nothing changed", async () => {
    const failing = new FakeStayProvider(
      [],
      new StayProviderError("rate_limit", "Out of searches."),
    );
    const error = await searchStays(failing, hotels, { now }).catch(
      (caught) => caught,
    );
    expect(error).toBeInstanceOf(DomainError);
    expect(error.code).toBe("UNAVAILABLE");
    expect(error.message).toBe(
      "Out of searches. Nothing in the trip was changed.",
    );
  });
});

describe("stay search configuration", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.STAYS_PROVIDER;
    delete process.env.SERPAPI_API_KEY;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("uses SerpApi by default with the flight search key", () => {
    expect(getStaySearchStatus()).toEqual({
      configured: false,
      reason: "SERPAPI_API_KEY is not set on the server.",
    });
    expect(getStayProvider()).toBeNull();
    process.env.SERPAPI_API_KEY = API_KEY;
    expect(getStaySearchStatus()).toEqual({
      configured: true,
      provider: "serpapi",
      label: "Google Hotels via SerpApi",
      supportsVacationRentals: true,
    });
    expect(getStayProvider()).toBeInstanceOf(CachedStayProvider);
  });

  it("can be turned off and rejects unknown providers", () => {
    process.env.SERPAPI_API_KEY = API_KEY;
    process.env.STAYS_PROVIDER = "none";
    expect(getStaySearchStatus()).toMatchObject({ configured: false });
    expect(getStayProvider()).toBeNull();
    process.env.STAYS_PROVIDER = "airbnb";
    expect(getStaySearchStatus()).toEqual({
      configured: false,
      reason:
        'STAYS_PROVIDER "airbnb" is not supported. Use "serpapi" or "none".',
    });
  });
});

describe("Atlas stay tools and instructions", () => {
  it("offers stay search and saving in a trip, but not before one exists", () => {
    const trip = toolsFor("trip").map((tool) => tool.name);
    expect(trip).toEqual(
      expect.arrayContaining(["search_stays", "save_stay_option"]),
    );
    const draft = toolsFor("draft").map((tool) => tool.name);
    expect(draft).not.toContain("search_stays");
    const record = toolsFor("trip").find(
      (tool) => tool.name === "record_booking",
    );
    expect(JSON.stringify(record?.parameters)).toContain("fromShownStay");
  });

  const base = {
    phase: "trip" as const,
    startMode: "KNOWN_DESTINATION" as const,
    draft: EMPTY_DRAFT,
    today: "2026-10-15",
    userName: "Sam",
    researchAvailable: false,
  };

  it("says stay search is off when it is", () => {
    const text = buildInstructions({ ...base, staySearch: "off" });
    expect(text).toContain("Stay search is not configured");
    expect(text).not.toContain("use search_stays");
  });

  it("names the source and the rules, and lists stays shown earlier", () => {
    const text = buildInstructions({
      ...base,
      staySearch: "live",
      staySource: "Google Hotels via SerpApi",
      shownStays: [{ resultId: "s1", offer: sampleStay() }],
    });
    expect(text).toContain("use search_stays");
    expect(text).toContain("Results come from Google Hotels via SerpApi");
    expect(text).toContain("never claim it booked or reserved one");
    expect(text).toContain("does not search Airbnb");
    expect(text).toContain(
      "- s1: Grand Summit Lodge (hotel), 2027-03-05 to 2027-03-07, 412.00 USD a night, 824.00 USD total for 2 nights",
    );
  });

  it("says rentals can't be searched when the provider only does hotels", () => {
    const text = buildInstructions({
      ...base,
      staySearch: "hotels_only",
      staySource: "Some hotel API",
    });
    expect(text).toContain("it cannot search vacation rentals");
  });
});
