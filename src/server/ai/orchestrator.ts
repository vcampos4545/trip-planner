import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { ASSISTANT_NAME } from "@/config/brand";
import { todayDateOnly } from "@/lib/dates";
import { isShownFlight, type ShownFlight } from "@/lib/domain/flight-match";
import { THEME_TASKS } from "@/lib/domain/theme";
import {
  isEstablishable,
  parseDraft,
  type TripDraft,
} from "@/lib/domain/trip-details";
import { requireTripAccess, type TripAccess } from "@/server/access";
import type { CurrentUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { conflict, DomainError, invalid } from "@/server/errors";
import { checkRateLimit } from "@/server/rate-limit";
import {
  getResearchProvider,
  type ResearchProvider,
  type ResearchResult,
} from "@/server/research";
import { getFlightProvider, type FlightSearchProvider } from "@/server/flights";
import { getOwnConversation } from "@/server/services/conversations";
import { createTripFromDraft, loadTripDraft } from "@/server/services/trips";

import { getAiStatus } from "./config";
import { buildInstructions } from "./prompts";
import { getLlmProvider } from "./provider";
import {
  executeToolCall,
  toolsFor,
  type AtlasContext,
  type ToolEffect,
} from "./tools";
import {
  LlmProviderError,
  type ChatTurn,
  type LlmProvider,
  type ProviderErrorKind,
} from "./types";

export const MAX_MESSAGE_LENGTH = 4000;
const HISTORY_TURNS = 30;
/** How many recent replies to scan for flight results Atlas showed. */
const FLIGHT_RESULT_MESSAGES = 12;
const MAX_SHOWN_FLIGHTS = 24;
const MAX_TOOL_ROUNDS = 5;
const REPLY_TIMEOUT_MS = 90_000;

/** A live search result the reply drew on, shown under the reply as a citation link. */
export type MessageSource = {
  title: string;
  url: string;
  sourceName: string;
  retrievedAt: string;
};

export type MessageMetadata = {
  effects?: ToolEffect[];
  sources?: MessageSource[];
  /** Flight results first shown with this reply, kept so later turns can refer back to them. */
  flightResults?: ShownFlight[];
  error?: ProviderErrorKind;
};

export type AtlasTurnResult = {
  replied: boolean;
  tripId: string | null;
  tripCreated: boolean;
  effects: ToolEffect[];
};

type Dependencies = {
  provider?: LlmProvider | null;
  research?: ResearchProvider;
  flights?: FlightSearchProvider | null;
  now?: Date;
};

const FAILURE_TEXT: Record<ProviderErrorKind, string> = {
  auth: `${ASSISTANT_NAME} couldn't reply because the AI provider rejected the server's API key. Ask whoever runs this app to check OPENAI_API_KEY.`,
  rate_limit: `${ASSISTANT_NAME} is getting too many requests right now. Wait a minute and try again.`,
  timeout: `${ASSISTANT_NAME} took too long to reply. Try sending your message again.`,
  unavailable: `${ASSISTANT_NAME} couldn't reach the AI provider. Try again in a moment.`,
  bad_response: `${ASSISTANT_NAME} couldn't produce a usable reply. Try rephrasing your message.`,
  refused: `${ASSISTANT_NAME} declined to answer that. Try asking in a different way.`,
};

/**
 * Handles one user message: saves it, lets Atlas read and update the trip through validated
 * tools, and saves the reply. Provider failures are recorded as a notice, never as a fake reply,
 * and they never undo or corrupt changes that tools already committed.
 */
export async function sendAtlasMessage(
  user: CurrentUser,
  conversationId: string,
  rawContent: string,
  deps: Dependencies = {},
): Promise<AtlasTurnResult> {
  const content = rawContent.trim();
  if (!content) throw invalid("Type a message first.");
  if (content.length > MAX_MESSAGE_LENGTH)
    throw invalid(`Messages can be up to ${MAX_MESSAGE_LENGTH} characters.`);

  const conversation = await getOwnConversation(user.id, conversationId);
  const access = conversation.tripId
    ? await requireTripAccess(conversation.tripId, user.id)
    : null;

  const provider =
    deps.provider === undefined ? getLlmProvider() : deps.provider;
  if (!provider) {
    const status = getAiStatus();
    throw new DomainError(
      "UNAVAILABLE",
      `${ASSISTANT_NAME} needs configuration before it can reply. ${status.configured ? "" : status.reason}`.trim(),
    );
  }
  checkRateLimit(`atlas:${user.id}`, 20, 60_000);

  const now = deps.now ?? new Date();
  await db.message.create({
    data: {
      conversationId: conversation.id,
      role: "USER",
      content,
      authorId: user.id,
    },
  });
  await db.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: now },
  });

  const history = await loadHistory(conversation.id);
  const effects: ToolEffect[] = [];
  const research = deps.research ?? getResearchProvider();
  const flights =
    deps.flights === undefined ? getFlightProvider() : deps.flights;

  let context: AtlasContext;
  let draftForPrompt: TripDraft;
  let memberNames: string[] | undefined;
  let shownFlights: ShownFlight[] = [];
  let themeTasksPending = false;
  const startMode = conversation.startMode ?? "MANUAL";

  if (access) {
    const loaded = await loadTripContextDraft(access);
    draftForPrompt = loaded.draft;
    memberNames = loaded.memberNames;
    themeTasksPending = loaded.themeTasksPending;
    shownFlights = await loadShownFlights(conversation.id);
    context = {
      phase: "trip",
      user,
      conversationId: conversation.id,
      effects,
      access,
      soloTrip: loaded.memberNames.length === 1,
      research,
      searchResults: new Map(),
      flights,
      flightResults: new Map(
        shownFlights.map((item) => [item.resultId, item.offer]),
      ),
      newFlightResultIds: [],
    };
  } else {
    draftForPrompt = parseDraft(conversation.draft);
    context = {
      phase: "draft",
      user,
      conversationId: conversation.id,
      effects,
      startMode: startMode === "MANUAL" ? "KNOWN_DESTINATION" : startMode,
      draft: draftForPrompt,
      saveDraft: async (draft) => {
        await db.conversation.updateMany({
          where: { id: conversation.id, tripId: null },
          data: { draft: draft as unknown as Prisma.InputJsonValue },
        });
      },
    };
  }

  const instructions = buildInstructions({
    phase: context.phase,
    startMode: access
      ? (
          await db.trip.findUniqueOrThrow({
            where: { id: access.tripId },
            select: { startMode: true },
          })
        ).startMode
      : startMode,
    draft: draftForPrompt,
    today: todayDateOnly(now),
    memberNames,
    userName: user.name,
    researchAvailable: research.isConfigured,
    researchUnavailableReason: research.unavailableReason ?? null,
    flightSearch: !flights ? "off" : flights.testMode ? "test" : "live",
    flightSource: flights?.label,
    soloTrip: context.phase === "trip" ? context.soloTrip : true,
    shownFlights,
    themeTasksPending,
  });

  let replied = false;
  try {
    const result = await provider.generate({
      instructions,
      messages: history,
      tools: toolsFor(context.phase),
      executeTool: (call) => executeToolCall(context, call),
      maxToolRounds: MAX_TOOL_ROUNDS,
      signal: AbortSignal.timeout(REPLY_TIMEOUT_MS),
    });
    const sources =
      context.phase === "trip"
        ? sourcesFrom(context.searchResults.values())
        : [];
    const flightResults =
      context.phase === "trip" ? newFlightResults(context) : [];
    await db.message.create({
      data: {
        conversationId: conversation.id,
        role: "ASSISTANT",
        content: labelTestData(result.text, effects),
        model: `${provider.id}:${result.model}`,
        metadata: {
          effects,
          ...(sources.length > 0 ? { sources } : {}),
          ...(flightResults.length > 0 ? { flightResults } : {}),
        } satisfies MessageMetadata as unknown as Prisma.InputJsonValue,
      },
    });
    replied = true;
  } catch (error) {
    const kind: ProviderErrorKind =
      error instanceof LlmProviderError ? error.kind : "unavailable";
    if (!(error instanceof LlmProviderError)) {
      console.error(
        "[atlas] unexpected failure:",
        error instanceof Error ? error.message : "unknown",
      );
    }
    const committed = effects.filter(
      (effect) => effect.ok && effect.kind !== "read",
    );
    const notice = [
      FAILURE_TEXT[kind],
      "Your message is saved.",
      committed.length > 0
        ? `Before the error, these changes were saved: ${committed.map((effect) => effect.summary).join("; ")}.`
        : "Nothing in the trip was changed.",
    ].join(" ");
    const flightResults =
      context.phase === "trip" ? newFlightResults(context) : [];
    await db.message.create({
      data: {
        conversationId: conversation.id,
        role: "NOTICE",
        content: notice,
        metadata: {
          effects,
          error: kind,
          ...(flightResults.length > 0 ? { flightResults } : {}),
        } satisfies MessageMetadata as unknown as Prisma.InputJsonValue,
      },
    });
  }

  await db.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date() },
  });

  if (context.phase === "draft" && isEstablishable(context.draft)) {
    const tripId = await convertConversationToTrip(user.id, conversation.id);
    return { replied, tripId, tripCreated: true, effects };
  }
  return { replied, tripId: conversation.tripId, tripCreated: false, effects };
}

