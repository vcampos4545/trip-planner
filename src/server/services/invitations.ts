import "server-only";

import { createHash, randomBytes } from "node:crypto";

import type { MemberRole } from "@/generated/prisma/enums";
import { toDateOnly } from "@/lib/dates";
import {
  canGrantRole,
  canInvite,
  emailMatches,
  invitationStatus,
  maskEmail,
  MAX_EMAILS_PER_REQUEST,
  normalizeEmail,
  type InvitationStatus,
} from "@/lib/domain/invitations";
import {
  requireInviter,
  requireOrganizer,
  requireTripAccess,
  type TripAccess,
} from "@/server/access";
import { logActivity } from "@/server/activity";
import { inviteUrl } from "@/server/app-url";
import { db, type DbTransaction } from "@/server/db";
import { EmailSendError, type EmailProvider } from "@/server/email";
import { invitationEmail } from "@/server/email/invitation-email";
import { DomainError, forbidden, invalid, notFound } from "@/server/errors";
import { checkRateLimit } from "@/server/rate-limit";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** Per-user limits. Creating links and invitations, and sending email, are counted separately. */
export const INVITE_RATE_LIMITS = {
  create: { limit: 30, windowMs: HOUR_MS },
  email: { limit: 20, windowMs: HOUR_MS },
} as const;

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

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function limitCreate(userId: string, cost = 1) {
  const { limit, windowMs } = INVITE_RATE_LIMITS.create;
  checkRateLimit(`invite-create:${userId}`, limit, windowMs, Date.now(), cost);
}

function limitEmail(userId: string, cost = 1) {
  const { limit, windowMs } = INVITE_RATE_LIMITS.email;
  checkRateLimit(`invite-email:${userId}`, limit, windowMs, Date.now(), cost);
}

async function inviterOf(tripId: string, userId: string, role: MemberRole) {
  const access = await requireInviter(tripId, userId);
  if (!canGrantRole(access.role, role))
    throw forbidden("Only an organizer can invite someone as an organizer.");
  return access;
}

// ---------------------------------------------------------------------------
// Share links
// ---------------------------------------------------------------------------

export type CreateLinkInput = {
  ttlDays: number;
  maxUses: number | null;
  role?: MemberRole;
};

/** Creates a shareable invite link. The raw token is returned once and never stored. */
export async function createInvitation(
  tripId: string,
  userId: string,
  input: CreateLinkInput,
  now = new Date(),
) {
  const role = input.role ?? "MEMBER";
  const access = await inviterOf(tripId, userId, role);
  limitCreate(userId);
  const token = generateInviteToken();
  const expiresAt = new Date(now.getTime() + input.ttlDays * DAY_MS);
  const invitation = await db.$transaction(async (tx) => {
    const created = await tx.tripInvitation.create({
      data: {
        tripId: access.tripId,
        tokenHash: hashInviteToken(token),
        role,
        createdById: userId,
        expiresAt,
        maxUses: input.maxUses,
      },
    });
    await logActivity(tx, {
      tripId: access.tripId,
      actorId: userId,
      type: "INVITE_CREATED",
      summary: `created ${role === "ORGANIZER" ? "an organizer" : "an"} invite link that expires in ${plural(input.ttlDays, "day")}${input.maxUses ? ` (up to ${plural(input.maxUses, "use")})` : ""}`,
      entityType: "invitation",
      entityId: created.id,
    });
    return created;
  });
  return { token, invitation };
}

// ---------------------------------------------------------------------------
// Email invitations
// ---------------------------------------------------------------------------

export type EmailOutcome =
  | { email: string; outcome: "sent"; invitationId: string }
  | {
      email: string;
      outcome: "not_sent" | "failed";
      invitationId: string;
      url: string;
      error?: string;
    }
  | { email: string; outcome: "already_member" };

type Delivery = {
  appUrl: string;
  /** Null when email isn't configured. The invitation is still created and its link returned. */
  email: EmailProvider | null;
  now?: Date;
};

