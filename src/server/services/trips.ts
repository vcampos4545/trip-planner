import "server-only";

import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import type { TripStage, TripStartMode } from "@/generated/prisma/enums";
import { parseDateOnly } from "@/lib/dates";
import type { TripProgress } from "@/lib/domain/next-action";
import {
  applyChanges,
  classifyPatch,
  crossFieldProblem,
  deriveTitle,
  type CandidateDestination,
  type FieldChange,
  type PreferenceInput,
  type TripDetails,
  type TripDetailsPatch,
  type TripDraft,
  tripDetailsSchema,
  TRIP_DETAIL_FIELDS,
} from "@/lib/domain/trip-details";
import type { quickTripFormSchema } from "@/lib/validation/trip";
import {
  requireOrganizer,
  requireTripAccess,
  type TripAccess,
} from "@/server/access";
import { logActivity } from "@/server/activity";
import { db, type DbTransaction } from "@/server/db";
import { conflict, invalid, notFound } from "@/server/errors";

import {
  describeFields,
  detailsToTripData,
  FIELD_LABELS,
  tripToDetails,
} from "./trip-mapping";

const MEMBER_USER_SELECT = {
  id: true,
  role: true,
  joinedAt: true,
  user: { select: { id: true, name: true, email: true, image: true } },
} as const;

export const DASHBOARD_TRIP_LIMIT = 50;

export async function listTripsForUser(userId: string) {
  const memberships = await db.tripMember.findMany({
    where: { userId },
    orderBy: { trip: { updatedAt: "desc" } },
    take: DASHBOARD_TRIP_LIMIT,
    select: {
      id: true,
      role: true,
      trip: {
        include: {
          members: { select: MEMBER_USER_SELECT, orderBy: { joinedAt: "asc" } },
        },
      },
    },
  });
  return Promise.all(
    memberships.map(async (membership) => {
      const access: TripAccess = {
        tripId: membership.trip.id,
        userId,
        memberId: membership.id,
        role: membership.role,
        isOrganizer: membership.role === "ORGANIZER",
      };
      return {
        trip: membership.trip,
        role: membership.role,
        progress: await getTripProgress(access),
      };
    }),
  );
}

export async function getTripProgress(
  access: TripAccess,
): Promise<TripProgress> {
  const { tripId, userId, memberId } = access;
  const [
    trip,
    memberCount,
    candidateCount,
    pendingProposals,
    suggestedTasks,
    suggestedEvents,
    openDecisions,
    myOpenTasks,
    unassignedOpenTasks,
    lodgingBookings,
    itineraryCount,
  ] = await Promise.all([
    db.trip.findUniqueOrThrow({
      where: { id: tripId },
      select: {
        destination: true,
        startDate: true,
        dateNotes: true,
        durationDays: true,
        lodgingStatus: true,
        flightsStatus: true,
      },
    }),
    db.tripMember.count({ where: { tripId } }),
    db.researchOption.count({
      where: {
        tripId,
        category: "DESTINATION",
        status: { in: ["SUGGESTED", "SHORTLISTED", "APPROVED"] },
      },
    }),
    db.tripDetailProposal.count({ where: { tripId, status: "PENDING" } }),
    db.task.count({ where: { tripId, status: "SUGGESTED" } }),
    db.itineraryEvent.count({ where: { tripId, status: "SUGGESTED" } }),
    db.decision.findMany({
      where: { tripId, status: "OPEN", votes: { none: { userId } } },
      select: { id: true, title: true },
      orderBy: { createdAt: "asc" },
      take: 3,
    }),
    db.task.findMany({
      where: {
        tripId,
        assigneeMemberId: memberId,
        status: { in: ["OPEN", "IN_PROGRESS"] },
      },
      select: { id: true, title: true },
      orderBy: [{ priority: "desc" }, { dueDate: "asc" }],
      take: 5,
    }),
    db.task.count({
      where: {
        tripId,
        assigneeMemberId: null,
        status: { in: ["OPEN", "IN_PROGRESS"] },
      },
    }),
    db.booking.count({
      where: {
        tripId,
        category: "ACCOMMODATION",
        status: { not: "CANCELLED" },
      },
    }),
    db.itineraryEvent.count({
      where: { tripId, status: { in: ["PLANNED", "CONFIRMED"] } },
    }),
  ]);
  return {
    tripId,
    hasDestination: Boolean(trip.destination),
    candidateCount,
    hasDates: Boolean(trip.startDate),
    hasTimingNotes: Boolean(trip.dateNotes || trip.durationDays),
    memberCount,
    pendingProposals,
    suggestedTasks,
    suggestedEvents,
    decisionsAwaitingMyVote: openDecisions,
    myOpenTasks,
    unassignedOpenTasks,
    lodgingStatus: trip.lodgingStatus,
    flightsStatus: trip.flightsStatus,
    lodgingBookings,
    itineraryCount,
  };
}

