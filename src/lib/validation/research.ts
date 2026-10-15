import { z } from "zod";

import { OptionCategory, OptionStatus } from "@/generated/prisma/enums";

import {
  entityId,
  optionalCoordinate,
  optionalCurrency,
  optionalMoney,
  optionalText,
  optionalUrl,
  requiredText,
} from "./fields";

export const optionFormSchema = z
  .object({
    category: z.enum(OptionCategory),
    title: requiredText(160, "Name"),
    description: optionalText(2000),
    url: optionalUrl,
    sourceName: optionalText(120),
    priceAmount: optionalMoney,
    priceCurrency: optionalCurrency,
    priceUnit: optionalText(60),
    priceNote: optionalText(300),
    locationName: optionalText(200),
    address: optionalText(300),
    latitude: optionalCoordinate(90),
    longitude: optionalCoordinate(180),
  })
  .superRefine((value, ctx) => {
    if (value.priceAmount && !value.priceCurrency) {
      ctx.addIssue({
        code: "custom",
        path: ["priceCurrency"],
        message: "Add a currency for the price",
      });
    }
  });

export type OptionFormInput = z.input<typeof optionFormSchema>;
export type OptionInput = z.output<typeof optionFormSchema>;

export const optionStatusSchema = z.enum(OptionStatus);

export const optionNoteSchema = z.object({ body: requiredText(1000, "Note") });

export const decisionFormSchema = z.object({
  title: requiredText(160, "Question"),
  description: optionalText(1000),
  choices: z
    .array(
      z.object({
        label: requiredText(160, "Choice"),
        researchOptionId: z
          .string()
          .trim()
          .max(64)
          .transform((value) => (value === "" ? null : value)),
      }),
    )
    .min(2, "Add at least two choices")
    .max(8, "Keep it to eight choices or fewer"),
});

export type DecisionFormInput = z.input<typeof decisionFormSchema>;
export type DecisionInput = z.output<typeof decisionFormSchema>;

export const resolveDecisionSchema = z.object({
  choiceId: entityId,
  note: optionalText(500),
});
