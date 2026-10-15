/**
 * Picks the single most useful next step for a trip. Used on the dashboard cards and the
 * overview so the group always knows what keeps planning moving.
 */

export type TripProgress = {
  tripId: string;
  hasDestination: boolean;
  candidateCount: number;
  hasDates: boolean;
  hasTimingNotes: boolean;
  memberCount: number;
  pendingProposals: number;
  suggestedTasks: number;
  suggestedEvents: number;
  decisionsAwaitingMyVote: { id: string; title: string }[];
  myOpenTasks: { id: string; title: string }[];
  unassignedOpenTasks: number;
  lodgingStatus: string;
  flightsStatus: string;
  lodgingBookings: number;
  itineraryCount: number;
};

export type NextAction = {
  key: string;
  title: string;
  description: string;
  tab: "overview" | "plan" | "options" | "itinerary" | "bookings" | "tasks";
};

export function nextAction(progress: TripProgress): NextAction {
  if (progress.pendingProposals > 0) {
    return {
      key: "review-proposals",
      title: "Review proposed changes",
      description: `Atlas proposed ${plural(progress.pendingProposals, "change")} to the trip details. Nothing changes until someone accepts.`,
      tab: "overview",
    };
  }
  if (!progress.hasDestination) {
    return progress.candidateCount > 0
      ? {
          key: "choose-destination",
          title: "Choose a destination",
          description: `You have ${plural(progress.candidateCount, "candidate")}. Shortlist and vote to decide.`,
          tab: "options",
        }
      : {
          key: "find-destination",
          title: "Figure out where to go",
          description:
            "Tell Atlas what you're after, or add destination ideas yourself.",
          tab: "plan",
        };
  }
  if (!progress.hasDates) {
    return {
      key: "set-dates",
      title: progress.hasTimingNotes ? "Lock in dates" : "Pick dates",
      description: progress.hasTimingNotes
        ? "There's a rough timeframe. Settle on exact dates when the group agrees."
        : "Add dates or a flexible window so the group can plan around them.",
      tab: "overview",
    };
  }
  const vote = progress.decisionsAwaitingMyVote[0];
  if (vote) {
    return {
      key: `vote-${vote.id}`,
      title: `Vote: ${vote.title}`,
      description: "Your vote is still missing on an open decision.",
      tab: "tasks",
    };
  }
  if (progress.suggestedTasks + progress.suggestedEvents > 0) {
    const count = progress.suggestedTasks + progress.suggestedEvents;
    return {
      key: "review-suggestions",
      title: "Review Atlas suggestions",
      description: `${plural(count, "suggestion")} waiting for a yes or no.`,
      tab: progress.suggestedTasks > 0 ? "tasks" : "itinerary",
    };
  }
  const myTask = progress.myOpenTasks[0];
  if (myTask) {
    return {
      key: `task-${myTask.id}`,
      title: myTask.title,
      description:
        progress.myOpenTasks.length > 1
          ? `One of ${progress.myOpenTasks.length} tasks assigned to you.`
          : "This task is assigned to you.",
      tab: "tasks",
    };
  }
  if (progress.memberCount <= 1) {
    return {
      key: "invite",
      title: "Invite your group",
      description: "Share an invite link so everyone sees the same plan.",
      tab: "overview",
    };
  }
  if (progress.unassignedOpenTasks > 0) {
    return {
      key: "assign-tasks",
      title: `Assign ${plural(progress.unassignedOpenTasks, "open task")}`,
      description: "Give each task an owner so research isn't duplicated.",
      tab: "tasks",
    };
  }
  if (
    progress.lodgingStatus !== "BOOKED" &&
    progress.lodgingStatus !== "NOT_NEEDED" &&
    progress.lodgingBookings === 0
  ) {
    return {
      key: "lodging",
      title: "Find a place to stay",
      description: "No accommodation is recorded yet.",
      tab: "options",
    };
  }
  if (
    progress.flightsStatus === "UNKNOWN" ||
    progress.flightsStatus === "NEEDED"
  ) {
    return {
      key: "flights",
      title: "Sort out travel",
      description: "Record flights or how everyone is getting there.",
      tab: "bookings",
    };
  }
  if (progress.itineraryCount === 0) {
    return {
      key: "itinerary",
      title: "Start the itinerary",
      description: "Add the first plans to the day-by-day schedule.",
      tab: "itinerary",
    };
  }
  return {
    key: "on-track",
    title: "Planning is on track",
    description: "Keep adding plans to the itinerary or ask Atlas for ideas.",
    tab: "itinerary",
  };
}

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
