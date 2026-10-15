import { beforeEach, describe, expect, it } from "vitest";

import { parseDraft } from "@/lib/domain/trip-details";
import { requireTripAccess } from "@/server/access";
import { sendAtlasMessage } from "@/server/ai/orchestrator";
import { LlmProviderError } from "@/server/ai/types";
import { DomainError } from "@/server/errors";
import {
  ResearchFailedError,
  type ResearchProvider,
  type ResearchResult,
} from "@/server/research";
import { resetRateLimits } from "@/server/rate-limit";
import {
  startCreationConversation,
  getOrCreateTripConversation,
} from "@/server/services/conversations";
import { removeMember } from "@/server/services/members";
import {
  createManualTrip,
  listPendingProposals,
  resolveProposal,
} from "@/server/services/trips";

import { addMember, createUser, db, resetDatabase } from "../support/db";
import { ScriptedProvider, updateCall } from "../support/mock-provider";

beforeEach(async () => {
  await resetDatabase();
  resetRateLimits();
});

describe("conversational trip creation", () => {
  it("extracts details into the draft, then creates the trip once there is enough", async () => {
    const user = await createUser("Riley");
    const conversation = await startCreationConversation(user.id, "VIBE");
    const provider = new ScriptedProvider([
      {
        calls: [
          updateCall(
            { tripStyle: "beaches and good food" },
            {
              preferences: [
                {
                  kind: "DIETARY",
                  strength: "REQUIREMENT",
                  description: "Vegetarian",
                },
              ],
            },
          ),
        ],
        reply: "Beaches and food, got it. When could you travel?",
      },
      {
        calls: [
          updateCall(
            {
              dateNotes: "a week in late June",
              departureLocation: "Chicago",
              dateFlexibility: "FLEXIBLE",
            },
            {
              candidateDestinations: [
                {
                  name: "Lisbon",
                  reason: "Beaches nearby and great food",
                  suggestedBy: "atlas",
                },
              ],
            },
          ),
        ],
        reply: "Lisbon could work well.",
      },
    ]);

    const first = await sendAtlasMessage(
      user,
      conversation.id,
      "Somewhere with beaches and great food. I'm vegetarian.",
      { provider },
    );
    expect(first).toMatchObject({
      replied: true,
      tripCreated: false,
      tripId: null,
    });
    const afterFirst = await db.conversation.findUniqueOrThrow({
      where: { id: conversation.id },
    });
    const draft = parseDraft(afterFirst.draft);
    expect(draft.details.tripStyle).toBe("beaches and good food");
    expect(draft.preferences).toEqual([
      { kind: "DIETARY", strength: "REQUIREMENT", description: "Vegetarian" },
    ]);
    // Atlas is told what is already known so it does not ask again.
    expect(provider.requests[0]!.instructions).toContain("Worth asking next");

    const second = await sendAtlasMessage(
      user,
      conversation.id,
      "Late June for a week, flying from Chicago.",
      { provider },
    );
    expect(second.tripCreated).toBe(true);
    const tripId = second.tripId!;
    const trip = await db.trip.findUniqueOrThrow({
      where: { id: tripId },
      include: { members: true, preferences: true, options: true },
    });
    expect(trip).toMatchObject({
      startMode: "VIBE",
      tripStyle: "beaches and good food",
      departureLocation: "Chicago",
      dateNotes: "a week in late June",
      dateFlexibility: "FLEXIBLE",
      startDate: null,
      destination: null,
      createdById: user.id,
    });
    expect(trip.title).toBe("Lisbon trip");
    expect(trip.members).toEqual([
      expect.objectContaining({ userId: user.id, role: "ORGANIZER" }),
    ]);
    expect(trip.preferences).toHaveLength(1);
    expect(trip.options).toEqual([
      expect.objectContaining({
        category: "DESTINATION",
        title: "Lisbon",
        status: "SUGGESTED",
        origin: "ATLAS",
      }),
    ]);

    // The conversation continues as the user's thread for the trip, with full history saved.
    const linked = await db.conversation.findUniqueOrThrow({
      where: { id: conversation.id },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    expect(linked.tripId).toBe(tripId);
    expect(linked.messages.map((message) => message.role)).toEqual([
      "USER",
      "ASSISTANT",
      "USER",
      "ASSISTANT",
    ]);
    expect(linked.messages[1]!.model).toBe("mock:scripted");
    expect(linked.messages[1]!.metadata).toMatchObject({
      effects: [expect.objectContaining({ kind: "updated", ok: true })],
    });
  });

  it("rejects invalid model output without changing anything", async () => {
    const user = await createUser("Riley");
    const conversation = await startCreationConversation(
      user.id,
      "KNOWN_DESTINATION",
    );
    const provider = new ScriptedProvider([
      {
        calls: [
          updateCall({ destination: "Lisbon", startDate: "2027-02-30" }),
          { name: "update_trip_details", args: null, raw: "{not json" },
          {
            name: "update_trip_details",
            args: { changes: { destination: 42 } },
          },
          updateCall({ startDate: "2027-06-10", endDate: "2027-06-01" }),
          { name: "drop_database", args: {} },
        ],
        reply: "Something went wrong saving that.",
      },
    ]);
    const result = await sendAtlasMessage(
      user,
      conversation.id,
      "Lisbon on February 30th",
      { provider },
    );
    expect(result.tripCreated).toBe(false);
    expect(
      provider.toolOutputs.every(
        (entry) => (entry.output as { ok: boolean }).ok === false,
      ),
    ).toBe(true);
    const saved = await db.conversation.findUniqueOrThrow({
      where: { id: conversation.id },
    });
    expect(parseDraft(saved.draft).details.destination).toBeNull();
    expect(await db.trip.count()).toBe(0);
    const reply = await db.message.findFirstOrThrow({
      where: { conversationId: conversation.id, role: "ASSISTANT" },
    });
    expect(reply.metadata).toMatchObject({
      effects: expect.arrayContaining([
        expect.objectContaining({ ok: false, kind: "error" }),
      ]),
    });
  });

  it("records provider failures as a notice and never as an Atlas reply", async () => {
    const user = await createUser("Riley");
    const conversation = await startCreationConversation(
      user.id,
      "KNOWN_DESTINATION",
    );
    const provider = new ScriptedProvider([
      {
        calls: [updateCall({ groupSize: 4 })],
        failAfterTools: new LlmProviderError("timeout", "slow"),
      },
    ]);
    const result = await sendAtlasMessage(user, conversation.id, "Four of us", {
      provider,
    });
    expect(result.replied).toBe(false);
    const messages = await db.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "asc" },
    });
    expect(messages.map((message) => message.role)).toEqual(["USER", "NOTICE"]);
    expect(messages[1]!.content).toMatch(/took too long/);
    expect(messages[1]!.content).toMatch(
      /Before the error, these changes were saved/,
    );
    expect(
      parseDraft(
        (
          await db.conversation.findUniqueOrThrow({
            where: { id: conversation.id },
          })
        ).draft,
      ).details.groupSize,
    ).toBe(4);
  });

  it("refuses to run without a configured provider and saves nothing", async () => {
    const user = await createUser("Riley");
    const conversation = await startCreationConversation(user.id, "DISCOVER");
    await expect(
      sendAtlasMessage(user, conversation.id, "Hello", { provider: null }),
    ).rejects.toMatchObject({
      code: "UNAVAILABLE",
      message: expect.stringContaining("Atlas needs configuration"),
    });
    expect(await db.message.count()).toBe(0);
  });

  it("does not let someone use another user's conversation", async () => {
    const owner = await createUser("Owner");
    const other = await createUser("Other");
    const conversation = await startCreationConversation(owner.id, "VIBE");
    await expect(
      sendAtlasMessage(other, conversation.id, "hi", {
        provider: new ScriptedProvider([]),
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});

describe("planning on a shared trip", () => {
  async function tripWithConversation() {
    const organizer = await createUser("Organizer");
    const trip = await createManualTrip(organizer.id, {
      title: "Lisbon",
      destination: "Lisbon",
      startDate: "2027-05-20",
      endDate: "2027-05-23",
    });
    const access = await requireTripAccess(trip.id, organizer.id);
    const conversation = await getOrCreateTripConversation(access);
    return { organizer, trip, access, conversation };
  }

  it("turns a change to a known value into a proposal the group must accept", async () => {
    const { organizer, trip, access, conversation } =
      await tripWithConversation();
    const provider = new ScriptedProvider([
      {
        calls: [updateCall({ destination: "Porto", groupSize: 5 })],
        reply: "I noted the group size and proposed switching to Porto.",
      },
    ]);
    await sendAtlasMessage(
      organizer,
      conversation.id,
      "Actually let's do Porto, and we are 5 now",
      { provider },
    );

    const afterTurn = await db.trip.findUniqueOrThrow({
      where: { id: trip.id },
    });
    expect(afterTurn.destination).toBe("Lisbon");
    expect(afterTurn.groupSize).toBe(5);
    const [proposal] = await listPendingProposals(access);
    expect(proposal!.changes.map((change) => change.field)).toEqual([
      "destination",
    ]);
    const toolResult = provider.toolOutputs[0]!.output as {
      result: { needsConfirmation: string[] };
    };
    expect(toolResult.result.needsConfirmation[0]).toContain("Porto");

    await resolveProposal(access, proposal!.id, true);
    expect(
      (await db.trip.findUniqueOrThrow({ where: { id: trip.id } })).destination,
    ).toBe("Porto");
  });

  it("saves suggestions for review and validates proposed itinerary dates", async () => {
    const { organizer, trip, conversation } = await tripWithConversation();
    const provider = new ScriptedProvider([
      {
        calls: [
          {
            name: "suggest_task",
            args: {
              title: "Find accommodation for six people",
              description: null,
              priority: "HIGH",
              relatedOptionId: null,
            },
          },
          {
            name: "propose_itinerary_event",
            args: {
              title: "Sunset at Miradouro da Senhora do Monte",
              kind: "ACTIVITY",
              date: "2027-05-21",
              startTime: "19:00",
              endTime: "20:30",
              locationName: "Graça",
              notes: null,
              rationale: "Free, and fits the open evening.",
              caveats: "Sunset time not verified.",
              relatedOptionId: null,
            },
          },
          {
            name: "propose_itinerary_event",
            args: {
              title: "Outside the trip",
              kind: "ACTIVITY",
              date: "2027-06-30",
              startTime: null,
              endTime: null,
              locationName: null,
              notes: null,
              rationale: "x",
              caveats: null,
              relatedOptionId: null,
            },
          },
          {
            name: "search_options",
            args: {
              category: "LODGING",
              query: "apartment for six",
              location: "Lisbon",
            },
          },
          {
            name: "save_research_option",
            args: {
              category: "ACTIVITY",
              title: "Tile museum",
              description: null,
              rationale: "Rainy-day option",
              sourceResultId: null,
              locationName: null,
            },
          },
        ],
        reply:
          "I added a task suggestion and an evening idea for you to review.",
      },
    ]);
    await sendAtlasMessage(
      organizer,
      conversation.id,
      "What should we do next?",
      { provider },
    );

    expect(
      await db.task.findFirstOrThrow({ where: { tripId: trip.id } }),
    ).toMatchObject({ status: "SUGGESTED", origin: "ATLAS" });
    const events = await db.itineraryEvent.findMany({
      where: { tripId: trip.id },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      status: "SUGGESTED",
      startMinute: 19 * 60,
      caveats: "Sunset time not verified.",
    });
    const outputs = provider.toolOutputs.map(
      (entry) =>
        entry.output as {
          ok: boolean;
          result?: Record<string, unknown>;
          error?: string;
        },
    );
    expect(outputs[2]).toMatchObject({
      ok: false,
      error: expect.stringContaining("after the trip ends"),
    });
    expect(outputs[3]).toMatchObject({
      ok: true,
      result: { available: false },
    });
    const idea = await db.researchOption.findFirstOrThrow({
      where: { tripId: trip.id },
    });
    expect(idea).toMatchObject({
      origin: "ATLAS",
      priceAmount: null,
      url: null,
      retrievedAt: null,
      status: "SUGGESTED",
    });
  });

  it("stops answering for someone who was removed from the trip", async () => {
    const { organizer, trip } = await tripWithConversation();
    const member = await createUser("Member");
    const membership = await addMember(trip.id, member.id);
    const access = await requireTripAccess(trip.id, member.id);
    const conversation = await getOrCreateTripConversation(access);
    await removeMember(trip.id, organizer.id, membership.id);
    await expect(
      sendAtlasMessage(member, conversation.id, "hi", {
        provider: new ScriptedProvider([]),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("saves a live web result with its source, stated price, and retrieval time, and cites it under the reply", async () => {
    const { organizer, trip, conversation } = await tripWithConversation();
    const retrievedAt = new Date("2026-10-15T09:30:00.000Z");
    const live: ResearchResult = {
      title: "Casa do Azulejo",
      description: "Guesthouse in Alfama.",
      url: "https://stays.example/casa-do-azulejo",
      sourceName: "Stays Example",
      priceAmount: "145",
      priceCurrency: "EUR",
      priceUnit: "night",
      availabilityNote: "Two rooms left for May 20 to 24",
      locationName: "Alfama, Lisbon",
      latitude: null,
      longitude: null,
      retrievedAt,
      payload: {
        provider: "openai_web",
        citedUrl: "https://stays.example/casa-do-azulejo",
      },
    };
    const research: ResearchProvider = {
      id: "openai_web",
      label: "OpenAI web search",
      isConfigured: true,
      search: async () => [live],
    };
    const provider = new ScriptedProvider([
      {
        calls: [
          {
            name: "search_options",
            args: {
              category: "LODGING",
              query: "guesthouse in Alfama",
              location: "Lisbon",
            },
          },
          {
            name: "save_research_option",
            args: {
              category: "LODGING",
              title: "Casa do Azulejo",
              description: null,
              rationale: "Central and within budget.",
              sourceResultId: "r1",
              locationName: null,
            },
          },
        ],
        reply:
          "I found [Casa do Azulejo](https://stays.example/casa-do-azulejo).",
      },
    ]);
    await sendAtlasMessage(organizer, conversation.id, "Find a guesthouse", {
      provider,
      research,
    });

    const search = provider.toolOutputs[0]!.output as {
      result: { results: Record<string, unknown>[] };
    };
    expect(search.result.results[0]).toMatchObject({
      resultId: "r1",
      url: live.url,
      price: { amount: "145 EUR per night", statedBy: "Stays Example" },
      availability: { note: "Two rooms left for May 20 to 24" },
    });
    const option = await db.researchOption.findFirstOrThrow({
      where: { tripId: trip.id },
    });
    expect(option).toMatchObject({
      origin: "RESEARCH_PROVIDER",
      status: "SUGGESTED",
      url: live.url,
      sourceName: "Stays Example",
      priceCurrency: "EUR",
      priceUnit: "night",
      retrievedAt,
      locationName: "Alfama, Lisbon",
    });
    expect(option.priceAmount?.toString()).toBe("145");
    expect(option.priceNote).toContain(
      "Stays Example, retrieved 2026-10-15 09:30 UTC",
    );
    expect(option.priceNote).toContain("Two rooms left");
    expect(option.providerPayload).toMatchObject({ provider: "openai_web" });

    const reply = await db.message.findFirstOrThrow({
      where: { conversationId: conversation.id, role: "ASSISTANT" },
    });
    expect(reply.metadata).toMatchObject({
      sources: [
        {
          title: "Casa do Azulejo",
          url: live.url,
          sourceName: "Stays Example",
          retrievedAt: retrievedAt.toISOString(),
        },
      ],
    });
  });

  it("reports a failed live search to Atlas without saving anything or attaching sources", async () => {
    const { organizer, trip, conversation } = await tripWithConversation();
    const research: ResearchProvider = {
      id: "openai_web",
      label: "OpenAI web search",
      isConfigured: true,
      search: async () => {
        throw new ResearchFailedError("Could not reach OpenAI web search.");
      },
    };
    const provider = new ScriptedProvider([
      {
        calls: [
          {
            name: "search_options",
            args: { category: "LODGING", query: "hotels", location: "Lisbon" },
          },
        ],
        reply: "Live research failed, so I have no live results right now.",
      },
    ]);
    await sendAtlasMessage(organizer, conversation.id, "Find hotels", {
      provider,
      research,
    });
    expect(provider.toolOutputs[0]!.output).toMatchObject({
      ok: true,
      result: {
        available: false,
        failed: true,
        message: expect.stringContaining(
          "Live research failed: Could not reach OpenAI web search.",
        ),
      },
    });
    expect(await db.researchOption.count({ where: { tripId: trip.id } })).toBe(
      0,
    );
    const reply = await db.message.findFirstOrThrow({
      where: { conversationId: conversation.id, role: "ASSISTANT" },
    });
    expect(reply.metadata).not.toHaveProperty("sources");
    expect(reply.metadata).toMatchObject({
      effects: [
        expect.objectContaining({
          ok: false,
          kind: "error",
          summary: "Live research failed: Could not reach OpenAI web search.",
        }),
      ],
    });
  });
});
