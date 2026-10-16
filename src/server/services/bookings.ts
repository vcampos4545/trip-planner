import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { BookingCategory } from "@/generated/prisma/enums";
import { parseDateOnly } from "@/lib/dates";
import { BOOKING_STATUS_LABELS } from "@/lib/labels";
import type { BookingInput } from "@/lib/validation/booking";
import { requireMembersOfTrip, type TripAccess } from "@/server/access";
import { logActivity } from "@/server/activity";
import { db, type DbTransaction } from "@/server/db";
import { conflict, forbidden, notFound } from "@/server/errors";

export const BOOKING_PAGE_SIZE = 200;

const BOOKING_INCLUDE = {
  participants: {
    orderBy: { createdAt: "asc" },
    include: {
      member: {
        select: {
          id: true,
          user: { select: { id: true, name: true, image: true, email: true } },
        },
      },
    },
  },
  researchOption: { select: { id: true, title: true, status: true } },
  createdBy: { select: { id: true, name: true } },
  updatedBy: { select: { id: true, name: true } },
} satisfies Prisma.BookingInclude;

export async function listBookings(access: TripAccess) {
  return db.booking.findMany({
    where: { tripId: access.tripId },
    orderBy: [
      { startDate: { sort: "asc", nulls: "last" } },
      { startMinute: { sort: "asc", nulls: "last" } },
      { createdAt: "asc" },
    ],
    take: BOOKING_PAGE_SIZE,
    include: BOOKING_INCLUDE,
  });
}

function bookingData(input: BookingInput) {
  return {
    category: input.category,
    title: input.title,
    provider: input.provider,
    url: input.url,
    reference: input.reference,
    status: input.status,
    startDate: input.startDate ? parseDateOnly(input.startDate) : null,
    startMinute: input.startTime,
    endDate: input.endDate ? parseDateOnly(input.endDate) : null,
    endMinute: input.endTime,
    fromLocation: input.fromLocation,
    toLocation: input.toLocation,
    locationName: input.locationName,
    address: input.address,
    costAmount: input.costAmount,
    currency: input.currency,
    costIsEstimate: input.costIsEstimate,
    costSplit: input.costSplit,
    notes: input.notes,
    researchOptionId: input.researchOptionId,
  };
}

function participantRows(input: BookingInput) {
  return input.participants.map((participant) => ({
    memberId: participant.memberId,
    status: participant.status,
    shareAmount: input.costSplit === "CUSTOM" ? participant.shareAmount : null,
    roomAssignment: participant.roomAssignment,
  }));
}

/**
 * A linked option only becomes "booked" when the booking itself is booked or confirmed, so a
 * planned booking never makes an idea look reserved.
 */
async function syncLinkedOption(
  tx: DbTransaction,
  access: TripAccess,
  booking: { researchOptionId: string | null; status: string; title: string },
) {
  if (!booking.researchOptionId) return;
  if (booking.status !== "BOOKED" && booking.status !== "CONFIRMED") return;
  const option = await tx.researchOption.findFirst({
    where: { id: booking.researchOptionId, tripId: access.tripId },
  });
  if (!option || option.status === "BOOKED") return;
  await tx.researchOption.update({
    where: { id: option.id },
    data: {
      status: "BOOKED",
      version: { increment: 1 },
      updatedById: access.userId,
    },
  });
  await logActivity(tx, {
    tripId: access.tripId,
    actorId: access.userId,
    type: "OPTION_STATUS_CHANGED",
    summary: `"${option.title}" is now booked (${booking.title})`,
    entityType: "option",
    entityId: option.id,
  });
}

async function checkOption(
  tx: DbTransaction,
  access: TripAccess,
  optionId: string | null,
) {
  if (!optionId) return;
  const found = await tx.researchOption.count({
    where: { id: optionId, tripId: access.tripId },
  });
  if (!found) throw notFound("That option isn't part of this trip.");
}

