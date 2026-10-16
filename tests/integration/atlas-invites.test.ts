import { beforeEach, describe, expect, it } from "vitest";

import { requireTripAccess } from "@/server/access";
import { sendAtlasMessage } from "@/server/ai/orchestrator";
import type { EmailMessage, EmailProvider } from "@/server/email";
import { resetRateLimits } from "@/server/rate-limit";
import { getOrCreateTripConversation } from "@/server/services/conversations";
import { acceptInvitation } from "@/server/services/invitations";
import { createManualTrip } from "@/server/services/trips";

import { addMember, createUser, db, resetDatabase } from "../support/db";
import { ScriptedProvider } from "../support/mock-provider";

const APP_URL = "https://trips.example.test";
const LINK_PATTERN =
  /https:\/\/trips\.example\.test\/invite\/([A-Za-z0-9_-]{40,})/;

class RecordingEmail implements EmailProvider {
  readonly id = "recording";
  readonly label = "Recording";
  readonly sent: EmailMessage[] = [];
  async send(message: EmailMessage) {
    this.sent.push(message);
    return { id: "1" };
  }
}

beforeEach(async () => {
  await resetDatabase();
  resetRateLimits();
});

async function tripWith(userName = "Olivia") {
  const organizer = await createUser(userName);
  const trip = await createManualTrip(organizer.id, {
    title: "Lisbon",
    destination: "Lisbon",
    startDate: null,
    endDate: null,
  });
  return { organizer, trip };
}

async function lastAssistantText(conversationId: string) {
  const message = await db.message.findFirstOrThrow({
    where: { conversationId, role: { in: ["ASSISTANT", "NOTICE"] } },
    orderBy: { createdAt: "desc" },
  });
  return message.content;
}

describe("Atlas invitations", () => {
  it("creates an invite link and adds it under the reply without sending the token to the model", async () => {
    const { organizer, trip } = await tripWith();
    const conversation = await getOrCreateTripConversation(
      await requireTripAccess(trip.id, organizer.id),
    );
    const provider = new ScriptedProvider([
      {
        calls: [
          {
            name: "create_invite_link",
            args: { role: null, expiresInDays: 3, maxUses: 5 },
          },
        ],
        reply: "Here's a link for your friends. Copy it from below.",
      },
      { reply: "Anything else?" },
    ]);
    await sendAtlasMessage(organizer, conversation.id, "invite my friends", {
      provider,
      appUrl: APP_URL,
      email: null,
    });

    const reply = await lastAssistantText(conversation.id);
    const match = LINK_PATTERN.exec(reply);
    expect(match).not.toBeNull();
    const token = match![1]!;
    expect(reply).toContain("up to 5 people");

    // The model saw neither the token in the tool result nor in the next turn's history.
    expect(JSON.stringify(provider.toolOutputs)).not.toContain(token);
    await sendAtlasMessage(organizer, conversation.id, "thanks", {
      provider,
      appUrl: APP_URL,
      email: null,
    });
    expect(JSON.stringify(provider.requests[1]!.messages)).not.toContain(token);

    // The link works.
    const friend = await createUser("Friend");
    await expect(acceptInvitation(token, friend.id)).resolves.toMatchObject({
      joined: true,
    });
    const invitation = await db.tripInvitation.findFirstOrThrow({
      where: { tripId: trip.id },
    });
    expect(invitation).toMatchObject({ maxUses: 5, createdById: organizer.id });
  });

  it("uses the same permissions: a member can't invite unless organizers allow it", async () => {
    const { trip } = await tripWith();
    const member = await createUser("Member");
    await addMember(trip.id, member.id);
    const conversation = await getOrCreateTripConversation(
      await requireTripAccess(trip.id, member.id),
    );
    const provider = new ScriptedProvider([
      {
        calls: [
          {
            name: "create_invite_link",
            args: { role: null, expiresInDays: null, maxUses: null },
          },
        ],
        reply: "Only an organizer can invite people.",
      },
    ]);
    await sendAtlasMessage(member, conversation.id, "invite my friends", {
      provider,
      appUrl: APP_URL,
      email: null,
    });
    expect(provider.toolOutputs[0]!.output).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Only organizers/),
    });
    expect(await db.tripInvitation.count()).toBe(0);
    expect(await lastAssistantText(conversation.id)).not.toMatch(/\/invite\//);
  });

  it("never emails addresses the user didn't type in the message", async () => {
    const { organizer, trip } = await tripWith();
    const conversation = await getOrCreateTripConversation(
      await requireTripAccess(trip.id, organizer.id),
    );
    const email = new RecordingEmail();
    const provider = new ScriptedProvider([
      {
        calls: [
          {
            name: "invite_by_email",
            args: { emails: ["guessed@example.test"], role: null },
          },
        ],
        reply: "Which addresses should I invite?",
      },
    ]);
    await sendAtlasMessage(organizer, conversation.id, "email my friends", {
      provider,
      appUrl: APP_URL,
      email,
    });
    expect(provider.toolOutputs[0]!.output).toMatchObject({ ok: false });
    expect(email.sent).toHaveLength(0);
    expect(await db.tripInvitation.count()).toBe(0);
  });

  it("emails addresses the user typed, and says plainly when email isn't set up", async () => {
    const { organizer, trip } = await tripWith();
    const conversation = await getOrCreateTripConversation(
      await requireTripAccess(trip.id, organizer.id),
    );
    const email = new RecordingEmail();
    const sent = new ScriptedProvider([
      {
        calls: [
          {
            name: "invite_by_email",
            args: { emails: ["Sam@Example.test"], role: null },
          },
        ],
        reply: "I emailed Sam.",
      },
    ]);
    await sendAtlasMessage(
      organizer,
      conversation.id,
      "please email an invite to sam@example.test",
      { provider: sent, appUrl: APP_URL, email },
    );
    expect(email.sent.map((message) => message.to)).toEqual([
      "sam@example.test",
    ]);
    expect(await lastAssistantText(conversation.id)).not.toMatch(/\/invite\//);

    const unsent = new ScriptedProvider([
      {
        calls: [
          {
            name: "invite_by_email",
            args: { emails: ["jo@example.test"], role: null },
          },
        ],
        reply: "Email isn't set up, so copy the link below.",
      },
    ]);
    await sendAtlasMessage(
      organizer,
      conversation.id,
      "invite jo@example.test by email",
      { provider: unsent, appUrl: APP_URL, email: null },
    );
    expect(unsent.toolOutputs[0]!.output).toMatchObject({
      ok: true,
      result: {
        emailConfigured: false,
        results: [{ email: "jo@example.test", outcome: "not emailed" }],
      },
    });
    const reply = await lastAssistantText(conversation.id);
    expect(reply).toMatch(/Invite link for jo@example\.test \(not emailed\)/);
    expect(reply).toMatch(LINK_PATTERN);
  });
});
