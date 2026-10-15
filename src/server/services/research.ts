import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type {
  OptionCategory,
  OptionStatus,
  RecordOrigin,
} from "@/generated/prisma/enums";
import { OPTION_STATUS_LABELS } from "@/lib/labels";
import { checkOptionTransition } from "@/lib/domain/status-rules";
import type { DecisionInput, OptionInput } from "@/lib/validation/research";
import { requireOrganizer, type TripAccess } from "@/server/access";
import { logActivity } from "@/server/activity";
import { db, type DbTransaction } from "@/server/db";
import { conflict, forbidden, invalid, notFound } from "@/server/errors";

export const OPTION_PAGE_SIZE = 60;

const OPTION_INCLUDE = {
  createdBy: { select: { id: true, name: true } },
  updatedBy: { select: { id: true, name: true } },
  notes: {
    orderBy: { createdAt: "asc" },
    take: 50,
    include: { author: { select: { id: true, name: true, image: true } } },
  },
  bookings: { select: { id: true, status: true, title: true } },
  _count: { select: { notes: true } },
} satisfies Prisma.ResearchOptionInclude;

export type OptionFilters = {
  category?: OptionCategory | null;
  status?: OptionStatus | "ACTIVE" | null;
  query?: string | null;
};

export async function listOptions(
  access: TripAccess,
  filters: OptionFilters = {},
) {
  const where: Prisma.ResearchOptionWhereInput = { tripId: access.tripId };
  if (filters.category) where.category = filters.category;
  if (filters.status === "ACTIVE")
    where.status = { notIn: ["REJECTED", "CANCELLED"] };
  else if (filters.status) where.status = filters.status;
  const query = filters.query?.trim();
  if (query) {
    where.OR = [
      { title: { contains: query, mode: "insensitive" } },
      { description: { contains: query, mode: "insensitive" } },
      { locationName: { contains: query, mode: "insensitive" } },
    ];
  }
  return db.researchOption.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }],
    take: OPTION_PAGE_SIZE,
    include: OPTION_INCLUDE,
  });
}

export async function getOption(access: TripAccess, optionId: string) {
  const option = await db.researchOption.findFirst({
    where: { id: optionId, tripId: access.tripId },
    include: OPTION_INCLUDE,
  });
  if (!option) throw notFound();
  return option;
}

type ProvenanceInput = {
  origin: RecordOrigin;
  retrievedAt?: Date | null;
  providerPayload?: Prisma.InputJsonValue;
  rationale?: string | null;
};

function optionData(input: OptionInput) {
  return {
    category: input.category,
    title: input.title,
    description: input.description,
    url: input.url,
    sourceName: input.sourceName,
    priceAmount: input.priceAmount,
    priceCurrency: input.priceAmount ? input.priceCurrency : null,
    priceUnit: input.priceUnit,
    priceNote: input.priceNote,
    locationName: input.locationName,
    address: input.address,
    latitude: input.latitude,
    longitude: input.longitude,
  };
}

export async function createOption(
  access: TripAccess,
  input: OptionInput,
  provenance: ProvenanceInput = { origin: "USER" },
) {
  return db.$transaction(async (tx) => {
    const option = await tx.researchOption.create({
      data: {
        ...optionData(input),
        tripId: access.tripId,
        origin: provenance.origin,
        retrievedAt: provenance.retrievedAt ?? null,
        providerPayload: provenance.providerPayload,
        rationale: provenance.rationale ?? null,
        status: "SUGGESTED",
        createdById: access.userId,
        updatedById: access.userId,
      },
    });
    await logActivity(tx, {
      tripId: access.tripId,
      actorId: access.userId,
      type: "OPTION_ADDED",
      summary:
        provenance.origin === "ATLAS"
          ? `saved Atlas's suggestion "${option.title}"`
          : `saved the option "${option.title}"`,
      entityType: "option",
      entityId: option.id,
    });
    return option;
  });
}

