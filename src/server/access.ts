import "server-only";

import type { MemberRole } from "@/generated/prisma/enums";
import { db, type DbTransaction } from "@/server/db";
import { forbidden, notFound } from "@/server/errors";

export type TripAccess = {
  tripId: string;
  userId: string;
  memberId: string;
  role: MemberRole;
  isOrganizer: boolean;
};

type Client = typeof db | DbTransaction;

/**
 * Resolves the caller's membership on a trip. A client-supplied trip ID is never trusted on its
 * own: non-members get the same "not found" answer as a trip that doesn't exist, so trip IDs
 * cannot be probed.
 */
export async function requireTripAccess(
  tripId: string,
  userId: string,
  client: Client = db,
): Promise<TripAccess> {
  if (typeof tripId !== "string" || tripId.length === 0 || tripId.length > 64)
    throw notFound();
  const member = await client.tripMember.findUnique({
    where: { tripId_userId: { tripId, userId } },
    select: { id: true, role: true },
  });
  if (!member)
    throw notFound(
      "We couldn't find that trip, or you don't have access to it.",
    );
  return {
    tripId,
    userId,
    memberId: member.id,
    role: member.role,
    isOrganizer: member.role === "ORGANIZER",
  };
}

export async function requireOrganizer(
  tripId: string,
  userId: string,
  client: Client = db,
) {
  const access = await requireTripAccess(tripId, userId, client);
  if (!access.isOrganizer)
    throw forbidden("Only a trip organizer can do that.");
  return access;
}

/** Ensures a trip member ID (for assignees and participants) belongs to the same trip. */
export async function requireMemberOfTrip(
  tripId: string,
  memberId: string,
  client: Client = db,
) {
  const member = await client.tripMember.findFirst({
    where: { id: memberId, tripId },
    select: { id: true },
  });
  if (!member) throw notFound("That person isn't a member of this trip.");
  return member.id;
}

export async function requireMembersOfTrip(
  tripId: string,
  memberIds: string[],
  client: Client = db,
) {
  const unique = [...new Set(memberIds)];
  if (unique.length === 0) return [];
  const found = await client.tripMember.findMany({
    where: { tripId, id: { in: unique } },
    select: { id: true },
  });
  if (found.length !== unique.length)
    throw notFound("One of those people isn't a member of this trip.");
  return unique;
}