async function deliver(
  invitation: { id: string; tripId: string; email: string; expiresAt: Date },
  token: string,
  sender: { id: string; name: string | null },
  tripTitle: string,
  delivery: Delivery,
): Promise<EmailOutcome> {
  const url = inviteUrl(delivery.appUrl, token);
  if (!delivery.email) {
    return {
      email: invitation.email,
      outcome: "not_sent",
      invitationId: invitation.id,
      url,
    };
  }
  try {
    await delivery.email.send(
      invitationEmail({
        to: invitation.email,
        inviterName: sender.name,
        tripTitle,
        url,
        expiresAt: invitation.expiresAt,
      }),
    );
  } catch (error) {
    return {
      email: invitation.email,
      outcome: "failed",
      invitationId: invitation.id,
      url,
      error:
        error instanceof EmailSendError
          ? error.message
          : "The email could not be sent.",
    };
  }
  await db.$transaction(async (tx) => {
    await tx.tripInvitation.update({
      where: { id: invitation.id },
      data: {
        lastSentAt: delivery.now ?? new Date(),
        sendCount: { increment: 1 },
      },
    });
    await logActivity(tx, {
      tripId: invitation.tripId,
      actorId: sender.id,
      type: "INVITE_SENT",
      summary: `emailed an invitation to ${maskEmail(invitation.email)}`,
      entityType: "invitation",
      entityId: invitation.id,
    });
  });
  return {
    email: invitation.email,
    outcome: "sent",
    invitationId: invitation.id,
  };
}

/**
 * Creates one invitation per address, each bound to that address, and emails it when email is
 * configured. A pending invitation for the same address is renewed with a fresh link instead of
 * duplicated. People who are already members are skipped.
 */
export async function inviteByEmail(
  tripId: string,
  userId: string,
  input: { emails: string[]; ttlDays: number; role?: MemberRole },
  delivery: Delivery,
) {
  const role = input.role ?? "MEMBER";
  const now = delivery.now ?? new Date();
  const emails = [...new Set(input.emails.map(normalizeEmail))];
  if (emails.length === 0) throw invalid("Add at least one email address.");
  if (emails.length > MAX_EMAILS_PER_REQUEST)
    throw invalid(
      `Invite up to ${MAX_EMAILS_PER_REQUEST} addresses at a time.`,
    );
  const access = await inviterOf(tripId, userId, role);

  const [trip, sender, members] = await Promise.all([
    db.trip.findUniqueOrThrow({
      where: { id: access.tripId },
      select: { title: true },
    }),
    db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, name: true },
    }),
    db.tripMember.findMany({
      where: { tripId: access.tripId },
      select: { user: { select: { email: true } } },
    }),
  ]);
  const memberEmails = new Set(
    members.flatMap((member) =>
      member.user.email ? [normalizeEmail(member.user.email)] : [],
    ),
  );
  const toInvite = emails.filter((email) => !memberEmails.has(email));
  if (toInvite.length > 0) {
    limitCreate(userId, toInvite.length);
    if (delivery.email) limitEmail(userId, toInvite.length);
  }

  const expiresAt = new Date(now.getTime() + input.ttlDays * DAY_MS);
  const results: EmailOutcome[] = [];
  for (const email of emails) {
    if (memberEmails.has(email)) {
      results.push({ email, outcome: "already_member" });
      continue;
    }
    const token = generateInviteToken();
    const invitation = await db.$transaction(async (tx) => {
      const pending = await tx.tripInvitation.findFirst({
        where: {
          tripId: access.tripId,
          email,
          revokedAt: null,
          acceptedAt: null,
        },
        orderBy: { createdAt: "desc" },
      });
      const saved = pending
        ? await tx.tripInvitation.update({
            where: { id: pending.id },
            data: { tokenHash: hashInviteToken(token), expiresAt, role },
          })
        : await tx.tripInvitation.create({
            data: {
              tripId: access.tripId,
              tokenHash: hashInviteToken(token),
              role,
              email,
              createdById: userId,
              expiresAt,
              maxUses: 1,
            },
          });
      await logActivity(tx, {
        tripId: access.tripId,
        actorId: userId,
        type: "INVITE_CREATED",
        summary: `invited ${maskEmail(email)} by email${role === "ORGANIZER" ? " as an organizer" : ""}`,
        entityType: "invitation",
        entityId: saved.id,
      });
      return saved;
    });
    results.push(
      await deliver(
        { ...invitation, email },
        token,
        sender,
        trip.title,
        delivery,
      ),
    );
  }
  return { results, emailConfigured: delivery.email !== null };
}

