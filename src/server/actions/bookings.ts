"use server";

import { z } from "zod";

import type { ActionResult } from "@/lib/action-result";
import { bookingFormSchema } from "@/lib/validation/booking";
import { requireTripAccess } from "@/server/access";
import {
  createBooking,
  deleteBooking,
  setOwnParticipation,
  updateBooking,
} from "@/server/services/bookings";

import { revalidateTrip } from "./revalidate";
import { runAction } from "./run-action";

const id = z.string().min(1).max(64);

export async function createBookingAction(
  tripId: string,
  raw: unknown,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async (user) => {
    const access = await requireTripAccess(tripId, user.id);
    const booking = await createBooking(access, bookingFormSchema.parse(raw));
    revalidateTrip(tripId);
    return { id: booking.id };
  });
}

export async function updateBookingAction(
  tripId: string,
  bookingId: string,
  raw: unknown,
  version: number,
): Promise<ActionResult> {
  return runAction(async (user) => {
    const access = await requireTripAccess(tripId, user.id);
    await updateBooking(
      access,
      id.parse(bookingId),
      bookingFormSchema.parse(raw),
      z.number().int().parse(version),
    );
    revalidateTrip(tripId);
    return null;
  });
}

export async function deleteBookingAction(
  tripId: string,
  bookingId: string,
): Promise<ActionResult> {
  return runAction(async (user) => {
    const access = await requireTripAccess(tripId, user.id);
    await deleteBooking(access, id.parse(bookingId));
    revalidateTrip(tripId);
    return null;
  });
}

export async function setOwnParticipationAction(
  tripId: string,
  bookingId: string,
  status: "CONSIDERING" | "BOOKED" | null,
): Promise<ActionResult> {
  return runAction(async (user) => {
    const access = await requireTripAccess(tripId, user.id);
    const parsed = z.enum(["CONSIDERING", "BOOKED"]).nullable().parse(status);
    await setOwnParticipation(
      access,
      id.parse(bookingId),
      parsed === null ? null : { status: parsed },
    );
    revalidateTrip(tripId);
    return null;
  });
}