/** Trip header data shared by every workspace tab. */
export async function getTripWorkspace(tripId: string, userId: string) {
  const access = await requireTripAccess(tripId, userId);
  const trip = await db.trip.findUniqueOrThrow({
    where: { id: tripId },
    include: {
      members: { select: MEMBER_USER_SELECT, orderBy: { joinedAt: "asc" } },
      updatedBy: { select: { id: true, name: true } },
    },
  });
  return { access, trip };
}

export async function getTripDetails(access: TripAccess) {
  const trip = await db.trip.findUniqueOrThrow({
    where: { id: access.tripId },
  });
  return {
    details: tripToDetails(trip),
    version: trip.version,
    stage: trip.stage,
    trip,
  };
}

export async function listPreferences(access: TripAccess) {
  return db.tripPreference.findMany({
    where: { tripId: access.tripId },
    orderBy: [{ strength: "asc" }, { createdAt: "asc" }],
    include: {
      member: { select: { id: true, user: { select: { name: true } } } },
    },
  });
}

async function createOrganizerTrip(
  tx: DbTransaction,
  params: {
    userId: string;
    startMode: TripStartMode;
    data: Omit<Prisma.TripUncheckedCreateInput, "createdById" | "startMode">;
  },
) {
  const trip = await tx.trip.create({
    data: {
      ...params.data,
      startMode: params.startMode,
      createdById: params.userId,
      updatedById: params.userId,
    },
  });
  await tx.tripMember.create({
    data: { tripId: trip.id, userId: params.userId, role: "ORGANIZER" },
  });
  await logActivity(tx, {
    tripId: trip.id,
    actorId: params.userId,
    type: "TRIP_CREATED",
    summary: `created the trip "${trip.title}"`,
    entityType: "trip",
    entityId: trip.id,
  });
  return trip;
}

export async function createManualTrip(
  userId: string,
  input: z.output<typeof quickTripFormSchema>,
) {
  return db.$transaction((tx) =>
    createOrganizerTrip(tx, {
      userId,
      startMode: "MANUAL",
      data: {
        title: input.title,
        destination: input.destination,
        startDate: input.startDate ? parseDateOnly(input.startDate) : null,
        endDate: input.endDate ? parseDateOnly(input.endDate) : null,
        dateFlexibility: input.startDate ? "FIXED" : "UNKNOWN",
      },
    }),
  );
}

/** Creates a trip from a conversation draft, inside the caller's transaction. */
export async function createTripFromDraft(
  tx: DbTransaction,
  params: { userId: string; startMode: TripStartMode; draft: TripDraft },
) {
  const { draft, userId } = params;
  const details: TripDetails = {
    ...draft.details,
    title: deriveTitle(draft, params.startMode),
  };
  const problem = crossFieldProblem(details);
  if (problem) {
    details.endDate = null;
  }
  const data = detailsToTripData(details) as Omit<
    Prisma.TripUncheckedCreateInput,
    "createdById" | "startMode"
  >;
  const trip = await createOrganizerTrip(tx, {
    userId,
    startMode: params.startMode,
    data: { ...data, title: details.title! },
  });
  await addPreferencesTx(tx, trip.id, userId, draft.preferences, "ATLAS");
  await addCandidatesTx(tx, trip.id, userId, draft.candidateDestinations);
  return trip;
}

