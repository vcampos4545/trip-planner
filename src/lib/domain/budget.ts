import type {
  BookingCategory,
  BookingStatus,
  CostSplit,
} from "@/generated/prisma/enums";
import { splitCents, toCents } from "@/lib/money";

/**
 * Lightweight budget summary built from booking records.
 *
 * Rules:
 * - Cancelled bookings are ignored.
 * - A booking without a price is listed as unpriced. It is never counted as zero.
 * - Currencies are summarized separately. Nothing is converted.
 * - Costs are attributed to the booking's participants according to its split rule.
 *   Anything that cannot be attributed to a person is reported as unassigned.
 */

export type BudgetBooking = {
  id: string;
  title: string;
  category: BookingCategory;
  status: BookingStatus;
  costAmount: { toString(): string } | string | null;
  currency: string | null;
  costIsEstimate: boolean;
  costSplit: CostSplit;
  participants: {
    memberId: string;
    shareAmount: { toString(): string } | string | null;
    status?: "CONSIDERING" | "BOOKED";
  }[];
};

export type MemberCost = {
  memberId: string;
  estimated: number;
  actual: number;
  total: number;
};

export type CurrencySummary = {
  currency: string;
  estimated: number;
  actual: number;
  total: number;
  /** Costs on bookings shared by two or more people, or not yet linked to anyone. */
  shared: number;
  /** Costs on bookings that belong to a single person. */
  individual: number;
  /** Cost that is not attributed to any member. */
  unassigned: number;
  perMember: MemberCost[];
};

export type BudgetWarning = {
  bookingId: string;
  title: string;
  message: string;
};

export type BudgetSummary = {
  currencies: CurrencySummary[];
  unpriced: { id: string; title: string; category: BookingCategory }[];
  warnings: BudgetWarning[];
  pricedCount: number;
};

export function summarizeBudget(
  bookings: BudgetBooking[],
  memberIds: string[],
  defaultCurrency = "USD",
): BudgetSummary {
  const byCurrency = new Map<string, CurrencySummary>();
  const unpriced: BudgetSummary["unpriced"] = [];
  const warnings: BudgetWarning[] = [];
  let pricedCount = 0;

  const summaryFor = (currency: string) => {
    let summary = byCurrency.get(currency);
    if (!summary) {
      summary = {
        currency,
        estimated: 0,
        actual: 0,
        total: 0,
        shared: 0,
        individual: 0,
        unassigned: 0,
        perMember: memberIds.map((memberId) => ({
          memberId,
          estimated: 0,
          actual: 0,
          total: 0,
        })),
      };
      byCurrency.set(currency, summary);
    }
    return summary;
  };

  for (const booking of bookings) {
    if (booking.status === "CANCELLED") continue;
    const amount = toCents(booking.costAmount);
    if (amount === null) {
      unpriced.push({
        id: booking.id,
        title: booking.title,
        category: booking.category,
      });
      continue;
    }
    pricedCount += 1;

    const summary = summaryFor(booking.currency || defaultCurrency);
    const participants = booking.participants;
    const shares = attributeCost(booking, amount, warnings);
    const bookingTotal = shares.total;

    summary.total += bookingTotal;
    if (participants.length === 1) summary.individual += bookingTotal;
    else summary.shared += bookingTotal;
    summary.unassigned += shares.unassigned;

    // A traveler who is only considering a booking has not paid, so their part is an estimate.
    const considering = new Set(
      participants
        .filter((participant) => participant.status === "CONSIDERING")
        .map((participant) => participant.memberId),
    );
    let attributed = 0;
    for (const [memberId, cents] of shares.byMember) {
      let row = summary.perMember.find((entry) => entry.memberId === memberId);
      if (!row) {
        // A participant who has since left the trip still shows up in the totals.
        row = { memberId, estimated: 0, actual: 0, total: 0 };
        summary.perMember.push(row);
      }
      const estimate = booking.costIsEstimate || considering.has(memberId);
      if (estimate) {
        row.estimated += cents;
        summary.estimated += cents;
      } else {
        row.actual += cents;
        summary.actual += cents;
      }
      row.total += cents;
      attributed += cents;
    }
    const rest = bookingTotal - attributed;
    if (booking.costIsEstimate) summary.estimated += rest;
    else summary.actual += rest;
  }

  const currencies = [...byCurrency.values()].sort((a, b) => b.total - a.total);
  return { currencies, unpriced, warnings, pricedCount };
}

function attributeCost(
  booking: BudgetBooking,
  amount: number,
  warnings: BudgetWarning[],
) {
  const byMember = new Map<string, number>();
  const participants = booking.participants;
  const add = (memberId: string, cents: number) =>
    byMember.set(memberId, (byMember.get(memberId) ?? 0) + cents);

  if (participants.length === 0) {
    if (booking.costSplit === "PER_PERSON") {
      warnings.push({
        bookingId: booking.id,
        title: booking.title,
        message:
          "Priced per person, but no travelers are linked yet. Counted once.",
      });
    }
    return { total: amount, unassigned: amount, byMember };
  }

  switch (booking.costSplit) {
    case "PER_PERSON": {
      for (const participant of participants) add(participant.memberId, amount);
      return { total: amount * participants.length, unassigned: 0, byMember };
    }
    case "CUSTOM": {
      let assigned = 0;
      let missing = 0;
      for (const participant of participants) {
        const share = toCents(participant.shareAmount);
        if (share === null) {
          missing += 1;
          continue;
        }
        add(participant.memberId, share);
        assigned += share;
      }
      if (missing > 0) {
        warnings.push({
          bookingId: booking.id,
          title: booking.title,
          message: `${missing} traveler${missing === 1 ? " has" : "s have"} no share amount yet.`,
        });
      }
      if (assigned > amount) {
        warnings.push({
          bookingId: booking.id,
          title: booking.title,
          message: "Individual shares add up to more than the booking total.",
        });
        return { total: assigned, unassigned: 0, byMember };
      }
      return { total: amount, unassigned: amount - assigned, byMember };
    }
    case "SHARED_EQUALLY":
    default: {
      const parts = splitCents(amount, participants.length);
      participants.forEach((participant, index) =>
        add(participant.memberId, parts[index] ?? 0),
      );
      return { total: amount, unassigned: 0, byMember };
    }
  }
}

/** Compares a currency summary against the trip's budget target, when the currency matches. */
export function compareToTarget(
  summary: CurrencySummary,
  target: {
    amount: { toString(): string } | string | null;
    currency: string | null;
    basis: string;
  },
  travelers: number,
): {
  targetCents: number;
  spentCents: number;
  basis: "PER_PERSON" | "TOTAL";
} | null {
  const targetCents = toCents(target.amount);
  if (
    targetCents === null ||
    !target.currency ||
    target.currency !== summary.currency
  )
    return null;
  if (target.basis === "PER_PERSON") {
    const people = Math.max(travelers, 1);
    return {
      targetCents,
      spentCents: Math.round(summary.total / people),
      basis: "PER_PERSON",
    };
  }
  if (target.basis === "TOTAL") {
    return { targetCents, spentCents: summary.total, basis: "TOTAL" };
  }
  return null;
}
