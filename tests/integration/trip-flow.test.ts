import { beforeEach, describe, expect, it } from "vitest";

import { requireTripAccess } from "@/server/access";
import { sendAtlasMessage } from "@/server/ai/orchestrator";
import type { ToolEffect } from "@/server/ai/tools";
import { DomainError } from "@/server/errors";
import { resetRateLimits } from "@/server/rate-limit";
import {
  getOrCreateTripConversation,
  startCreationConversation,
} from "@/server/services/conversations";
import { saveFlightOffer } from "@/server/services/flights";
import { listStops, updateTripRoute } from "@/server/services/stops";
import {
  createManualTrip,
  listPendingProposals,
  resolveProposal,
} from "@/server/services/trips";

import { addMember, createUser, db, resetDatabase } from "../support/db";
import { PARK_CITY_FLIGHTS, RouteFlightProvider } from "../support/flights";
import { ScriptedProvider, updateCall } from "../support/mock-provider";

beforeEach(async () => {
  await resetDatabase();
  resetRateLimits();
});

async function parkCityTrip() {
  const user = await createUser("Vaughn Campos");
  const trip = await createManualTrip(user.id, {
    title: "Park City trip",
    destination: "Park City",
    startDate: "2027-02-27",
    endDate: "2027-03-07",
  });
  const access = await requireTripAccess(trip.id, user.id);
  const conversation = await getOrCreateTripConversation(access);
  const flights = new RouteFlightProvider(PARK_CITY_FLIGHTS);
  return { user, trip, access, conversation, flights };
}

function stopsCall(
  changes: {
    action: "add" | "update" | "remove" | "move";
    name: string;
    newName?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    position?: number | null;
  }[],
) {
  return {
    name: "update_trip_stops",
    args: {
      changes: changes.map((change) => ({
        newName: null,
        startDate: null,
        endDate: null,
        position: null,
        ...change,
      })),
    },
  };
}

function bookingCall(values: Record<string, unknown>) {
  const keys = [
    "travelers",
    "fromShownFlight",
    "title",
    "provider",
    "reference",
    "fromLocation",
    "toLocation",
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
    name: "record_booking",
    args: {
      category: "FLIGHT",
      ...Object.fromEntries(keys.map((key) => [key, null])),
      travelers: [],
      ...values,
    },
  };
}