function newFlightResults(context: {
  flightResults: Map<string, ShownFlight["offer"]>;
  newFlightResultIds: string[];
}): ShownFlight[] {
  return context.newFlightResultIds.flatMap((resultId) => {
    const offer = context.flightResults.get(resultId);
    return offer ? [{ resultId, offer }] : [];
  });
}

/**
 * Flight results shown in this conversation's recent replies, oldest first. A later turn uses
 * them to resolve "I bought the Southwest flight" to the exact result that was shown.
 */
export async function loadShownFlights(
  conversationId: string,
): Promise<ShownFlight[]> {
  const recent = await db.message.findMany({
    where: { conversationId, role: { in: ["ASSISTANT", "NOTICE"] } },
    orderBy: { createdAt: "desc" },
    take: FLIGHT_RESULT_MESSAGES,
    select: { metadata: true },
  });
  const shown: ShownFlight[] = [];
  for (const message of recent.reverse()) {
    const metadata = message.metadata as { flightResults?: unknown } | null;
    if (!Array.isArray(metadata?.flightResults)) continue;
    shown.push(...metadata.flightResults.filter(isShownFlight));
  }
  return shown.slice(-MAX_SHOWN_FLIGHTS);
}

function sourcesFrom(results: Iterable<ResearchResult>): MessageSource[] {
  const sources = new Map<string, MessageSource>();
  for (const result of results) {
    if (!result.url || sources.has(result.url)) continue;
    sources.set(result.url, {
      title: result.title,
      url: result.url,
      sourceName: result.sourceName,
      retrievedAt: result.retrievedAt.toISOString(),
    });
  }
  return [...sources.values()];
}