/** Organizers manage every invitation. A member who may invite manages the ones they created. */
async function manageableInvitation(
  tripId: string,
  userId: string,
  invitationId: string,
  client: typeof db | DbTransaction = db,
) {
  const access = await requireTripAccess(tripId, userId, client);
  const invitation = await client.tripInvitation.findFirst({
    where: { id: invitationId, tripId: access.tripId },
  });
  if (!invitation) throw notFound("That invitation doesn't exist.");
  if (!access.isOrganizer) {
    const trip = await client.trip.findUniqueOrThrow({
      where: { id: access.tripId },
      select: { membersCanInvite: true },
    });
    if (
      !canInvite(access.role, trip.membersCanInvite) ||
      invitation.createdById !== userId
    )
      throw forbidden("Only an organizer can change that invitation.");
  }
  return { access, invitation };
}

/**
 * Emails an invitation again with a fresh link (the earlier link stops working) and a renewed
 * expiry. Without email configured, the fresh link is returned to copy instead.
 */
export async function resendInvitation(
  tripId: string,
  userId: string,
  invitationId: string,
  delivery: Delivery,
) {
  const now = delivery.now ?? new Date();
  const { access, invitation } = await manageableInvitation(
    tripId,
    userId,
    invitationId,
  );
  if (!invitation.email)
    throw invalid(
      "Only email invitations can be resent. Copy the link instead.",
    );
  const status = invitationStatus(invitation, now);
  if (status === "accepted")
    throw invalid("This invitation was already accepted.");
  if (status === "revoked")
    throw invalid("This invitation was revoked. Invite them again instead.");
  if (delivery.email) limitEmail(userId);
  else limitCreate(userId);

  const ttlMs = Math.max(
    DAY_MS,
    invitation.expiresAt.getTime() - invitation.createdAt.getTime(),
  );
  const token = generateInviteToken();
  const updated = await db.tripInvitation.update({
    where: { id: invitation.id },
    data: {
      tokenHash: hashInviteToken(token),
      expiresAt: new Date(now.getTime() + ttlMs),
    },
  });
  const [trip, sender] = await Promise.all([
    db.trip.findUniqueOrThrow({
      where: { id: access.tripId },
      select: { title: true },
    }),
    db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, name: true },
    }),
  ]);
  return deliver(
    { ...updated, email: invitation.email },
    token,
    sender,
    trip.title,
    { ...delivery, now },
  );
}

export async function revokeInvitation(
  tripId: string,
  userId: string,
  invitationId: string,
) {
  await db.$transaction(async (tx) => {
    const { access, invitation } = await manageableInvitation(
      tripId,
      userId,
      invitationId,
      tx,
    );
    if (invitation.revokedAt) return;
    if (invitation.acceptedAt)
      throw invalid("This invitation was already accepted.");
    await tx.tripInvitation.update({
      where: { id: invitation.id },
      data: { revokedAt: new Date(), revokedById: userId },
    });
    await logActivity(tx, {
      tripId: access.tripId,
      actorId: userId,
      type: "INVITE_REVOKED",
      summary: invitation.email
        ? `revoked the invitation for ${maskEmail(invitation.email)}`
        : "revoked an invite link",
      entityType: "invitation",
      entityId: invitation.id,
    });
  });
}

// ---------------------------------------------------------------------------
// Listing and settings
// ---------------------------------------------------------------------------

export type InvitationListItem = {
  id: string;
  role: MemberRole;
  email: string | null;
  status: InvitationStatus;
  expiresAt: Date;
  maxUses: number | null;
  useCount: number;
  lastSentAt: Date | null;
  sendCount: number;
  createdAt: Date;
  createdBy: { id: string; name: string | null };
  acceptedBy: { name: string | null } | null;
  /** Whether the viewer may revoke or resend it. */
  canManage: boolean;
};

/**
 * Invitations the viewer can see: every one for organizers, their own for members who may invite,
 * and none otherwise. Links are listed while active; email invitations are listed with their
 * status so the group can see who hasn't joined yet.
 */
