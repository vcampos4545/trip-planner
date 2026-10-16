import { beforeEach, describe, expect, it } from "vitest";

import type { FlightOffer } from "@/lib/flights";
import { requireTripAccess } from "@/server/access";
import { sendAtlasMessage } from "@/server/ai/orchestrator";
import {
  FlightProviderError,
  type FlightSearchProvider,
  type FlightSearchQuery,
  type FlightSearchResult,
} from "@/server/flights";
import { dbFlightCache } from "@/server/flights/db-cache";
import {
  SERPAPI_SOURCE_NAME,
  SerpApiFlightProvider,
} from "@/server/flights/serpapi";
import { resetRateLimits } from "@/server/rate-limit";
import { getOrCreateTripConversation } from "@/server/services/conversations";
import { saveFlightOffer } from "@/server/services/flights";
import { createManualTrip } from "@/server/services/trips";

import { createUser, db, resetDatabase } from "../support/db";
import { jsonResponse, sampleOffer } from "../support/duffel";
import { ScriptedProvider } from "../support/mock-provider";
import {
  GOOGLE_FLIGHTS_URL,
  SUGGESTIONS_BY_QUERY,
  serpItem,
  serpSearch,
} from "../support/serpapi";

beforeEach(async () => {
  await resetDatabase();
  resetRateLimits();
});

const PENDING_RETURN = {
  date: "2027-05-23",
  token: "dep_token_1",
  originCodes: "JFK",
  destinationCodes: "LIS",
  maxStops: 1,
};

function serpOffer(overrides: Partial<FlightOffer> = {}): FlightOffer {
  return sampleOffer({
    offerId: "gf_0123456789abcdef01234567",
    airline: { name: "TAP Air Portugal", iataCode: "TP" },
    totalAmount: "1040.00",
    expiresAt: null,
    sourceName: SERPAPI_SOURCE_NAME,
    providerId: "serpapi",
    testMode: false,
    pendingReturn: PENDING_RETURN,
    bookingUrl: GOOGLE_FLIGHTS_URL,
    ...overrides,
  });
}

/** A provider that behaves like SerpApi: live data, round trips priced first, returns on request. */
class FakeSerpApi implements FlightSearchProvider {
  readonly id = "serpapi";
  readonly label = SERPAPI_SOURCE_NAME;
  readonly testMode = false;
  readonly queries: FlightSearchQuery[] = [];
  readonly returnRequests: FlightOffer[] = [];

  constructor(private readonly error?: Error) {}

  private result(offers: FlightOffer[]): FlightSearchResult {
    const place = (code: string) => ({
      query: code,
      iataCode: code,
      name: code,
    });
    return {
      search: {
        origin: place("JFK"),
        destination: place("LIS"),
        departureDate: "2027-05-20",
        returnDate: "2027-05-23",
        passengers: 2,
        cabin: "economy",
        maxStops: 1,
      },
      offers,
      retrievedAt: "2026-10-15T12:00:00.000Z",
      sourceName: SERPAPI_SOURCE_NAME,
      testMode: false,
      priceInsights: {
        sourceName: "Google Flights",
        currency: "USD",
        lowestPrice: "1040.00",
        priceLevel: "low",
        typicalLow: "1100.00",
        typicalHigh: "1500.00",
      },
    };
  }

  async search(query: FlightSearchQuery) {
    this.queries.push(query);
    if (this.error) throw this.error;
    return this.result([serpOffer()]);
  }

  async searchReturns(offer: FlightOffer) {
    this.returnRequests.push(offer);
    const back = {
      ...offer.slices[0]!,
      origin: offer.slices[0]!.destination,
      destination: offer.slices[0]!.origin,
      departingAt: "2027-05-23T11:00:00",
      arrivingAt: "2027-05-23T14:30:00",
    };
    return this.result([
      serpOffer({
        offerId: "gf_return_000000000000000001",
        slices: [offer.slices[0]!, back],
        pendingReturn: null,
        totalAmount: "1090.00",
      }),
    ]);
  }
}

async function setup() {
  const organizer = await createUser("Organizer");
  const trip = await createManualTrip(organizer.id, {
    title: "Lisbon",
    destination: "Lisbon",
    startDate: "2027-05-20",
    endDate: "2027-05-23",
  });
  const access = await requireTripAccess(trip.id, organizer.id);
  const conversation = await getOrCreateTripConversation(access);
  return { organizer, trip, access, conversation };
}

const searchCall = {
  name: "search_flights",
  args: {
    origin: "JFK",
    destination: "LIS",
    departureDate: "2027-05-20",
    returnDate: "2027-05-23",
    passengers: 2,
    cabin: "economy",
    maxStops: null,
  },
};

