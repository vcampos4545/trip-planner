import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { TripStartMode } from "@/generated/prisma/enums";
import {
  EMPTY_DRAFT,
  parseDraft,
  type TripDraft,
} from "@/lib/domain/trip-details";
import type { TripAccess } from "@/server/access";
import { db } from "@/server/db";
import { notFound } from "@/server/errors";

export const MESSAGE_HISTORY_LIMIT = 80;

export async function startCreationConversation(
  userId: string,
  mode: Exclude<TripStartMode, "MANUAL">,
) {
  return db.conversation.create({
    data: {
      userId,
      startMode: mode,
      draft: EMPTY_DRAFT as unknown as Prisma.InputJsonValue,
    },
  });
}

/** A conversation the user owns. Conversations are private to the person talking to Atlas. */
export async function getOwnConversation(
  userId: string,
  conversationId: string,
) {
  if (!conversationId || conversationId.length > 64) throw notFound();
  const conversation = await db.conversation.findFirst({
    where: { id: conversationId, userId },
  });
  if (!conversation) throw notFound("We couldn't find that conversation.");
  return conversation;
}

export async function getOrCreateTripConversation(access: TripAccess) {
  const existing = await db.conversation.findUnique({
    where: { tripId_userId: { tripId: access.tripId, userId: access.userId } },
  });
  if (existing) return existing;
  return db.conversation.upsert({
    where: { tripId_userId: { tripId: access.tripId, userId: access.userId } },
    create: { tripId: access.tripId, userId: access.userId },
    update: {},
  });
}

export async function listMessages(
  conversationId: string,
  limit = MESSAGE_HISTORY_LIMIT,
) {
  const messages = await db.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      role: true,
      content: true,
      model: true,
      metadata: true,
      createdAt: true,
    },
  });
  return messages.reverse();
}

export async function listDraftConversations(userId: string) {
  return db.conversation.findMany({
    where: { userId, tripId: null, messages: { some: {} } },
    orderBy: { lastMessageAt: "desc" },
    take: 10,
    select: {
      id: true,
      startMode: true,
      draft: true,
      lastMessageAt: true,
      _count: { select: { messages: true } },
    },
  });
}

export function draftOf(conversation: {
  draft: Prisma.JsonValue | null;
}): TripDraft {
  return parseDraft(conversation.draft);
}

export async function deleteDraftConversation(
  userId: string,
  conversationId: string,
) {
  const result = await db.conversation.deleteMany({
    where: { id: conversationId, userId, tripId: null },
  });
  if (result.count === 0) throw notFound("We couldn't find that draft.");
}