export async function createBooking(access: TripAccess, input: BookingInput) {
  return db.$transaction(async (tx) => {
    await requireMembersOfTrip(
      access.tripId,
      input.participants.map((p) => p.memberId),
      tx,
    );
    await checkOption(tx, access, input.researchOptionId);
    const booking = await tx.booking.create({
      data: {
        ...bookingData(input),
        tripId: access.tripId,
        createdById: access.userId,
        updatedById: access.userId,
        participants: { create: participantRows(input) },
      },
    });
    await logActivity(tx, {
      tripId: access.tripId,
      actorId: access.userId,
      type: "BOOKING_ADDED",
      summary: `recorded "${booking.title}" (${BOOKING_STATUS_LABELS[booking.status].toLowerCase()})`,
      entityType: "booking",
      entityId: booking.id,
    });
    await syncLinkedOption(tx, access, booking);
    return booking;
  });
}

export async function updateBooking(
  access: TripAccess,
  bookingId: string,
  input: BookingInput,
  expectedVersion: number,
) {
  return db.$transaction(async (tx) => {
    const booking = await tx.booking.findFirst({
      where: { id: bookingId, tripId: access.tripId },
    });
    if (!booking) throw notFound();
    await requireMembersOfTrip(
      access.tripId,
      input.participants.map((p) => p.memberId),
      tx,
    );
    await checkOption(tx, access, input.researchOptionId);
    const result = await tx.booking.updateMany({
      where: {
        id: booking.id,
        tripId: access.tripId,
        version: expectedVersion,
      },
      data: {
        ...bookingData(input),
        version: { increment: 1 },
        updatedById: access.userId,
      },
    });
    if (result.count !== 1) throw conflict();
    await tx.bookingParticipant.deleteMany({
      where: { bookingId: booking.id },
    });
    if (input.participants.length > 0) {
      await tx.bookingParticipant.createMany({
        data: participantRows(input).map((row) => ({
          ...row,
          bookingId: booking.id,
        })),
      });
    }
    const becameConfirmed =
      booking.status !== "CONFIRMED" && input.status === "CONFIRMED";
    await logActivity(tx, {
      tripId: access.tripId,
      actorId: access.userId,
      type: becameConfirmed ? "BOOKING_CONFIRMED" : "BOOKING_UPDATED",
      summary: becameConfirmed
        ? `marked "${input.title}" as confirmed`
        : `updated the booking "${input.title}"`,
      entityType: "booking",
      entityId: booking.id,
    });
    await syncLinkedOption(tx, access, {
      researchOptionId: input.researchOptionId,
      status: input.status,
      title: input.title,
    });
  });
}

export async function deleteBooking(access: TripAccess, bookingId: string) {
  await db.$transaction(async (tx) => {
    const booking = await tx.booking.findFirst({
      where: { id: bookingId, tripId: access.tripId },
    });
    if (!booking) throw notFound();
    if (!access.isOrganizer && booking.createdById !== access.userId) {
      throw forbidden(
        "Only the person who recorded this booking or an organizer can delete it.",
      );
    }
    await tx.booking.delete({ where: { id: booking.id } });
    if (booking.researchOptionId) {
      const others = await tx.booking.count({
        where: {
          researchOptionId: booking.researchOptionId,
          status: { in: ["BOOKED", "CONFIRMED"] },
        },
      });
      if (others === 0) {
        await tx.researchOption.updateMany({
          where: {
            id: booking.researchOptionId,
            tripId: access.tripId,
            status: "BOOKED",
          },
          data: {
            status: "APPROVED",
            version: { increment: 1 },
            updatedById: access.userId,
          },
        });
      }
    }
    await logActivity(tx, {
      tripId: access.tripId,
      actorId: access.userId,
      type: "BOOKING_REMOVED",
      summary: `deleted the booking "${booking.title}"`,
      entityType: "booking",
      entityId: booking.id,
    });
  });
}