describe("saving a Google Flights result", () => {
  it("keeps the source, the Google Flights link, and that the return is not chosen", async () => {
    const { trip, access } = await setup();
    const saved = await saveFlightOffer(access, serpOffer(), {
      asBooking: true,
    });
    const option = await db.researchOption.findUniqueOrThrow({
      where: { id: saved.optionId },
    });
    expect(option).toMatchObject({
      status: "SUGGESTED",
      sourceName: "Google Flights via SerpApi",
      url: GOOGLE_FLIGHTS_URL,
      title: "TAP Air Portugal: JFK to LIS, round trip",
      priceNote:
        "Round-trip total for 2 travelers. Price as Google Flights via SerpApi showed it at retrieval; it can change before booking",
    });
    expect(option.description).toContain(
      "Return on 2027-05-23: flight not chosen yet.",
    );
    expect(option.providerPayload).toMatchObject({
      provider: "serpapi",
      testMode: false,
      returnDate: "2027-05-23",
      returnChosen: false,
    });
    expect(option.priceNote).not.toMatch(/test data/i);

    const booking = await db.booking.findUniqueOrThrow({
      where: { id: saved.bookingId! },
    });
    expect(booking).toMatchObject({
      status: "PLANNED",
      url: GOOGLE_FLIGHTS_URL,
    });
    expect(booking.notes).toContain(
      "round-trip total for 2 travelers as quoted by Google Flights via SerpApi",
    );
    expect(booking.notes).toContain("Not booked.");
    expect(await db.booking.count({ where: { tripId: trip.id } })).toBe(1);
  });
});

describe("Atlas with SerpApi", () => {
  it("names the real source, shows Google's insights, and loads returns only when asked", async () => {
    const { organizer, trip, conversation } = await setup();
    const flights = new FakeSerpApi();
    const provider = new ScriptedProvider([
      {
        calls: [searchCall],
        reply:
          "TAP has a round trip for 1040.00 USD total on Google Flights via SerpApi.",
      },
    ]);
    const first = await sendAtlasMessage(
      organizer,
      conversation.id,
      "Find flights to Lisbon",
      { provider, flights },
    );
    expect(flights.returnRequests).toHaveLength(0);
    const output = provider.toolOutputs[0]!.output as {
      ok: boolean;
      result: {
        testData: boolean;
        source: string;
        dataNotice: string;
        priceInsights: { sourceName: string; note: string };
        results: { returnNotLoaded: boolean; link: string }[];
      };
    };
    expect(output.ok).toBe(true);
    expect(output.result).toMatchObject({
      testData: false,
      source: "Google Flights via SerpApi",
      priceInsights: {
        sourceName: "Google Flights",
        note: "Google's own estimate for this route, not a fare.",
      },
      results: [{ returnNotLoaded: true, link: GOOGLE_FLIGHTS_URL }],
    });
    expect(output.result.dataNotice).not.toMatch(/duffel|test data/i);
    expect(first.effects[0]!.summary).toBe(
      "Searched Google Flights via SerpApi for flights JFK to LIS (1 results)",
    );
    const instructions = provider.requests[0]!.instructions;
    expect(instructions).toContain(
      "Its results come from Google Flights via SerpApi.",
    );
    expect(instructions).not.toContain("Duffel");
    const reply = await db.message.findFirstOrThrow({
      where: { conversationId: conversation.id, role: "ASSISTANT" },
    });
    expect(reply.content).not.toMatch(/test data/i);

    // Asked explicitly: Atlas searches and loads the returns for the first result. Result IDs
    // continue from the earlier turn, whose result (f1) is still listed for Atlas.
    const second = new ScriptedProvider([
      {
        calls: [
          searchCall,
          { name: "search_return_flights", args: { resultId: "f2" } },
          { name: "save_flight_option", args: { resultId: "f3" } },
        ],
        reply: "I saved the round trip with the 11:00 return.",
      },
    ]);
    const result = await sendAtlasMessage(
      organizer,
      conversation.id,
      "Show return flights for the first one and save it",
      { provider: second, flights },
    );
    expect(second.requests[0]!.instructions).toContain(
      "Flights shown earlier in this conversation",
    );
    expect(second.requests[0]!.instructions).toContain(
      "- f1: TAP Air Portugal",
    );
    expect(flights.returnRequests).toHaveLength(1);
    expect(flights.returnRequests[0]!.pendingReturn?.token).toBe("dep_token_1");
    expect(result.effects.map((effect) => effect.tool)).toEqual([
      "search_flights",
      "search_return_flights",
      "save_flight_option",
    ]);
    const option = await db.researchOption.findFirstOrThrow({
      where: { tripId: trip.id },
    });
    expect(option.description?.split("\n")).toHaveLength(2);
    expect(option.providerPayload).toMatchObject({ returnChosen: true });
    expect(await db.booking.count({ where: { tripId: trip.id } })).toBe(0);
  });

  it("reports an exhausted quota and changes nothing", async () => {
    const { organizer, trip, conversation } = await setup();
    const before = await db.researchOption.count({
      where: { tripId: trip.id },
    });
    const flights = new FakeSerpApi(
      new FlightProviderError(
        "rate_limit",
        "The app's SerpApi account has used all of its flight searches for now.",
      ),
    );
    const provider = new ScriptedProvider([
      { calls: [searchCall], reply: "Flight search is out of quota." },
    ]);
    await sendAtlasMessage(organizer, conversation.id, "Flights?", {
      provider,
      flights,
    });
    expect(provider.toolOutputs[0]!.output).toEqual({
      ok: false,
      error:
        "The app's SerpApi account has used all of its flight searches for now. Nothing in the trip was changed.",
    });
    expect(await db.researchOption.count({ where: { tripId: trip.id } })).toBe(
      before,
    );
  });
});

