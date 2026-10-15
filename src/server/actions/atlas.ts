"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { ActionResult } from "@/lib/action-result";
import { tripDetailsSchema, tripDraftSchema } from "@/lib/domain/trip-details";
import { tripDetailsFormSchema } from "@/lib/validation/trip";
import { requireActionUser } from "@/server/auth/session";
import {
  convertConversationToTrip,
  sendAtlasMessage,
  updateDraft,
} from "@/server/ai/orchestrator";
import type { ToolEffect } from "@/server/ai/tools";
import {
  deleteDraftConversation,
  draftOf,
  getOwnConversation,
  startCreationConversation,
} from "@/server/services/conversations";

import { revalidateTrip } from "./revalidate";
import { runAction, toFailure } from "./run-action";

const id = z.string().min(1).max(64);
const startModeSchema = z.enum(["KNOWN_DESTINATION", "VIBE", "DISCOVER"]);

export async function startConversationAction(
  mode: unknown,
): Promise<ActionResult<never>> {
  let conversationId: string;
  try {
    const user = await requireActionUser();
    const conversation = await startCreationConversation(
      user.id,
      startModeSchema.parse(mode),
    );
    conversationId = conversation.id;
  } catch (error) {
    return toFailure(error);
  }
  redirect(`/trips/new/${conversationId}`);
}

export async function sendMessageAction(
  conversationId: string,
  content: unknown,
): Promise<
  ActionResult<{
    replied: boolean;
    tripId: string | null;
    tripCreated: boolean;
    effects: ToolEffect[];
  }>
> {
  return runAction(async (user) => {
    const result = await sendAtlasMessage(
      user,
      id.parse(conversationId),
      z.string().parse(content),
    );
    if (result.tripId) revalidateTrip(result.tripId);
    revalidatePath(`/trips/new/${conversationId}`);
    return result;
  });
}

export async function createTripFromConversationAction(
  conversationId: string,
): Promise<ActionResult<never>> {
  let tripId: string;
  try {
    const user = await requireActionUser();
    tripId = await convertConversationToTrip(user.id, id.parse(conversationId));
  } catch (error) {
    return toFailure(error);
  }
  revalidateTrip(tripId);
  redirect(`/trips/${tripId}/plan`);
}

export async function updateDraftDetailsAction(
  conversationId: string,
  raw: unknown,
): Promise<ActionResult> {
  return runAction(async (user) => {
    const conversation = await getOwnConversation(
      user.id,
      id.parse(conversationId),
    );
    const details = tripDetailsSchema.parse(tripDetailsFormSchema.parse(raw));
    const draft = tripDraftSchema.parse({ ...draftOf(conversation), details });
    await updateDraft(user.id, conversation.id, draft);
    revalidatePath(`/trips/new/${conversation.id}`);
    return null;
  });
}

export async function deleteDraftAction(
  conversationId: string,
): Promise<ActionResult> {
  return runAction(async (user) => {
    await deleteDraftConversation(user.id, id.parse(conversationId));
    revalidatePath("/trips");
    return null;
  });
}
