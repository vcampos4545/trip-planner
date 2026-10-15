import { z } from "zod";

import { EventKind, EventStatus } from "@/generated/prisma/enums";

import {
  optionalCoordinate,
  optionalEntityId,
  optionalText,
  optionalTime,
  optionalUrl,
  requiredDate,
  requiredText,
} from "./fields";

export const eventFormSchema = z
  .object({
    title: requiredText(200, "Title"),
    kind: z.enum(EventKind),
    status: z.enum(EventStatus).exclude(["SUGGESTED"]),
    date: requiredDate,
    startTime: optionalTime,
    endTime: optionalTime,
    locationName: optionalText(200),
    address: optionalText(300),
    latitude: optionalCoordinate(90),
    longitude: optionalCoordinate(180),
    url: optionalUrl,
    notes: optionalText(2000),
    researchOptionId: optionalEntityId,
    bookingId: optionalEntityId,
  })
  .superRefine((value, ctx) => {
    if (
      value.startTime !== null &&
      value.endTime !== null &&
      value.endTime <= value.startTime
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["endTime"],
        message: "End time must be after the start time",
      });
    }
  });

export type EventFormInput = z.input<typeof eventFormSchema>;
export type EventInput = z.output<typeof eventFormSchema>;