function shownFlight(values: Record<string, unknown>) {
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

function searchCall(origin: string, destination: string, date: string) {
  return {
    name: "search_flights",
    args: {
      origin,
      destination,
      departureDate: date,
      returnDate: null,
      passengers: null,
      cabin: null,
      maxStops: null,
    },
  };
}

function summaries(effects: ToolEffect[]) {
  return effects.map((effect) => effect.summary);
}

describe("the Park City trip", () => {
  it("records stops, airports, a friend's rides, and flights bought from earlier searches", async () => {
    const { user, trip, access, conversation, flights } = await parkCityTrip();
    // The single destination is the first stop.
    expect(await listStops(access)).toEqual([
      { name: "Park City", startDate: null, endDate: null },
    ]);

    const provider = new ScriptedProvider([
      {
        calls: [
          updateCall({ flyIntoAirport: "SLC", flyOutOfAirport: "SLC" }),
          stopsCall([
            {
              action: "add",
              name: "Jackson Hole",
              startDate: "2027-02-27",
              endDate: "2027-03-02",
              position: 0,
            },
            {
              action: "update",
              name: "Park City",
              startDate: "2027-03-02",
              endDate: "2027-03-07",
            },
          ]),
        ],
        reply:
          "Jackson Hole, then Park City, in and out of SLC. Is this a ski trip?",
      },
      {
        calls: [
          bookingCall({
            category: "GROUND_TRANSPORT",
            provider: "Friend driving",
            fromLocation: "Salt Lake City",
            toLocation: "Jackson Hole",
            startDate: "2027-02-27",
          }),
          bookingCall({
            category: "GROUND_TRANSPORT",
            provider: "Friend driving",
            fromLocation: "Jackson Hole",
            toLocation: "Park City",
            startDate: "2027-03-02",
          }),
        ],
        reply: "I added both rides to Bookings.",
      },
      {
        calls: [searchCall("LGA", "SLC", "2027-02-27")],
        reply: "Two flights.",
      },
      {
        calls: [
          bookingCall({
            fromShownFlight: shownFlight({ airline: "Southwest" }),
          }),
        ],
        reply: "Recorded your Southwest flight.",
      },
      {
        calls: [searchCall("SLC", "JFK", "2027-03-07")],
        reply: "Two flights home.",
      },
      {
        calls: [
          bookingCall({
            fromShownFlight: shownFlight({ airline: "American" }),
          }),
        ],
        reply: "Which American flight did you buy?",
      },
      {
        calls: [
          bookingCall({
            fromShownFlight: shownFlight({
              airline: "American",
              arrivalTime: "14:59",
            }),
          }),
        ],
        reply: "Recorded your American flight home.",
      },
    ]);
    const send = (text: string) =>
      sendAtlasMessage(user, conversation.id, text, { provider, flights });

    // 1. Stops and airports: adding Jackson Hole and dating Park City only fill gaps.
    const first = await send(
      "Jackson Hole then Park City, flying in and out of Salt Lake City",
    );
    expect(await listStops(access)).toEqual([
      { name: "Jackson Hole", startDate: "2027-02-27", endDate: "2027-03-02" },
      { name: "Park City", startDate: "2027-03-02", endDate: "2027-03-07" },
    ]);
    expect(
      await db.trip.findUniqueOrThrow({ where: { id: trip.id } }),
    ).toMatchObject({ flyIntoAirport: "SLC", flyOutOfAirport: "SLC" });
    expect(summaries(first.effects)).toContain(
      "Updated stops: Jackson Hole (Feb 27 to Mar 2), then Park City (Mar 2 to Mar 7)",
    );
    // The tool result tells Atlas to ask about skiing instead of assuming it.
    const stopsOutput = provider.toolOutputs[1]!.output as {
      result: { theme?: string };
    };
    expect(stopsOutput.result.theme).toContain('"Is this a ski trip?"');
    expect(await db.tripPreference.count({ where: { tripId: trip.id } })).toBe(
      0,
    );

    // 2. A friend driving between stops becomes ground transport with the user on it.
    const rides = await send(
      "My friend is driving me from Salt Lake to Jackson, then Jackson to Park City",
    );
    expect(rides.effects).toEqual([
      expect.objectContaining({
        kind: "recorded",
        entityType: "booking",
        undo: "delete_booking",
        summary:
          'Recorded "Friend driving: Salt Lake City to Jackson Hole" in Bookings as booked for Vaughn',
      }),
      expect.objectContaining({ kind: "recorded" }),
    ]);

    // 3-4. A search, then the purchase in a later message, tied to the result that was shown.
    await send("Find flights from LGA to SLC on Feb 27");
    const southwest = await send("I bought the Southwest flight");
    expect(summaries(southwest.effects)).toEqual([
      'Recorded "Southwest WN1234: LGA to SLC" in Bookings as booked for Vaughn',
    ]);

    // 5-6. Two American flights were shown, so "the American flight" is ambiguous.
    await send("Find flights home from SLC to JFK on Mar 7");
    const before = await db.booking.count({ where: { tripId: trip.id } });
    const ambiguous = await send("I bought the American flight");
    expect(ambiguous.effects).toEqual([]);
    const ambiguousOutput = provider.toolOutputs.at(-1)!.output as {
      result: { ambiguous: boolean; candidates: { flight: string }[] };
    };
    expect(ambiguousOutput.result.ambiguous).toBe(true);
    expect(
      ambiguousOutput.result.candidates.map((item) => item.flight),
    ).toEqual([
      expect.stringContaining("14:59"),
      expect.stringContaining("20:31"),
    ]);
    expect(await db.booking.count({ where: { tripId: trip.id } })).toBe(before);

    // 7. The arrival time settles it.
    await send("I bought the American flight that lands at 2:59pm");

    const bookings = await db.booking.findMany({
      where: { tripId: trip.id },
      include: { participants: true },
      orderBy: [{ startDate: "asc" }, { startMinute: "asc" }],
    });
    expect(
      bookings.map((booking) => ({
        category: booking.category,
        title: booking.title,
        status: booking.status,
        start: `${booking.startDate?.toISOString().slice(0, 10)} ${booking.startMinute}`,
        end: booking.endMinute,
        travelers: booking.participants.map(
          (participant) => participant.status,
        ),
      })),
    ).toEqual([
      {
        category: "FLIGHT",
        title: "Southwest WN1234: LGA to SLC",
        status: "BOOKED",
        start: "2027-02-27 360",
        end: 585,
        travelers: ["BOOKED"],
      },
      {
        category: "GROUND_TRANSPORT",
        title: "Friend driving: Salt Lake City to Jackson Hole",
        status: "BOOKED",
        start: "2027-02-27 null",
        end: null,
        travelers: ["BOOKED"],
      },
      {
        category: "GROUND_TRANSPORT",
        title: "Friend driving: Jackson Hole to Park City",
        status: "BOOKED",
        start: "2027-03-02 null",
        end: null,
        travelers: ["BOOKED"],
      },
      {
        category: "FLIGHT",
        title: "American Airlines AA2210: SLC to JFK",
        status: "BOOKED",
        start: "2027-03-07 425",
        end: 899,
        travelers: ["BOOKED"],
      },
    ]);
    const [flight] = bookings;
    expect(flight).toMatchObject({
      provider: "Southwest",
      reference: "WN1234",
      fromLocation: "New York (LGA)",
      toLocation: "Salt Lake City (SLC)",
      costIsEstimate: true,
      currency: "USD",
    });
    expect(flight!.costAmount?.toFixed(2)).toBe("189.00");
    expect(flight!.notes).toContain(
      "Not checked with the airline or provider.",
    );

    // Nothing on a one-member trip talks about a group.
    const messages = await db.message.findMany({
      where: { conversationId: conversation.id },
    });
    expect(
      JSON.stringify(messages.map((message) => message.metadata)),
    ).not.toMatch(/group/i);
  });

  it("marks a flight someone was considering as booked instead of adding another", async () => {
    const { user, trip, access, conversation, flights } = await parkCityTrip();
    const offer = PARK_CITY_FLIGHTS["LGA-SLC"][0]!;
    const saved = await saveFlightOffer(access, offer, { asBooking: true });
    const provider = new ScriptedProvider([
      { calls: [searchCall("LGA", "SLC", "2027-02-27")] },
      {
        calls: [
          bookingCall({
            fromShownFlight: shownFlight({ airline: "Southwest" }),
          }),
        ],
      },
    ]);
    await sendAtlasMessage(user, conversation.id, "Find flights", {
      provider,
      flights,
    });
    const result = await sendAtlasMessage(
      user,
      conversation.id,
      "I bought the Southwest one",
      { provider, flights },
    );
    expect(result.effects).toEqual([
      expect.objectContaining({
        kind: "recorded",
        entityId: saved.bookingId,
        summary: expect.stringMatching(/^Marked ".+" as booked for Vaughn$/),
      }),
    ]);
    // An update to an existing record offers Edit, not Undo.
    expect(result.effects[0]).not.toHaveProperty("undo");
    const bookings = await db.booking.findMany({
      where: { tripId: trip.id },
      include: { participants: true, researchOption: true },
    });
    expect(bookings).toHaveLength(1);
    expect(bookings[0]).toMatchObject({ status: "BOOKED" });
    expect(bookings[0]!.participants).toEqual([
      expect.objectContaining({ status: "BOOKED" }),
    ]);
    expect(bookings[0]!.researchOption?.status).toBe("BOOKED");
  });

  it("records a booking for a named member and refuses people who aren't on the trip", async () => {
    const { user, trip, access, conversation } = await parkCityTrip();
    const sam = await createUser("Sam Rivera");
    const samMember = await addMember(trip.id, sam.id);
    const provider = new ScriptedProvider([
      {
        calls: [
          bookingCall({
            category: "ACCOMMODATION",
            travelers: ["me", "Sam"],
            title: "Condo in Park City",
            startDate: "2027-03-02",
            endDate: "2027-03-07",
            costAmount: "1200",
            currency: "usd",
          }),
          bookingCall({ travelers: ["Jordan"], title: "Jordan's flight" }),
          bookingCall({
            category: "GROUND_TRANSPORT",
            provider: "Canyon shuttle",
            costAmount: "60",
          }),
        ],
      },
    ]);
    const result = await sendAtlasMessage(
      user,
      conversation.id,
      "Sam and I booked a condo, and Jordan bought a flight",
      { provider, flights: null },
    );
    const condo = await db.booking.findFirstOrThrow({
      where: { tripId: trip.id, category: "ACCOMMODATION" },
      include: { participants: true },
    });
    // An amount without a currency is in the trip's currency.
    const shuttle = await db.booking.findFirstOrThrow({
      where: { tripId: trip.id, category: "GROUND_TRANSPORT" },
    });
    expect(shuttle).toMatchObject({
      title: "Canyon shuttle",
      currency: "USD",
      costIsEstimate: false,
    });
    expect(condo).toMatchObject({
      category: "ACCOMMODATION",
      status: "BOOKED",
      currency: "USD",
      costIsEstimate: false,
    });
    expect(
      condo.participants.map((participant) => participant.memberId).sort(),
    ).toEqual([access.memberId, samMember.id].sort());
    expect(summaries(result.effects)).toEqual([
      'Recorded "Condo in Park City" in Bookings as booked for Vaughn, Sam',
      "Jordan isn't a member of this trip, so nothing was recorded. Ask the user to invite them first, or record it for the user.",
      'Recorded "Canyon shuttle" in Bookings as booked for Vaughn',
    ]);
    expect(await db.booking.count({ where: { tripId: trip.id } })).toBe(2);
  });
});

describe("stops on a shared trip", () => {
  it("adds stops directly but turns a removal into a proposal the group accepts", async () => {
    const { user, trip, conversation } = await parkCityTrip();
    const sam = await createUser("Sam Rivera");
    await addMember(trip.id, sam.id);
    const provider = new ScriptedProvider([
      {
        calls: [
          stopsCall([{ action: "add", name: "Jackson Hole", position: 0 }]),
        ],
      },
      { calls: [stopsCall([{ action: "remove", name: "Jackson Hole" }])] },
    ]);
    await sendAtlasMessage(user, conversation.id, "Jackson Hole first", {
      provider,
    });
    const removal = await sendAtlasMessage(
      user,
      conversation.id,
      "Actually skip Jackson Hole",
      { provider },
    );
    expect(summaries(removal.effects)).toEqual([
      "Proposed change waiting for the group: Stops: Jackson Hole, then Park City → Park City",
    ]);
    const access = await requireTripAccess(trip.id, sam.id);
    expect((await listStops(access)).map((stop) => stop.name)).toEqual([
      "Jackson Hole",
      "Park City",
    ]);
    const [proposal] = await listPendingProposals(access);
    expect(proposal!.changes.map((change) => change.label)).toEqual([
      "Stops: Jackson Hole, then Park City → Park City",
    ]);
    await resolveProposal(access, proposal!.id, true);
    expect((await listStops(access)).map((stop) => stop.name)).toEqual([
      "Park City",
    ]);
  });

  it("rejects stops that break the trip dates and changes nothing", async () => {
    const { user, access, conversation } = await parkCityTrip();
    const provider = new ScriptedProvider([
      {
        calls: [
          stopsCall([
            {
              action: "add",
              name: "Jackson Hole",
              startDate: "2027-02-20",
              position: 0,
            },
          ]),
        ],
      },
    ]);
    const result = await sendAtlasMessage(user, conversation.id, "Go early", {
      provider,
    });
    expect(summaries(result.effects)).toEqual([
      "Nothing was changed. Jackson Hole is dated before the trip starts.",
    ]);
    expect(await listStops(access)).toHaveLength(1);
  });

  it("saves edits from the stops dialog with a version check", async () => {
    const { trip, access } = await parkCityTrip();
    const input = {
      flyIntoAirport: "SLC",
      flyOutOfAirport: "SLC",
      stops: [
        {
          name: "Jackson Hole",
          startDate: "2027-02-27",
          endDate: "2027-03-02",
        },
        { name: "Park City", startDate: null, endDate: null },
      ],
    };
    await expect(
      updateTripRoute(access, input, trip.version + 1),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      updateTripRoute(
        access,
        { ...input, stops: [...input.stops, input.stops[0]!] },
        trip.version,
      ),
    ).rejects.toBeInstanceOf(DomainError);
    await updateTripRoute(access, input, trip.version);
    expect((await listStops(access)).map((stop) => stop.name)).toEqual([
      "Jackson Hole",
      "Park City",
    ]);
    const updated = await db.trip.findUniqueOrThrow({ where: { id: trip.id } });
    expect(updated).toMatchObject({
      flyIntoAirport: "SLC",
      version: trip.version + 1,
    });
  });
});

describe("trip themes", () => {
  it("records a stated theme, asks before renaming a one-member trip, and suggests ski tasks", async () => {
    const { user, trip, access, conversation } = await parkCityTrip();
    const provider = new ScriptedProvider([
      {
        calls: [
          { name: "suggest_theme_tasks", args: { theme: "SKI" } },
          updateCall({ theme: "SKI", title: "Out West ski trip" }),
          { name: "suggest_theme_tasks", args: { theme: "SKI" } },
          { name: "suggest_theme_tasks", args: { theme: "SKI" } },
        ],
        reply: "A ski trip! I suggested a new name and the usual ski tasks.",
      },
    ]);
    const result = await sendAtlasMessage(
      user,
      conversation.id,
      "Yes, we're skiing",
      { provider },
    );
    // Theme tasks need the theme first.
    expect(result.effects[0]).toMatchObject({ ok: false, kind: "error" });
    const proposal = result.effects.find(
      (effect) => effect.kind === "proposal",
    );
    expect(proposal).toMatchObject({
      summary: "Needs your OK: trip name: Park City trip → Out West ski trip",
      entityType: "proposal",
    });
    const update = provider.toolOutputs[1]!.output as {
      result: { confirmation: string };
    };
    expect(update.result.confirmation).toMatch(/buttons under your reply/);
    expect(update.result.confirmation).toMatch(/Do not mention a group/);
    expect(
      await db.trip.findUniqueOrThrow({ where: { id: trip.id } }),
    ).toMatchObject({ theme: "SKI", title: "Park City trip" });

    const tasks = await db.task.findMany({
      where: { tripId: trip.id },
      orderBy: { createdAt: "asc" },
    });
    expect(tasks.map((task) => [task.title, task.status])).toEqual([
      ["Reserve ski or snowboard rentals", "SUGGESTED"],
      ["Buy lift passes", "SUGGESTED"],
      ["Book ski or snowboard lessons", "SUGGESTED"],
      ["Check ski gear and warm layers", "SUGGESTED"],
    ]);
    const repeat = provider.toolOutputs[3]!.output as {
      result: { suggested: string[]; alreadyOnTrip: string[] };
    };
    expect(repeat.result).toMatchObject({ suggested: [] });
    expect(repeat.result.alreadyOnTrip).toHaveLength(4);

    await resolveProposal(access, proposal!.entityId!, true);
    expect(
      (await db.trip.findUniqueOrThrow({ where: { id: trip.id } })).title,
    ).toBe("Out West ski trip");
  });

  it("says a change waits for the group on a shared trip", async () => {
    const { user, trip, conversation } = await parkCityTrip();
    await addMember(trip.id, (await createUser("Sam")).id);
    const provider = new ScriptedProvider([
      { calls: [updateCall({ title: "Out West ski trip" })] },
    ]);
    const result = await sendAtlasMessage(user, conversation.id, "Rename it", {
      provider,
    });
    expect(summaries(result.effects)).toEqual([
      "Proposed change waiting for the group: trip name: Park City trip → Out West ski trip",
    ]);
  });
});

describe("planning a multi-stop trip before it exists", () => {
  it("keeps stops in the draft and creates the trip with them", async () => {
    const user = await createUser("Vaughn");
    const conversation = await startCreationConversation(
      user.id,
      "KNOWN_DESTINATION",
    );
    const provider = new ScriptedProvider([
      {
        calls: [
          updateCall({
            startDate: "2027-02-27",
            endDate: "2027-03-07",
            flyIntoAirport: "SLC",
            flyOutOfAirport: "SLC",
            departureLocation: "NYC",
          }),
          stopsCall([
            {
              action: "add",
              name: "Jackson Hole",
              startDate: "2027-02-27",
              endDate: "2027-03-02",
            },
            {
              action: "add",
              name: "Park City",
              startDate: "2027-03-02",
              endDate: "2027-03-07",
            },
          ]),
        ],
        reply: "Is this a ski trip?",
      },
    ]);
    const result = await sendAtlasMessage(
      user,
      conversation.id,
      "Jackson Hole then Park City, Feb 27 to Mar 7, in and out of SLC",
      { provider },
    );
    expect(result.tripCreated).toBe(true);
    const output = provider.toolOutputs[1]!.output as {
      result: { theme?: string };
    };
    expect(output.result.theme).toContain("Is this a ski trip?");
    const trip = await db.trip.findUniqueOrThrow({
      where: { id: result.tripId! },
      include: { stops: { orderBy: { position: "asc" } } },
    });
    expect(trip).toMatchObject({
      title: "Jackson Hole and Park City trip",
      destination: "Jackson Hole",
      flyIntoAirport: "SLC",
      flyOutOfAirport: "SLC",
    });
    expect(trip.stops.map((stop) => stop.name)).toEqual([
      "Jackson Hole",
      "Park City",
    ]);
  });
});