export async function updateTripDetails(
  access: TripAccess,
  details: TripDetails,
  expectedVersion: number,
) {
  const parsed = tripDetailsSchema.parse(details);
  const problem = crossFieldProblem(parsed);
  if (problem) throw invalid(problem);
  return db.$transaction(async (tx) => {
    const current = await tx.trip.findUniqueOrThrow({
      where: { id: access.tripId },
    });
    if (current.version !== expectedVersion) throw conflict();
    const before = tripToDetails(current);
    const changed = TRIP_DETAIL_FIELDS.filter(
      (field) =>
        JSON.stringify(before[field]) !== JSON.stringify(parsed[field]),
    );
    if (changed.length === 0) return current;
    const result = await tx.trip.updateMany({
      where: { id: access.tripId, version: expectedVersion },
      data: {
        ...detailsToTripData(parsed),
        version: { increment: 1 },
        updatedById: access.userId,
      },
    });
    if (result.count !== 1) throw conflict();
    await logActivity(tx, {
      tripId: access.tripId,
      actorId: access.userId,
      type: "TRIP_UPDATED",
      summary: `updated the ${describeFields(changed)}`,
      entityType: "trip",
      entityId: access.tripId,
      metadata: { fields: changed },
    });
    return tx.trip.findUniqueOrThrow({ where: { id: access.tripId } });
  });
}

export async function setTripStage(access: TripAccess, stage: TripStage) {
  return db.$transaction(async (tx) => {
    const trip = await tx.trip.update({
      where: { id: access.tripId },
      data: { stage, version: { increment: 1 }, updatedById: access.userId },
    });
    await logActivity(tx, {
      tripId: access.tripId,
      actorId: access.userId,
      type: "TRIP_UPDATED",
      summary: `set the planning status to ${stage.toLowerCase()}`,
      entityType: "trip",
      entityId: access.tripId,
    });
    return trip;
  });
}

export async function deleteTrip(tripId: string, userId: string) {
  await requireOrganizer(tripId, userId);
  await db.trip.delete({ where: { id: tripId } });
}

// ---------------------------------------------------------------------------
// Preferences and destination candidates
// ---------------------------------------------------------------------------

async function addPreferencesTx(
  tx: DbTransaction,
  tripId: string,
  userId: string,
  preferences: PreferenceInput[],
  origin: "USER" | "ATLAS",
  memberId: string | null = null,
) {
  if (preferences.length === 0) return [];
  const existing = await tx.tripPreference.findMany({
    where: { tripId },
    select: { kind: true, description: true },
  });
  const keys = new Set(
    existing.map(
      (item) => `${item.kind}:${item.description.trim().toLowerCase()}`,
    ),
  );
  const fresh = preferences.filter((item) => {
    const key = `${item.kind}:${item.description.trim().toLowerCase()}`;
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  });
  if (fresh.length === 0) return [];
  await tx.tripPreference.createMany({
    data: fresh.map((item) => ({
      ...item,
      tripId,
      origin,
      memberId,
      createdById: userId,
    })),
  });
  return fresh;
}

async function addCandidatesTx(
  tx: DbTransaction,
  tripId: string,
  userId: string,
  candidates: CandidateDestination[],
) {
  if (candidates.length === 0) return [];
  const existing = await tx.researchOption.findMany({
    where: { tripId, category: "DESTINATION" },
    select: { title: true },
  });
  const titles = new Set(
    existing.map((item) => item.title.trim().toLowerCase()),
  );
  const fresh = candidates.filter((candidate) => {
    const key = candidate.name.trim().toLowerCase();
    if (titles.has(key)) return false;
    titles.add(key);
    return true;
  });
  for (const candidate of fresh) {
    const option = await tx.researchOption.create({
      data: {
        tripId,
        category: "DESTINATION",
        title: candidate.name,
        rationale: candidate.reason,
        origin: candidate.suggestedBy === "atlas" ? "ATLAS" : "USER",
        status: "SUGGESTED",
        createdById: userId,
        updatedById: userId,
      },
    });
    await logActivity(tx, {
      tripId,
      actorId: userId,
      type: "OPTION_ADDED",
      summary: `added "${option.title}" as a destination idea`,
      entityType: "option",
      entityId: option.id,
    });
  }
  return fresh;
}

