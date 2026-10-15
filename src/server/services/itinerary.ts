import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { EventKind } from "@/generated/prisma/enums";
import { formatDateOnly, parseDateOnly, toDateOnly } from "@/lib/dates";
import type { EventInput } from "@/lib/validation/itinerary";
import type { TripAccess } from "@/server/access";
import { logActivity } from "@/server/activity";
import { db, type DbTransaction } from "@/server/db";
import { conflict, invalid, notFound } from "@/server/errors";

export const EVENT_PAGE_SIZE = 300;

const EVENT_INCLUDE = {
  researchOption: { select: { id: true, title: true, url: true } },
  booking: { select: { id: true, title: true, status: true } },
  createdBy: { select: { id: true, name: true } },
  updatedBy: { select: { id: true, name: true } },
} satisfies Prisma.ItineraryEventInclude;

export async function listEvents(access: TripAccess) {
  return db.itineraryEvent.findMany({
    where: { tripId: access.tripId, status: { not: "CANCELLED" } },
    orderBy: [
      { date: "asc" },
      { startMinute: { sort: "asc", nulls: "last" } },
      { createdAt: "asc" },
    ],
    take: EVENT_PAGE_SIZE,
    include: EVENT_INCLUDE,
  });
}

async function checkLinks(
  tx: DbTransaction,
  access: TripAccess,
  input: { researchOptionId: string | null; bookingId: string | null },
) {
  if (input.researchOptionId) {
    const found = await tx.researchOption.count({
      where: { id: input.researchOptionId, tripId: access.tripId },
    });
    if (!found) throw notFound("That option isn't part of this trip.");
  }
  if (input.bookingId) {
    const found = await tx.booking.count({
      where: { id: input.bookingId, tripId: access.tripId },
    });
    if (!found) throw notFound("That booking isn't part of this trip.");
  }
}

function eventData(input: EventInput) {
  return {
    title: input.title,
    kind: input.kind,
    status: input.status,
    date: parseDateOnly(input.date),
    startMinute: input.startTime,
    endMinute: input.endTime,
    locationName: input.locationName,
    address: input.address,
    latitude: input.latitude,
    longitude: input.longitude,
    url: input.url,
    notes: input.notes,
    researchOptionId: input.researchOptionId,
    bookingId: input.bookingId,
  };
}

export async function createEvent(access: TripAccess, input: EventInput) {
  return db.$transaction(async (tx) => {
    await checkLinks(tx, access, input);
    const event = await tx.itineraryEvent.create({
      data: {
        ...eventData(input),
        tripId: access.tripId,
        origin: "USER",
        createdById: access.userId,
        updatedById: access.userId,
      },
    });
    await logActivity(tx, {
      tripId: access.tripId,
      actorId: access.userId,
      type: "EVENT_ADDED",
      summary: `added "${event.title}" to ${formatDateOnly(event.date, "weekday")}`,
      entityType: "event",
      entityId: event.id,
    });
    return event;
  });
}

export async function updateEvent(
  access: TripAccess,
  eventId: string,
  input: EventInput,
  expectedVersion: number,
) {
  return db.$transaction(async (tx) => {
    const event = await tx.itineraryEvent.findFirst({
      where: { id: eventId, tripId: access.tripId },
    });
    if (!event) throw notFound();
    await checkLinks(tx, access, input);
    // Editing a suggestion keeps it a suggestion until someone accepts it.
    const status = event.status === "SUGGESTED" ? "SUGGESTED" : input.status;
    const result = await tx.itineraryEvent.updateMany({
      where: { id: event.id, tripId: access.tripId, version: expectedVersion },
      data: {
        ...eventData(input),
        status,
        version: { increment: 1 },
        updatedById: access.userId,
      },
    });
    if (result.count !== 1) throw conflict();
    await logActivity(tx, {
      tripId: access.tripId,
      actorId: access.userId,
      type: "EVENT_UPDATED",
      summary: `updated "${input.title}" on the itinerary`,
      entityType: "event",
      entityId: event.id,
    });
  });
}