export async function updateOption(
  access: TripAccess,
  optionId: string,
  input: OptionInput,
  expectedVersion: number,
) {
  return db.$transaction(async (tx) => {
    const option = await tx.researchOption.findFirst({
      where: { id: optionId, tripId: access.tripId },
    });
    if (!option) throw notFound();
    const result = await tx.researchOption.updateMany({
      where: { id: option.id, tripId: access.tripId, version: expectedVersion },
      data: {
        ...optionData(input),
        version: { increment: 1 },
        updatedById: access.userId,
      },
    });
    if (result.count !== 1) throw conflict();
    await logActivity(tx, {
      tripId: access.tripId,
      actorId: access.userId,
      type: "OPTION_UPDATED",
      summary: `edited the option "${input.title}"`,
      entityType: "option",
      entityId: option.id,
    });
  });
}

async function setOptionStatusTx(
  tx: DbTransaction,
  access: TripAccess,
  optionId: string,
  status: OptionStatus,
) {
  const option = await tx.researchOption.findFirst({
    where: { id: optionId, tripId: access.tripId },
  });
  if (!option) throw notFound();
  if (option.status === status) return option;
  const check = checkOptionTransition(option.status, status, access.role);
  if (!check.ok) throw invalid(check.reason);
  const updated = await tx.researchOption.update({
    where: { id: option.id },
    data: { status, version: { increment: 1 }, updatedById: access.userId },
  });
  await logActivity(tx, {
    tripId: access.tripId,
    actorId: access.userId,
    type: "OPTION_STATUS_CHANGED",
    summary: `marked "${option.title}" as ${OPTION_STATUS_LABELS[status].toLowerCase()}`,
    entityType: "option",
    entityId: option.id,
    metadata: { from: option.status, to: status },
  });
  return updated;
}

export async function setOptionStatus(
  access: TripAccess,
  optionId: string,
  status: OptionStatus,
) {
  return db.$transaction((tx) =>
    setOptionStatusTx(tx, access, optionId, status),
  );
}

export async function deleteOption(access: TripAccess, optionId: string) {
  await db.$transaction(async (tx) => {
    const option = await tx.researchOption.findFirst({
      where: { id: optionId, tripId: access.tripId },
    });
    if (!option) throw notFound();
    if (!access.isOrganizer && option.createdById !== access.userId) {
      throw forbidden(
        "Only the person who added this option or an organizer can delete it.",
      );
    }
    if (option.status === "BOOKED")
      throw invalid(
        "This option has a booking. Remove or cancel the booking first.",
      );
    await tx.researchOption.delete({ where: { id: option.id } });
    await logActivity(tx, {
      tripId: access.tripId,
      actorId: access.userId,
      type: "OPTION_REMOVED",
      summary: `deleted the option "${option.title}"`,
      entityType: "option",
      entityId: option.id,
    });
  });
}

export async function addOptionNote(
  access: TripAccess,
  optionId: string,
  body: string,
) {
  return db.$transaction(async (tx) => {
    const option = await tx.researchOption.findFirst({
      where: { id: optionId, tripId: access.tripId },
    });
    if (!option) throw notFound();
    const note = await tx.optionNote.create({
      data: { optionId: option.id, authorId: access.userId, body },
    });
    await logActivity(tx, {
      tripId: access.tripId,
      actorId: access.userId,
      type: "OPTION_NOTE_ADDED",
      summary: `commented on "${option.title}"`,
      entityType: "option",
      entityId: option.id,
    });
    return note;
  });
}

// ---------------------------------------------------------------------------
// Decisions and votes
// ---------------------------------------------------------------------------

export async function listDecisions(access: TripAccess) {
  return db.decision.findMany({
    where: { tripId: access.tripId },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 30,
    include: {
      choices: {
        orderBy: { position: "asc" },
        include: {
          option: {
            select: {
              id: true,
              title: true,
              status: true,
              category: true,
              url: true,
            },
          },
          votes: {
            select: {
              userId: true,
              user: { select: { id: true, name: true, image: true } },
            },
          },
        },
      },
      createdBy: { select: { id: true, name: true } },
      resolvedBy: { select: { id: true, name: true } },
    },
  });
}

