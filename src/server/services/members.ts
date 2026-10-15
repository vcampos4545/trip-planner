import "server-only";

import { createHash, randomBytes } from "node:crypto";

import type { MemberRole } from "@/generated/prisma/enums";
import {
  requireOrganizer,
  requireTripAccess,
  type TripAccess,
} from "@/server/access";
import { logActivity } from "@/server/activity";
import { db } from "@/server/db";
import { conflict, DomainError, forbidden, notFound } from "@/server/errors";

const DAY_MS = 86_400_000;

/** Invitation tokens are 32 random bytes. Only their SHA-256 hash is stored. */
export function generateInviteToken() {
  return randomBytes(32).toString("base64url");
}

export function hashInviteToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function isPlausibleToken(token: string) {
  return /^[A-Za-z0-9_-]{40,64}$/.test(token);
}

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

export async function createInvitation(
  tripId: string,
  userId: string,
  options: { ttlDays: number; maxUses: number | null },
  now = new Date(),
) {
  const access = await requireOrganizer(tripId, userId);
  const token = generateInviteToken();
  const expiresAt = new Date(now.getTime() + options.ttlDays * DAY_MS);
  const invitation = await db.$transaction(async (tx) => {
    const created = await tx.tripInvitation.create({
      data: {
        tripId: access.tripId,
        tokenHash: hashInviteToken(token),
        createdById: userId,
        expiresAt,
        maxUses: options.maxUses,
      },
    });
    await logActivity(tx, {
      tripId: access.tripId,
      actorId: userId,
      type: "INVITE_CREATED",
      summary: `created an invite link that expires in ${options.ttlDays} day${options.ttlDays === 1 ? "" : "s"}`,
      entityType: "invitation",
      entityId: created.id,
    });
    return created;
  });
  return { token, invitation };
}

export async function listInvitations(access: TripAccess, now = new Date()) {
  if (!access.isOrganizer) return [];
  const invitations = await db.tripInvitation.findMany({
    where: { tripId: access.tripId, revokedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      expiresAt: true,
      maxUses: true,
      useCount: true,
      createdAt: true,
      createdBy: { select: { name: true } },
    },
  });
  return invitations.filter(
    (invite) => invite.maxUses === null || invite.useCount < invite.maxUses,
  );
}

export async function revokeInvitation(
  tripId: string,
  userId: string,
  invitationId: string,
) {
  const access = await requireOrganizer(tripId, userId);
  await db.$transaction(async (tx) => {
    const invitation = await tx.tripInvitation.findFirst({
      where: { id: invitationId, tripId: access.tripId },
    });
    if (!invitation) throw notFound();
    if (invitation.revokedAt) return;
    await tx.tripInvitation.update({
      where: { id: invitation.id },
      data: { revokedAt: new Date(), revokedById: userId },
    });
    await logActivity(tx, {
      tripId: access.tripId,
      actorId: userId,
      type: "INVITE_REVOKED",
      summary: "revoked an invite link",
      entityType: "invitation",
      entityId: invitation.id,
    });
  });
}

export type InvitationState =
  | { status: "invalid" }
  | { status: "expired" | "revoked" | "used_up"; tripTitle: string }
  | { status: "member"; tripId: string; tripTitle: string }
  | {
      status: "valid";
      tripTitle: string;
      organizerName: string | null;
      memberCount: number;
      expiresAt: Date;
    };

/**
 * Looks up an invitation for the signed-in user. A token that does not match anything reveals
 * nothing about any trip. A valid token reveals only the trip name and group size.
 */
export async function inspectInvitation(
  token: string,
  userId: string,
  now = new Date(),
): Promise<InvitationState> {
  if (!isPlausibleToken(token)) return { status: "invalid" };
  const invitation = await db.tripInvitation.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    include: {
      trip: {
        select: {
          id: true,
          title: true,
          _count: { select: { members: true } },
          members: {
            where: { role: "ORGANIZER" },
            take: 1,
            select: { user: { select: { name: true } } },
          },
        },
      },
    },
  });
  if (!invitation) return { status: "invalid" };
  const tripTitle = invitation.trip.title;
  const existing = await db.tripMember.findUnique({
    where: { tripId_userId: { tripId: invitation.tripId, userId } },
    select: { id: true },
  });
  if (existing)
    return { status: "member", tripId: invitation.tripId, tripTitle };
  if (invitation.revokedAt) return { status: "revoked", tripTitle };
  if (invitation.expiresAt <= now) return { status: "expired", tripTitle };
  if (invitation.maxUses !== null && invitation.useCount >= invitation.maxUses)
    return { status: "used_up", tripTitle };
  return {
    status: "valid",
    tripTitle,
    organizerName: invitation.trip.members[0]?.user.name ?? null,
    memberCount: invitation.trip._count.members,
    expiresAt: invitation.expiresAt,
  };
}

