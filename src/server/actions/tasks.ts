"use server";

import { z } from "zod";

import type { ActionResult } from "@/lib/action-result";
import { taskFormSchema, taskStatusSchema } from "@/lib/validation/task";
import { requireTripAccess } from "@/server/access";
import {
  assignTask,
  createTask,
  deleteTask,
  reviewSuggestedTask,
  setTaskStatus,
  updateTask,
} from "@/server/services/tasks";

import { revalidateTrip } from "./revalidate";
import { runAction } from "./run-action";

const id = z.string().min(1).max(64);

export async function createTaskAction(
  tripId: string,
  raw: unknown,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async (user) => {
    const access = await requireTripAccess(tripId, user.id);
    const task = await createTask(access, taskFormSchema.parse(raw));
    revalidateTrip(tripId);
    return { id: task.id };
  });
}

export async function updateTaskAction(
  tripId: string,
  taskId: string,
  raw: unknown,
  version: number,
): Promise<ActionResult> {
  return runAction(async (user) => {
    const access = await requireTripAccess(tripId, user.id);
    await updateTask(
      access,
      id.parse(taskId),
      taskFormSchema.parse(raw),
      z.number().int().parse(version),
    );
    revalidateTrip(tripId);
    return null;
  });
}

export async function setTaskStatusAction(
  tripId: string,
  taskId: string,
  status: unknown,
): Promise<ActionResult> {
  return runAction(async (user) => {
    const access = await requireTripAccess(tripId, user.id);
    await setTaskStatus(
      access,
      id.parse(taskId),
      taskStatusSchema.parse(status),
    );
    revalidateTrip(tripId);
    return null;
  });
}

export async function assignTaskAction(
  tripId: string,
  taskId: string,
  memberId: string | null,
): Promise<ActionResult> {
  return runAction(async (user) => {
    const access = await requireTripAccess(tripId, user.id);
    await assignTask(
      access,
      id.parse(taskId),
      memberId === null ? null : id.parse(memberId),
    );
    revalidateTrip(tripId);
    return null;
  });
}

export async function reviewTaskSuggestionAction(
  tripId: string,
  taskId: string,
  accept: boolean,
): Promise<ActionResult> {
  return runAction(async (user) => {
    const access = await requireTripAccess(tripId, user.id);
    await reviewSuggestedTask(
      access,
      id.parse(taskId),
      z.boolean().parse(accept),
    );
    revalidateTrip(tripId);
    return null;
  });
}

export async function deleteTaskAction(
  tripId: string,
  taskId: string,
): Promise<ActionResult> {
  return runAction(async (user) => {
    const access = await requireTripAccess(tripId, user.id);
    await deleteTask(access, id.parse(taskId));
    revalidateTrip(tripId);
    return null;
  });
}
