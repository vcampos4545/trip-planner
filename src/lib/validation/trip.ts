import { z } from "zod";

import {
  ArrangementStatus,
  BudgetBasis,
  BudgetComponent,
  DateFlexibility,
  PreferenceKind,
  PreferenceStrength,
  TripStage,
} from "@/generated/prisma/enums";

import {
  optionalCurrency,
  optionalDate,
  optionalInt,
  optionalMoney,
  optionalText,
  requiredText,
} from "./fields";

/** The "edit trip details" form. Produces a full TripDetails object. */
export const tripDetailsFormSchema = z
  .object({
    title: requiredText(120, "Trip name"),
    summary: optionalText(1000),
    destination: optionalText(160),
    destinationConfirmed: z.boolean(),
    departureLocation: optionalText(160),
    tripStyle: optionalText(300),
    startDate: optionalDate,
    endDate: optionalDate,
    dateFlexibility: z.enum(DateFlexibility),
    dateNotes: optionalText(300),
    durationDays: optionalInt(1, 365),
    groupSize: optionalInt(1, 500),
    groupNotes: optionalText(500),
    budgetAmount: optionalMoney,
    budgetCurrency: optionalCurrency,
    budgetBasis: z.enum(BudgetBasis),
    budgetIncludes: z.array(z.enum(BudgetComponent)).max(5),
    budgetNotes: optionalText(300),
    flightsStatus: z.enum(ArrangementStatus),
    lodgingStatus: z.enum(ArrangementStatus),
    localTransportStatus: z.enum(ArrangementStatus),
    activitiesStatus: z.enum(ArrangementStatus),
  })
  .superRefine((value, ctx) => {
    if (value.startDate && value.endDate && value.endDate < value.startDate) {
      ctx.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "End date must be on or after the start date",
      });
    }
    if (value.budgetAmount && !value.budgetCurrency) {
      ctx.addIssue({
        code: "custom",
        path: ["budgetCurrency"],
        message: "Add a currency for the budget",
      });
    }
  });

export type TripDetailsFormInput = z.input<typeof tripDetailsFormSchema>;

export const quickTripFormSchema = z
  .object({
    title: requiredText(120, "Trip name"),
    destination: optionalText(160),
    startDate: optionalDate,
    endDate: optionalDate,
  })
  .superRefine((value, ctx) => {
    if (value.startDate && value.endDate && value.endDate < value.startDate) {
      ctx.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "End date must be on or after the start date",
      });
    }
  });

export type QuickTripFormInput = z.input<typeof quickTripFormSchema>;

export const tripStageSchema = z.enum(TripStage);

export const preferenceFormSchema = z.object({
  kind: z.enum(PreferenceKind),
  strength: z.enum(PreferenceStrength),
  description: requiredText(300, "Description"),
  memberId: z
    .string()
    .trim()
    .max(64)
    .transform((value) => (value === "" ? null : value)),
});

export type PreferenceFormInput = z.input<typeof preferenceFormSchema>;
