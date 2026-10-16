"use client";

import type { TripDetailsFormInput } from "@/lib/validation/trip";
import { updateDraftDetailsAction } from "@/server/actions/atlas";
import { updateTripDetailsAction } from "@/server/actions/trips";

import { EditDetailsSheet } from "./edit-details-sheet";

export function TripDetailsEditButton({
  tripId,
  version,
  initial,
  triggerLabel,
}: {
  tripId: string;
  version: number;
  initial: TripDetailsFormInput;
  triggerLabel?: string;
}) {
  return (
    <EditDetailsSheet
      initial={initial}
      triggerLabel={triggerLabel}
      openParam="details"
      save={(values) => updateTripDetailsAction(tripId, values, version)}
    />
  );
}

export function DraftDetailsEditButton({
  conversationId,
  initial,
}: {
  conversationId: string;
  initial: TripDetailsFormInput;
}) {
  return (
    <EditDetailsSheet
      initial={initial}
      triggerLabel="Edit"
      triggerVariant="ghost"
      description="Fill in anything you already know. Unknowns are fine."
      save={(values) => updateDraftDetailsAction(conversationId, values)}
    />
  );
}