describe("Postgres flight cache", () => {
  it("stores, expires, and clears entries", async () => {
    const now = new Date();
    await dbFlightCache.set(
      "serpapi:search:a",
      { offers: [1] },
      new Date(now.getTime() + 60_000),
    );
    await dbFlightCache.set(
      "serpapi:search:old",
      { offers: [] },
      new Date(now.getTime() - 60_000),
    );
    expect(await dbFlightCache.get("serpapi:search:a", now)).toEqual({
      offers: [1],
    });
    expect(
      await dbFlightCache.get(
        "serpapi:search:a",
        new Date(now.getTime() + 120_000),
      ),
    ).toBeNull();
    expect(await dbFlightCache.get("serpapi:search:missing", now)).toBeNull();

    // Writing again replaces the entry and clears expired rows.
    await dbFlightCache.set(
      "serpapi:search:a",
      { offers: [2] },
      new Date(now.getTime() + 60_000),
    );
    expect(await dbFlightCache.get("serpapi:search:a", now)).toEqual({
      offers: [2],
    });
    expect(await db.flightSearchCache.count()).toBe(1);
  });
});

describe("Atlas searches places the way the form does", () => {
  function serpApi() {
    const calls: URL[] = [];
    const fetchImpl = async (input: string | URL | Request) => {
      const url = new URL(String(input));
      calls.push(url);
      if (url.searchParams.get("engine") === "google_flights_autocomplete") {
        const q = (url.searchParams.get("q") ?? "").toLowerCase();
        return jsonResponse(
          200,
          SUGGESTIONS_BY_QUERY[q] ?? { suggestions: [] },
        );
      }
      return jsonResponse(
        200,
        serpSearch({
          best: [
            serpItem({
              price: 520,
              legs: [
                {
                  from: "JFK",
                  to: "LIS",
                  depart: "2027-05-20 8:05",
                  arrive: "2027-05-20 20:15",
                },
              ],
              bookingToken: "book_1",
            }),
          ],
        }),
      );
    };
    const flights = new SerpApiFlightProvider({
      apiKey: "serp_integration_key",
      baseUrl: "https://serpapi.example",
      fetch: fetchImpl as typeof fetch,
    });
    return { flights, calls };
  }

  const placeSearch = (origin: string, destination: string) => ({
    name: "search_flights",
    args: { ...searchCall.args, origin, destination, returnDate: null },
  });

  it.each([
    ["New York", "Lisbon", "JFK, LGA, EWR to LIS"],
    ["JFK", "LIS", "JFK to LIS"],
    ["new york", "lis", "JFK, LGA, EWR to LIS"],
  ])("searches %j to %j", async (origin, destination, route) => {
    const { organizer, conversation } = await setup();
    const { flights } = serpApi();
    const provider = new ScriptedProvider([
      { calls: [placeSearch(origin, destination)], reply: "Here you go." },
    ]);
    const result = await sendAtlasMessage(
      organizer,
      conversation.id,
      `Flights from ${origin} to ${destination}`,
      { provider, flights },
    );
    expect(result.effects[0]!.summary).toBe(
      `Searched Google Flights via SerpApi for flights ${route} (1 results)`,
    );
  });

  it("hands back the choices for an ambiguous city without searching", async () => {
    const { organizer, conversation } = await setup();
    const { flights, calls } = serpApi();
    const provider = new ScriptedProvider([
      {
        calls: [placeSearch("JFK", "Portland")],
        reply: "Did you mean Portland, Oregon or Portland, Maine?",
      },
    ]);
    await sendAtlasMessage(organizer, conversation.id, "Flights to Portland", {
      provider,
      flights,
    });
    expect(provider.toolOutputs[0]!.output).toEqual({
      ok: false,
      error:
        'No flights were searched. To: "Portland" could be Portland, Oregon (PDX) or Portland, Maine (PWM). Pick one.',
    });
    expect(
      calls.some((url) => url.searchParams.get("engine") === "google_flights"),
    ).toBe(false);
  });
});
