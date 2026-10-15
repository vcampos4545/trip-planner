import type { TripStartMode } from "@/generated/prisma/enums";

import type { TripDraft } from "./trip-details";

/**
 * Decides which unknowns are worth asking about next. Atlas receives this list so it does not
 * re-ask for known information and asks about the most useful gap for the chosen start mode.
 */

export type DetailTopic =
  | "destination"
  | "vibe"
  | "timing"
  | "departure"
  | "group"
  | "budget"
  | "lodging"
  | "flights"
  | "interests";

const TOPIC_PROMPTS: Record<DetailTopic, string> = {
  destination: "where they want to go (a place, or a shortlist)",
  vibe: "the kind of experience they want (beach, mountains, food, nightlife, culture)",
  timing:
    "when they can travel, how long, and whether dates are fixed or flexible",
  departure: "which city or airport people would leave from",
  group: "who is coming and how many people",
  budget: "a rough budget, total or per person, and what it should cover",
  lodging: "whether a place to stay is already booked and what kind they like",
  flights: "whether flights are booked yet or still needed",
  interests:
    "interests, must-dos, or constraints such as accessibility or diet",
};

const ORDER: Record<TripStartMode, DetailTopic[]> = {
  KNOWN_DESTINATION: [
    "destination",
    "timing",
    "group",
    "departure",
    "budget",
    "lodging",
    "flights",
    "interests",
  ],
  VIBE: [
    "vibe",
    "timing",
    "departure",
    "budget",
    "group",
    "destination",
    "interests",
    "lodging",
  ],
  DISCOVER: [
    "timing",
    "departure",
    "budget",
    "vibe",
    "group",
    "destination",
    "interests",
    "lodging",
  ],
  MANUAL: [
    "destination",
    "timing",
    "group",
    "departure",
    "budget",
    "lodging",
    "flights",
    "interests",
  ],
};

export function knownTopics(draft: TripDraft): Set<DetailTopic> {
  const d = draft.details;
  const known = new Set<DetailTopic>();
  if (d.destination || draft.candidateDestinations.length > 0)
    known.add("destination");
  if (d.tripStyle) known.add("vibe");
  if (
    d.startDate ||
    d.endDate ||
    d.dateNotes ||
    d.durationDays ||
    d.dateFlexibility !== "UNKNOWN"
  ) {
    known.add("timing");
  }
  if (d.departureLocation) known.add("departure");
  if (d.groupSize !== null || d.groupNotes) known.add("group");
  if (d.budgetAmount || d.budgetNotes) known.add("budget");
  if (d.lodgingStatus !== "UNKNOWN") known.add("lodging");
  if (d.flightsStatus !== "UNKNOWN") known.add("flights");
  if (draft.preferences.length > 0) known.add("interests");
  return known;
}

/** Unknown topics in priority order for this start mode. */
export function nextTopics(
  draft: TripDraft,
  mode: TripStartMode | null,
  limit = 3,
) {
  const known = knownTopics(draft);
  return ORDER[mode ?? "MANUAL"]
    .filter((topic) => !known.has(topic))
    .slice(0, limit)
    .map((topic) => ({ topic, prompt: TOPIC_PROMPTS[topic] }));
}
