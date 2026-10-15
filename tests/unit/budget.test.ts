import { describe, expect, it } from "vitest";

import {
  compareToTarget,
  summarizeBudget,
  type BudgetBooking,
} from "@/lib/domain/budget";

function booking(overrides: Partial<BudgetBooking>): BudgetBooking {
  return {
    id: overrides.id ?? "b1",
    title: overrides.title ?? "Booking",
    category: "ACCOMMODATION",
    status: "CONFIRMED",
    costAmount: "300.00",
    currency: "USD",
    costIsEstimate: false,
    costSplit: "SHARED_EQUALLY",
    participants: [],
    ...overrides,
  };
}

describe("summarizeBudget", () => {
  it("splits a shared cost equally and keeps the cents adding up", () => {
    const summary = summarizeBudget(
      [
        booking({
          costAmount: "100.00",
          participants: ["a", "b", "c"].map((memberId) => ({
            memberId,
            shareAmount: null,
          })),
        }),
      ],
      ["a", "b", "c"],
    );
    const usd = summary.currencies[0]!;
    expect(usd.total).toBe(10000);
    const shares = usd.perMember.map((row) => row.total);
    expect(shares.reduce((sum, value) => sum + value, 0)).toBe(10000);
    expect(shares.sort()).toEqual([3333, 3333, 3334]);
    expect(usd.shared).toBe(10000);
  });

  it("charges a per-person price to every traveler on the booking", () => {
    const summary = summarizeBudget(
      [
        booking({
          category: "FLIGHT",
          costAmount: "620",
          costSplit: "PER_PERSON",
          participants: [
            { memberId: "a", shareAmount: null },
            { memberId: "b", shareAmount: null },
          ],
        }),
      ],
      ["a", "b"],
    );
    expect(summary.currencies[0]!.total).toBe(124000);
    expect(
      summary.currencies[0]!.perMember.every((row) => row.total === 62000),
    ).toBe(true);
  });

  it("never counts a missing price as zero", () => {
    const summary = summarizeBudget(
      [
        booking({ id: "priced", costAmount: "200" }),
        booking({ id: "unpriced", title: "Hostel", costAmount: null }),
      ],
      [],
    );
    expect(summary.unpriced).toEqual([
      { id: "unpriced", title: "Hostel", category: "ACCOMMODATION" },
    ]);
    expect(summary.pricedCount).toBe(1);
    expect(summary.currencies[0]!.total).toBe(20000);
  });

  it("ignores cancelled bookings and keeps currencies separate", () => {
    const summary = summarizeBudget(
      [
        booking({ id: "1", costAmount: "100", currency: "USD" }),
        booking({ id: "2", costAmount: "80", currency: "EUR" }),
        booking({
          id: "3",
          costAmount: "999",
          currency: "USD",
          status: "CANCELLED",
        }),
      ],
      [],
    );
    expect(
      summary.currencies.map((entry) => [entry.currency, entry.total]),
    ).toEqual([
      ["USD", 10000],
      ["EUR", 8000],
    ]);
  });

  it("keeps estimated and actual costs apart, and treats a considering traveler as an estimate", () => {
    const summary = summarizeBudget(
      [
        booking({ id: "estimate", costAmount: "50", costIsEstimate: true }),
        booking({
          id: "flight",
          costAmount: "500",
          costSplit: "PER_PERSON",
          participants: [
            { memberId: "a", shareAmount: null, status: "BOOKED" },
            { memberId: "b", shareAmount: null, status: "CONSIDERING" },
          ],
        }),
      ],
      ["a", "b"],
    );
    const usd = summary.currencies[0]!;
    expect(usd.actual).toBe(50000);
    expect(usd.estimated).toBe(5000 + 50000);
    expect(usd.perMember.find((row) => row.memberId === "b")).toMatchObject({
      actual: 0,
      estimated: 50000,
    });
  });

  it("reports unassigned cost and warnings for custom shares", () => {
    const summary = summarizeBudget(
      [
        booking({
          costAmount: "300",
          costSplit: "CUSTOM",
          participants: [
            { memberId: "a", shareAmount: "200" },
            { memberId: "b", shareAmount: null },
          ],
        }),
      ],
      ["a", "b"],
    );
    const usd = summary.currencies[0]!;
    expect(usd.unassigned).toBe(10000);
    expect(usd.perMember.find((row) => row.memberId === "a")!.total).toBe(
      20000,
    );
    expect(summary.warnings[0]!.message).toMatch(/no share amount/);
  });

  it("treats a booking with no travelers as shared and unassigned", () => {
    const summary = summarizeBudget([booking({ costAmount: "75" })], ["a"]);
    expect(summary.currencies[0]!.unassigned).toBe(7500);
    expect(summary.currencies[0]!.perMember[0]!.total).toBe(0);
  });
});

describe("compareToTarget", () => {
  const summary = summarizeBudget([booking({ costAmount: "900" })], [])
    .currencies[0]!;

  it("compares the per-person average against a per-person target", () => {
    expect(
      compareToTarget(
        summary,
        { amount: "500", currency: "USD", basis: "PER_PERSON" },
        3,
      ),
    ).toEqual({
      targetCents: 50000,
      spentCents: 30000,
      basis: "PER_PERSON",
    });
  });

  it("does not compare across currencies", () => {
    expect(
      compareToTarget(
        summary,
        { amount: "500", currency: "EUR", basis: "TOTAL" },
        3,
      ),
    ).toBeNull();
  });
});
