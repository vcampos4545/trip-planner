import { z } from "zod";

import {
  isEmailAddress,
  MAX_EMAILS_PER_REQUEST,
  normalizeEmail,
} from "@/lib/domain/invitations";

export const INVITE_TTL_CHOICES = [1, 3, 7, 14, 30] as const;

const ttlDays = z
  .number()
  .int()
  .refine(
    (value) => (INVITE_TTL_CHOICES as readonly number[]).includes(value),
    "Pick an expiry",
  );

const role = z.enum(["MEMBER", "ORGANIZER"]).default("MEMBER");

export const createInvitationSchema = z.object({
  ttlDays,
  maxUses: z.number().int().min(1).max(100).nullable(),
  role,
});

export const emailInvitationSchema = z.object({
  emails: z
    .array(
      z
        .string()
        .max(254)
        .transform(normalizeEmail)
        .refine(isEmailAddress, "That isn't an email address"),
    )
    .min(1, "Add at least one email address.")
    .max(
      MAX_EMAILS_PER_REQUEST,
      `Invite up to ${MAX_EMAILS_PER_REQUEST} addresses at a time.`,
    ),
  ttlDays,
  role,
});
