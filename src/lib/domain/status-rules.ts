import type {
  MemberRole,
  OptionStatus,
  TaskStatus,
} from "@/generated/prisma/enums";

/**
 * Lifecycle rules for saved options. "Booked" is never set by hand: it follows from a booking
 * record linked to the option, so a shortlisted or approved idea is never shown as booked.
 */
const OPTION_TRANSITIONS: Record<
  OptionStatus,
  { to: OptionStatus; organizerOnly?: boolean }[]
> = {
  SUGGESTED: [{ to: "SHORTLISTED" }, { to: "REJECTED" }],
  SHORTLISTED: [
    { to: "SUGGESTED" },
    { to: "REJECTED" },
    { to: "APPROVED", organizerOnly: true },
  ],
  APPROVED: [
    { to: "SHORTLISTED", organizerOnly: true },
    { to: "CANCELLED", organizerOnly: true },
  ],
  BOOKED: [{ to: "CANCELLED", organizerOnly: true }],
  REJECTED: [{ to: "SUGGESTED" }, { to: "SHORTLISTED" }],
  CANCELLED: [{ to: "SHORTLISTED" }],
};

export type TransitionCheck = { ok: true } | { ok: false; reason: string };

export function checkOptionTransition(
  from: OptionStatus,
  to: OptionStatus,
  role: MemberRole,
): TransitionCheck {
  if (to === "BOOKED") {
    return {
      ok: false,
      reason: "Record a booking to mark an option as booked.",
    };
  }
  const rule = OPTION_TRANSITIONS[from].find((entry) => entry.to === to);
  if (!rule)
    return {
      ok: false,
      reason: `An option can't move from ${from.toLowerCase()} to ${to.toLowerCase()}.`,
    };
  if (rule.organizerOnly && role !== "ORGANIZER") {
    return { ok: false, reason: "Only an organizer can make that change." };
  }
  return { ok: true };
}

export function allowedOptionTransitions(
  from: OptionStatus,
  role: MemberRole,
): OptionStatus[] {
  return OPTION_TRANSITIONS[from]
    .filter((rule) => !rule.organizerOnly || role === "ORGANIZER")
    .map((rule) => rule.to);
}

export const ACTIVE_TASK_STATUSES: TaskStatus[] = ["OPEN", "IN_PROGRESS"];

export function isTaskOpen(status: TaskStatus) {
  return status === "OPEN" || status === "IN_PROGRESS";
}
