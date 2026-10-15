import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { TaskPriority, TaskStatus } from "@/generated/prisma/enums";
import { parseDateOnly } from "@/lib/dates";
import { TASK_STATUS_LABELS } from "@/lib/labels";
import type { TaskInput } from "@/lib/validation/task";
import { requireMemberOfTrip, type TripAccess } from "@/server/access";
import { logActivity } from "@/server/activity";
import { db, type DbTransaction } from "@/server/db";
import { conflict, forbidden, invalid, notFound } from "@/server/errors";

export const TASK_PAGE_SIZE = 100;

const TASK_INCLUDE = {
  assignee: {
    select: {
      id: true,
      user: { select: { id: true, name: true, image: true, email: true } },
    },
  },
  createdBy: { select: { id: true, name: true } },
  updatedBy: { select: { id: true, name: true } },
  relatedOption: { select: { id: true, title: true, category: true } },
  relatedBooking: { select: { id: true, title: true } },
  relatedEvent: { select: { id: true, title: true, date: true } },
} satisfies Prisma.TaskInclude;

export async function listTasks(access: TripAccess) {
  return db.task.findMany({
    where: { tripId: access.tripId },
    orderBy: [
      { status: "asc" },
      { priority: "desc" },
      { dueDate: "asc" },
      { createdAt: "desc" },
    ],
    take: TASK_PAGE_SIZE,
    include: TASK_INCLUDE,
  });
}

async function checkRelations(
  tx: DbTransaction,
  access: TripAccess,
  input: TaskInput,
) {
  if (input.assigneeMemberId)
    await requireMemberOfTrip(access.tripId, input.assigneeMemberId, tx);
  if (input.relatedOptionId) {
    const found = await tx.researchOption.count({
      where: { id: input.relatedOptionId, tripId: access.tripId },
    });
    if (!found) throw notFound("That option isn't part of this trip.");
  }
  if (input.relatedBookingId) {
    const found = await tx.booking.count({
      where: { id: input.relatedBookingId, tripId: access.tripId },
    });
    if (!found) throw notFound("That booking isn't part of this trip.");
  }
  if (input.relatedEventId) {
    const found = await tx.itineraryEvent.count({
      where: { id: input.relatedEventId, tripId: access.tripId },
    });
    if (!found) throw notFound("That itinerary item isn't part of this trip.");
  }
}

function taskData(input: TaskInput) {
  return {
    title: input.title,
    description: input.description,
    priority: input.priority,
    dueDate: input.dueDate ? parseDateOnly(input.dueDate) : null,
    assigneeMemberId: input.assigneeMemberId,
    relatedOptionId: input.relatedOptionId,
    relatedBookingId: input.relatedBookingId,
    relatedEventId: input.relatedEventId,
  };
}

export async function createTask(access: TripAccess, input: TaskInput) {
  return db.$transaction(async (tx) => {
    await checkRelations(tx, access, input);
    const task = await tx.task.create({
      data: {
        ...taskData(input),
        tripId: access.tripId,
        status: "OPEN",
        origin: "USER",
        createdById: access.userId,
        updatedById: access.userId,
      },
    });
    await logActivity(tx, {
      tripId: access.tripId,
      actorId: access.userId,
      type: "TASK_CREATED",
      summary: `added the task "${task.title}"`,
      entityType: "task",
      entityId: task.id,
    });
    return task;
  });
}

/** Atlas suggestions are stored as SUGGESTED and need a person to accept them. */
export async function suggestTask(
  access: TripAccess,
  input: {
    title: string;
    description: string | null;
    priority: TaskPriority;
    relatedOptionId: string | null;
  },
) {
  return db.$transaction(async (tx) => {
    const duplicate = await tx.task.findFirst({
      where: {
        tripId: access.tripId,
        title: { equals: input.title, mode: "insensitive" },
        status: { in: ["SUGGESTED", "OPEN", "IN_PROGRESS"] },
      },
      select: { id: true, status: true },
    });
    if (duplicate) return { task: null, duplicateOf: duplicate.id };
    if (input.relatedOptionId) {
      const found = await tx.researchOption.count({
        where: { id: input.relatedOptionId, tripId: access.tripId },
      });
      if (!found) throw notFound("That option isn't part of this trip.");
    }
    const task = await tx.task.create({
      data: {
        tripId: access.tripId,
        title: input.title,
        description: input.description,
        priority: input.priority,
        relatedOptionId: input.relatedOptionId,
        status: "SUGGESTED",
        origin: "ATLAS",
        createdById: access.userId,
        updatedById: access.userId,
      },
    });
    await logActivity(tx, {
      tripId: access.tripId,
      actorId: access.userId,
      type: "TASK_SUGGESTED",
      summary: `got an Atlas task suggestion: "${task.title}"`,
      entityType: "task",
      entityId: task.id,
    });
    return { task, duplicateOf: null };
  });
}

