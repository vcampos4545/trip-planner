"use server";

import { z } from "zod";

import type { ActionResult } from "@/lib/action-result";
import {
  decisionFormSchema,
  optionFormSchema,
  optionNoteSchema,
  optionStatusSchema,
  resolveDecisionSchema,
} from "@/lib/validation/research";
import { requireTripAccess } from "@/server/access";
import {
  addOptionNote,
  cancelDecision,
  castVote,
  createDecision,
  createOption,
  deleteOption,
  resolveDecision,
  setOptionStatus,
  updateOption,
} from "@/server/services/research";

import { revalidateTrip } from "./revalidate";
import { runAction } from "./run-action";

const id = z.string().min(1).max(64);

export async function createOptionAction(
  tripId: string,
  raw: unknown,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async (user) => {
    const access = await requireTripAccess(tripId, user.id);
    const option = await createOption(access, optionFormSchema.parse(raw), {
      origin: "USER",
    });
    revalidateTrip(tripId);
    return { id: option.id };
  });
}

export async function updateOptionAction(
  tripId: string,
  optionId: string,
  raw: unknown,
  version: number,
): Promise<ActionResult> {
  return runAction(async (user) => {
    const access = await requireTripAccess(tripId, user.id);
    await updateOption(
      access,
      id.parse(optionId),
      optionFormSchema.parse(raw),
      z.number().int().parse(version),
    );
    revalidateTrip(tripId);
    return null;
  });
}

export async function setOptionStatusAction(
  tripId: string,
  optionId: string,
  status: unknown,
): Promise<ActionResult> {
  return runAction(async (user) => {
    const access = await requireTripAccess(tripId, user.id);
    await setOptionStatus(
      access,
      id.parse(optionId),
      optionStatusSchema.parse(status),
    );
    revalidateTrip(tripId);
    return null;
  });
}

export async function deleteOptionAction(
  tripId: string,
  optionId: string,
): Promise<ActionResult> {
  return runAction(async (user) => {
    const access = await requireTripAccess(tripId, user.id);
    await deleteOption(access, id.parse(optionId));
    revalidateTrip(tripId);
    return null;
  });
}

export async function addOptionNoteAction(
  tripId: string,
  optionId: string,
  raw: unknown,
): Promise<ActionResult> {
  return runAction(async (user) => {
    const access = await requireTripAccess(tripId, user.id);
    await addOptionNote(
      access,
      id.parse(optionId),
      optionNoteSchema.parse(raw).body,
    );
    revalidateTrip(tripId);
    return null;
  });
}

export async function createDecisionAction(
  tripId: string,
  raw: unknown,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async (user) => {
    const access = await requireTripAccess(tripId, user.id);
    const decision = await createDecision(
      access,
      decisionFormSchema.parse(raw),
    );
    revalidateTrip(tripId);
    return { id: decision.id };
  });
}

export async function castVoteAction(
  tripId: string,
  decisionId: string,
  choiceId: string | null,
): Promise<ActionResult> {
  return runAction(async (user) => {
    const access = await requireTripAccess(tripId, user.id);
    await castVote(
      access,
      id.parse(decisionId),
      choiceId === null ? null : id.parse(choiceId),
    );
    revalidateTrip(tripId);
    return null;
  });
}

export async function resolveDecisionAction(
  tripId: string,
  decisionId: string,
  raw: unknown,
): Promise<ActionResult> {
  return runAction(async (user) => {
    await resolveDecision(
      id.parse(tripId),
      user.id,
      id.parse(decisionId),
      resolveDecisionSchema.parse(raw),
    );
    revalidateTrip(tripId);
    return null;
  });
}

export async function cancelDecisionAction(
  tripId: string,
  decisionId: string,
): Promise<ActionResult> {
  return runAction(async (user) => {
    await cancelDecision(id.parse(tripId), user.id, id.parse(decisionId));
    revalidateTrip(tripId);
    return null;
  });
}
