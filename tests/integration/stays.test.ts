import { beforeEach, describe, expect, it } from "vitest";

import { requireTripAccess } from "@/server/access";
import { sendAtlasMessage } from "@/server/ai/orchestrator";
import { dbFlightCache } from "@/server/flights/db-cache";
import { resetRateLimits } from "@/server/rate-limit";
import { getOrCreateTripConversation } from "@/server/services/conversations";
import { addStayFromLink, saveStayOffer } from "@/server/services/stays";
import { createManualTrip } from "@/server/services/trips";
import { StayProviderError } from "@/server/stays";
import { CachedStayProvider } from "@/server/stays/cache";
import { SerpApiStayProvider } from "@/server/stays/serpapi";

import { addMember, createUser, db, resetDatabase } from "../support/db";
import { jsonResponse } from "../support/duffel";
import { ScriptedProvider } from "../support/mock-provider";
import {
  FakeStayProvider,
  hotelProperty,
  hotelsSearch,
  rentalProperty,
  sampleStay,
} from "../support/stays";

beforeEach(async () => {
  await resetDatabase();
  resetRateLimits();
});

async function setup() {
  const organizer = await createUser("Organizer");
  const trip = await createManualTrip(organizer.id, {
    title: "Park City",
    destination: "Park City",
    startDate: "2027-03-05",
    endDate: "2027-03-07",
  });
  const access = await requireTripAccess(trip.id, organizer.id);
  const conversation = await getOrCreateTripConversation(access);
  return { organizer, trip, access, conversation };
}

const rentalSearch = {
  name: "search_stays",
  args: {
    location: "Park City, Utah",
    checkIn: "2027-03-05",
    checkOut: "2027-03-07",
    guests: 8,
    kind: "vacation_rental",
    bedrooms: 4,
    minPrice: null,
    maxPrice: null,
    sort: null,
  },
};

function bookingArgs(values: Record<string, unknown>) {
  const keys = [
    "fromShownFlight",
    "fromShownStay",
    "title",
    "provider",
    "reference",
    "fromLocation",
    "toLocation",
    "locationName",
    "address",
    "startDate",
    "startTime",
    "endDate",
    "endTime",
    "costAmount",
    "currency",
    "costPerPerson",
    "notes",
  ];
  return {
    category: "ACCOMMODATION",
    travelers: [],
    ...Object.fromEntries(keys.map((key) => [key, null])),
    ...values,
  };
}

async function tripCounts(tripId: string) {
  return Promise.all([
    db.researchOption.count({ where: { tripId } }),
    db.booking.count({ where: { tripId } }),
    db.activityLog.count({ where: { tripId } }),
  ]);
}

