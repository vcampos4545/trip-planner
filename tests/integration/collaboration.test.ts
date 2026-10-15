import { beforeEach, describe, expect, it } from "vitest";

import { bookingFormSchema } from "@/lib/validation/booking";
import { emptyBooking } from "@/lib/validation/form-defaults";
import { tripDetailsSchema } from "@/lib/domain/trip-details";
import { requireTripAccess } from "@/server/access";
import { DomainError } from "@/server/errors";
import {
  createBooking,
  deleteBooking,
  setOwnParticipation,
  updateBooking,
} from "@/server/services/bookings";
import {
  castVote,
  createDecision,
  createOption,
  resolveDecision,
  setOptionStatus,
} from "@/server/services/research";
import { createTask, setTaskStatus, updateTask } from "@/server/services/tasks";
import {
  getTripDetails,
  updateTripDetails,
  createManualTrip,
} from "@/server/services/trips";

import { addMember, createUser, db, resetDatabase } from "../support/db";

const option = (title: string) => ({
  category: "LODGING" as const,
  title,
  description: null,
  url: "https://example.com/stay",
  sourceName: "Example",
  priceAmount: "180.00",
  priceCurrency: "USD",
  priceUnit: "night",
  priceNote: null,
  locationName: null,
  address: null,
  latitude: null,
  longitude: null,
});

async function setup() {
  const organizer = await createUser("Organizer");
  const member = await createUser("Member");
  const trip = await createManualTrip(organizer.id, {
    title: "Trip",
    destination: "Lisbon",
    startDate: "2027-05-20",
    endDate: "2027-05-23",
  });
  const memberRow = await addMember(trip.id, member.id);
  return {
    trip,
    organizer: await requireTripAccess(trip.id, organizer.id),
    member: await requireTripAccess(trip.id, member.id),
    memberRow,
  };
}

describe("shared editing", () => {
  beforeEach(resetDatabase);

  it("rejects a stale edit instead of silently overwriting another member's change", async () => {
    const { organizer, member } = await setup();
    const { details, version } = await getTripDetails(organizer);
    await updateTripDetails(
      organizer,
      tripDetailsSchema.parse({ ...details, groupSize: 4 }),
      version,
    );
    const stale = updateTripDetails(
      member,
      tripDetailsSchema.parse({ ...details, groupSize: 6 }),
      version,
    );
    await expect(stale).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await getTripDetails(organizer)).details.groupSize).toBe(4);
  });

  it("lets members share tasks and records who changed them", async () => {
    const { organizer, member } = await setup();
    const task = await createTask(member, {
      title: "Compare transfers",
      description: null,
      priority: "HIGH",
      dueDate: "2027-04-01",
      assigneeMemberId: member.memberId,
      relatedOptionId: null,
      relatedBookingId: null,
      relatedEventId: null,
    });
    await setTaskStatus(organizer, task.id, "COMPLETED");
    const saved = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(saved).toMatchObject({
      status: "COMPLETED",
      createdById: member.userId,
      updatedById: organizer.userId,
    });
    expect(saved.completedAt).not.toBeNull();
    await expect(
      updateTask(
        member,
        task.id,
        {
          title: "x",
          description: null,
          priority: "LOW",
          dueDate: null,
          assigneeMemberId: null,
          relatedOptionId: null,
          relatedBookingId: null,
          relatedEventId: null,
        },
        1,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const kinds = (
      await db.activityLog.findMany({ where: { tripId: organizer.tripId } })
    ).map((entry) => entry.type);
    expect(kinds).toEqual(
      expect.arrayContaining(["TASK_CREATED", "TASK_COMPLETED"]),
    );
  });
});