export async function createDecision(access: TripAccess, input: DecisionInput) {
  return db.$transaction(async (tx) => {
    const optionIds = input.choices
      .map((choice) => choice.researchOptionId)
      .filter((id): id is string => Boolean(id));
    if (optionIds.length > 0) {
      const found = await tx.researchOption.count({
        where: { tripId: access.tripId, id: { in: optionIds } },
      });
      if (found !== new Set(optionIds).size)
        throw notFound("One of those options isn't part of this trip.");
    }
    const decision = await tx.decision.create({
      data: {
        tripId: access.tripId,
        title: input.title,
        description: input.description,
        createdById: access.userId,
        choices: {
          create: input.choices.map((choice, index) => ({
            label: choice.label,
            researchOptionId: choice.researchOptionId,
            position: index,
          })),
        },
      },
    });
    await logActivity(tx, {
      tripId: access.tripId,
      actorId: access.userId,
      type: "DECISION_CREATED",
      summary: `started a vote: ${decision.title}`,
      entityType: "decision",
      entityId: decision.id,
    });
    return decision;
  });
}

export async function castVote(
  access: TripAccess,
  decisionId: string,
  choiceId: string | null,
) {
  return db.$transaction(async (tx) => {
    const decision = await tx.decision.findFirst({
      where: { id: decisionId, tripId: access.tripId },
      include: { choices: { select: { id: true, label: true } } },
    });
    if (!decision) throw notFound();
    if (decision.status !== "OPEN")
      throw conflict("Voting is closed for this decision.");
    if (choiceId === null) {
      await tx.vote.deleteMany({
        where: { decisionId: decision.id, userId: access.userId },
      });
      return;
    }
    const choice = decision.choices.find((item) => item.id === choiceId);
    if (!choice) throw notFound("That choice isn't part of this decision.");
    await tx.vote.upsert({
      where: {
        decisionId_userId: { decisionId: decision.id, userId: access.userId },
      },
      create: {
        decisionId: decision.id,
        choiceId: choice.id,
        userId: access.userId,
      },
      update: { choiceId: choice.id },
    });
    await logActivity(tx, {
      tripId: access.tripId,
      actorId: access.userId,
      type: "VOTE_CAST",
      summary: `voted on "${decision.title}"`,
      entityType: "decision",
      entityId: decision.id,
    });
  });
}

/**
 * Organizer closes a decision. The winning option becomes "approved", which is still not a
 * booking: bookings are recorded separately.
 */
export async function resolveDecision(
  tripId: string,
  userId: string,
  decisionId: string,
  params: { choiceId: string; note: string | null },
) {
  const access = await requireOrganizer(tripId, userId);
  return db.$transaction(async (tx) => {
    const decision = await tx.decision.findFirst({
      where: { id: decisionId, tripId: access.tripId },
      include: { choices: { include: { option: true } } },
    });
    if (!decision) throw notFound();
    if (decision.status !== "OPEN")
      throw conflict("This decision is already closed.");
    const choice = decision.choices.find((item) => item.id === params.choiceId);
    if (!choice) throw notFound("That choice isn't part of this decision.");

    await tx.decision.update({
      where: { id: decision.id },
      data: {
        status: "RESOLVED",
        chosenChoiceId: choice.id,
        resolutionNote: params.note,
        resolvedById: userId,
        resolvedAt: new Date(),
      },
    });
    if (
      choice.option &&
      ["SUGGESTED", "SHORTLISTED"].includes(choice.option.status)
    ) {
      if (choice.option.status === "SUGGESTED") {
        await setOptionStatusTx(tx, access, choice.option.id, "SHORTLISTED");
      }
      await setOptionStatusTx(tx, access, choice.option.id, "APPROVED");
    }
    await logActivity(tx, {
      tripId: access.tripId,
      actorId: userId,
      type: "DECISION_RESOLVED",
      summary: `decided "${decision.title}": ${choice.label}`,
      entityType: "decision",
      entityId: decision.id,
    });
  });
}

export async function cancelDecision(
  tripId: string,
  userId: string,
  decisionId: string,
) {
  const access = await requireOrganizer(tripId, userId);
  await db.$transaction(async (tx) => {
    const decision = await tx.decision.findFirst({
      where: { id: decisionId, tripId: access.tripId },
    });
    if (!decision) throw notFound();
    if (decision.status !== "OPEN")
      throw conflict("This decision is already closed.");
    await tx.decision.update({
      where: { id: decision.id },
      data: {
        status: "CANCELLED",
        resolvedById: userId,
        resolvedAt: new Date(),
      },
    });
    await logActivity(tx, {
      tripId: access.tripId,
      actorId: userId,
      type: "DECISION_CANCELLED",
      summary: `closed the vote "${decision.title}" without a decision`,
      entityType: "decision",
      entityId: decision.id,
    });
  });
}