describe("saving a Google Hotels result", () => {
  it("saves an option with provenance and coordinates, and a considering booking that is never booked", async () => {
    const { trip, access } = await setup();
    const saved = await saveStayOffer(access, sampleStay(), {
      asBooking: true,
    });
    const option = await db.researchOption.findUniqueOrThrow({
      where: { id: saved.optionId },
    });
    expect(option).toMatchObject({
      category: "LODGING",
      title: "Grand Summit Lodge",
      url: "https://www.grandsummit.example/stay",
      sourceName: "Google Hotels via SerpApi",
      origin: "RESEARCH_PROVIDER",
      status: "SUGGESTED",
      priceCurrency: "USD",
      priceUnit: "total for 2 nights",
      locationName: "Park City",
      latitude: 40.6514,
      longitude: -111.5079,
    });
    expect(option.priceAmount?.toFixed(2)).toBe("824.00");
    expect(option.retrievedAt?.toISOString()).toBe("2026-10-15T12:00:00.000Z");
    expect(option.priceNote).toContain("can change before booking");
    expect(option.providerPayload).toMatchObject({
      provider: "serpapi",
      offerId: "gh_0123456789abcdef01234567",
      propertyToken: "ChkIv_HyiNKHpf6yARoML2cvMXozdGJnZ3BzEAE",
      checkIn: "2027-03-05",
      nightlyAmount: "412.00",
    });

    const booking = await db.booking.findUniqueOrThrow({
      where: { id: saved.bookingId! },
      include: { participants: true },
    });
    expect(booking).toMatchObject({
      category: "ACCOMMODATION",
      status: "PLANNED",
      startMinute: 960,
      endMinute: 660,
      locationName: "Park City",
      currency: "USD",
      costIsEstimate: true,
      researchOptionId: option.id,
    });
    expect(booking.startDate?.toISOString().slice(0, 10)).toBe("2027-03-05");
    expect(booking.endDate?.toISOString().slice(0, 10)).toBe("2027-03-07");
    expect(booking.costAmount?.toFixed(2)).toBe("824.00");
    expect(booking.notes).toContain("Not booked.");
    expect(booking.notes).toContain("from Booking.com, Expedia");
    expect(booking.participants).toEqual([
      expect.objectContaining({
        memberId: access.memberId,
        status: "CONSIDERING",
        roomAssignment: null,
      }),
    ]);

    // Saving the same result again reuses both records and adds a second member as considering.
    const friend = await createUser("Friend");
    await addMember(trip.id, friend.id);
    const friendAccess = await requireTripAccess(trip.id, friend.id);
    const again = await saveStayOffer(friendAccess, sampleStay(), {
      asBooking: true,
    });
    expect(again).toEqual({
      optionId: option.id,
      bookingId: booking.id,
      alreadySaved: true,
    });
    expect(
      await db.bookingParticipant.findMany({
        where: { bookingId: booking.id },
        select: { status: true },
      }),
    ).toEqual([{ status: "CONSIDERING" }, { status: "CONSIDERING" }]);
    expect(
      (await db.booking.findUniqueOrThrow({ where: { id: booking.id } }))
        .status,
    ).toBe("PLANNED");
  });

  it("can save to options only, and keeps several stays per trip apart", async () => {
    const { trip, access } = await setup();
    await saveStayOffer(access, sampleStay(), { asBooking: false });
    await saveStayOffer(
      access,
      sampleStay({
        offerId: "gh_other",
        name: "Old Town Ski Chalet",
        kind: "vacation_rental",
        totalAmount: null,
        nightlyAmount: "690.00",
      }),
      { asBooking: true },
    );
    const options = await db.researchOption.findMany({
      where: { tripId: trip.id },
      orderBy: { createdAt: "asc" },
    });
    expect(options.map((option) => option.title)).toEqual([
      "Grand Summit Lodge",
      "Old Town Ski Chalet",
    ]);
    expect(options[1]!.priceUnit).toBe("night");
    const bookings = await db.booking.findMany({ where: { tripId: trip.id } });
    expect(bookings).toHaveLength(1);
    expect(bookings[0]!.notes).toContain("No total was shown");
  });
});

