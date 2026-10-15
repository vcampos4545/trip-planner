import { z } from "zod";

import { TaskPriority, TaskStatus } from "@/generated/prisma/enums";

import {
  optionalDate,
  optionalEntityId,
  optionalText,
  requiredText,
} from "./fields";

export const taskFormSchema = z.object({
  title: requiredText(200, "Title"),
  description: optionalText(2000),
  priority: z.enum(TaskPriority),
  dueDate: optionalDate,
  assigneeMemberId: optionalEntityId,
  relatedOptionId: optionalEntityId,
  relatedBookingId: optionalEntityId,
  relatedEventId: optionalEntityId,
});

export type TaskFormInput = z.input<typeof taskFormSchema>;
export type TaskInput = z.output<typeof taskFormSchema>;

/** Statuses a person can set directly. SUGGESTED only comes from Atlas. */
export const taskStatusSchema = z.enum(TaskStatus).exclude(["SUGGESTED"]);
