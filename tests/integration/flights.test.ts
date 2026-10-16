import { beforeEach, describe, expect, it } from "vitest";

import { requireTripAccess } from "@/server/access";
import {
  sendAtlasMessage,
  TEST_DATA_REPLY_NOTICE,
} from "@/server/ai/orchestrator";
import { FlightProviderError } from "@/server/flights";
import { resetRateLimits } from "@/server/rate-limit";
import { getOrCreateTripConversation } from "@/server/services/conversations";
import { saveFlightOffer } from "@/server/services/flights";
import { createManualTrip } from "@/server/services/trips";

import { addMember, createUser, db, resetDatabase } from "../support/db";
import { FakeFlightProvider, sampleOffer } from "../support/duffel";
import { ScriptedProvider } from "../support/mock-provider";

beforeEach(async () => {
  await resetDatabase();
  resetRateLimits();
});

async function setup() {
  const organizer = await createUser("Organizer");
  const trip = await createManualTrip(organizer.id, {
    title: "Lisbon",
    destination: "Lisbon",
    startDate: "2027-05-20",
    endDate: "2027-05-23",
  });
  const access = await requireTripAccess(trip.id, organizer.id);
  return { organizer, trip, access };
}

async function tripCounts(tripId: string) {
  const [options, bookings, activity] = await Promise.all([
    db.researchOption.count({ where: { tripId } }),
    db.booking.count({ where: { tripId } }),
    db.activityLog.count({ where: { tripId } }),
  ]);
  return { options, bookings, activity };
}

describe("saving a flight", () => {
  it("saves an option with provenance and labels test data", async () => {
    const { trip, access } = await setup();
    const saved = await saveFlightOffer(access, sampleOffer(), {
      asBooking: false,
    });
    expect(saved).toMatchObject({ bookingId: null, alreadySaved: false });

    const option = await db.researchOption.findUniqueOrThrow({
      where: { id: saved.optionId },
    });
    expect(option).toMatchObject({
      tripId: trip.id,
      category: "FLIGHT",
      status: "SUGGESTED",
      origin: "RESEARCH_PROVIDER",
      sourceName: "Duffel (test data)",
      priceCurrency: "USD",
      priceNote:
        "Total for 2 travelers. Duffel test data: not real fares or availability",
      title: "Duffel Airways: JFK to LIS, one way",
    });
    expect(option.priceAmount?.toFixed(2)).toBe("864.20");
    expect(option.retrievedAt?.toISOString()).toBe("2026-10-15T12:00:00.000Z");
    expect(option.url).toMatch(/^https:\/\/www\.google\.com\/travel\/flights/);
    expect(option.providerPayload).toMatchObject({
      provider: "duffel",
      offerId: "off_test_1",
      testMode: true,
    });
    expect(await db.booking.count({ where: { tripId: trip.id } })).toBe(0);
  });

  it("tracks a flight as a booking record with the traveler considering, never booked", async () => {
    const { trip, access } = await setup();
    const member = await createUser("Member");
    await addMember(trip.id, member.id);
    const memberAccess = await requireTripAccess(trip.id, member.id);

    const first = await saveFlightOffer(access, sampleOffer(), {
      asBooking: true,
    });
    const booking = await db.booking.findUniqueOrThrow({
      where: { id: first.bookingId! },
      include: { participants: true },
    });
    expect(booking).toMatchObject({
      category: "FLIGHT",
      status: "PLANNED",
      researchOptionId: first.optionId,
      fromLocation: "New York (JFK)",
      toLocation: "Lisbon (LIS)",
      startMinute: 8 * 60 + 30,
      endMinute: 20 * 60 + 45,
      currency: "USD",
      costIsEstimate: true,
    });
    expect(booking.notes).toContain("Duffel test data");
    expect(booking.participants).toEqual([
      expect.objectContaining({
        memberId: access.memberId,
        status: "CONSIDERING",
      }),
    ]);

    // A second traveler tracking the same flight joins the same record as considering.
    const second = await saveFlightOffer(memberAccess, sampleOffer(), {
      asBooking: true,
    });
    expect(second).toEqual({
      optionId: first.optionId,
      bookingId: first.bookingId,
      alreadySaved: true,
    });
    const participants = await db.bookingParticipant.findMany({
      where: { bookingId: first.bookingId! },
    });
    expect(participants.map((p) => p.status)).toEqual([
      "CONSIDERING",
      "CONSIDERING",
    ]);
    expect(await tripCounts(trip.id)).toMatchObject({
      options: 1,
      bookings: 1,
    });
    const option = await db.researchOption.findUniqueOrThrow({
      where: { id: first.optionId },
    });
    expect(option.status).toBe("SUGGESTED");
  });
});

