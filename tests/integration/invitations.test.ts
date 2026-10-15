import { beforeEach, describe, expect, it } from "vitest";

import { DomainError } from "@/server/errors";
import {
  acceptInvitation,
  createInvitation,
  hashInviteToken,
  inspectInvitation,
  listInvitations,
  revokeInvitation,
} from "@/server/services/members";
import { requireTripAccess } from "@/server/access";
import { createManualTrip } from "@/server/services/trips";

import { createUser, db, resetDatabase } from "../support/db";

async function setup() {
  const owner = await createUser("Owner");
  const guest = await createUser("Guest");
  const trip = await createManualTrip(owner.id, {
    title: "Lisbon",
    destination: "Lisbon",
    startDate: null,
    endDate: null,
  });
  return { owner, guest, trip };
}

describe("invitations", () => {
  beforeEach(resetDatabase);

  it("stores only a hash of the token and lets a signed-in user join", async () => {
    const { owner, guest, trip } = await setup();
    const { token, invitation } = await createInvitation(trip.id, owner.id, {
      ttlDays: 7,
      maxUses: null,
    });

    const stored = await db.tripInvitation.findUniqueOrThrow({
      where: { id: invitation.id },
    });
    expect(stored.tokenHash).toBe(hashInviteToken(token));
    expect(JSON.stringify(stored)).not.toContain(token);

    await expect(inspectInvitation(token, guest.id)).resolves.toMatchObject({
      status: "valid",
      tripTitle: "Lisbon",
      memberCount: 1,
    });
    await expect(acceptInvitation(token, guest.id)).resolves.toEqual({
      tripId: trip.id,
      joined: true,
    });
    await expect(requireTripAccess(trip.id, guest.id)).resolves.toMatchObject({
      role: "MEMBER",
    });

    // Joining twice is harmless and does not use the link again.
    await expect(acceptInvitation(token, guest.id)).resolves.toEqual({
      tripId: trip.id,
      joined: false,
    });
    expect(
      (
        await db.tripInvitation.findUniqueOrThrow({
          where: { id: invitation.id },
        })
      ).useCount,
    ).toBe(1);
    await expect(inspectInvitation(token, guest.id)).resolves.toMatchObject({
      status: "member",
    });
    expect(
      await db.activityLog.count({
        where: { tripId: trip.id, type: "MEMBER_JOINED" },
      }),
    ).toBe(1);
  });

  it("rejects expired, revoked, and unknown links without revealing anything", async () => {
    const { owner, guest, trip } = await setup();
    const past = new Date(Date.now() - 10 * 86_400_000);
    const expired = await createInvitation(
      trip.id,
      owner.id,
      { ttlDays: 1, maxUses: null },
      past,
    );
    await expect(
      inspectInvitation(expired.token, guest.id),
    ).resolves.toMatchObject({ status: "expired" });
    await expect(acceptInvitation(expired.token, guest.id)).rejects.toThrow(
      /expired/,
    );

    const revoked = await createInvitation(trip.id, owner.id, {
      ttlDays: 7,
      maxUses: null,
    });
    await revokeInvitation(trip.id, owner.id, revoked.invitation.id);
    await expect(
      inspectInvitation(revoked.token, guest.id),
    ).resolves.toMatchObject({ status: "revoked" });
    await expect(acceptInvitation(revoked.token, guest.id)).rejects.toThrow(
      /revoked/,
    );

    const unknown = "x".repeat(43);
    await expect(inspectInvitation(unknown, guest.id)).resolves.toEqual({
      status: "invalid",
    });
    await expect(inspectInvitation("short", guest.id)).resolves.toEqual({
      status: "invalid",
    });
    await expect(acceptInvitation(unknown, guest.id)).rejects.toBeInstanceOf(
      DomainError,
    );

    expect(await db.tripMember.count({ where: { tripId: trip.id } })).toBe(1);
    expect(
      await listInvitations(await requireTripAccess(trip.id, owner.id)),
    ).toHaveLength(0);
  });

  it("enforces a use limit even when people join at the same time", async () => {
    const { owner, trip } = await setup();
    const { token } = await createInvitation(trip.id, owner.id, {
      ttlDays: 7,
      maxUses: 1,
    });
    const guests = await Promise.all([
      createUser("G1"),
      createUser("G2"),
      createUser("G3"),
    ]);
    const results = await Promise.allSettled(
      guests.map((guest) => acceptInvitation(token, guest.id)),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(await db.tripMember.count({ where: { tripId: trip.id } })).toBe(2);
  });
});