export async function addPreference(
  access: TripAccess,
  input: PreferenceInput & { memberId: string | null },
) {
  return db.$transaction(async (tx) => {
    if (input.memberId) {
      const member = await tx.tripMember.findFirst({
        where: { id: input.memberId, tripId: access.tripId },
      });
      if (!member) throw notFound("That person isn't a member of this trip.");
    }
    const preference = await tx.tripPreference.create({
      data: {
        tripId: access.tripId,
        kind: input.kind,
        strength: input.strength,
        description: input.description,
        memberId: input.memberId,
        origin: "USER",
        createdById: access.userId,
      },
    });
    await logActivity(tx, {
      tripId: access.tripId,
      actorId: access.userId,
      type: "PREFERENCE_ADDED",
      summary: `added a ${input.strength === "REQUIREMENT" ? "requirement" : "preference"}: ${input.description}`,
      entityType: "preference",
      entityId: preference.id,
    });
    return preference;
  });
}

export async function removePreference(
  access: TripAccess,
  preferenceId: string,
) {
  return db.$transaction(async (tx) => {
    const preference = await tx.tripPreference.findFirst({
      where: { id: preferenceId, tripId: access.tripId },
    });
    if (!preference) throw notFound();
    await tx.tripPreference.delete({ where: { id: preference.id } });
    await logActivity(tx, {
      tripId: access.tripId,
      actorId: access.userId,
      type: "PREFERENCE_REMOVED",
      summary: `removed "${preference.description}"`,
      entityType: "preference",
      entityId: preference.id,
    });
  });
}

// ---------------------------------------------------------------------------
// Atlas updates and proposals
// ---------------------------------------------------------------------------

export type AtlasPatchResult = {
  applied: FieldChange[];
  proposal: { id: string; summary: string; changes: FieldChange[] } | null;
  rejected: string[];
  addedPreferences: number;
  addedCandidates: number;
};

const proposalChangesSchema = z.array(
  z.object({
    field: z.enum(
      TRIP_DETAIL_FIELDS as [keyof TripDetails, ...(keyof TripDetails)[]],
    ),
    from: z.unknown(),
    to: z.unknown(),
  }),
);

function formatValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "not set";
  if (Array.isArray(value))
    return value.length ? value.join(", ").toLowerCase() : "not set";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "string" && value.length > 3 && /^[A-Z_]+$/.test(value))
    return value.replaceAll("_", " ").toLowerCase();
  return String(value);
}

export function describeChange(change: FieldChange) {
  return `${FIELD_LABELS[change.field]}: ${formatValue(change.from)} → ${formatValue(change.to)}`;
}

/**
 * Applies a validated patch from Atlas. Unknown fields are filled. Values someone already set are
 * never overwritten here; they become a pending proposal that a member must accept.
 */
export async function applyAtlasPatch(
  access: TripAccess,
  params: {
    patch: TripDetailsPatch;
    preferences: PreferenceInput[];
    candidates: CandidateDestination[];
    conversationId: string | null;
  },
): Promise<AtlasPatchResult> {
  return db.$transaction(async (tx) => {
    const trip = await tx.trip.findUniqueOrThrow({
      where: { id: access.tripId },
    });
    const current = tripToDetails(trip);
    const { fills, overwrites } = classifyPatch(current, params.patch);
    const rejected: string[] = [];

    let applied = fills;
    const candidate = applyChanges(current, fills);
    const problem = crossFieldProblem(candidate);
    if (problem) {
      rejected.push(problem);
      applied = fills.filter(
        (change) => change.field !== "startDate" && change.field !== "endDate",
      );
    }

    if (applied.length > 0) {
      const data = detailsToTripData(
        Object.fromEntries(applied.map((change) => [change.field, change.to])),
      );
      const result = await tx.trip.updateMany({
        where: { id: trip.id, version: trip.version },
        data: {
          ...data,
          version: { increment: 1 },
          updatedById: access.userId,
        },
      });
      if (result.count !== 1)
        throw conflict(
          "The trip changed while Atlas was working. Please send your message again.",
        );
      await logActivity(tx, {
        tripId: trip.id,
        actorId: access.userId,
        type: "TRIP_UPDATED",
        summary: `added the ${describeFields(applied.map((change) => change.field))} via Atlas`,
        entityType: "trip",
        entityId: trip.id,
        metadata: {
          fields: applied.map((change) => change.field),
          via: "atlas",
        },
      });
    }

    let proposal: AtlasPatchResult["proposal"] = null;
    if (overwrites.length > 0) {
      const summary = overwrites.map(describeChange).join("; ");
      const duplicate = await tx.tripDetailProposal.findFirst({
        where: { tripId: trip.id, status: "PENDING", summary },
        select: { id: true },
      });
      if (duplicate) {
        proposal = { id: duplicate.id, summary, changes: overwrites };
      } else {
        const created = await tx.tripDetailProposal.create({
          data: {
            tripId: trip.id,
            conversationId: params.conversationId,
            proposedById: access.userId,
            summary,
            changes: overwrites as unknown as Prisma.InputJsonValue,
          },
        });
        await logActivity(tx, {
          tripId: trip.id,
          actorId: access.userId,
          type: "PROPOSAL_CREATED",
          summary: `got an Atlas proposal to change the ${describeFields(overwrites.map((change) => change.field))}`,
          entityType: "proposal",
          entityId: created.id,
        });
        proposal = { id: created.id, summary, changes: overwrites };
      }
    }

    const addedPreferences = await addPreferencesTx(
      tx,
      trip.id,
      access.userId,
      params.preferences,
      "ATLAS",
    );
    const addedCandidates = await addCandidatesTx(
      tx,
      trip.id,
      access.userId,
      params.candidates,
    );

    return {
      applied,
      proposal,
      rejected,
      addedPreferences: addedPreferences.length,
      addedCandidates: addedCandidates.length,
    };
  });
}