export async function listInvitations(access: TripAccess, now = new Date()) {
  const trip = await db.trip.findUniqueOrThrow({
    where: { id: access.tripId },
    select: { membersCanInvite: true },
  });
  if (!canInvite(access.role, trip.membersCanInvite))
    return { links: [], emails: [] };
  const rows = await db.tripInvitation.findMany({
    where: {
      tripId: access.tripId,
      ...(access.isOrganizer ? {} : { createdById: access.userId }),
      OR: [
        { email: null, revokedAt: null, expiresAt: { gt: now } },
        { email: { not: null } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 60,
    select: {
      id: true,
      role: true,
      email: true,
      expiresAt: true,
      maxUses: true,
      useCount: true,
      lastSentAt: true,
      sendCount: true,
      acceptedAt: true,
      revokedAt: true,
      createdAt: true,
      createdBy: { select: { id: true, name: true } },
      acceptedBy: { select: { name: true } },
    },
  });
  const items: InvitationListItem[] = rows.map((row) => ({
    id: row.id,
    role: row.role,
    email: row.email,
    status: invitationStatus(row, now),
    expiresAt: row.expiresAt,
    maxUses: row.maxUses,
    useCount: row.useCount,
    lastSentAt: row.lastSentAt,
    sendCount: row.sendCount,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    acceptedBy: row.acceptedBy,
    canManage: access.isOrganizer || row.createdBy.id === access.userId,
  }));
  return {
    links: items.filter((item) => !item.email && item.status === "pending"),
    emails: items.filter((item) => item.email).slice(0, 30),
  };
}

export async function setMembersCanInvite(
  tripId: string,
  userId: string,
  allowed: boolean,
) {
  const access = await requireOrganizer(tripId, userId);
  await db.$transaction(async (tx) => {
    const trip = await tx.trip.findUniqueOrThrow({
      where: { id: access.tripId },
      select: { membersCanInvite: true },
    });
    if (trip.membersCanInvite === allowed) return;
    await tx.trip.update({
      where: { id: access.tripId },
      data: { membersCanInvite: allowed },
    });
    await logActivity(tx, {
      tripId: access.tripId,
      actorId: userId,
      type: "INVITE_SETTINGS_CHANGED",
      summary: allowed
        ? "let every member invite people"
        : "limited inviting people to organizers",
    });
  });
}

// ---------------------------------------------------------------------------
// Joining
// ---------------------------------------------------------------------------

export type InvitePreview = {
  tripTitle: string;
  startDate: string | null;
  endDate: string | null;
  organizerName: string | null;
  memberCount: number;
  expiresAt: Date;
  role: MemberRole;
  /** Masked address for an email invitation, so the invitee picks the right account. */
  invitedEmail: string | null;
};

export type InvitationState =
  | { status: "invalid" | "revoked" }
  | { status: "expired" | "used_up" | "accepted"; tripTitle: string }
  | { status: "member"; tripId: string; tripTitle: string }
  | {
      status: "wrong_account";
      reason: "different" | "unverified";
      signedInAs: string | null;
      preview: InvitePreview;
    }
  | { status: "valid"; preview: InvitePreview };

export type Viewer = {
  id: string;
} | null;

/**
 * Looks up an invitation for whoever opened the link, signed in or not. A token that doesn't match
 * anything reveals nothing, a revoked one reveals nothing about the trip, and a valid one reveals
 * only the preview: trip name, dates, an organizer's name, and the group size.
 */
export async function inspectInvitation(
  token: string,
  viewer: Viewer,
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
          startDate: true,
          endDate: true,
          _count: { select: { members: true } },
          members: {
            where: { role: "ORGANIZER" },
            orderBy: { joinedAt: "asc" },
            take: 1,
            select: { user: { select: { name: true } } },
          },
        },
      },
    },
  });
  if (!invitation) return { status: "invalid" };
  const tripTitle = invitation.trip.title;
  if (viewer) {
    const existing = await db.tripMember.findUnique({
      where: {
        tripId_userId: { tripId: invitation.tripId, userId: viewer.id },
      },
      select: { id: true },
    });
    if (existing)
      return { status: "member", tripId: invitation.tripId, tripTitle };
  }
  const status = invitationStatus(invitation, now);
  if (status === "revoked") return { status: "revoked" };
  if (status !== "pending") return { status, tripTitle };

  const preview: InvitePreview = {
    tripTitle,
    startDate: invitation.trip.startDate
      ? toDateOnly(invitation.trip.startDate)
      : null,
    endDate: invitation.trip.endDate
      ? toDateOnly(invitation.trip.endDate)
      : null,
    organizerName: invitation.trip.members[0]?.user.name ?? null,
    memberCount: invitation.trip._count.members,
    expiresAt: invitation.expiresAt,
    role: invitation.role,
    invitedEmail: invitation.email ? maskEmail(invitation.email) : null,
  };
  if (viewer && invitation.email) {
    const user = await db.user.findUniqueOrThrow({
      where: { id: viewer.id },
      select: { email: true, emailVerified: true },
    });
    if (!emailMatches(invitation.email, user)) {
      const sameAddress =
        user.email !== null && normalizeEmail(user.email) === invitation.email;
      return {
        status: "wrong_account",
        reason: sameAddress ? "unverified" : "different",
        signedInAs: user.email,
        preview,
      };
    }
  }
  return { status: "valid", preview };
}

