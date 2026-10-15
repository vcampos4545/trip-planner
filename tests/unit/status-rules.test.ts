import { describe, expect, it } from "vitest";

import {
  allowedOptionTransitions,
  checkOptionTransition,
} from "@/lib/domain/status-rules";

describe("option lifecycle", () => {
  it("never allows marking an option booked by hand", () => {
    expect(checkOptionTransition("APPROVED", "BOOKED", "ORGANIZER")).toEqual({
      ok: false,
      reason: "Record a booking to mark an option as booked.",
    });
  });

  it("lets any member shortlist and reject, but only organizers approve", () => {
    expect(checkOptionTransition("SUGGESTED", "SHORTLISTED", "MEMBER").ok).toBe(
      true,
    );
    expect(checkOptionTransition("SHORTLISTED", "REJECTED", "MEMBER").ok).toBe(
      true,
    );
    expect(checkOptionTransition("SHORTLISTED", "APPROVED", "MEMBER").ok).toBe(
      false,
    );
    expect(
      checkOptionTransition("SHORTLISTED", "APPROVED", "ORGANIZER").ok,
    ).toBe(true);
  });

  it("does not skip straight from suggested to approved", () => {
    expect(checkOptionTransition("SUGGESTED", "APPROVED", "ORGANIZER").ok).toBe(
      false,
    );
  });

  it("lists only the transitions a role may use", () => {
    expect(allowedOptionTransitions("SHORTLISTED", "MEMBER")).toEqual([
      "SUGGESTED",
      "REJECTED",
    ]);
    expect(allowedOptionTransitions("SHORTLISTED", "ORGANIZER")).toContain(
      "APPROVED",
    );
  });
});