export const TEST_DATA_REPLY_NOTICE =
  "Note: these flight results are Duffel test data, not real flights, fares, or availability.";

/**
 * Test flight data must never read as real. If a tool returned test data and the reply does not
 * already say so, a plain notice is added to the reply.
 */
export function labelTestData(text: string, effects: ToolEffect[]) {
  if (!effects.some((effect) => effect.testData)) return text;
  if (/test data/i.test(text)) return text;
  return `${text.trimEnd()}\n\n${TEST_DATA_REPLY_NOTICE}`;
}

async function loadHistory(conversationId: string): Promise<ChatTurn[]> {
  const recent = await db.message.findMany({
    where: { conversationId, role: { in: ["USER", "ASSISTANT"] } },
    orderBy: { createdAt: "desc" },
    take: HISTORY_TURNS,
    select: { role: true, content: true },
  });
  return recent.reverse().map((message) => ({
    role: message.role === "USER" ? "user" : "assistant",
    content: message.content,
  }));
}

async function loadTripContextDraft(access: TripAccess) {
  const [draft, trip, members] = await Promise.all([
    loadTripDraft(access),
    db.trip.findUniqueOrThrow({
      where: { id: access.tripId },
      select: { theme: true },
    }),
    db.tripMember.findMany({
      where: { tripId: access.tripId },
      select: { user: { select: { name: true } } },
    }),
  ]);
  const themeTasks = trip.theme ? (THEME_TASKS[trip.theme] ?? []) : [];
  const existingThemeTasks =
    themeTasks.length > 0
      ? await db.task.count({
          where: {
            tripId: access.tripId,
            title: { in: themeTasks.map((task) => task.title) },
          },
        })
      : 0;
  return {
    draft,
    memberNames: members.map(
      (member) => member.user.name?.split(/\s+/)[0] ?? "Member",
    ),
    themeTasksPending: themeTasks.length > 0 && existingThemeTasks === 0,
  };
}

/**
 * Turns a creation conversation into a trip, once. The conversation then continues as the
 * user's planning thread for that trip.
 */
export async function convertConversationToTrip(
  userId: string,
  conversationId: string,
) {
  const conversation = await getOwnConversation(userId, conversationId);
  if (conversation.tripId) return conversation.tripId;
  const draft = parseDraft(conversation.draft);
  const startMode =
    conversation.startMode && conversation.startMode !== "MANUAL"
      ? conversation.startMode
      : "KNOWN_DESTINATION";
  return db.$transaction(async (tx) => {
    const trip = await createTripFromDraft(tx, { userId, startMode, draft });
    const linked = await tx.conversation.updateMany({
      where: { id: conversation.id, userId, tripId: null },
      data: { tripId: trip.id, draft: undefined },
    });
    if (linked.count !== 1)
      throw conflict("This conversation already became a trip.");
    return trip.id;
  });
}

/** Saves edits the user made directly to the draft details before the trip exists. */
export async function updateDraft(
  userId: string,
  conversationId: string,
  draft: TripDraft,
) {
  const conversation = await getOwnConversation(userId, conversationId);
  if (conversation.tripId)
    throw conflict(
      "This conversation already became a trip. Edit the trip instead.",
    );
  await db.conversation.update({
    where: { id: conversation.id },
    data: { draft: draft as unknown as Prisma.InputJsonValue },
  });
}
