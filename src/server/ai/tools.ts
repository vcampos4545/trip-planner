import "server-only";

import { z } from "zod";

import { ASSISTANT_NAME } from "@/config/brand";
import {
  ArrangementStatus,
  BookingCategory,
  BudgetBasis,
  BudgetComponent,
  DateFlexibility,
  EventKind,
  OptionCategory,
  OptionStatus,
  PreferenceKind,
  PreferenceStrength,
  TaskPriority,
  TripTheme,
} from "@/generated/prisma/enums";
import {
  formatMinutes,
  isTimeOfDay,
  timeToMinutes,
  toDateOnly,
} from "@/lib/dates";
import {
  describeMatch,
  matchShownFlights,
  nextResultId,
} from "@/lib/domain/flight-match";
import { nextTopics } from "@/lib/domain/follow-up";
import {
  applyStopOps,
  describeStops,
  stopListProblem,
  type StopOp,
} from "@/lib/domain/stops";
import { THEME_TASKS } from "@/lib/domain/theme";
import {
  applyChanges,
  candidateDestinationSchema,
  classifyPatch,
  crossFieldProblem,
  mergeCandidates,
  mergePreferences,
  preferenceInputSchema,
  tripDetailsPatchSchema,
  type TripDetailsPatch,
  type TripDraft,
} from "@/lib/domain/trip-details";
import {
  CABIN_CLASSES,
  MAX_FLIGHT_PASSENGERS,
  TEST_DATA_NOTICE,
  bookElsewhereUrl,
  describeOffer,
  isRoundTrip,
  localClock,
  localDate,
  placeCodes,
  type FlightAirport,
  type FlightOffer,
  type FlightSlice,
} from "@/lib/flights";
import { BOOKING_CATEGORY_SINGULAR, TRIP_THEME_LABELS } from "@/lib/labels";
import { bookingFormSchema } from "@/lib/validation/booking";
import { flightSearchFormSchema } from "@/lib/validation/flights";
import type { TripAccess } from "@/server/access";
import type { CurrentUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { DomainError } from "@/server/errors";
import {
  ResearchFailedError,
  ResearchUnavailableError,
  type ResearchProvider,
  type ResearchResult,
} from "@/server/research";
import type {
  FlightSearchProvider,
  FlightSearchResult,
} from "@/server/flights";
import {
  saveFlightOffer,
  searchFlights,
  searchReturnFlights,
} from "@/server/services/flights";
import {
  createBooking,
  findExistingBooking,
  recordTravelersBooked,
} from "@/server/services/bookings";
import { loadStops } from "@/server/services/stops";
import { describeFields, tripToDetails } from "@/server/services/trip-mapping";
import {
  applyAtlasPatch,
  applyAtlasStops,
  describeChange,
  loadTripDraft,
} from "@/server/services/trips";
import { createOption, listOptions } from "@/server/services/research";
import { suggestTask } from "@/server/services/tasks";
import { proposeEvent } from "@/server/services/itinerary";

import { themeGuidance } from "./prompts";
import { toStrictJsonSchema } from "./schema";
import type { ToolCall, ToolSpec } from "./types";

// ---------------------------------------------------------------------------
// Context and effects
// ---------------------------------------------------------------------------

export type ToolEffect = {
  tool: string;
  ok: boolean;
  kind:
    | "updated"
    | "proposal"
    | "suggestion"
    | "saved"
    | "recorded"
    | "searched"
    | "read"
    | "error";
  summary: string;
  entityId?: string;
  /** What entityId points at, so the chat can link to it or act on it. */
  entityType?: "booking" | "proposal";
  /** Set when the change can be undone from the chat, such as a booking Atlas just recorded. */
  undo?: "delete_booking";
  /** Set when the tool returned provider test data, so the reply is labelled as such. */
  testData?: boolean;
};

type BaseContext = {
  user: CurrentUser;
  conversationId: string;
  effects: ToolEffect[];
};

export type DraftContext = BaseContext & {
  phase: "draft";
  startMode: "KNOWN_DESTINATION" | "VIBE" | "DISCOVER";
  draft: TripDraft;
  saveDraft: (draft: TripDraft) => Promise<void>;
};

export type TripContext = BaseContext & {
  phase: "trip";
  access: TripAccess;
  /** True when the user is the only member, so nothing waits on "the group". */
  soloTrip: boolean;
  research: ResearchProvider;
  searchResults: Map<string, ResearchResult>;
  flights: FlightSearchProvider | null;
  /** Flight results shown in this conversation, including earlier turns, by result ID. */
  flightResults: Map<string, FlightOffer>;
  /** Result IDs first shown in this turn, saved with the reply so later turns can use them. */
  newFlightResultIds: string[];
};

export type AtlasContext = DraftContext | TripContext;

type AtlasTool<Args> = {
  name: string;
  description: string;
  args: z.ZodType<Args>;
  phases: AtlasContext["phase"][];
  run: (context: AtlasContext, args: Args) => Promise<unknown>;
};

function defineTool<Args>(tool: AtlasTool<Args>) {
  return tool;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONEY_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

// ---------------------------------------------------------------------------
// update_trip_details
// ---------------------------------------------------------------------------

const detailChangesArgs = z.object({
  title: z
    .string()
    .nullable()
    .describe(
      "Short working title. Only if the user named the trip, or to propose a better one once the theme is known (the user accepts or edits it).",
    ),
  summary: z
    .string()
    .nullable()
    .describe("One or two sentence summary of the trip idea."),
  destination: z
    .string()
    .nullable()
    .describe(
      "A single destination the user has chosen or is planning around.",
    ),
  destinationConfirmed: z
    .boolean()
    .nullable()
    .describe(
      "true only if the user said the destination is decided. null if not mentioned.",
    ),
  departureLocation: z
    .string()
    .nullable()
    .describe("Home city or airport people leave from."),
  flyIntoAirport: z
    .string()
    .nullable()
    .describe(
      "Airport people fly into for the trip, when it is not a stop itself, e.g. SLC.",
    ),
  flyOutOfAirport: z
    .string()
    .nullable()
    .describe("Airport people fly home from at the end of the trip, e.g. SLC."),
  tripStyle: z
    .string()
    .nullable()
    .describe("The vibe or kind of trip, in the user's words."),
  theme: z
    .enum(TripTheme)
    .nullable()
    .describe(
      "Only when the user said it (e.g. mentioned skiing) or answered yes when asked. NONE if they said there is no particular theme.",
    ),
  startDate: z
    .string()
    .regex(DATE_PATTERN)
    .nullable()
    .describe("YYYY-MM-DD. Only exact dates the user gave."),
  endDate: z
    .string()
    .regex(DATE_PATTERN)
    .nullable()
    .describe("YYYY-MM-DD. Only exact dates the user gave."),
  dateFlexibility: z.enum(DateFlexibility).nullable(),
  dateNotes: z
    .string()
    .nullable()
    .describe('Loose timing in words, e.g. "a long weekend in late May".'),
  durationDays: z.number().int().nullable(),
  groupSize: z
    .number()
    .int()
    .nullable()
    .describe("Total number of travelers, if stated."),
  groupNotes: z
    .string()
    .nullable()
    .describe("Who is coming, ages if volunteered, relationships."),
  budgetAmount: z
    .string()
    .regex(MONEY_PATTERN)
    .nullable()
    .describe("Plain number like 1500 or 1500.00."),
  budgetCurrency: z.string().nullable().describe("ISO currency code like USD."),
  budgetBasis: z.enum(BudgetBasis).nullable(),
  budgetIncludes: z.array(z.enum(BudgetComponent)).nullable(),
  budgetNotes: z.string().nullable(),
  flightsStatus: z.enum(ArrangementStatus).nullable(),
  lodgingStatus: z.enum(ArrangementStatus).nullable(),
  localTransportStatus: z.enum(ArrangementStatus).nullable(),
  activitiesStatus: z.enum(ArrangementStatus).nullable(),
});

const updateTripDetailsArgs = z.object({
  changes: detailChangesArgs.describe(
    "Fields to record. Use null for anything the user did not mention.",
  ),
  preferences: z
    .array(
      z.object({
        kind: z.enum(PreferenceKind),
        strength: z
          .enum(PreferenceStrength)
          .describe("REQUIREMENT for must/need/can't. PREFERENCE otherwise."),
        description: z.string(),
      }),
    )
    .describe(
      "New interests, constraints, accessibility or dietary needs. Empty array if none.",
    ),
  candidateDestinations: z
    .array(
      z.object({
        name: z.string(),
        reason: z.string().nullable(),
        suggestedBy: z.enum(["user", "atlas"]),
      }),
    )
    .describe(
      "Places being considered. suggestedBy is 'user' if the user named it.",
    ),
});

function patchFromArgs(changes: z.infer<typeof detailChangesArgs>) {
  const raw = Object.fromEntries(
    Object.entries(changes).filter(([, value]) => value !== null),
  );
  if (typeof raw.budgetCurrency === "string")
    raw.budgetCurrency = raw.budgetCurrency.toUpperCase();
  return tripDetailsPatchSchema.safeParse(raw);
}

const updateTripDetails = defineTool({
  name: "update_trip_details",
  description:
    "Record trip details, preferences, and candidate destinations the user stated. Call this whenever the user shares new information. Values that are already set are not overwritten; a change to them is sent to the group for confirmation.",
  args: updateTripDetailsArgs,
  phases: ["draft", "trip"],
  async run(context, args) {
    const parsed = patchFromArgs(args.changes);
    if (!parsed.success) {
      throw new DomainError(
        "VALIDATION",
        `Nothing was saved. Invalid values: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
      );
    }
    const preferences = z
      .array(preferenceInputSchema)
      .safeParse(args.preferences);
    const candidates = z
      .array(candidateDestinationSchema)
      .safeParse(args.candidateDestinations);
    if (!preferences.success || !candidates.success) {
      throw new DomainError(
        "VALIDATION",
        "Nothing was saved. A preference or destination entry was invalid.",
      );
    }
    const patch: TripDetailsPatch = parsed.data;

    if (context.phase === "draft") {
      // Before the trip exists the draft belongs to this user alone, so stated changes apply directly.
      const { fills, overwrites } = classifyPatch(context.draft.details, patch);
      const changes = [...fills, ...overwrites];
      const next = applyChanges(context.draft.details, changes);
      const problem = crossFieldProblem(next);
      if (problem)
        throw new DomainError("VALIDATION", `Nothing was saved. ${problem}`);
      const draft: TripDraft = {
        details: next,
        preferences: mergePreferences(
          context.draft.preferences,
          preferences.data,
        ),
        candidateDestinations: mergeCandidates(
          context.draft.candidateDestinations,
          candidates.data,
        ),
        stops: context.draft.stops,
      };
      const addedPreferences =
        draft.preferences.length - context.draft.preferences.length;
      const addedCandidates =
        draft.candidateDestinations.length -
        context.draft.candidateDestinations.length;
      await context.saveDraft(draft);
      context.draft = draft;
      const parts = [
        changes.length > 0
          ? `Noted ${describeFields(changes.map((change) => change.field))}`
          : null,
        addedCandidates > 0 ? `${addedCandidates} destination idea(s)` : null,
        addedPreferences > 0 ? `${addedPreferences} preference(s)` : null,
      ].filter(Boolean);
      if (parts.length > 0) {
        context.effects.push({
          tool: this.name,
          ok: true,
          kind: "updated",
          summary: parts.join(", "),
        });
      }
      return {
        saved: changes.map((change) => change.field),
        draft: summarizeDraft(draft),
        ...(await themeNote(context)),
      };
    }

    const result = await applyAtlasPatch(context.access, {
      patch,
      preferences: preferences.data,
      candidates: candidates.data,
      conversationId: context.conversationId,
    });
    if (
      result.applied.length > 0 ||
      result.addedPreferences > 0 ||
      result.addedCandidates > 0
    ) {
      const parts = [
        result.applied.length
          ? `Updated ${describeFields(result.applied.map((change) => change.field))}`
          : null,
        result.addedCandidates
          ? `added ${result.addedCandidates} destination idea(s)`
          : null,
        result.addedPreferences
          ? `added ${result.addedPreferences} preference(s)`
          : null,
      ].filter(Boolean);
      context.effects.push({
        tool: this.name,
        ok: true,
        kind: "updated",
        summary: parts.join(", "),
      });
    }
    if (result.proposal) pushProposal(context, this.name, result.proposal);
    return {
      appliedFields: result.applied.map((change) => change.field),
      needsConfirmation: result.proposal
        ? result.proposal.changes.map(describeChange)
        : [],
      ...(result.proposal ? confirmationNote(context) : {}),
      rejected: result.rejected,
      addedPreferences: result.addedPreferences,
      addedCandidateDestinations: result.addedCandidates,
      ...(await themeNote(context)),
    };
  },
});

/**
 * A change to something already set waits for a member to accept it. On a trip with one member
 * that member is the user, who accepts it from the chat, so nothing mentions a group.
 */
function pushProposal(
  context: TripContext,
  tool: string,
  proposal: { id: string; summary: string },
) {
  context.effects.push({
    tool,
    ok: true,
    kind: "proposal",
    summary: context.soloTrip
      ? `Needs your OK: ${proposal.summary}`
      : `Proposed change waiting for the group: ${proposal.summary}`,
    entityId: proposal.id,
    entityType: "proposal",
  });
}

/** After places or dates change, tells Atlas whether to ask about or record the theme. */
async function themeNote(context: AtlasContext) {
  const draft =
    context.phase === "draft"
      ? context.draft
      : await loadTripDraft(context.access);
  const guidance = themeGuidance(draft);
  return guidance ? { theme: guidance } : {};
}

function confirmationNote(context: TripContext) {
  return {
    confirmation: context.soloTrip
      ? "The user is the only member. They can accept or decline this change with the buttons under your reply; ask them to. Do not mention a group."
      : "A member must accept this change on the Overview tab. Say it is waiting for the group.",
  };
}

// ---------------------------------------------------------------------------
// Reading state
// ---------------------------------------------------------------------------

function summarizeDraft(draft: TripDraft) {
  return {
    details: draft.details,
    stops: draft.stops,
    preferences: draft.preferences,
    candidateDestinations: draft.candidateDestinations,
  };
}

function firstName(name: string | null | undefined) {
  return name?.trim().split(/\s+/)[0] ?? "Member";
}

export async function buildTripSnapshot(access: TripAccess) {
  const [
    trip,
    members,
    preferences,
    options,
    decisions,
    tasks,
    events,
    bookings,
    proposals,
  ] = await Promise.all([
    db.trip.findUniqueOrThrow({ where: { id: access.tripId } }),
    db.tripMember.findMany({
      where: { tripId: access.tripId },
      select: { id: true, role: true, user: { select: { name: true } } },
      orderBy: { joinedAt: "asc" },
    }),
    db.tripPreference.findMany({
      where: { tripId: access.tripId },
      select: {
        kind: true,
        strength: true,
        description: true,
        member: { select: { user: { select: { name: true } } } },
      },
      take: 40,
    }),
    db.researchOption.findMany({
      where: {
        tripId: access.tripId,
        status: { notIn: ["REJECTED", "CANCELLED"] },
      },
      orderBy: { updatedAt: "desc" },
      take: 25,
      select: {
        id: true,
        category: true,
        title: true,
        status: true,
        origin: true,
        priceAmount: true,
        priceCurrency: true,
        priceUnit: true,
        sourceName: true,
        retrievedAt: true,
      },
    }),
    db.decision.findMany({
      where: { tripId: access.tripId, status: "OPEN" },
      take: 10,
      select: {
        id: true,
        title: true,
        choices: {
          select: { label: true, _count: { select: { votes: true } } },
        },
      },
    }),
    db.task.findMany({
      where: {
        tripId: access.tripId,
        status: { in: ["SUGGESTED", "OPEN", "IN_PROGRESS"] },
      },
      take: 25,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        dueDate: true,
        assignee: { select: { user: { select: { name: true } } } },
      },
    }),
    db.itineraryEvent.findMany({
      where: { tripId: access.tripId, status: { not: "CANCELLED" } },
      take: 80,
      orderBy: [{ date: "asc" }, { startMinute: "asc" }],
      select: {
        id: true,
        title: true,
        kind: true,
        status: true,
        date: true,
        startMinute: true,
        endMinute: true,
        locationName: true,
      },
    }),
    db.booking.findMany({
      where: { tripId: access.tripId },
      take: 40,
      orderBy: [
        { startDate: { sort: "asc", nulls: "last" } },
        { startMinute: { sort: "asc", nulls: "last" } },
      ],
      select: {
        id: true,
        category: true,
        title: true,
        provider: true,
        status: true,
        startDate: true,
        startMinute: true,
        endDate: true,
        endMinute: true,
        fromLocation: true,
        toLocation: true,
        costAmount: true,
        currency: true,
        participants: {
          select: {
            status: true,
            member: { select: { user: { select: { name: true } } } },
          },
        },
      },
    }),
    db.tripDetailProposal.findMany({
      where: { tripId: access.tripId, status: "PENDING" },
      select: { summary: true },
      take: 10,
    }),
  ]);
  const stops = await loadStops(db, access.tripId);

  return {
    trip: {
      ...tripToDetails(trip),
      stage: trip.stage,
      startMode: trip.startMode,
    },
    stops,
    members: members.map((member) => ({
      name: firstName(member.user.name),
      role: member.role,
    })),
    preferences: preferences.map((preference) => ({
      kind: preference.kind,
      strength: preference.strength,
      description: preference.description,
      person: preference.member ? firstName(preference.member.user.name) : null,
    })),
    savedOptions: options.map((option) => ({
      id: option.id,
      category: option.category,
      title: option.title,
      status: option.status,
      origin: option.origin,
      price: option.priceAmount
        ? `${option.priceAmount.toFixed(2)} ${option.priceCurrency ?? ""} ${option.priceUnit ?? ""}`.trim()
        : null,
      source: option.sourceName,
      retrievedAt: option.retrievedAt?.toISOString() ?? null,
    })),
    openDecisions: decisions.map((decision) => ({
      id: decision.id,
      title: decision.title,
      choices: decision.choices.map((choice) => ({
        label: choice.label,
        votes: choice._count.votes,
      })),
    })),
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      due: task.dueDate ? toDateOnly(task.dueDate) : null,
      assignee: task.assignee ? firstName(task.assignee.user.name) : null,
    })),
    itinerary: events.map((event) => ({
      id: event.id,
      date: toDateOnly(event.date),
      start:
        event.startMinute !== null ? formatMinutes(event.startMinute) : null,
      end: event.endMinute !== null ? formatMinutes(event.endMinute) : null,
      title: event.title,
      kind: event.kind,
      status: event.status,
      location: event.locationName,
    })),
    bookings: bookings.map((booking) => ({
      id: booking.id,
      category: booking.category,
      title: booking.title,
      provider: booking.provider,
      status: booking.status,
      from: booking.fromLocation,
      to: booking.toLocation,
      start: booking.startDate
        ? `${toDateOnly(booking.startDate)}${booking.startMinute !== null ? ` ${formatMinutes(booking.startMinute)}` : ""}`
        : null,
      end: booking.endDate
        ? `${toDateOnly(booking.endDate)}${booking.endMinute !== null ? ` ${formatMinutes(booking.endMinute)}` : ""}`
        : null,
      travelers: booking.participants.map(
        (participant) =>
          `${firstName(participant.member.user.name)} (${participant.status.toLowerCase()})`,
      ),
      cost: booking.costAmount
        ? `${booking.costAmount.toFixed(2)} ${booking.currency ?? ""}`.trim()
        : "unpriced",
    })),
    pendingProposals: proposals.map((proposal) => proposal.summary),
  };
}

const getTripState = defineTool({
  name: "get_trip_state",
  description:
    "Read the current shared trip record: details, members, preferences, saved options, open decisions, tasks, itinerary, bookings, and pending proposals.",
  args: z.object({}),
  phases: ["draft", "trip"],
  async run(context) {
    context.effects.push({
      tool: this.name,
      ok: true,
      kind: "read",
      summary: "Read the trip",
    });
    if (context.phase === "draft")
      return { phase: "draft", ...summarizeDraft(context.draft) };
    return buildTripSnapshot(context.access);
  },
});

const summarizeOutstanding = defineTool({
  name: "summarize_outstanding_decisions",
  description:
    "List open decisions with vote counts, pending proposals, suggestions awaiting review, unassigned tasks, and missing trip details.",
  args: z.object({}),
  phases: ["trip"],
  async run(context) {
    if (context.phase !== "trip") return {};
    const snapshot = await buildTripSnapshot(context.access);
    const draftLike: TripDraft = {
      details: snapshot.trip,
      stops: snapshot.stops,
      preferences: snapshot.preferences.map((preference) => ({
        kind: preference.kind,
        strength: preference.strength,
        description: preference.description,
      })),
      candidateDestinations: snapshot.savedOptions
        .filter((option) => option.category === "DESTINATION")
        .map((option) => ({
          name: option.title,
          reason: null,
          suggestedBy: "user" as const,
        })),
    };
    context.effects.push({
      tool: this.name,
      ok: true,
      kind: "read",
      summary: "Reviewed open items",
    });
    return {
      openDecisions: snapshot.openDecisions,
      pendingProposals: snapshot.pendingProposals,
      suggestionsAwaitingReview: {
        tasks: snapshot.tasks
          .filter((task) => task.status === "SUGGESTED")
          .map((task) => task.title),
        itinerary: snapshot.itinerary
          .filter((event) => event.status === "SUGGESTED")
          .map((event) => event.title),
      },
      unassignedTasks: snapshot.tasks
        .filter((task) => task.status !== "SUGGESTED" && !task.assignee)
        .map((task) => task.title),
      missingDetails: nextTopics(draftLike, snapshot.trip.startMode, 5).map(
        (item) => item.prompt,
      ),
    };
  },
});

// ---------------------------------------------------------------------------
// Research
// ---------------------------------------------------------------------------

const searchOptions = defineTool({
  name: "search_options",
  description:
    "Search the live research provider for destinations, stays, activities, food, or transport. Use it only when the request needs current information from the web, such as prices, availability, opening hours, or recent places; each search has a cost. Returns results with source links and retrieval time, or says that live search is unavailable or failed.",
  args: z.object({
    category: z.enum(OptionCategory),
    query: z.string().describe("What to look for, in plain words."),
    location: z.string().nullable(),
  }),
  phases: ["trip"],
  async run(context, args) {
    if (context.phase !== "trip") return {};
    const query = args.query.trim().slice(0, 200);
    if (!query)
      throw new DomainError("VALIDATION", "The search query was empty.");
    try {
      const results = await context.research.search({
        category: args.category,
        query,
        location: args.location,
        limit: 6,
      });
      const listed = results.slice(0, 6).map((result, index) => {
        const id = `r${context.searchResults.size + index + 1}`;
        context.searchResults.set(id, result);
        const retrievedAt = result.retrievedAt.toISOString();
        return {
          resultId: id,
          title: result.title,
          description: result.description,
          url: result.url,
          source: result.sourceName,
          price: result.priceAmount
            ? {
                amount:
                  `${result.priceAmount} ${result.priceCurrency ?? ""} ${result.priceUnit ? `per ${result.priceUnit}` : ""}`.trim(),
                statedBy: result.sourceName,
                retrievedAt,
              }
            : null,
          availability: result.availabilityNote
            ? {
                note: result.availabilityNote,
                statedBy: result.sourceName,
                retrievedAt,
              }
            : null,
          retrievedAt,
        };
      });
      context.effects.push({
        tool: this.name,
        ok: true,
        kind: "searched",
        summary: `Searched ${context.research.label} for "${query}" (${listed.length} results)`,
      });
      return {
        available: true,
        provider: context.research.label,
        results: listed,
        note:
          listed.length === 0
            ? "No live results with a source were found."
            : "Cite results you mention as Markdown links to their url. Prices and availability are only as stated by that source at retrievedAt.",
      };
    } catch (error) {
      if (error instanceof ResearchUnavailableError) {
        context.effects.push({
          tool: this.name,
          ok: false,
          kind: "searched",
          summary:
            context.research.id === "none"
              ? "Live search is not configured"
              : "Live research is unavailable",
        });
        return { available: false, message: error.message };
      }
      if (!(error instanceof ResearchFailedError)) {
        console.error(
          "[atlas] research provider failed:",
          error instanceof Error ? error.message : "unknown",
        );
      }
      const reason =
        error instanceof ResearchFailedError
          ? error.message
          : "The research provider returned an error.";
      context.effects.push({
        tool: this.name,
        ok: false,
        kind: "error",
        summary: `Live research failed: ${reason}`,
      });
      return {
        available: false,
        failed: true,
        message: `Live research failed: ${reason} No live results are available right now. Tell the user, and do not present general knowledge as live results.`,
      };
    }
  },
});

const saveOption = defineTool({
  name: "save_research_option",
  description:
    "Save a candidate (destination, stay, activity, food, transport) to the trip's shared options as a suggestion for the group to review. Use sourceResultId to save a live search result with its source and price. Without it, the option is saved as an Atlas idea with no price.",
  args: z.object({
    category: z.enum(OptionCategory),
    title: z.string(),
    description: z.string().nullable(),
    rationale: z
      .string()
      .describe(
        "Why it fits this group, mentioning their preferences and budget.",
      ),
    sourceResultId: z
      .string()
      .nullable()
      .describe(
        "resultId from search_options, if the option came from a search.",
      ),
    locationName: z.string().nullable(),
  }),
  phases: ["trip"],
  async run(context, args) {
    if (context.phase !== "trip") return {};
    const title = args.title.trim().slice(0, 160);
    if (!title)
      throw new DomainError("VALIDATION", "The option needs a title.");
    const existing = await db.researchOption.findFirst({
      where: {
        tripId: context.access.tripId,
        category: args.category,
        title: { equals: title, mode: "insensitive" },
      },
      select: { id: true, status: true },
    });
    if (existing) {
      return {
        saved: false,
        alreadySaved: true,
        optionId: existing.id,
        status: existing.status,
      };
    }
    const source = args.sourceResultId
      ? context.searchResults.get(args.sourceResultId)
      : undefined;
    if (args.sourceResultId && !source) {
      throw new DomainError(
        "VALIDATION",
        `Unknown sourceResultId "${args.sourceResultId}". Search first or omit it.`,
      );
    }
    const option = await createOption(
      context.access,
      {
        category: args.category,
        title,
        description:
          args.description?.slice(0, 2000) ?? source?.description ?? null,
        url: source?.url ?? null,
        sourceName: source?.sourceName ?? null,
        priceAmount: source?.priceAmount ?? null,
        priceCurrency: source?.priceCurrency ?? null,
        priceUnit: source?.priceUnit ?? null,
        priceNote: source ? statedByNote(source) : null,
        locationName:
          args.locationName?.slice(0, 200) ?? source?.locationName ?? null,
        address: null,
        latitude: source?.latitude ?? null,
        longitude: source?.longitude ?? null,
      },
      source
        ? {
            origin: "RESEARCH_PROVIDER",
            retrievedAt: source.retrievedAt,
            rationale: args.rationale.slice(0, 1000),
            providerPayload: (source.payload ?? undefined) as never,
          }
        : { origin: "ATLAS", rationale: args.rationale.slice(0, 1000) },
    );
    context.effects.push({
      tool: this.name,
      ok: true,
      kind: "saved",
      summary: `Saved "${option.title}" to options`,
      entityId: option.id,
    });
    return { saved: true, optionId: option.id, status: option.status };
  },
});

/** Labels a live price or availability with the source that stated it and when. */
function statedByNote(source: ResearchResult) {
  const parts = [
    source.priceAmount ? "Price as stated" : null,
    source.availabilityNote
      ? `Availability: ${source.availabilityNote.slice(0, 160)}`
      : null,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return `${parts.join(". ")} (${source.sourceName}, retrieved ${source.retrievedAt.toISOString().slice(0, 16).replace("T", " ")} UTC)`.slice(
    0,
    300,
  );
}

const listSavedOptions = defineTool({
  name: "list_saved_research",
  description:
    "List options the group already saved, so research is reused instead of repeated.",
  args: z.object({
    category: z.enum(OptionCategory).nullable(),
    status: z.enum(OptionStatus).nullable(),
  }),
  phases: ["trip"],
  async run(context, args) {
    if (context.phase !== "trip") return {};
    const options = await listOptions(context.access, {
      category: args.category,
      status: args.status ?? "ACTIVE",
    });
    context.effects.push({
      tool: this.name,
      ok: true,
      kind: "read",
      summary: "Checked saved options",
    });
    return {
      options: options.slice(0, 30).map((option) => ({
        id: option.id,
        category: option.category,
        title: option.title,
        status: option.status,
        origin: option.origin,
        price: option.priceAmount
          ? `${option.priceAmount.toFixed(2)} ${option.priceCurrency ?? ""} ${option.priceUnit ?? ""}`.trim()
          : null,
        url: option.url,
        source: option.sourceName,
        retrievedAt: option.retrievedAt?.toISOString() ?? null,
        notes: option.notes.slice(-3).map((note) => note.body),
      })),
    };
  },
});

// ---------------------------------------------------------------------------
// Flights
// ---------------------------------------------------------------------------

/** Keeps offers for save_flight_option and search_return_flights, and shapes the tool output. */
function flightToolOutput(context: TripContext, result: FlightSearchResult) {
  const listed = result.offers.slice(0, 6).map((offer) => {
    const id = nextResultId(context.flightResults.keys());
    context.flightResults.set(id, offer);
    context.newFlightResultIds.push(id);
    return {
      resultId: id,
      airline: offer.airline.name,
      totalPrice: `${offer.totalAmount} ${offer.totalCurrency} ${isRoundTrip(offer) ? "round-trip " : ""}total for ${offer.passengers}`,
      slices: describeOffer(offer),
      returnNotLoaded: Boolean(offer.pendingReturn),
      link: offer.bookingUrl ?? null,
    };
  });
  return {
    available: true,
    testData: result.testMode,
    dataNotice: result.testMode
      ? `${TEST_DATA_NOTICE}. These come from Duffel's test environment and may use real airline names, but they are samples. Tell the user plainly that they are test data and not real flights, fares, or availability.`
      : `Prices are as ${result.sourceName} showed them at retrieval and can change before booking. This app does not book flights.`,
    source: result.sourceName,
    retrievedAt: result.retrievedAt,
    reusedEarlierSearch: result.cached ?? false,
    priceInsights: result.priceInsights
      ? {
          ...result.priceInsights,
          note: "Google's own estimate for this route, not a fare.",
        }
      : null,
    search: result.search,
    bookElsewhere:
      listed.find((item) => item.link)?.link ??
      bookElsewhereUrl({
        origin: result.search.origin.iataCode,
        destination: result.search.destination.iataCode,
        departureDate: result.search.departureDate,
        returnDate: result.search.returnDate,
      }),
    results: listed,
  };
}

const searchFlightsTool = defineTool({
  name: "search_flights",
  description:
    "Search flights with the configured flight provider. Call it only when the user wants flights or flight prices. Returns priced offers with airline, local times, stops, duration, total price and currency, source, retrieval time, and any price insights, or says flight search is unavailable. If a place name fits more than one city, no search is run and the error lists the choices: ask the user which one they mean, then search again with that choice. Only state flight details that this tool returned.",
  args: z.object({
    origin: z
      .string()
      .describe(
        "Departure airport or city: an IATA airport or city code like JFK or NYC (preferred, it saves a lookup), or a city name like New York.",
      ),
    destination: z
      .string()
      .describe(
        "Arrival airport or city: an IATA airport or city code like LIS (preferred, it saves a lookup), or a city name like Lisbon.",
      ),
    departureDate: z.string().regex(DATE_PATTERN).describe("YYYY-MM-DD."),
    returnDate: z
      .string()
      .regex(DATE_PATTERN)
      .nullable()
      .describe("YYYY-MM-DD for a round trip, or null for one way."),
    passengers: z
      .number()
      .int()
      .nullable()
      .describe(
        `Adult travelers, 1 to ${MAX_FLIGHT_PASSENGERS}. null uses the trip's group size.`,
      ),
    cabin: z.enum(CABIN_CLASSES).nullable().describe("null means any cabin."),
    maxStops: z
      .number()
      .int()
      .nullable()
      .describe("0 for nonstop only, up to 2. null means at most 1 stop."),
  }),
  phases: ["trip"],
  async run(context, args) {
    if (context.phase !== "trip") return {};
    if (!context.flights) {
      context.effects.push({
        tool: this.name,
        ok: false,
        kind: "searched",
        summary: "Flight search is not configured",
      });
      return {
        available: false,
        message:
          "Flight search is not configured, so there are no flight results. Do not quote airlines, times, or fares.",
      };
    }
    let passengers = args.passengers;
    if (passengers === null) {
      const trip = await db.trip.findUniqueOrThrow({
        where: { id: context.access.tripId },
        select: { groupSize: true },
      });
      passengers = trip.groupSize ?? 1;
    }
    const parsed = flightSearchFormSchema.safeParse({
      origin: args.origin,
      destination: args.destination,
      departureDate: args.departureDate,
      returnDate: args.returnDate ?? "",
      passengers: String(
        Math.min(Math.max(passengers, 1), MAX_FLIGHT_PASSENGERS),
      ),
      cabin: args.cabin ?? "any",
      maxStops: String(Math.min(Math.max(args.maxStops ?? 1, 0), 2)),
    });
    if (!parsed.success) {
      throw new DomainError(
        "VALIDATION",
        `No search was run. ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
      );
    }
    const result = await searchFlights(context.flights, parsed.data);
    const output = flightToolOutput(context, result);
    const route = `${placeCodes(result.search.origin)} to ${placeCodes(result.search.destination)}`;
    context.effects.push({
      tool: this.name,
      ok: true,
      kind: "searched",
      summary: `Searched ${result.sourceName} for flights ${route} (${output.results.length} results${result.cached ? ", reused from an earlier search" : ""})${result.testMode ? `. ${TEST_DATA_NOTICE}` : ""}`,
      testData: result.testMode,
    });
    return output;
  },
});

const searchReturnFlightsTool = defineTool({
  name: "search_return_flights",
  description:
    "Load return flight options for one round-trip result from search_flights whose return is not loaded yet (returnNotLoaded: true). Each call spends a search from a limited quota, so call it only when the user asks for return flights for that result. Returns round-trip offers with both legs.",
  args: z.object({
    resultId: z.string().describe("resultId from search_flights."),
  }),
  phases: ["trip"],
  async run(context, args) {
    if (context.phase !== "trip") return {};
    const offer = context.flightResults.get(args.resultId);
    if (!offer) {
      throw new DomainError(
        "VALIDATION",
        `Unknown resultId "${args.resultId}". Search flights first.`,
      );
    }
    const result = await searchReturnFlights(context.flights, offer);
    const output = flightToolOutput(context, result);
    context.effects.push({
      tool: this.name,
      ok: true,
      kind: "searched",
      summary: `Loaded return flights from ${result.sourceName} (${output.results.length} results${result.cached ? ", reused from an earlier search" : ""})`,
      testData: result.testMode,
    });
    return output;
  },
});

const saveFlightTool = defineTool({
  name: "save_flight_option",
  description:
    "Save one flight from search_flights to the trip's options as a suggestion, with its source, price, and retrieval time. This is not a booking and does not reserve anything. If the user says they already bought it, use record_booking instead.",
  args: z.object({
    resultId: z.string().describe("resultId from search_flights."),
  }),
  phases: ["trip"],
  async run(context, args) {
    if (context.phase !== "trip") return {};
    const offer = context.flightResults.get(args.resultId);
    if (!offer) {
      throw new DomainError(
        "VALIDATION",
        `Unknown resultId "${args.resultId}". Search flights first.`,
      );
    }
    const saved = await saveFlightOffer(context.access, offer, {
      asBooking: false,
    });
    if (!saved.alreadySaved) {
      context.effects.push({
        tool: this.name,
        ok: true,
        kind: "saved",
        summary: `Saved a ${offer.airline.name} flight to options${offer.testMode ? ` (${TEST_DATA_NOTICE})` : ""}`,
        entityId: saved.optionId,
        testData: offer.testMode,
      });
    }
    return {
      saved: !saved.alreadySaved,
      alreadySaved: saved.alreadySaved,
      optionId: saved.optionId,
      status: "SUGGESTED",
      testData: offer.testMode,
    };
  },
});

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

const suggestTaskTool = defineTool({
  name: "suggest_task",
  description:
    "Suggest a task based on what is missing (for example: find a place to stay for six people). It is saved as a suggestion that a member accepts or dismisses.",
  args: z.object({
    title: z.string(),
    description: z.string().nullable(),
    priority: z.enum(TaskPriority),
    relatedOptionId: z.string().nullable(),
  }),
  phases: ["trip"],
  async run(context, args) {
    if (context.phase !== "trip") return {};
    const title = args.title.trim().slice(0, 200);
    if (!title) throw new DomainError("VALIDATION", "The task needs a title.");
    const result = await suggestTask(context.access, {
      title,
      description: args.description?.trim().slice(0, 2000) || null,
      priority: args.priority,
      relatedOptionId: args.relatedOptionId,
    });
    if (!result.task)
      return { created: false, duplicateOfTaskId: result.duplicateOf };
    context.effects.push({
      tool: this.name,
      ok: true,
      kind: "suggestion",
      summary: `Suggested task: ${result.task.title}`,
      entityId: result.task.id,
    });
    return { created: true, taskId: result.task.id, status: "SUGGESTED" };
  },
});

const proposeEventTool = defineTool({
  name: "propose_itinerary_event",
  description:
    "Propose an activity for a gap in the itinerary. It is saved as a suggestion shown apart from confirmed plans until a member accepts it. Never present opening hours, travel times, or reservations as verified.",
  args: z.object({
    title: z.string(),
    kind: z.enum(EventKind),
    date: z
      .string()
      .regex(DATE_PATTERN)
      .describe("YYYY-MM-DD within the trip dates."),
    startTime: z
      .string()
      .nullable()
      .describe("HH:MM 24-hour local time, or null if not important."),
    endTime: z.string().nullable(),
    locationName: z.string().nullable(),
    notes: z.string().nullable(),
    rationale: z.string().describe("Why this fits the group and the gap."),
    caveats: z
      .string()
      .nullable()
      .describe("What is unverified, e.g. opening hours, travel time, price."),
    relatedOptionId: z.string().nullable(),
  }),
  phases: ["trip"],
  async run(context, args) {
    if (context.phase !== "trip") return {};
    const title = args.title.trim().slice(0, 200);
    if (!title)
      throw new DomainError("VALIDATION", "The suggestion needs a title.");
    for (const time of [args.startTime, args.endTime]) {
      if (time !== null && !isTimeOfDay(time))
        throw new DomainError(
          "VALIDATION",
          `Invalid time "${time}". Use HH:MM.`,
        );
    }
    const event = await proposeEvent(context.access, {
      title,
      kind: args.kind,
      date: args.date,
      startMinute: args.startTime ? timeToMinutes(args.startTime) : null,
      endMinute: args.endTime ? timeToMinutes(args.endTime) : null,
      locationName: args.locationName?.slice(0, 200) ?? null,
      notes: args.notes?.slice(0, 2000) ?? null,
      rationale: args.rationale.slice(0, 1000),
      caveats: args.caveats?.slice(0, 1000) ?? null,
      researchOptionId: args.relatedOptionId,
    });
    context.effects.push({
      tool: this.name,
      ok: true,
      kind: "suggestion",
      summary: `Suggested for the itinerary: ${event.title}`,
      entityId: event.id,
    });
    return { created: true, eventId: event.id, status: "SUGGESTED" };
  },
});

// ---------------------------------------------------------------------------
// Stops
// ---------------------------------------------------------------------------

const updateStopsTool = defineTool({
  name: "update_trip_stops",
  description:
    "Record the places the trip visits, in travel order, with dates when known: one stop per place (for example Jackson Hole, then Park City). Airports people only fly through go in update_trip_details (flyIntoAirport, flyOutOfAirport), not here. Send small changes. Adding stops or filling in missing dates applies directly; removing, renaming, reordering, or changing a date someone set needs a member to accept it.",
  args: z.object({
    changes: z
      .array(
        z.object({
          action: z.enum(["add", "update", "remove", "move"]),
          name: z
            .string()
            .describe(
              "The place, like 'Jackson Hole'. For update, remove, and move: the stop's current name.",
            ),
          newName: z.string().nullable().describe("Only to rename a stop."),
          startDate: z
            .string()
            .regex(DATE_PATTERN)
            .nullable()
            .describe("YYYY-MM-DD the group arrives, if the user said it."),
          endDate: z
            .string()
            .regex(DATE_PATTERN)
            .nullable()
            .describe("YYYY-MM-DD the group leaves, if the user said it."),
          position: z
            .number()
            .int()
            .nullable()
            .describe(
              "Zero-based place in the order, for add or move. null adds at the end.",
            ),
        }),
      )
      .min(1)
      .max(12),
  }),
  phases: ["draft", "trip"],
  async run(context, args) {
    const ops: StopOp[] = args.changes.map((change) => {
      switch (change.action) {
        case "add":
          return {
            op: "add",
            name: change.name,
            startDate: change.startDate,
            endDate: change.endDate,
            position: change.position,
          };
        case "update":
          return {
            op: "update",
            name: change.name,
            newName: change.newName,
            startDate: change.startDate,
            endDate: change.endDate,
          };
        case "remove":
          return { op: "remove", name: change.name };
        case "move":
          if (change.position === null)
            throw new DomainError(
              "VALIDATION",
              "Nothing was changed. Moving a stop needs a position.",
            );
          return { op: "move", name: change.name, position: change.position };
      }
    });

    if (context.phase === "draft") {
      const applied = applyStopOps(context.draft.stops, ops);
      if (!applied.ok)
        throw new DomainError(
          "VALIDATION",
          `Nothing was changed. ${applied.error}`,
        );
      const problem = stopListProblem(applied.stops, context.draft.details);
      if (problem)
        throw new DomainError("VALIDATION", `Nothing was changed. ${problem}`);
      const draft: TripDraft = { ...context.draft, stops: applied.stops };
      await context.saveDraft(draft);
      context.draft = draft;
      context.effects.push({
        tool: this.name,
        ok: true,
        kind: "updated",
        summary: `Noted stops: ${describeStops(applied.stops)}`,
      });
      return {
        saved: true,
        stops: applied.stops,
        ...(await themeNote(context)),
      };
    }

    const result = await applyAtlasStops(context.access, {
      ops,
      conversationId: context.conversationId,
    });
    if (result.kind === "applied") {
      context.effects.push({
        tool: this.name,
        ok: true,
        kind: "updated",
        summary: `Updated stops: ${describeStops(result.stops)}`,
      });
    }
    if (result.proposal) pushProposal(context, this.name, result.proposal);
    return {
      applied: result.kind === "applied",
      unchanged: result.kind === "none",
      stops: result.stops,
      needsConfirmation: result.proposal ? [result.proposal.summary] : [],
      ...(result.proposal ? confirmationNote(context) : {}),
      ...(await themeNote(context)),
    };
  },
});

// ---------------------------------------------------------------------------
// Recording bookings the user made
// ---------------------------------------------------------------------------

const SELF_WORDS = new Set(["me", "i", "myself", "self", "user", "the user"]);

/** Resolves "me" and member names to member IDs. Unknown or ambiguous names are an error. */
async function resolveTravelers(context: TripContext, names: string[]) {
  const wanted = names.map((name) => name.trim()).filter(Boolean);
  if (wanted.length === 0) return [context.access.memberId];
  const members = await db.tripMember.findMany({
    where: { tripId: context.access.tripId },
    select: { id: true, user: { select: { name: true, email: true } } },
  });
  const ids = new Set<string>();
  for (const name of wanted) {
    const key = name.toLowerCase();
    if (SELF_WORDS.has(key)) {
      ids.add(context.access.memberId);
      continue;
    }
    const full = members.filter(
      (member) => member.user.name?.trim().toLowerCase() === key,
    );
    const first = members.filter(
      (member) => firstName(member.user.name).toLowerCase() === key,
    );
    const found = full.length > 0 ? full : first;
    if (found.length > 1)
      throw new DomainError(
        "VALIDATION",
        `More than one member is called ${name}. Nothing was recorded. Ask which one, using their full name.`,
      );
    if (found.length === 0)
      throw new DomainError(
        "VALIDATION",
        `${name} isn't a member of this trip, so nothing was recorded. Ask the user to invite them first, or record it for the user.`,
      );
    ids.add(found[0]!.id);
  }
  return [...ids];
}

function placeName(airport: FlightAirport) {
  return airport.cityName
    ? `${airport.cityName} (${airport.iataCode})`
    : airport.iataCode;
}

function sliceTitle(airline: string, slice: FlightSlice) {
  const numbers = slice.segments
    .map((segment) => segment.flightNumber)
    .filter(Boolean)
    .join(", ");
  return `${airline}${numbers ? ` ${numbers}` : ""}: ${slice.origin.iataCode} to ${slice.destination.iataCode}`;
}

function sliceFields(slice: FlightSlice) {
  return {
    startDate: localDate(slice.departingAt),
    startTime: localClock(slice.departingAt),
    endDate: localDate(slice.arrivingAt),
    endTime: localClock(slice.arrivingAt),
    fromLocation: placeName(slice.origin),
    toLocation: placeName(slice.destination),
    reference: slice.segments
      .map((segment) => segment.flightNumber)
      .filter(Boolean)
      .join(", "),
  };
}

type RawBooking = {
  title: string;
  provider: string;
  url: string;
  reference: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  fromLocation: string;
  toLocation: string;
  costAmount: string;
  currency: string;
  costIsEstimate: boolean;
  costSplit: "SHARED_EQUALLY" | "PER_PERSON";
  notes: string;
};

const recordBookingArgs = z.object({
  category: z.enum(BookingCategory),
  travelers: z
    .array(z.string())
    .describe(
      'Who it is for: "me" for the user, or the names of trip members. Empty means the user.',
    ),
  fromShownFlight: z
    .object({
      resultId: z
        .string()
        .nullable()
        .describe("resultId of a flight shown earlier, only if you are sure."),
      airline: z.string().nullable(),
      flightNumber: z.string().nullable(),
      date: z
        .string()
        .regex(DATE_PATTERN)
        .nullable()
        .describe("Departure date, YYYY-MM-DD."),
      departureTime: z
        .string()
        .nullable()
        .describe("Local departure time as HH:MM, 24-hour."),
      arrivalTime: z
        .string()
        .nullable()
        .describe("Local arrival time as HH:MM, 24-hour. 2:59 PM is 14:59."),
      origin: z.string().nullable().describe("Airport code or city."),
      destination: z.string().nullable().describe("Airport code or city."),
      leg: z
        .enum(["outbound", "return", "both"])
        .nullable()
        .describe(
          "For a round-trip result, which flight they bought. null if not said.",
        ),
    })
    .nullable()
    .describe(
      "Use for a flight from search results shown earlier in this conversation. Fill in what the user said about it; the app finds the exact result or reports that it is ambiguous.",
    ),
  title: z.string().nullable(),
  provider: z
    .string()
    .nullable()
    .describe(
      "Airline, hotel, company, or who is driving (for example 'Friend driving').",
    ),
  reference: z
    .string()
    .nullable()
    .describe("Flight number or confirmation code, if the user gave one."),
  fromLocation: z.string().nullable(),
  toLocation: z.string().nullable(),
  startDate: z.string().regex(DATE_PATTERN).nullable(),
  startTime: z.string().nullable().describe("Local time as HH:MM, 24-hour."),
  endDate: z.string().regex(DATE_PATTERN).nullable(),
  endTime: z.string().nullable().describe("Local time as HH:MM, 24-hour."),
  costAmount: z
    .string()
    .regex(MONEY_PATTERN)
    .nullable()
    .describe("Only what the user said they paid, like 189.40."),
  currency: z.string().nullable().describe("ISO code like USD."),
  costPerPerson: z
    .boolean()
    .nullable()
    .describe("true if the stated cost is per traveler."),
  notes: z.string().nullable(),
});

const recordBookingTool = defineTool({
  name: "record_booking",
  description:
    "Record something the user says is already booked or arranged: a flight they bought, a stay they reserved, or a ground leg such as a friend driving them between stops. For themselves or a named trip member. The user's statement is enough; do not ask the group to confirm. It is saved in Bookings as booked for those travelers, never as confirmed with the airline or provider. For a flight from search results shown earlier, fill fromShownFlight instead of copying details.",
  args: recordBookingArgs,
  phases: ["trip"],
  async run(context, args) {
    if (context.phase !== "trip") return {};
    for (const time of [args.startTime, args.endTime]) {
      if (time !== null && !isTimeOfDay(time))
        throw new DomainError(
          "VALIDATION",
          `Nothing was recorded. Invalid time "${time}". Use HH:MM.`,
        );
    }
    const memberIds = await resolveTravelers(context, args.travelers);
    // A flight picked from search results is a flight, whatever category was sent.
    const category = args.fromShownFlight ? "FLIGHT" : args.category;
    const trip = await db.trip.findUniqueOrThrow({
      where: { id: context.access.tripId },
      select: { currency: true },
    });
    const userName = firstName(context.user.name);
    const recordedOn = new Date().toISOString().slice(0, 10);
    const provenance = `Recorded from what ${userName} told ${ASSISTANT_NAME} on ${recordedOn}. Not checked with the airline or provider.`;

    const stated = {
      costAmount: args.costAmount ?? "",
      // An amount without a currency is in the trip's currency.
      currency: (
        args.currency ?? (args.costAmount ? trip.currency : "")
      ).toUpperCase(),
      costIsEstimate: false,
      costSplit: args.costPerPerson
        ? ("PER_PERSON" as const)
        : ("SHARED_EQUALLY" as const),
    };
    const rows: RawBooking[] = [];
    let offerId: string | null = null;

    if (args.fromShownFlight) {
      const shown = [...context.flightResults.entries()].map(
        ([resultId, offer]) => ({ resultId, offer }),
      );
      const matches = matchShownFlights(shown, args.fromShownFlight);
      if (matches.length === 0) {
        return {
          recorded: false,
          notFound: true,
          message:
            "No flight shown earlier in this conversation fits that description. Nothing was recorded. Ask the user for the airline, flight number, date, and times, or record it from what they said without fromShownFlight.",
        };
      }
      if (matches.length > 1) {
        return {
          recorded: false,
          ambiguous: true,
          candidates: matches.slice(0, 6).map((match) => ({
            resultId: match.resultId,
            flight: describeMatch(match),
          })),
          message:
            "More than one flight shown earlier fits. Nothing was recorded. Ask the user which one they bought, for example by time or flight number.",
        };
      }
      const [match] = matches as [(typeof matches)[number]];
      const { offer } = match;
      const wholeOffer = match.slices.length === offer.slices.length;
      offerId = wholeOffer ? offer.offerId : null;
      // The search price covers the whole result: use it only when that is what was bought.
      const searchPrice =
        wholeOffer && !offer.pendingReturn && !args.costAmount
          ? {
              costAmount: offer.totalAmount,
              currency: offer.totalCurrency,
              costIsEstimate: true,
              costSplit: "SHARED_EQUALLY" as const,
            }
          : null;
      const priceNote = searchPrice
        ? ` Price is what ${offer.sourceName} showed for ${offer.passengers === 1 ? "1 traveler" : `${offer.passengers} travelers`} on ${offer.retrievedAt.slice(0, 10)}; update it with what was paid.`
        : "";
      match.slices.forEach((slice, index) => {
        rows.push({
          ...sliceFields(slice),
          title: (args.title && match.slices.length === 1
            ? args.title
            : sliceTitle(offer.airline.name, slice)
          ).slice(0, 200),
          provider: offer.airline.name,
          url: offer.bookingUrl ?? "",
          ...(index === 0
            ? (searchPrice ?? stated)
            : {
                costAmount: searchPrice || args.costAmount ? "0" : "",
                currency: searchPrice?.currency ?? stated.currency,
                costIsEstimate: searchPrice?.costIsEstimate ?? false,
                costSplit: "SHARED_EQUALLY" as const,
              }),
          notes: [
            provenance,
            `From ${offer.sourceName} results shown on ${offer.retrievedAt.slice(0, 10)}.${index === 0 ? priceNote : " Cost is included with the outbound flight."}`,
            offer.testMode ? `${TEST_DATA_NOTICE}.` : null,
            args.notes,
          ]
            .filter(Boolean)
            .join("\n"),
        });
      });
    } else {
      const route =
        args.fromLocation && args.toLocation
          ? `${args.fromLocation} to ${args.toLocation}`
          : null;
      const title =
        args.title?.trim() ||
        [args.provider?.trim() || BOOKING_CATEGORY_SINGULAR[category], route]
          .filter(Boolean)
          .join(": ");
      rows.push({
        title: title.slice(0, 200),
        provider: args.provider ?? "",
        url: "",
        reference: args.reference ?? "",
        startDate: args.startDate ?? "",
        startTime: args.startTime ?? "",
        endDate: args.endDate ?? args.startDate ?? "",
        endTime: args.endTime ?? "",
        fromLocation: args.fromLocation ?? "",
        toLocation: args.toLocation ?? "",
        ...stated,
        notes: [provenance, args.notes].filter(Boolean).join("\n"),
      });
    }

    const recorded: { id: string; title: string; created: boolean }[] = [];
    for (const row of rows) {
      const existing = await findExistingBooking(context.access, {
        category,
        title: row.title,
        startDate: row.startDate || null,
        offerId,
      });
      if (existing) {
        // A record that stands for a whole round trip is updated once, not once per leg.
        if (recorded.some((item) => item.id === existing.id)) continue;
        await recordTravelersBooked(context.access, existing.id, memberIds);
        recorded.push({
          id: existing.id,
          title: existing.title,
          created: false,
        });
        continue;
      }
      const parsed = bookingFormSchema.safeParse({
        category,
        status: "BOOKED",
        researchOptionId: "",
        locationName: "",
        address: "",
        ...row,
        participants: memberIds.map((memberId) => ({
          memberId,
          status: "BOOKED",
          shareAmount: "",
          roomAssignment: "",
        })),
      });
      if (!parsed.success) {
        throw new DomainError(
          "VALIDATION",
          `Nothing was recorded. ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
        );
      }
      const booking = await createBooking(context.access, parsed.data);
      recorded.push({ id: booking.id, title: booking.title, created: true });
    }

    const names = await memberNames(context.access.tripId, memberIds);
    for (const item of recorded) {
      context.effects.push({
        tool: this.name,
        ok: true,
        kind: "recorded",
        summary: item.created
          ? `Recorded "${item.title}" in Bookings as booked for ${names}`
          : `Marked "${item.title}" as booked for ${names}`,
        entityId: item.id,
        entityType: "booking",
        ...(item.created ? { undo: "delete_booking" as const } : {}),
      });
    }
    return {
      recorded: true,
      bookings: recorded.map((item) => ({
        bookingId: item.id,
        title: item.title,
        newRecord: item.created,
      })),
      travelers: names,
      note: "Saved in Bookings as booked for these travelers, from what the user said. It is not confirmed with the airline or provider; never say it is. Tell the user they can edit or undo it from the buttons under your reply.",
    };
  },
});

async function memberNames(tripId: string, memberIds: string[]) {
  const members = await db.tripMember.findMany({
    where: { tripId, id: { in: memberIds } },
    select: { user: { select: { name: true } } },
  });
  return members.map((member) => firstName(member.user.name)).join(", ");
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

const suggestThemeTasksTool = defineTool({
  name: "suggest_theme_tasks",
  description:
    "Suggest the usual tasks for the trip's theme, such as ski or snowboard rentals, lift passes, lessons, and gear for a ski trip. Only after the theme is recorded. Each one waits for a member to accept it.",
  args: z.object({ theme: z.enum(TripTheme) }),
  phases: ["trip"],
  async run(context, args) {
    if (context.phase !== "trip") return {};
    const trip = await db.trip.findUniqueOrThrow({
      where: { id: context.access.tripId },
      select: { theme: true },
    });
    if (trip.theme !== args.theme)
      throw new DomainError(
        "VALIDATION",
        "Record the theme with update_trip_details first, and only once the user has said it.",
      );
    const tasks = THEME_TASKS[args.theme] ?? [];
    const created: string[] = [];
    const alreadyOnTrip: string[] = [];
    for (const task of tasks) {
      const result = await suggestTask(context.access, {
        title: task.title,
        description: task.description,
        priority: task.priority,
        relatedOptionId: null,
      });
      if (!result.task) {
        alreadyOnTrip.push(task.title);
        continue;
      }
      created.push(result.task.title);
      context.effects.push({
        tool: this.name,
        ok: true,
        kind: "suggestion",
        summary: `Suggested task: ${result.task.title}`,
        entityId: result.task.id,
      });
    }
    return {
      theme: TRIP_THEME_LABELS[args.theme],
      suggested: created,
      alreadyOnTrip,
      note:
        tasks.length === 0
          ? "There are no standard tasks for this theme."
          : "Suggested tasks wait for a member to accept them on the Tasks tab.",
    };
  },
});

// ---------------------------------------------------------------------------
// Registry and execution
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ALL_TOOLS: AtlasTool<any>[] = [
  getTripState,
  updateTripDetails,
  updateStopsTool,
  recordBookingTool,
  searchOptions,
  saveOption,
  listSavedOptions,
  searchFlightsTool,
  searchReturnFlightsTool,
  saveFlightTool,
  suggestTaskTool,
  suggestThemeTasksTool,
  proposeEventTool,
  summarizeOutstanding,
];

export function toolsFor(phase: AtlasContext["phase"]): ToolSpec[] {
  return ALL_TOOLS.filter((tool) => tool.phases.includes(phase)).map(
    (tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: toStrictJsonSchema(tool.args),
    }),
  );
}

/**
 * Runs one tool call from the model. Arguments are parsed and validated before anything is
 * written. Every failure is returned to the model as data and recorded as an effect; a failed
 * call never leaves partial changes because each service runs in a transaction.
 */
export async function executeToolCall(
  context: AtlasContext,
  call: ToolCall,
): Promise<string> {
  const tool = ALL_TOOLS.find(
    (candidate) =>
      candidate.name === call.name && candidate.phases.includes(context.phase),
  );
  if (!tool)
    return JSON.stringify({
      ok: false,
      error: `Tool "${call.name}" is not available here.`,
    });

  let raw: unknown;
  try {
    raw = JSON.parse(call.arguments || "{}");
  } catch {
    context.effects.push({
      tool: call.name,
      ok: false,
      kind: "error",
      summary: "Atlas sent malformed tool input; nothing was changed",
    });
    return JSON.stringify({
      ok: false,
      error: "Arguments were not valid JSON. Nothing was changed.",
    });
  }
  const parsed = tool.args.safeParse(raw);
  if (!parsed.success) {
    context.effects.push({
      tool: call.name,
      ok: false,
      kind: "error",
      summary: "Atlas sent invalid tool input; nothing was changed",
    });
    return JSON.stringify({
      ok: false,
      error: "Invalid arguments. Nothing was changed.",
      issues: parsed.error.issues
        .slice(0, 8)
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    });
  }

  try {
    const result = await tool.run(context, parsed.data);
    return JSON.stringify({ ok: true, result });
  } catch (error) {
    const message =
      error instanceof DomainError
        ? error.message
        : "The action failed. Nothing was changed.";
    if (!(error instanceof DomainError)) {
      console.error(
        `[atlas] tool ${call.name} failed:`,
        error instanceof Error ? error.message : "unknown",
      );
    }
    context.effects.push({
      tool: call.name,
      ok: false,
      kind: "error",
      summary: message,
    });
    return JSON.stringify({ ok: false, error: message });
  }
}
