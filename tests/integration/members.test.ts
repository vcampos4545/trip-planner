import { beforeEach, describe, expect, it } from "vitest";

import { requireTripAccess } from "@/server/access";
import { DomainError } from "@/server/errors";
import {
  changeMemberRole,
  leaveStatus,
  leaveTrip,
  removeMember,
  transferOrganizer,
} from "@/server/services/members";
import { createManualTrip } from "@/server/services/trips";

import { addMember, createUser, db, resetDatabase } from "../support/db";

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(DomainError);
  expect((error as DomainError).code).toBe(code);
  return error as DomainError;
}

async function setup() {
  const owner = await createUser("Owner");
  const trip = await createManualTrip(owner.id, {
    title: "Trip",
    destination: null,
    startDate: null,
    endDate: null,
  });
  const ownerMembership = await db.tripMember.findFirstOrThrow({
    where: { tripId: trip.id, userId: owner.id },
  });
  return { owner, trip, ownerMembership };
}

async function roleOf(tripId: string, userId: string) {
  return (await requireTripAccess(tripId, userId)).role;
}

beforeEach(resetDatabase);

describe("leaving a trip", () => {
  it("doesn't let the only member leave", async () => {
    const { owner, trip } = await setup();
    expect(await leaveStatus(await requireTripAccess(trip.id, owner.id))).toBe(
      "sole_member",
    );
    const error = await expectCode(leaveTrip(trip.id, owner.id), "CONFLICT");
    expect(error.message).toMatch(/only member/);
    // The trip and the membership are untouched.
    await expect(requireTripAccess(trip.id, owner.id)).resolves.toBeTruthy();
    expect(await db.trip.count({ where: { id: trip.id } })).toBe(1);
  });

  it("doesn't let the only organizer leave until someone else is an organizer", async () => {
    const { owner, trip } = await setup();
    const friend = await createUser("Friend");
    const membership = await addMember(trip.id, friend.id);
    expect(await leaveStatus(await requireTripAccess(trip.id, owner.id))).toBe(
      "only_organizer",
    );
    const error = await expectCode(leaveTrip(trip.id, owner.id), "CONFLICT");
    expect(error.message).toMatch(/only organizer/);

    await changeMemberRole(trip.id, owner.id, membership.id, "ORGANIZER");
    expect(
      await leaveStatus(await requireTripAccess(trip.id, owner.id)),
    ).toBeNull();
    await leaveTrip(trip.id, owner.id);
    await expectCode(requireTripAccess(trip.id, owner.id), "NOT_FOUND");
    expect(await roleOf(trip.id, friend.id)).toBe("ORGANIZER");
    expect(
      await db.activityLog.count({
        where: { tripId: trip.id, type: "MEMBER_LEFT" },
      }),
    ).toBe(1);
  });

  it("lets a regular member leave, but not once they're the last one left", async () => {
    const { owner, trip, ownerMembership } = await setup();
    const friend = await createUser("Friend");
    await addMember(trip.id, friend.id);
    expect(
      await leaveStatus(await requireTripAccess(trip.id, friend.id)),
    ).toBeNull();
    await leaveTrip(trip.id, friend.id);
    await expectCode(requireTripAccess(trip.id, friend.id), "NOT_FOUND");
    expect(ownerMembership.role).toBe("ORGANIZER");
    await expectCode(leaveTrip(trip.id, owner.id), "CONFLICT");
  });

  it("never leaves a trip without an organizer when two organizers leave at once", async () => {
    const { owner, trip } = await setup();
    const friend = await createUser("Friend");
    await addMember(trip.id, friend.id, "ORGANIZER");
    await addMember(trip.id, (await createUser("Third")).id);
    const results = await Promise.allSettled([
      leaveTrip(trip.id, owner.id),
      leaveTrip(trip.id, friend.id),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      await db.tripMember.count({
        where: { tripId: trip.id, role: "ORGANIZER" },
      }),
    ).toBe(1);
  });
});

describe("managing members", () => {
  it("transfers the organizer role in one step", async () => {
    const { owner, trip } = await setup();
    const friend = await createUser("Friend");
    const membership = await addMember(trip.id, friend.id);

    await expectCode(
      transferOrganizer(trip.id, friend.id, membership.id),
      "FORBIDDEN",
    );
    await transferOrganizer(trip.id, owner.id, membership.id);
    expect(await roleOf(trip.id, friend.id)).toBe("ORGANIZER");
    expect(await roleOf(trip.id, owner.id)).toBe("MEMBER");
    const entry = await db.activityLog.findFirstOrThrow({
      where: { tripId: trip.id, type: "MEMBER_ROLE_CHANGED" },
    });
    expect(entry.summary).toBe("handed the organizer role to Friend");

    // The former organizer can now leave.
    await leaveTrip(trip.id, owner.id);
    await expectCode(requireTripAccess(trip.id, owner.id), "NOT_FOUND");
  });

  it("keeps at least one organizer and keeps role changes with organizers", async () => {
    const { owner, trip, ownerMembership } = await setup();
    const friend = await createUser("Friend");
    const membership = await addMember(trip.id, friend.id);

    await expectCode(
      changeMemberRole(trip.id, owner.id, ownerMembership.id, "MEMBER"),
      "CONFLICT",
    );
    await expectCode(
      changeMemberRole(trip.id, friend.id, membership.id, "ORGANIZER"),
      "FORBIDDEN",
    );
    await changeMemberRole(trip.id, owner.id, membership.id, "ORGANIZER");
    // With a second organizer, the owner can step down.
    await changeMemberRole(trip.id, owner.id, ownerMembership.id, "MEMBER");
    expect(await roleOf(trip.id, owner.id)).toBe("MEMBER");
    expect(
      await db.activityLog.count({
        where: { tripId: trip.id, type: "MEMBER_ROLE_CHANGED" },
      }),
    ).toBe(2);
  });

  it("lets organizers remove other members, never themselves", async () => {
    const { owner, trip, ownerMembership } = await setup();
    const friend = await createUser("Friend");
    const membership = await addMember(trip.id, friend.id);

    await expectCode(
      removeMember(trip.id, friend.id, ownerMembership.id),
      "FORBIDDEN",
    );
    await expectCode(
      removeMember(trip.id, owner.id, ownerMembership.id),
      "FORBIDDEN",
    );
    await removeMember(trip.id, owner.id, membership.id);
    await expectCode(requireTripAccess(trip.id, friend.id), "NOT_FOUND");
    const entry = await db.activityLog.findFirstOrThrow({
      where: { tripId: trip.id, type: "MEMBER_REMOVED" },
    });
    expect(entry.summary).toBe("removed Friend from the trip");

    const other = await createManualTrip(owner.id, {
      title: "Other",
      destination: null,
      startDate: null,
      endDate: null,
    });
    const elsewhere = await addMember(other.id, friend.id);
    // A member ID from another trip is not found on this one.
    await expectCode(
      removeMember(trip.id, owner.id, elsewhere.id),
      "NOT_FOUND",
    );
  });
});