describe("adding a stay from a link", () => {
  it("keeps the link and site, never opens it, and prices per night as an estimate", async () => {
    const { organizer, trip, access } = await setup();
    const friend = await createUser("Friend");
    const member = await addMember(trip.id, friend.id);
    const added = await addStayFromLink(
      access,
      {
        url: "https://www.airbnb.com/rooms/53917725?adults=4",
        title: "Cabin near Main Street",
        checkIn: "2027-03-05",
        checkOut: "2027-03-07",
        priceAmount: "350.00",
        priceBasis: "night",
        currency: "USD",
        travelers: [access.memberId, member.id],
        booked: false,
        notes: null,
      },
      { now: new Date("2026-10-15T12:00:00Z"), userName: organizer.name },
    );
    const booking = await db.booking.findUniqueOrThrow({
      where: { id: added.bookingId },
      include: { participants: { orderBy: { createdAt: "asc" } } },
    });
    expect(booking).toMatchObject({
      category: "ACCOMMODATION",
      title: "Cabin near Main Street",
      provider: "Airbnb",
      url: "https://www.airbnb.com/rooms/53917725?adults=4",
      status: "PLANNED",
      currency: "USD",
      costIsEstimate: true,
      researchOptionId: added.optionId,
    });
    expect(booking.costAmount?.toFixed(2)).toBe("700.00");
    expect(booking.notes).toContain(
      "Added from a Airbnb link by Organizer on 2026-10-15. The name, dates, and price were entered by hand; the app did not open or check the listing.",
    );
    expect(booking.notes).toContain("350.00 USD a night");
    expect(booking.participants.map((p) => p.status)).toEqual([
      "CONSIDERING",
      "CONSIDERING",
    ]);
    const option = await db.researchOption.findUniqueOrThrow({
      where: { id: added.optionId },
    });
    expect(option).toMatchObject({
      category: "LODGING",
      origin: "USER",
      sourceName: "Airbnb",
      status: "SUGGESTED",
      retrievedAt: null,
      priceUnit: "night",
    });
  });

  it("records a stay the traveler already booked as booked, not confirmed", async () => {
    const { access } = await setup();
    const added = await addStayFromLink(access, {
      url: "https://www.vrbo.com/2345678ha",
      title: "Deer Valley condo",
      checkIn: null,
      checkOut: null,
      priceAmount: "1450.00",
      priceBasis: "total",
      currency: "USD",
      travelers: [],
      booked: true,
      notes: null,
    });
    const booking = await db.booking.findUniqueOrThrow({
      where: { id: added.bookingId },
      include: { participants: true },
    });
    expect(booking.status).toBe("BOOKED");
    expect(booking.costIsEstimate).toBe(false);
    expect(booking.participants).toEqual([
      expect.objectContaining({ memberId: access.memberId, status: "BOOKED" }),
    ]);
  });

  it("refuses travelers from another trip and writes nothing", async () => {
    const { trip, access } = await setup();
    const other = await setup();
    const before = await tripCounts(trip.id);
    await expect(
      addStayFromLink(access, {
        url: "https://www.airbnb.com/rooms/1",
        title: "Cabin",
        checkIn: null,
        checkOut: null,
        priceAmount: null,
        priceBasis: "total",
        currency: null,
        travelers: [other.access.memberId],
        booked: false,
        notes: null,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await tripCounts(trip.id)).toEqual(before);
  });
});

describe("Atlas and stays", () => {
  it("finds a 4-bedroom place near Park City, saves one as considering, and records it booked later", async () => {
    const { organizer, trip, conversation } = await setup();
    const stays = new FakeStayProvider([
      sampleStay({
        offerId: "gh_chalet",
        name: "Old Town Ski Chalet",
        kind: "vacation_rental",
        essentialInfo: ["Sleeps 10", "4 bedrooms"],
        nightlyAmount: "690.00",
        totalAmount: "1380.00",
        propertyUrl: null,
      }),
      sampleStay({ offerId: "gh_lodge" }),
    ]);
    const provider = new ScriptedProvider([
      {
        calls: [rentalSearch],
        reply: "I found two places on Google Hotels via SerpApi.",
      },
      {
        calls: [
          {
            name: "save_stay_option",
            args: { resultId: "s1", asConsidering: true },
          },
        ],
        reply: "Saved it as considering.",
      },
      {
        calls: [
          {
            name: "record_booking",
            args: bookingArgs({
              fromShownStay: { resultId: null, name: "old town chalet" },
              costAmount: "1290.00",
            }),
          },
        ],
        reply: "Recorded it.",
      },
    ]);

    await sendAtlasMessage(
      organizer,
      conversation.id,
      "find a 4-bedroom place near Park City for March 5-7",
      { provider, stays, flights: null },
    );
    expect(stays.queries[0]).toMatchObject({
      location: "Park City, Utah",
      kind: "vacation_rental",
      bedrooms: 4,
      guests: 8,
      sort: "relevance",
    });
    const search = provider.toolOutputs[0]!.output as {
      ok: true;
      result: {
        source: string;
        retrievedAt: string;
        results: { resultId: string; name: string; price: string }[];
      };
    };
    expect(search.ok).toBe(true);
    expect(search.result.source).toBe("Google Hotels via SerpApi");
    expect(search.result.results[0]).toMatchObject({
      resultId: "s1",
      name: "Old Town Ski Chalet",
      price: "690.00 USD a night, 1380.00 USD total for 2 nights",
    });
    // Searching wrote nothing to the trip.
    expect(await db.researchOption.count({ where: { tripId: trip.id } })).toBe(
      0,
    );
    const reply = await db.message.findFirstOrThrow({
      where: { conversationId: conversation.id, role: "ASSISTANT" },
    });
    expect(
      (reply.metadata as { stayResults?: unknown[] }).stayResults,
    ).toHaveLength(2);

    // A later turn saves the stay it showed, by resultId.
    await sendAtlasMessage(organizer, conversation.id, "save the chalet", {
      provider,
      stays,
      flights: null,
    });
    const booking = await db.booking.findFirstOrThrow({
      where: { tripId: trip.id },
      include: { participants: true, researchOption: true },
    });
    expect(booking.status).toBe("PLANNED");
    expect(booking.participants[0]!.status).toBe("CONSIDERING");
    expect(booking.researchOption).toMatchObject({
      latitude: 40.6514,
      longitude: -111.5079,
    });

    // "We booked it": the same record becomes booked for the user, never confirmed.
    await sendAtlasMessage(
      organizer,
      conversation.id,
      "we booked the old town chalet for 1290",
      { provider, stays, flights: null },
    );
    const output = provider.toolOutputs[2]!.output as {
      ok: true;
      result: { recorded: boolean; bookings: { newRecord: boolean }[] };
    };
    expect(output.result.recorded).toBe(true);
    expect(output.result.bookings).toEqual([
      expect.objectContaining({ newRecord: false }),
    ]);
    const updated = await db.booking.findUniqueOrThrow({
      where: { id: booking.id },
      include: { participants: true, researchOption: true },
    });
    expect(updated.status).toBe("BOOKED");
    expect(updated.participants[0]!.status).toBe("BOOKED");
    expect(updated.researchOption?.status).toBe("BOOKED");
    expect(await db.booking.count({ where: { tripId: trip.id } })).toBe(1);
  });

  it("records a shown stay booked straight away with the price the user paid and its coordinates", async () => {
    const { organizer, trip, conversation } = await setup();
    const stays = new FakeStayProvider([sampleStay()]);
    const provider = new ScriptedProvider([
      {
        calls: [
          {
            ...rentalSearch,
            args: { ...rentalSearch.args, kind: "hotel", bedrooms: null },
          },
        ],
        reply: "Found one.",
      },
      {
        calls: [
          {
            name: "record_booking",
            args: bookingArgs({
              fromShownStay: { resultId: "s1", name: null },
              costAmount: "800.00",
              currency: "USD",
            }),
          },
        ],
        reply: "Recorded.",
      },
    ]);
    await sendAtlasMessage(organizer, conversation.id, "hotels please", {
      provider,
      stays,
      flights: null,
    });
    await sendAtlasMessage(organizer, conversation.id, "I booked it", {
      provider,
      stays,
      flights: null,
    });
    const booking = await db.booking.findFirstOrThrow({
      where: { tripId: trip.id },
      include: { participants: true, researchOption: true },
    });
    expect(booking).toMatchObject({
      category: "ACCOMMODATION",
      title: "Grand Summit Lodge",
      status: "BOOKED",
      costIsEstimate: false,
      startMinute: 960,
      endMinute: 660,
      locationName: "Park City",
    });
    expect(booking.costAmount?.toFixed(2)).toBe("800.00");
    expect(booking.notes).toContain(
      "Not checked with the airline or provider.",
    );
    expect(booking.researchOption).toMatchObject({
      latitude: 40.6514,
      status: "BOOKED",
    });
  });

  it("records a stay the user describes without a search", async () => {
    const { organizer, trip, conversation } = await setup();
    const provider = new ScriptedProvider([
      {
        calls: [
          {
            name: "record_booking",
            args: bookingArgs({
              title: "Airbnb on Main Street",
              provider: "Airbnb",
              locationName: "Park City",
              address: "123 Main St",
              startDate: "2027-03-05",
              endDate: "2027-03-07",
            }),
          },
        ],
        reply: "Recorded.",
      },
    ]);
    await sendAtlasMessage(organizer, conversation.id, "We booked an Airbnb", {
      provider,
      stays: null,
      flights: null,
    });
    const booking = await db.booking.findFirstOrThrow({
      where: { tripId: trip.id },
    });
    expect(booking).toMatchObject({
      category: "ACCOMMODATION",
      provider: "Airbnb",
      locationName: "Park City",
      address: "123 Main St",
      status: "BOOKED",
    });
  });

  it("asks which stay when a name fits more than one, and records nothing", async () => {
    const { organizer, trip, conversation } = await setup();
    const stays = new FakeStayProvider([
      sampleStay({ offerId: "a", name: "Summit Watch Resort" }),
      sampleStay({ offerId: "b", name: "Grand Summit Lodge" }),
    ]);
    const provider = new ScriptedProvider([
      {
        calls: [
          {
            ...rentalSearch,
            args: { ...rentalSearch.args, kind: "hotel", bedrooms: null },
          },
        ],
        reply: "Two.",
      },
      {
        calls: [
          {
            name: "record_booking",
            args: bookingArgs({
              fromShownStay: { resultId: null, name: "Summit" },
            }),
          },
        ],
        reply: "Which one?",
      },
    ]);
    await sendAtlasMessage(organizer, conversation.id, "hotels", {
      provider,
      stays,
      flights: null,
    });
    await sendAtlasMessage(organizer, conversation.id, "booked the summit", {
      provider,
      stays,
      flights: null,
    });
    expect(provider.toolOutputs[1]!.output).toMatchObject({
      ok: true,
      result: { recorded: false, ambiguous: true },
    });
    expect(await db.booking.count({ where: { tripId: trip.id } })).toBe(0);
  });

  it("says stay search is not configured and changes nothing", async () => {
    const { organizer, trip, conversation } = await setup();
    const provider = new ScriptedProvider([
      { calls: [rentalSearch], reply: "Stay search isn't set up." },
    ]);
    const before = await tripCounts(trip.id);
    await sendAtlasMessage(organizer, conversation.id, "find a cabin", {
      provider,
      stays: null,
      flights: null,
    });
    expect(provider.toolOutputs[0]!.output).toMatchObject({
      ok: true,
      result: { available: false },
    });
    expect(provider.requests[0]!.instructions).toContain(
      "Stay search is not configured",
    );
    expect(await tripCounts(trip.id)).toEqual(before);
  });

  it("reports an exhausted quota and changes nothing", async () => {
    const { organizer, trip, conversation } = await setup();
    const stays = new FakeStayProvider(
      [],
      new StayProviderError(
        "rate_limit",
        "The app's SerpApi account has used all of its searches for now.",
      ),
    );
    const provider = new ScriptedProvider([
      { calls: [rentalSearch], reply: "Out of quota." },
    ]);
    const before = await tripCounts(trip.id);
    await sendAtlasMessage(organizer, conversation.id, "find a cabin", {
      provider,
      stays,
      flights: null,
    });
    expect(provider.toolOutputs[0]!.output).toEqual({
      ok: false,
      error:
        "The app's SerpApi account has used all of its searches for now. Nothing in the trip was changed.",
    });
    expect(await tripCounts(trip.id)).toEqual(before);
  });
});

describe("the persisted search cache", () => {
  it("answers an identical stay search from Postgres without another request", async () => {
    let requests = 0;
    const fetchImpl = (async () => {
      requests += 1;
      return jsonResponse(
        200,
        hotelsSearch([hotelProperty(), rentalProperty()]),
      );
    }) as unknown as typeof fetch;
    const make = () =>
      new CachedStayProvider(
        new SerpApiStayProvider({
          apiKey: "serp_key",
          baseUrl: "https://serpapi.example",
          fetch: fetchImpl,
        }),
        dbFlightCache,
        60 * 60 * 1000,
      );
    const query = {
      location: "Park City",
      checkIn: "2027-03-05",
      checkOut: "2027-03-07",
      guests: 4,
      kind: "hotel" as const,
      bedrooms: null,
      minPrice: null,
      maxPrice: null,
      sort: "relevance" as const,
    };
    const first = await make().search(query);
    const second = await make().search(query);
    expect(requests).toBe(1);
    expect(second.cached).toBe(true);
    expect(second.offers).toEqual(first.offers);
    const rows = await db.flightSearchCache.findMany();
    expect(rows.map((row) => row.key)).toEqual([
      expect.stringMatching(/^serpapi-hotels:search:/),
    ]);
  });
});
