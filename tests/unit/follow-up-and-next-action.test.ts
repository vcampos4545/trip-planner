import { describe, expect, it } from "vitest";

import { knownTopics, nextTopics } from "@/lib/domain/follow-up";
import { nextAction, type TripProgress } from "@/lib/domain/next-action";
import { EMPTY_DRAFT, EMPTY_TRIP_DETAILS } from "@/lib/domain/trip-details";

describe("nextTopics", () => {
  it("never asks about something already known", () => {
    const draft = {
      ...EMPTY_DRAFT,
      details: {
        ...EMPTY_TRIP_DETAILS,
        destination: "Lisbon",
        dateNotes: "late May",
        groupSize: 4,
      },
    };
    const topics = nextTopics(draft, "KNOWN_DESTINATION", 10).map(
      (item) => item.topic,
    );
    expect(topics).not.toContain("destination");
    expect(topics).not.toContain("timing");
    expect(topics).not.toContain("group");
    expect(topics[0]).toBe("departure");
  });

  it("orders questions by start mode", () => {
    expect(nextTopics(EMPTY_DRAFT, "VIBE", 1)[0]!.topic).toBe("vibe");
    expect(nextTopics(EMPTY_DRAFT, "DISCOVER", 1)[0]!.topic).toBe("timing");
    expect(nextTopics(EMPTY_DRAFT, "KNOWN_DESTINATION", 1)[0]!.topic).toBe(
      "destination",
    );
  });

  it("counts candidate destinations and flexible timing as known", () => {
    const known = knownTopics({
      ...EMPTY_DRAFT,
      details: { ...EMPTY_TRIP_DETAILS, dateFlexibility: "FLEXIBLE" },
      candidateDestinations: [
        { name: "Oaxaca", reason: null, suggestedBy: "atlas" },
      ],
    });
    expect(known.has("destination")).toBe(true);
    expect(known.has("timing")).toBe(true);
  });
});

const BASE: TripProgress = {
  tripId: "t1",
  hasDestination: true,
  candidateCount: 0,
  hasDates: true,
  hasTimingNotes: false,
  memberCount: 3,
  pendingProposals: 0,
  suggestedTasks: 0,
  suggestedEvents: 0,
  decisionsAwaitingMyVote: [],
  myOpenTasks: [],
  unassignedOpenTasks: 0,
  lodgingStatus: "BOOKED",
  flightsStatus: "BOOKED",
  lodgingBookings: 1,
  itineraryCount: 4,
};

describe("nextAction", () => {
  it("puts pending proposals first", () => {
    expect(
      nextAction({ ...BASE, pendingProposals: 1, hasDestination: false }).key,
    ).toBe("review-proposals");
  });

  it("asks for a destination, then dates", () => {
    expect(nextAction({ ...BASE, hasDestination: false }).key).toBe(
      "find-destination",
    );
    expect(
      nextAction({ ...BASE, hasDestination: false, candidateCount: 2 }).key,
    ).toBe("choose-destination");
    expect(nextAction({ ...BASE, hasDates: false }).key).toBe("set-dates");
  });

  it("surfaces missing votes before tasks", () => {
    const action = nextAction({
      ...BASE,
      decisionsAwaitingMyVote: [{ id: "d1", title: "Which hotel?" }],
      myOpenTasks: [{ id: "t", title: "Book car" }],
    });
    expect(action.title).toBe("Vote: Which hotel?");
  });

  it("suggests inviting people when planning alone", () => {
    expect(nextAction({ ...BASE, memberCount: 1 }).key).toBe("invite");
  });

  it("reports on-track when nothing is outstanding", () => {
    expect(nextAction(BASE).key).toBe("on-track");
  });
});
