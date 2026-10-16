import "server-only";

import type { MemberRole } from "@/generated/prisma/enums";
import { LEAVE_BLOCK_MESSAGES, leaveBlock } from "@/lib/domain/invitations";
import {
  requireOrganizer,
  requireTripAccess,
  type TripAccess,
} from "@/server/access";
import { logActivity } from "@/server/activity";
import { db, type DbTransaction } from "@/server/db";
import { conflict, forbidden, notFound } from "@/server/errors";

export async function listMembers(access: TripAccess) {
  return db.tripMember.findMany({
    where: { tripId: access.tripId },
    orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
    select: {
      id: true,
      role: true,
      joinedAt: true,
      user: { select: { id: true, name: true, email: true, image: true } },
    },
  });
}

/**
 * Locks the trip row for the rest of the transaction, so concurrent membership changes (two
 * organizers stepping down at once, say) see each other and can't leave a trip with no organizer.
 */
async function lockTrip(tx: DbTransaction, tripId: string) {
  await tx.$queryRaw`SELECT id FROM "Trip" WHERE id = ${tripId} FOR UPDATE`;
}

async function roleCounts(tx: DbTransaction, tripId: string) {
  const [memberCount, organizerCount] = await Promise.all([
    tx.tripMember.count({ where: { tripId } }),
    tx.tripMember.count({ where: { tripId, role: "ORGANIZER" } }),
  ]);
  return { memberCount, organizerCount };
}

function displayName(user: { name: string | null; email: string | null }) {
  return user.name ?? user.email ?? "a member";
}

async function findMember(tx: DbTransaction, tripId: string, memberId: string) {
  const member = await tx.tripMember.findFirst({
    where: { id: memberId, tripId },
    include: { user: { select: { name: true, email: true } } },
  });
  if (!member) throw notFound("That person isn't a member of this trip.");
  return member;
}

export async function removeMember(
  tripId: string,
  userId: string,
  memberId: string,
) {
  const access = await requireOrganizer(tripId, userId);
  await db.$transaction(async (tx) => {
    await lockTrip(tx, access.tripId);
    const member = await findMember(tx, access.tripId, memberId);
    if (member.id === access.memberId)
      throw forbidden('Use "Leave trip" to remove yourself.');
    await tx.tripMember.delete({ where: { id: member.id } });
    await logActivity(tx, {
      tripId: access.tripId,
      actorId: userId,
      type: "MEMBER_REMOVED",
      summary: `removed ${displayName(member.user)} from the trip`,
      entityType: "member",
      entityId: member.userId,
    });
  });
}

/** Why the caller can't leave right now, or null when they can. Used to explain it in the UI. */
export async function leaveStatus(access: TripAccess) {
  const [memberCount, organizerCount] = await Promise.all([
    db.tripMember.count({ where: { tripId: access.tripId } }),
    db.tripMember.count({
      where: { tripId: access.tripId, role: "ORGANIZER" },
    }),
  ]);
  return leaveBlock({ role: access.role, memberCount, organizerCount });
}

/**
 * Leaves a trip. The only member can't leave (they can delete the trip instead), and an organizer
 * can't leave until another member is an organizer, so a trip always has an organizer.
 */
export async function leaveTrip(tripId: string, userId: string) {
  const access = await requireTripAccess(tripId, userId);
  await db.$transaction(async (tx) => {
    await lockTrip(tx, access.tripId);
    const member = await tx.tripMember.findUnique({
      where: { id: access.memberId },
      select: { id: true, role: true },
    });
    if (!member) throw notFound();
    const block = leaveBlock({
      role: member.role,
      ...(await roleCounts(tx, access.tripId)),
    });
    if (block) throw conflict(LEAVE_BLOCK_MESSAGES[block]);
    await tx.tripMember.delete({ where: { id: member.id } });
    await logActivity(tx, {
      tripId: access.tripId,
      actorId: userId,
      type: "MEMBER_LEFT",
      summary: "left the trip",
      entityType: "member",
      entityId: userId,
    });
  });
}

export async function changeMemberRole(
  tripId: string,
  userId: string,
  memberId: string,
  role: MemberRole,
) {
  const access = await requireOrganizer(tripId, userId);
  await db.$transaction(async (tx) => {
    await lockTrip(tx, access.tripId);
    const member = await findMember(tx, access.tripId, memberId);
    if (member.role === role) return;
    if (member.role === "ORGANIZER" && role === "MEMBER") {
      const { organizerCount } = await roleCounts(tx, access.tripId);
      if (organizerCount <= 1)
        throw conflict("A trip needs at least one organizer.");
    }
    await tx.tripMember.update({ where: { id: member.id }, data: { role } });
    const self = member.id === access.memberId;
    await logActivity(tx, {
      tripId: access.tripId,
      actorId: userId,
      type: "MEMBER_ROLE_CHANGED",
      summary: self
        ? "stepped down as organizer"
        : `made ${displayName(member.user)} ${role === "ORGANIZER" ? "an organizer" : "a regular member"}`,
      entityType: "member",
      entityId: member.userId,
      metadata: { role },
    });
  });
}

/** Makes another member an organizer and the caller a regular member, in one step. */
export async function transferOrganizer(
  tripId: string,
  userId: string,
  memberId: string,
) {
  const access = await requireOrganizer(tripId, userId);
  await db.$transaction(async (tx) => {
    await lockTrip(tx, access.tripId);
    const current = await tx.tripMember.findUnique({
      where: { id: access.memberId },
      select: { role: true },
    });
    if (current?.role !== "ORGANIZER")
      throw forbidden("Only a trip organizer can do that.");
    const member = await findMember(tx, access.tripId, memberId);
    if (member.id === access.memberId)
      throw forbidden("Pick another member to hand the organizer role to.");
    if (member.role !== "ORGANIZER")
      await tx.tripMember.update({
        where: { id: member.id },
        data: { role: "ORGANIZER" },
      });
    await tx.tripMember.update({
      where: { id: access.memberId },
      data: { role: "MEMBER" },
    });
    await logActivity(tx, {
      tripId: access.tripId,
      actorId: userId,
      type: "MEMBER_ROLE_CHANGED",
      summary: `handed the organizer role to ${displayName(member.user)}`,
      entityType: "member",
      entityId: member.userId,
      metadata: { role: "ORGANIZER", transfer: true },
    });
  });
}