export async function deleteEvent(access: TripAccess, eventId: string) {
  await db.$transaction(async (tx) => {
    const event = await tx.itineraryEvent.findFirst({
      where: { id: eventId, tripId: access.tripId },
    });
    if (!event) throw notFound();
    await tx.itineraryEvent.delete({ where: { id: event.id } });
    await logActivity(tx, {
      tripId: access.tripId,
      actorId: access.userId,
      type: "EVENT_REMOVED",
      summary: `removed "${event.title}" from the itinerary`,
      entityType: "event",
      entityId: event.id,
    });
  });
}

export async function confirmEvent(access: TripAccess, eventId: string) {
  await db.$transaction(async (tx) => {
    const event = await tx.itineraryEvent.findFirst({
      where: { id: eventId, tripId: access.tripId },
    });
    if (!event) throw notFound();
    if (event.status === "SUGGESTED")
      throw invalid("Accept this suggestion before confirming it.");
    if (event.status === "CONFIRMED") return;
    await tx.itineraryEvent.update({
      where: { id: event.id },
      data: {
        status: "CONFIRMED",
        version: { increment: 1 },
        updatedById: access.userId,
      },
    });
    await logActivity(tx, {
      tripId: access.tripId,
      actorId: access.userId,
      type: "EVENT_UPDATED",
      summary: `confirmed "${event.title}"`,
      entityType: "event",
      entityId: event.id,
    });
  });
}

export type ProposedEvent = {
  title: string;
  kind: EventKind;
  date: string;
  startMinute: number | null;
  endMinute: number | null;
  locationName: string | null;
  notes: string | null;
  rationale: string;
  caveats: string | null;
  researchOptionId: string | null;
};

/** Atlas proposals land as SUGGESTED, shown apart from the plan until someone accepts them. */
export async function proposeEvent(access: TripAccess, input: ProposedEvent) {
  return db.$transaction(async (tx) => {
    const trip = await tx.trip.findUniqueOrThrow({
      where: { id: access.tripId },
      select: { startDate: true, endDate: true },
    });
    if (trip.startDate && input.date < toDateOnly(trip.startDate))
      throw invalid("That date is before the trip starts.");
    if (trip.endDate && input.date > toDateOnly(trip.endDate))
      throw invalid("That date is after the trip ends.");
    if (
      input.startMinute !== null &&
      input.endMinute !== null &&
      input.endMinute <= input.startMinute
    ) {
      throw invalid("The end time must be after the start time.");
    }
    await checkLinks(tx, access, {
      researchOptionId: input.researchOptionId,
      bookingId: null,
    });
    const event = await tx.itineraryEvent.create({
      data: {
        tripId: access.tripId,
        title: input.title,
        kind: input.kind,
        status: "SUGGESTED",
        date: parseDateOnly(input.date),
        startMinute: input.startMinute,
        endMinute: input.endMinute,
        locationName: input.locationName,
        notes: input.notes,
        rationale: input.rationale,
        caveats: input.caveats,
        researchOptionId: input.researchOptionId,
        origin: "ATLAS",
        createdById: access.userId,
        updatedById: access.userId,
      },
    });
    await logActivity(tx, {
      tripId: access.tripId,
      actorId: access.userId,
      type: "EVENT_SUGGESTED",
      summary: `got an Atlas suggestion for ${formatDateOnly(event.date, "weekday")}: "${event.title}"`,
      entityType: "event",
      entityId: event.id,
    });
    return event;
  });
}

export async function reviewSuggestedEvent(
  access: TripAccess,
  eventId: string,
  accept: boolean,
) {
  await db.$transaction(async (tx) => {
    const event = await tx.itineraryEvent.findFirst({
      where: { id: eventId, tripId: access.tripId },
    });
    if (!event) throw notFound();
    if (event.status !== "SUGGESTED")
      throw conflict("This suggestion was already reviewed.");
    if (accept) {
      await tx.itineraryEvent.update({
        where: { id: event.id },
        data: {
          status: "PLANNED",
          version: { increment: 1 },
          updatedById: access.userId,
        },
      });
    } else {
      await tx.itineraryEvent.delete({ where: { id: event.id } });
    }
    await logActivity(tx, {
      tripId: access.tripId,
      actorId: access.userId,
      type: accept ? "SUGGESTION_ACCEPTED" : "SUGGESTION_DISMISSED",
      summary: `${accept ? "added" : "dismissed"} Atlas's suggestion "${event.title}"`,
      entityType: "event",
      entityId: event.id,
    });
  });
}
