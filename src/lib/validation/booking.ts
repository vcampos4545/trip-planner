import { z } from "zod";

import {
  BookingCategory,
  BookingStatus,
  CostSplit,
  ParticipantStatus,
} from "@/generated/prisma/enums";

import {
  entityId,
  optionalCurrency,
  optionalDate,
  optionalEntityId,
  optionalMoney,
  optionalText,
  optionalTime,
  optionalUrl,
  requiredText,
} from "./fields";

export const bookingFormSchema = z
  .object({
    category: z.enum(BookingCategory),
    title: requiredText(200, "Title"),
    provider: optionalText(120),
    url: optionalUrl,
    reference: optionalText(120),
    status: z.enum(BookingStatus),
    startDate: optionalDate,
    startTime: optionalTime,
    endDate: optionalDate,
    endTime: optionalTime,
    fromLocation: optionalText(160),
    toLocation: optionalText(160),
    locationName: optionalText(200),
    address: optionalText(300),
    costAmount: optionalMoney,
    currency: optionalCurrency,
    costIsEstimate: z.boolean(),
    costSplit: z.enum(CostSplit),
    notes: optionalText(2000),
    researchOptionId: optionalEntityId,
    participants: z
      .array(
        z.object({
          memberId: entityId,
          status: z.enum(ParticipantStatus),
          shareAmount: optionalMoney,
          roomAssignment: optionalText(120),
        }),
      )
      .max(100),
  })
  .superRefine((value, ctx) => {
    if (value.startDate && value.endDate && value.endDate < value.startDate) {
      ctx.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "End date must be on or after the start date",
      });
    }
    if (value.costAmount && !value.currency) {
      ctx.addIssue({
        code: "custom",
        path: ["currency"],
        message: "Add a currency for the cost",
      });
    }
    const ids = value.participants.map((participant) => participant.memberId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: "custom",
        path: ["participants"],
        message: "Each traveler can only be added once",
      });
    }
  });

export type BookingFormInput = z.input<typeof bookingFormSchema>;
export type BookingInput = z.output<typeof bookingFormSchema>;
