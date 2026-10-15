import { z } from "zod";

import { isDateOnly, isTimeOfDay, timeToMinutes } from "@/lib/dates";
import { normalizeMoneyInput } from "@/lib/money";

/**
 * Field schemas for forms. Inputs are the raw strings a form produces; outputs are typed values.
 * The same schema validates on the client (React Hook Form) and again on the server.
 */

export const requiredText = (max: number, label = "This field") =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be ${max} characters or fewer`);

export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be ${max} characters or fewer`)
    .transform((value) => (value === "" ? null : value));

export function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export const optionalUrl = z
  .string()
  .trim()
  .max(2000, "That link is too long")
  .refine(
    (value) => value === "" || isHttpUrl(value),
    "Enter a full link starting with https://",
  )
  .transform((value) => (value === "" ? null : value));

export const requiredDate = z
  .string({ error: "Pick a date" })
  .trim()
  .refine(isDateOnly, "Pick a valid date");

export const optionalDate = z
  .string()
  .trim()
  .refine((value) => value === "" || isDateOnly(value), "Pick a valid date")
  .transform((value) => (value === "" ? null : value));

export const optionalTime = z
  .string()
  .trim()
  .refine(
    (value) => value === "" || isTimeOfDay(value),
    "Use a time like 09:30",
  )
  .transform((value) => (value === "" ? null : timeToMinutes(value)));

export const optionalMoney = z
  .string()
  .trim()
  .refine(
    (value) => value === "" || normalizeMoneyInput(value) !== null,
    "Enter an amount like 120 or 120.50",
  )
  .transform((value) => (value === "" ? null : normalizeMoneyInput(value)));

export const currencyCode = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .refine((value) => /^[A-Z]{3}$/.test(value), "Use a 3-letter code like USD");

export const optionalCurrency = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .refine(
    (value) => value === "" || /^[A-Z]{3}$/.test(value),
    "Use a 3-letter code like USD",
  )
  .transform((value) => (value === "" ? null : value));

export const optionalInt = (min: number, max: number) =>
  z
    .string()
    .trim()
    .refine(
      (value) =>
        value === "" ||
        (/^\d+$/.test(value) && Number(value) >= min && Number(value) <= max),
      `Enter a whole number from ${min} to ${max}`,
    )
    .transform((value) => (value === "" ? null : Number(value)));

export const optionalCoordinate = (limit: number) =>
  z
    .string()
    .trim()
    .refine(
      (value) =>
        value === "" ||
        (Number.isFinite(Number(value)) && Math.abs(Number(value)) <= limit),
      "Enter a valid coordinate",
    )
    .transform((value) => (value === "" ? null : Number(value)));

export const entityId = z.string().trim().min(1).max(64);

export const optionalEntityId = z
  .string()
  .trim()
  .max(64)
  .transform((value) => (value === "" ? null : value));

export const version = z.number().int().min(1);