/** Lets a member add or remove themselves from a booking, such as joining a flight. */
export async function setOwnParticipation(
  access: TripAccess,
  bookingId: string,
  participation: { status: "CONSIDERING" | "BOOKED" } | null,
) {
  await db.$transaction(async (tx) => {
    const booking = await tx.booking.findFirst({
      where: { id: bookingId, tripId: access.tripId },
    });
    if (!booking) throw notFound();
    if (participation === null) {
      await tx.bookingParticipant.deleteMany({
        where: { bookingId: booking.id, memberId: access.memberId },
      });
    } else {
      await tx.bookingParticipant.upsert({
        where: {
          bookingId_memberId: {
            bookingId: booking.id,
            memberId: access.memberId,
          },
        },
        create: {
          bookingId: booking.id,
          memberId: access.memberId,
          status: participation.status,
        },
        update: { status: participation.status },
      });
    }
    await tx.booking.update({
      where: { id: booking.id },
      data: { version: { increment: 1 } },
    });
    await logActivity(tx, {
      tripId: access.tripId,
      actorId: access.userId,
      type: "BOOKING_UPDATED",
      summary:
        participation === null
          ? `left "${booking.title}"`
          : `joined "${booking.title}" (${participation.status === "BOOKED" ? "booked" : "considering"})`,
      entityType: "booking",
      entityId: booking.id,
    });
  });
}

/**
 * A booking that already stands for the same thing: the record saved from the same flight result,
 * or one with the same category, title, and start date. Used so telling Atlas about a purchase
 * twice, or buying a flight someone was considering, updates that record instead of adding one.
 */
export async function findExistingBooking(
  access: TripAccess,
  params: {
    category: BookingCategory;
    title: string;
    startDate: string | null;
    offerId: string | null;
  },
) {
  if (params.offerId) {
    const fromOffer = await db.booking.findFirst({
      where: {
        tripId: access.tripId,
        category: params.category,
        status: { not: "CANCELLED" },
        researchOption: {
          providerPayload: { path: ["offerId"], equals: params.offerId },
        },
      },
      select: { id: true, title: true },
    });
    if (fromOffer) return fromOffer;
  }
  return db.booking.findFirst({
    where: {
      tripId: access.tripId,
      category: params.category,
      status: { not: "CANCELLED" },
      title: { equals: params.title, mode: "insensitive" },
      startDate: params.startDate ? parseDateOnly(params.startDate) : null,
    },
    select: { id: true, title: true },
  });
}

/**
 * Marks travelers as booked on an existing record, for example when someone who was considering a
 * flight says they bought it. A booking that was "not booked yet" becomes booked. Nothing here
 * marks a booking as confirmed with the provider.
 */
export async function recordTravelersBooked(
  access: TripAccess,
  bookingId: string,
  memberIds: string[],
) {
  await db.$transaction(async (tx) => {
    const booking = await tx.booking.findFirst({
      where: { id: bookingId, tripId: access.tripId },
    });
    if (!booking) throw notFound();
    await requireMembersOfTrip(access.tripId, memberIds, tx);
    for (const memberId of memberIds) {
      await tx.bookingParticipant.upsert({
        where: { bookingId_memberId: { bookingId: booking.id, memberId } },
        create: { bookingId: booking.id, memberId, status: "BOOKED" },
        update: { status: "BOOKED" },
      });
    }
    const status = booking.status === "PLANNED" ? "BOOKED" : booking.status;
    await tx.booking.update({
      where: { id: booking.id },
      data: {
        status,
        version: { increment: 1 },
        updatedById: access.userId,
      },
    });
    await logActivity(tx, {
      tripId: access.tripId,
      actorId: access.userId,
      type: "BOOKING_UPDATED",
      summary: `marked "${booking.title}" as booked`,
      entityType: "booking",
      entityId: booking.id,
    });
    await syncLinkedOption(tx, access, { ...booking, status });
  });
}
