import { z } from "zod";

export const INVITE_TTL_CHOICES = [1, 3, 7, 14, 30] as const;

export const createInvitationSchema = z.object({
  ttlDays: z
    .number()
    .int()
    .refine(
      (value) => (INVITE_TTL_CHOICES as readonly number[]).includes(value),
      "Pick an expiry",
    ),
  maxUses: z.number().int().min(1).max(100).nullable(),
});