export async function updateTask(
  access: TripAccess,
  taskId: string,
  input: TaskInput,
  expectedVersion: number,
) {
  return db.$transaction(async (tx) => {
    const task = await tx.task.findFirst({
      where: { id: taskId, tripId: access.tripId },
    });
    if (!task) throw notFound();
    await checkRelations(tx, access, input);
    const result = await tx.task.updateMany({
      where: { id: task.id, tripId: access.tripId, version: expectedVersion },
      data: {
        ...taskData(input),
        version: { increment: 1 },
        updatedById: access.userId,
      },
    });
    if (result.count !== 1) throw conflict();
    await logActivity(tx, {
      tripId: access.tripId,
      actorId: access.userId,
      type: "TASK_UPDATED",
      summary:
        task.assigneeMemberId !== input.assigneeMemberId &&
        input.assigneeMemberId
          ? `assigned "${input.title}"`
          : `edited the task "${input.title}"`,
      entityType: "task",
      entityId: task.id,
    });
  });
}

export async function setTaskStatus(
  access: TripAccess,
  taskId: string,
  status: Exclude<TaskStatus, "SUGGESTED">,
) {
  return db.$transaction(async (tx) => {
    const task = await tx.task.findFirst({
      where: { id: taskId, tripId: access.tripId },
    });
    if (!task) throw notFound();
    if (task.status === "SUGGESTED")
      throw invalid("Accept this suggestion before changing its status.");
    if (task.status === status) return;
    await tx.task.update({
      where: { id: task.id },
      data: {
        status,
        completedAt: status === "COMPLETED" ? new Date() : null,
        version: { increment: 1 },
        updatedById: access.userId,
      },
    });
    await logActivity(tx, {
      tripId: access.tripId,
      actorId: access.userId,
      type: status === "COMPLETED" ? "TASK_COMPLETED" : "TASK_UPDATED",
      summary:
        status === "COMPLETED"
          ? `completed "${task.title}"`
          : `marked "${task.title}" as ${TASK_STATUS_LABELS[status].toLowerCase()}`,
      entityType: "task",
      entityId: task.id,
    });
  });
}

export async function assignTask(
  access: TripAccess,
  taskId: string,
  memberId: string | null,
) {
  return db.$transaction(async (tx) => {
    const task = await tx.task.findFirst({
      where: { id: taskId, tripId: access.tripId },
    });
    if (!task) throw notFound();
    if (memberId) await requireMemberOfTrip(access.tripId, memberId, tx);
    await tx.task.update({
      where: { id: task.id },
      data: {
        assigneeMemberId: memberId,
        version: { increment: 1 },
        updatedById: access.userId,
      },
    });
    await logActivity(tx, {
      tripId: access.tripId,
      actorId: access.userId,
      type: "TASK_UPDATED",
      summary: memberId
        ? `assigned "${task.title}"`
        : `unassigned "${task.title}"`,
      entityType: "task",
      entityId: task.id,
    });
  });
}

export async function reviewSuggestedTask(
  access: TripAccess,
  taskId: string,
  accept: boolean,
) {
  return db.$transaction(async (tx) => {
    const task = await tx.task.findFirst({
      where: { id: taskId, tripId: access.tripId },
    });
    if (!task) throw notFound();
    if (task.status !== "SUGGESTED")
      throw conflict("This suggestion was already reviewed.");
    if (accept) {
      await tx.task.update({
        where: { id: task.id },
        data: {
          status: "OPEN",
          version: { increment: 1 },
          updatedById: access.userId,
        },
      });
    } else {
      await tx.task.delete({ where: { id: task.id } });
    }
    await logActivity(tx, {
      tripId: access.tripId,
      actorId: access.userId,
      type: accept ? "SUGGESTION_ACCEPTED" : "SUGGESTION_DISMISSED",
      summary: `${accept ? "accepted" : "dismissed"} Atlas's task suggestion "${task.title}"`,
      entityType: "task",
      entityId: task.id,
    });
  });
}

export async function deleteTask(access: TripAccess, taskId: string) {
  await db.$transaction(async (tx) => {
    const task = await tx.task.findFirst({
      where: { id: taskId, tripId: access.tripId },
    });
    if (!task) throw notFound();
    if (!access.isOrganizer && task.createdById !== access.userId) {
      throw forbidden(
        "Only the person who created this task or an organizer can delete it.",
      );
    }
    await tx.task.delete({ where: { id: task.id } });
    await logActivity(tx, {
      tripId: access.tripId,
      actorId: access.userId,
      type: "TASK_REMOVED",
      summary: `deleted the task "${task.title}"`,
      entityType: "task",
      entityId: task.id,
    });
  });
}
