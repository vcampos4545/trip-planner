import { beforeEach, describe, expect, it } from "vitest";

import { requireTripAccess } from "@/server/access";
import { DomainError } from "@/server/errors";
import { createBooking } from "@/server/services/bookings";
import { createInvitation } from "@/server/services/invitations";
import { removeMember } from "@/server/services/members";
import {
  createOption,
  resolveDecision,
  createDecision,
} from "@/server/services/research";
import { createTask, updateTask } from "@/server/services/tasks";
import {
  createManualTrip,
  deleteTrip,
  getTripWorkspace,
} from "@/server/services/trips";
import { emptyBooking } from "@/lib/validation/form-defaults";
import { bookingFormSchema } from "@/lib/validation/booking";

import { addMember, createUser, db, resetDatabase } from "../support/db";

const taskInput = (title: string, assigneeMemberId: string | null = null) => ({
  title,
  description: null,
  priority: "MEDIUM" as const,
  dueDate: null,
  assigneeMemberId,
  relatedOptionId: null,
  relatedBookingId: null,
  relatedEventId: null,
});

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(DomainError);
  expect((error as DomainError).code).toBe(code);
}

describe("trip authorization", () => {
  beforeEach(resetDatabase);

  it("hides a trip from non-members exactly like a missing trip", async () => {
    const owner = await createUser("Owner");
    const stranger = await createUser("Stranger");
    const trip = await createManualTrip(owner.id, {
      title: "Private",
      destination: null,
      startDate: null,
      endDate: null,
    });

    await expect(requireTripAccess(trip.id, owner.id)).resolves.toMatchObject({
      role: "ORGANIZER",
    });
    await expectCode(requireTripAccess(trip.id, stranger.id), "NOT_FOUND");
    await expectCode(getTripWorkspace(trip.id, stranger.id), "NOT_FOUND");
    await expectCode(
      requireTripAccess("does-not-exist", owner.id),
      "NOT_FOUND",
    );
  });

  it("keeps organizer-only actions away from regular members", async () => {
    const owner = await createUser("Owner");
    const member = await createUser("Member");
    const trip = await createManualTrip(owner.id, {
      title: "Trip",
      destination: null,
      startDate: null,
      endDate: null,
    });
    const ownerMembership = await db.tripMember.findFirstOrThrow({
      where: { tripId: trip.id, userId: owner.id },
    });
    await addMember(trip.id, member.id);

    await expectCode(
      createInvitation(trip.id, member.id, { ttlDays: 7, maxUses: null }),
      "FORBIDDEN",
    );
    await expectCode(
      removeMember(trip.id, member.id, ownerMembership.id),
      "FORBIDDEN",
    );
    await expectCode(deleteTrip(trip.id, member.id), "FORBIDDEN");

    const access = await requireTripAccess(trip.id, member.id);
    const decision = await createDecision(access, {
      title: "Where?",
      description: null,
      choices: [
        { label: "A", researchOptionId: null },
        { label: "B", researchOptionId: null },
      ],
    });
    const choice = await db.decisionChoice.findFirstOrThrow({
      where: { decisionId: decision.id },
    });
    await expectCode(
      resolveDecision(trip.id, member.id, decision.id, {
        choiceId: choice.id,
        note: null,
      }),
      "FORBIDDEN",
    );
  });

  it("scopes child records to the trip the caller belongs to", async () => {
    const alice = await createUser("Alice");
    const bob = await createUser("Bob");
    const tripA = await createManualTrip(alice.id, {
      title: "A",
      destination: null,
      startDate: null,
      endDate: null,
    });
    const tripB = await createManualTrip(bob.id, {
      title: "B",
      destination: null,
      startDate: null,
      endDate: null,
    });
    const accessA = await requireTripAccess(tripA.id, alice.id);
    const accessB = await requireTripAccess(tripB.id, bob.id);

    const taskInA = await createTask(accessA, taskInput("Find hotel"));
    // Bob uses his own valid access but targets Alice's task ID.
    await expectCode(
      updateTask(accessB, taskInA.id, taskInput("Hijacked"), 1),
      "NOT_FOUND",
    );
    expect(
      (await db.task.findUniqueOrThrow({ where: { id: taskInA.id } })).title,
    ).toBe("Find hotel");

    // Assignees and booking travelers must be members of the same trip.
    const bobMembership = await db.tripMember.findFirstOrThrow({
      where: { tripId: tripB.id },
    });
    await expectCode(
      createTask(accessA, taskInput("Assign outsider", bobMembership.id)),
      "NOT_FOUND",
    );
    const booking = bookingFormSchema.parse({
      ...emptyBooking("FLIGHT", "USD"),
      title: "Flight",
      participants: [
        {
          memberId: bobMembership.id,
          status: "BOOKED",
          shareAmount: "",
          roomAssignment: "",
        },
      ],
    });
    await expectCode(createBooking(accessA, booking), "NOT_FOUND");

    // An option from another trip cannot be linked to a decision.
    const optionInB = await createOption(accessB, {
      category: "LODGING",
      title: "Bob's place",
      description: null,
      url: null,
      sourceName: null,
      priceAmount: null,
      priceCurrency: null,
      priceUnit: null,
      priceNote: null,
      locationName: null,
      address: null,
      latitude: null,
      longitude: null,
    });
    await expectCode(
      createDecision(accessA, {
        title: "Which?",
        description: null,
        choices: [
          { label: "Steal", researchOptionId: optionInB.id },
          { label: "Other", researchOptionId: null },
        ],
      }),
      "NOT_FOUND",
    );
  });

  it("removes access as soon as a member is removed", async () => {
    const owner = await createUser("Owner");
    const member = await createUser("Member");
    const trip = await createManualTrip(owner.id, {
      title: "Trip",
      destination: null,
      startDate: null,
      endDate: null,
    });
    const membership = await addMember(trip.id, member.id);
    await removeMember(trip.id, owner.id, membership.id);
    await expectCode(requireTripAccess(trip.id, member.id), "NOT_FOUND");
  });
});