export async function listPendingProposals(access: TripAccess) {
  const proposals = await db.tripDetailProposal.findMany({
    where: { tripId: access.tripId, status: "PENDING" },
    orderBy: { createdAt: "asc" },
    include: { proposedBy: { select: { id: true, name: true } } },
    take: 20,
  });
  return proposals.map((proposal) => {
    const parsed = proposalChangesSchema.safeParse(proposal.changes);
    return {
      id: proposal.id,
      summary: proposal.summary,
      createdAt: proposal.createdAt,
      proposedBy: proposal.proposedBy,
      changes: parsed.success
        ? (parsed.data as FieldChange[]).map((change) => ({
            ...change,
            label: describeChange(change),
          }))
        : [],
    };
  });
}

export async function resolveProposal(
  access: TripAccess,
  proposalId: string,
  accept: boolean,
) {
  return db.$transaction(async (tx) => {
    const proposal = await tx.tripDetailProposal.findFirst({
      where: { id: proposalId, tripId: access.tripId },
    });
    if (!proposal) throw notFound();
    if (proposal.status !== "PENDING")
      throw conflict("This proposal was already handled.");

    if (accept) {
      const parsed = proposalChangesSchema.safeParse(proposal.changes);
      if (!parsed.success) throw invalid("This proposal is no longer valid.");
      const changes: FieldChange[] = [];
      for (const change of parsed.data) {
        const value = tripDetailsSchema.shape[change.field].safeParse(
          change.to,
        );
        if (!value.success)
          throw invalid("This proposal contains an invalid value.");
        changes.push({
          field: change.field,
          from: change.from,
          to: value.data,
        });
      }
      const trip = await tx.trip.findUniqueOrThrow({
        where: { id: access.tripId },
      });
      const next = applyChanges(tripToDetails(trip), changes);
      const problem = crossFieldProblem(next);
      if (problem) throw invalid(`${problem} Edit the trip details instead.`);
      const data = detailsToTripData(
        Object.fromEntries(changes.map((change) => [change.field, change.to])),
      );
      const result = await tx.trip.updateMany({
        where: { id: trip.id, version: trip.version },
        data: {
          ...data,
          version: { increment: 1 },
          updatedById: access.userId,
        },
      });
      if (result.count !== 1) throw conflict();
    }

    await tx.tripDetailProposal.update({
      where: { id: proposal.id },
      data: {
        status: accept ? "ACCEPTED" : "REJECTED",
        resolvedById: access.userId,
        resolvedAt: new Date(),
      },
    });
    await logActivity(tx, {
      tripId: access.tripId,
      actorId: access.userId,
      type: accept ? "PROPOSAL_ACCEPTED" : "PROPOSAL_REJECTED",
      summary: `${accept ? "accepted" : "declined"} Atlas's proposal (${proposal.summary})`,
      entityType: "proposal",
      entityId: proposal.id,
    });
  });
}