const JOIN_ERRORS = {
  invalid: "This invite link isn't valid.",
  revoked: "This invitation was revoked. Ask the organizer for a new one.",
  expired: "This invitation has expired. Ask the organizer for a new one.",
  used_up:
    "This invite link has reached its limit. Ask the organizer for a new one.",
  accepted: "This invitation was already accepted.",
  wrong_account:
    "This invitation was sent to a different email address. Sign in with that Google account to accept it.",
} as const;

/**
 * Joins the trip behind a valid invitation. Safe to call twice: an existing member just gets the
 * trip ID. An email invitation only works for the signed-in user whose verified email matches.
 */
export async function acceptInvitation(
  token: string,
  userId: string,
  now = new Date(),
) {
  if (!isPlausibleToken(token)) throw notFound(JOIN_ERRORS.invalid);
  return db.$transaction(async (tx) => {
    const invitation = await tx.tripInvitation.findUnique({
      where: { tokenHash: hashInviteToken(token) },
      include: { createdBy: { select: { name: true } } },
    });
    if (!invitation) throw notFound(JOIN_ERRORS.invalid);
    const existing = await tx.tripMember.findUnique({
      where: { tripId_userId: { tripId: invitation.tripId, userId } },
    });
    if (existing) return { tripId: invitation.tripId, joined: false };
    const status = invitationStatus(invitation, now);
    if (status !== "pending")
      throw new DomainError("FORBIDDEN", JOIN_ERRORS[status]);
    if (invitation.email) {
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { email: true, emailVerified: true },
      });
      if (!emailMatches(invitation.email, user))
        throw new DomainError("FORBIDDEN", JOIN_ERRORS.wrong_account);
    }

    // Count the use atomically so a limited link can't be over-used by concurrent joins.
    const claimed = await tx.tripInvitation.updateMany({
      where: {
        id: invitation.id,
        revokedAt: null,
        acceptedAt: null,
        expiresAt: { gt: now },
        ...(invitation.maxUses !== null
          ? { useCount: { lt: invitation.maxUses } }
          : {}),
      },
      data: {
        useCount: { increment: 1 },
        ...(invitation.email ? { acceptedAt: now, acceptedById: userId } : {}),
      },
    });
    if (claimed.count !== 1)
      throw new DomainError("FORBIDDEN", JOIN_ERRORS.used_up);
    await tx.tripMember.create({
      data: {
        tripId: invitation.tripId,
        userId,
        role: invitation.role,
        invitedById: invitation.createdById,
      },
    });
    const from = invitation.createdBy.name
      ? ` from ${invitation.createdBy.name}`
      : "";
    await logActivity(tx, {
      tripId: invitation.tripId,
      actorId: userId,
      type: "INVITE_ACCEPTED",
      summary: `${invitation.email ? `accepted an email invitation${from}` : `used an invite link${from}`} and joined the trip${invitation.role === "ORGANIZER" ? " as an organizer" : ""}`,
      entityType: "member",
      entityId: userId,
      metadata: { invitationId: invitation.id },
    });
    return { tripId: invitation.tripId, joined: true };
  });
}