describe("options, votes, and bookings", () => {
  beforeEach(resetDatabase);

  it("approves the winning option without ever calling it booked", async () => {
    const { trip, organizer, member } = await setup();
    const a = await createOption(member, option("Apartment"));
    const b = await createOption(member, option("Hotel"));
    expect(a).toMatchObject({
      status: "SUGGESTED",
      origin: "USER",
      url: "https://example.com/stay",
    });
    await setOptionStatus(member, a.id, "SHORTLISTED");
    await expect(
      setOptionStatus(member, a.id, "APPROVED"),
    ).rejects.toBeInstanceOf(DomainError);
    await expect(setOptionStatus(organizer, a.id, "BOOKED")).rejects.toThrow(
      /Record a booking/,
    );

    const decision = await createDecision(member, {
      title: "Where do we stay?",
      description: null,
      choices: [
        { label: a.title, researchOptionId: a.id },
        { label: b.title, researchOptionId: b.id },
      ],
    });
    const choices = await db.decisionChoice.findMany({
      where: { decisionId: decision.id },
      orderBy: { position: "asc" },
    });
    await castVote(member, decision.id, choices[0]!.id);
    await castVote(organizer, decision.id, choices[1]!.id);
    await castVote(organizer, decision.id, choices[0]!.id);
    expect(await db.vote.count({ where: { decisionId: decision.id } })).toBe(2);

    await resolveDecision(trip.id, organizer.userId, decision.id, {
      choiceId: choices[0]!.id,
      note: "Better location",
    });
    expect(
      (await db.researchOption.findUniqueOrThrow({ where: { id: a.id } }))
        .status,
    ).toBe("APPROVED");
    await expect(
      castVote(member, decision.id, choices[1]!.id),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    // A planned booking does not make the option booked; a booked one does.
    const planned = await createBooking(
      member,
      bookingFormSchema.parse({
        ...emptyBooking("ACCOMMODATION", "USD"),
        title: "Apartment",
        researchOptionId: a.id,
      }),
    );
    expect(
      (await db.researchOption.findUniqueOrThrow({ where: { id: a.id } }))
        .status,
    ).toBe("APPROVED");
    await updateBooking(
      member,
      planned.id,
      bookingFormSchema.parse({
        ...emptyBooking("ACCOMMODATION", "USD"),
        title: "Apartment",
        status: "BOOKED",
        researchOptionId: a.id,
      }),
      planned.version,
    );
    expect(
      (await db.researchOption.findUniqueOrThrow({ where: { id: a.id } }))
        .status,
    ).toBe("BOOKED");
    await deleteBooking(organizer, planned.id);
    expect(
      (await db.researchOption.findUniqueOrThrow({ where: { id: a.id } }))
        .status,
    ).toBe("APPROVED");
  });

  it("lets several travelers share one flight and keeps multiple stays", async () => {
    const { organizer, member } = await setup();
    const flight = await createBooking(
      organizer,
      bookingFormSchema.parse({
        ...emptyBooking("FLIGHT", "USD"),
        title: "TP 218",
        status: "CONFIRMED",
        costAmount: "620",
        costIsEstimate: false,
        participants: [
          {
            memberId: organizer.memberId,
            status: "BOOKED",
            shareAmount: "",
            roomAssignment: "",
          },
        ],
      }),
    );
    await setOwnParticipation(member, flight.id, { status: "CONSIDERING" });
    const participants = await db.bookingParticipant.findMany({
      where: { bookingId: flight.id },
    });
    expect(
      participants.map((participant) => participant.status).sort(),
    ).toEqual(["BOOKED", "CONSIDERING"]);

    for (const title of ["Lisbon apartment", "Porto hotel"]) {
      await createBooking(
        member,
        bookingFormSchema.parse({
          ...emptyBooking("ACCOMMODATION", "USD"),
          title,
        }),
      );
    }
    expect(
      await db.booking.count({
        where: { tripId: organizer.tripId, category: "ACCOMMODATION" },
      }),
    ).toBe(2);
    const unpriced = await db.booking.findFirstOrThrow({
      where: { title: "Porto hotel" },
    });
    expect(unpriced.costAmount).toBeNull();
  });
});