/** Joins the trip behind a valid invitation. Safe to call twice: an existing member just gets the trip ID. */
export async function acceptInvitation(
  token: string,
  userId: string,
  now = new Date(),
) {
  if (!isPlausibleToken(token)) throw notFound("This invite link isn't valid.");
  return db.$transaction(async (tx) => {
    const invitation = await tx.tripInvitation.findUnique({
      where: { tokenHash: hashInviteToken(token) },
    });
    if (!invitation) throw notFound("This invite link isn't valid.");
    const existing = await tx.tripMember.findUnique({
      where: { tripId_userId: { tripId: invitation.tripId, userId } },
    });
    if (existing) return { tripId: invitation.tripId, joined: false };
    if (invitation.revokedAt)
      throw new DomainError(
        "FORBIDDEN",
        "This invite link was revoked. Ask the organizer for a new one.",
      );
    if (invitation.expiresAt <= now)
      throw new DomainError(
        "FORBIDDEN",
        "This invite link has expired. Ask the organizer for a new one.",
      );

    // Count the use atomically so a limited link can't be over-used by concurrent joins.
    const claimed = await tx.tripInvitation.updateMany({
      where: {
        id: invitation.id,
        revokedAt: null,
        expiresAt: { gt: now },
        ...(invitation.maxUses !== null
          ? { useCount: { lt: invitation.maxUses } }
          : {}),
      },
      data: { useCount: { increment: 1 } },
    });
    if (claimed.count !== 1) {
      throw new DomainError(
        "FORBIDDEN",
        "This invite link has already been used. Ask the organizer for a new one.",
      );
    }
    await tx.tripMember.create({
      data: {
        tripId: invitation.tripId,
        userId,
        role: invitation.role,
        invitedById: invitation.createdById,
      },
    });
    await logActivity(tx, {
      tripId: invitation.tripId,
      actorId: userId,
      type: "MEMBER_JOINED",
      summary: "joined the trip",
      entityType: "member",
      entityId: userId,
    });
    return { tripId: invitation.tripId, joined: true };
  });
}

async function organizerCount(tripId: string) {
  return db.tripMember.count({ where: { tripId, role: "ORGANIZER" } });
}

export async function removeMember(
  tripId: string,
  userId: string,
  memberId: string,
) {
  const access = await requireOrganizer(tripId, userId);
  const member = await db.tripMember.findFirst({
    where: { id: memberId, tripId: access.tripId },
    include: { user: { select: { name: true, email: true } } },
  });
  if (!member) throw notFound("That person isn't a member of this trip.");
  if (member.id === access.memberId)
    throw forbidden('Use "Leave trip" to remove yourself.');
  await db.$transaction(async (tx) => {
    await tx.tripMember.delete({ where: { id: member.id } });
    await logActivity(tx, {
      tripId: access.tripId,
      actorId: userId,
      type: "MEMBER_REMOVED",
      summary: `removed ${member.user.name ?? member.user.email ?? "a member"} from the trip`,
      entityType: "member",
      entityId: member.userId,
    });
  });
}

export async function leaveTrip(tripId: string, userId: string) {
  const access = await requireTripAccess(tripId, userId);
  if (access.isOrganizer && (await organizerCount(tripId)) === 1) {
    const others = await db.tripMember.count({ where: { tripId } });
    if (others > 1)
      throw conflict("Make another member an organizer before you leave.");
  }
  await db.$transaction(async (tx) => {
    await tx.tripMember.delete({ where: { id: access.memberId } });
    const remaining = await tx.tripMember.count({ where: { tripId } });
    if (remaining === 0) {
      await tx.trip.delete({ where: { id: tripId } });
      return;
    }
    await logActivity(tx, {
      tripId,
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
  const member = await db.tripMember.findFirst({
    where: { id: memberId, tripId: access.tripId },
    include: { user: { select: { name: true, email: true } } },
  });
  if (!member) throw notFound("That person isn't a member of this trip.");
  if (member.role === role) return;
  if (
    member.role === "ORGANIZER" &&
    role === "MEMBER" &&
    (await organizerCount(tripId)) === 1
  ) {
    throw conflict("A trip needs at least one organizer.");
  }
  await db.$transaction(async (tx) => {
    await tx.tripMember.update({ where: { id: member.id }, data: { role } });
    await logActivity(tx, {
      tripId: access.tripId,
      actorId: userId,
      type: "MEMBER_ROLE_CHANGED",
      summary: `made ${member.user.name ?? member.user.email ?? "a member"} ${role === "ORGANIZER" ? "an organizer" : "a member"}`,
      entityType: "member",
      entityId: member.userId,
    });
  });
}