describe("Atlas flight search", () => {
  async function withConversation() {
    const context = await setup();
    const conversation = await getOrCreateTripConversation(context.access);
    return { ...context, conversation };
  }

  const searchCall = {
    name: "search_flights",
    args: {
      origin: "JFK",
      destination: "LIS",
      departureDate: "2027-05-20",
      returnDate: null,
      passengers: null,
      cabin: null,
      maxStops: null,
    },
  };

  it("answers from returned results, labels test data, and saves only on request", async () => {
    const { organizer, trip, conversation } = await withConversation();
    const flights = new FakeFlightProvider();
    const provider = new ScriptedProvider([
      {
        calls: [
          searchCall,
          { name: "save_flight_option", args: { resultId: "f1" } },
        ],
        reply: "Duffel Airways has a nonstop for $864.20 in total.",
      },
    ]);
    const result = await sendAtlasMessage(
      organizer,
      conversation.id,
      "Find flights from JFK",
      { provider, flights },
    );

    expect(flights.queries[0]).toMatchObject({
      origin: "JFK",
      destination: "LIS",
      passengers: 1,
      cabin: null,
      maxStops: 1,
    });
    const searchOutput = provider.toolOutputs[0]!.output as {
      ok: boolean;
      result: { testData: boolean; dataNotice: string; results: unknown[] };
    };
    expect(searchOutput.ok).toBe(true);
    expect(searchOutput.result.testData).toBe(true);
    expect(searchOutput.result.dataNotice).toContain("Duffel test data");
    expect(searchOutput.result.results).toHaveLength(1);
    expect(result.effects.map((effect) => effect.tool)).toEqual([
      "search_flights",
      "save_flight_option",
    ]);
    expect(result.effects[0]!.summary).toContain("Duffel test data");

    const reply = await db.message.findFirstOrThrow({
      where: { conversationId: conversation.id, role: "ASSISTANT" },
    });
    expect(reply.content).toContain(TEST_DATA_REPLY_NOTICE);
    expect(provider.requests[0]!.instructions).toContain("Duffel test data");

    const options = await db.researchOption.findMany({
      where: { tripId: trip.id },
    });
    expect(options).toEqual([
      expect.objectContaining({
        category: "FLIGHT",
        status: "SUGGESTED",
        origin: "RESEARCH_PROVIDER",
        sourceName: "Duffel (test data)",
      }),
    ]);
    expect(await db.booking.count({ where: { tripId: trip.id } })).toBe(0);
  });

  it("says flight search is not configured and changes nothing", async () => {
    const { organizer, trip, conversation } = await withConversation();
    const before = await tripCounts(trip.id);
    const provider = new ScriptedProvider([
      { calls: [searchCall], reply: "Flight search isn't set up yet." },
    ]);
    await sendAtlasMessage(organizer, conversation.id, "Any flights?", {
      provider,
      flights: null,
    });
    expect(provider.toolOutputs[0]!.output).toEqual({
      ok: true,
      result: expect.objectContaining({ available: false }),
    });
    expect(provider.requests[0]!.instructions).toContain(
      "Flight search is not configured",
    );
    expect(await tripCounts(trip.id)).toEqual(before);
  });

  it("reports a provider error to the model and changes nothing", async () => {
    const { organizer, trip, conversation } = await withConversation();
    const before = await tripCounts(trip.id);
    const flights = new FakeFlightProvider(
      [],
      new FlightProviderError(
        "auth",
        "Duffel rejected the server's access token.",
      ),
    );
    const provider = new ScriptedProvider([
      { calls: [searchCall], reply: "The flight search failed." },
    ]);
    const result = await sendAtlasMessage(
      organizer,
      conversation.id,
      "Flights please",
      { provider, flights },
    );
    expect(provider.toolOutputs[0]!.output).toEqual({
      ok: false,
      error:
        "Duffel rejected the server's access token. Nothing in the trip was changed.",
    });
    expect(result.effects).toEqual([
      expect.objectContaining({ tool: "search_flights", ok: false }),
    ]);
    expect(await tripCounts(trip.id)).toEqual(before);
  });
});
