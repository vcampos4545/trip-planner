"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import type { ActionResult } from "@/lib/action-result";
import { tripDetailsSchema } from "@/lib/domain/trip-details";
import {
  preferenceFormSchema,
  quickTripFormSchema,
  tripDetailsFormSchema,
  tripStageSchema,
} from "@/lib/validation/trip";
import { requireTripAccess } from "@/server/access";
import { requireActionUser } from "@/server/auth/session";
import {
  addPreference,
  createManualTrip,
  deleteTrip,
  removePreference,
  resolveProposal,
  setTripStage,
  updateTripDetails,
} from "@/server/services/trips";

import { revalidateTrip } from "./revalidate";
import { runAction, toFailure } from "./run-action";

export async function createQuickTripAction(
  raw: unknown,
): Promise<ActionResult<never>> {
  let tripId: string;
  try {
    const user = await requireActionUser();
    const input = quickTripFormSchema.parse(raw);
    const trip = await createManualTrip(user.id, input);
    tripId = trip.id;
  } catch (error) {
    return toFailure(error);
  }
  redirect(`/trips/${tripId}`);
}

export async function updateTripDetailsAction(
  tripId: string,
  raw: unknown,
  version: number,
): Promise<ActionResult> {
  return runAction(async (user) => {
    const access = await requireTripAccess(tripId, user.id);
    const input = tripDetailsFormSchema.parse(raw);
    await updateTripDetails(
      access,
      tripDetailsSchema.parse(input),
      z.number().int().parse(version),
    );
    revalidateTrip(tripId);
    return null;
  });
}

export async function setTripStageAction(
  tripId: string,
  stage: unknown,
): Promise<ActionResult> {
  return runAction(async (user) => {
    const access = await requireTripAccess(tripId, user.id);
    await setTripStage(access, tripStageSchema.parse(stage));
    revalidateTrip(tripId);
    return null;
  });
}

export async function deleteTripAction(
  tripId: string,
): Promise<ActionResult<never>> {
  try {
    const user = await requireActionUser();
    await deleteTrip(tripId, user.id);
  } catch (error) {
    return toFailure(error);
  }
  redirect("/trips");
}

export async function resolveProposalAction(
  tripId: string,
  proposalId: string,
  accept: boolean,
): Promise<ActionResult> {
  return runAction(async (user) => {
    const access = await requireTripAccess(tripId, user.id);
    await resolveProposal(
      access,
      z.string().min(1).max(64).parse(proposalId),
      z.boolean().parse(accept),
    );
    revalidateTrip(tripId);
    return null;
  });
}

export async function addPreferenceAction(
  tripId: string,
  raw: unknown,
): Promise<ActionResult> {
  return runAction(async (user) => {
    const access = await requireTripAccess(tripId, user.id);
    await addPreference(access, preferenceFormSchema.parse(raw));
    revalidateTrip(tripId);
    return null;
  });
}

export async function removePreferenceAction(
  tripId: string,
  preferenceId: string,
): Promise<ActionResult> {
  return runAction(async (user) => {
    const access = await requireTripAccess(tripId, user.id);
    await removePreference(
      access,
      z.string().min(1).max(64).parse(preferenceId),
    );
    revalidateTrip(tripId);
    return null;
  });
}
