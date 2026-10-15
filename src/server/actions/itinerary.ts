"use server";

import { z } from "zod";

import type { ActionResult } from "@/lib/action-result";
import { eventFormSchema } from "@/lib/validation/itinerary";
import { requireTripAccess } from "@/server/access";
import {
  confirmEvent,
  createEvent,
  deleteEvent,
  reviewSuggestedEvent,
  updateEvent,
} from "@/server/services/itinerary";

import { revalidateTrip } from "./revalidate";
import { runAction } from "./run-action";

const id = z.string().min(1).max(64);

export async function createEventAction(
  tripId: string,
  raw: unknown,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async (user) => {
    const access = await requireTripAccess(tripId, user.id);
    const event = await createEvent(access, eventFormSchema.parse(raw));
    revalidateTrip(tripId);
    return { id: event.id };
  });
}

export async function updateEventAction(
  tripId: string,
  eventId: string,
  raw: unknown,
  version: number,
): Promise<ActionResult> {
  return runAction(async (user) => {
    const access = await requireTripAccess(tripId, user.id);
    await updateEvent(
      access,
      id.parse(eventId),
      eventFormSchema.parse(raw),
      z.number().int().parse(version),
    );
    revalidateTrip(tripId);
    return null;
  });
}

export async function deleteEventAction(
  tripId: string,
  eventId: string,
): Promise<ActionResult> {
  return runAction(async (user) => {
    const access = await requireTripAccess(tripId, user.id);
    await deleteEvent(access, id.parse(eventId));
    revalidateTrip(tripId);
    return null;
  });
}

export async function confirmEventAction(
  tripId: string,
  eventId: string,
): Promise<ActionResult> {
  return runAction(async (user) => {
    const access = await requireTripAccess(tripId, user.id);
    await confirmEvent(access, id.parse(eventId));
    revalidateTrip(tripId);
    return null;
  });
}

export async function reviewEventSuggestionAction(
  tripId: string,
  eventId: string,
  accept: boolean,
): Promise<ActionResult> {
  return runAction(async (user) => {
    const access = await requireTripAccess(tripId, user.id);
    await reviewSuggestedEvent(
      access,
      id.parse(eventId),
      z.boolean().parse(accept),
    );
    revalidateTrip(tripId);
    return null;
  });
}
