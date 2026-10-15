import "server-only";

import { z } from "zod";

import {
  ArrangementStatus,
  BudgetBasis,
  BudgetComponent,
  DateFlexibility,
  EventKind,
  OptionCategory,
  OptionStatus,
  PreferenceKind,
  PreferenceStrength,
  TaskPriority,
} from "@/generated/prisma/enums";
import {
  formatMinutes,
  isTimeOfDay,
  timeToMinutes,
  toDateOnly,
} from "@/lib/dates";
import { nextTopics } from "@/lib/domain/follow-up";
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
import { describeFields, tripToDetails } from "@/server/services/trip-mapping";
import { applyAtlasPatch, describeChange } from "@/server/services/trips";
import { createOption, listOptions } from "@/server/services/research";
import { suggestTask } from "@/server/services/tasks";
import { proposeEvent } from "@/server/services/itinerary";

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
    | "searched"
    | "read"
    | "error";
  summary: string;
  entityId?: string;
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
  research: ResearchProvider;
  searchResults: Map<string, ResearchResult>;
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
    .describe("Short working title. Only if the user named the trip."),
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
    .describe("City or airport people leave from."),
  tripStyle: z
    .string()
    .nullable()
    .describe("The vibe or kind of trip, in the user's words."),
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
    if (result.proposal) {
      context.effects.push({
        tool: this.name,
        ok: true,
        kind: "proposal",
        summary: `Proposed change awaiting confirmation: ${result.proposal.summary}`,
        entityId: result.proposal.id,
      });
    }
    return {
      appliedFields: result.applied.map((change) => change.field),
      needsConfirmation: result.proposal
        ? result.proposal.changes.map(describeChange)
        : [],
      rejected: result.rejected,
      addedPreferences: result.addedPreferences,
      addedCandidateDestinations: result.addedCandidates,
    };
  },
});

// ---------------------------------------------------------------------------
// Reading state
// ---------------------------------------------------------------------------

function summarizeDraft(draft: TripDraft) {
  return {
    details: draft.details,
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
      select: {
        id: true,
        category: true,
        title: true,
        status: true,
        startDate: true,
        endDate: true,
        costAmount: true,
        currency: true,
        _count: { select: { participants: true } },
      },
    }),
    db.tripDetailProposal.findMany({
      where: { tripId: access.tripId, status: "PENDING" },
      select: { summary: true },
      take: 10,
    }),
  ]);

  return {
    trip: {
      ...tripToDetails(trip),
      stage: trip.stage,
      startMode: trip.startMode,
    },
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
      status: booking.status,
      start: booking.startDate ? toDateOnly(booking.startDate) : null,
      end: booking.endDate ? toDateOnly(booking.endDate) : null,
      travelers: booking._count.participants,
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
// Registry and execution
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ALL_TOOLS: AtlasTool<any>[] = [
  getTripState,
  updateTripDetails,
  searchOptions,
  saveOption,
  listSavedOptions,
  suggestTaskTool,
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
