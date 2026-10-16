import { beforeEach, describe, expect, it } from "vitest";

import { requireTripAccess } from "@/server/access";
import {
  EmailSendError,
  type EmailMessage,
  type EmailProvider,
} from "@/server/email";
import { DomainError } from "@/server/errors";
import { resetRateLimits } from "@/server/rate-limit";
import {
  acceptInvitation,
  createInvitation,
  hashInviteToken,
  INVITE_RATE_LIMITS,
  inspectInvitation,
  inviteByEmail,
  listInvitations,
  resendInvitation,
  revokeInvitation,
  setMembersCanInvite,
} from "@/server/services/invitations";
import { createManualTrip } from "@/server/services/trips";

import { addMember, createUser, db, resetDatabase } from "../support/db";

const APP_URL = "https://trips.example.test";

/** Records messages instead of sending them. Nothing leaves the test process. */
class RecordingEmail implements EmailProvider {
  readonly id = "recording";
  readonly label = "Recording";
  readonly sent: EmailMessage[] = [];
  constructor(private readonly fail = false) {}
  async send(message: EmailMessage) {
    if (this.fail) throw new EmailSendError("The email service is down.");
    this.sent.push(message);
    return { id: `msg_${this.sent.length}` };
  }
}

function tokenFrom(url: string) {
  return url.split("/invite/")[1]!;
}

function tokenFromEmail(message: EmailMessage) {
  const match = /\/invite\/([A-Za-z0-9_-]+)/.exec(message.text);
  return match![1]!;
}

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(DomainError);
  expect((error as DomainError).code).toBe(code);
  return error as DomainError;
}

async function setup() {
  const owner = await createUser("Owner");
  const guest = await createUser("Guest");
  const trip = await createManualTrip(owner.id, {
    title: "Lisbon",
    destination: "Lisbon",
    startDate: "2027-05-01",
    endDate: "2027-05-08",
  });
  return { owner, guest, trip };
}

beforeEach(async () => {
  await resetDatabase();
  resetRateLimits();
});

describe("invite links", () => {
  it("stores only a hash of the token and lets a signed-in user join", async () => {
    const { owner, guest, trip } = await setup();
    const { token, invitation } = await createInvitation(trip.id, owner.id, {
      ttlDays: 7,
      maxUses: null,
    });

    const stored = await db.tripInvitation.findUniqueOrThrow({
      where: { id: invitation.id },
    });
    expect(stored.tokenHash).toBe(hashInviteToken(token));
    expect(JSON.stringify(stored)).not.toContain(token);

    await expect(
      inspectInvitation(token, { id: guest.id }),
    ).resolves.toMatchObject({
      status: "valid",
      preview: {
        tripTitle: "Lisbon",
        startDate: "2027-05-01",
        endDate: "2027-05-08",
        organizerName: "Owner",
        memberCount: 1,
        invitedEmail: null,
      },
    });
    await expect(acceptInvitation(token, guest.id)).resolves.toEqual({
      tripId: trip.id,
      joined: true,
    });
    await expect(requireTripAccess(trip.id, guest.id)).resolves.toMatchObject({
      role: "MEMBER",
    });

    // Joining twice is harmless and does not use the link again.
    await expect(acceptInvitation(token, guest.id)).resolves.toEqual({
      tripId: trip.id,
      joined: false,
    });
    expect(
      (
        await db.tripInvitation.findUniqueOrThrow({
          where: { id: invitation.id },
        })
      ).useCount,
    ).toBe(1);
    await expect(
      inspectInvitation(token, { id: guest.id }),
    ).resolves.toMatchObject({ status: "member" });
    expect(
      await db.activityLog.count({
        where: { tripId: trip.id, type: "INVITE_ACCEPTED" },
      }),
    ).toBe(1);
  });

  it("shows signed-out visitors the safe preview and nothing private", async () => {
    const { owner, trip } = await setup();
    await db.trip.update({
      where: { id: trip.id },
      data: { budgetNotes: "secret budget", summary: "private summary" },
    });
    const { token } = await createInvitation(trip.id, owner.id, {
      ttlDays: 7,
      maxUses: null,
    });
    const state = await inspectInvitation(token, null);
    expect(state.status).toBe("valid");
    const serialized = JSON.stringify(state);
    expect(serialized).not.toContain("secret budget");
    expect(serialized).not.toContain("private summary");
    expect(serialized).not.toContain(owner.email!);
    expect(serialized).not.toContain(trip.id);
  });

  it("joins with the role the link grants", async () => {
    const { owner, guest, trip } = await setup();
    const { token } = await createInvitation(trip.id, owner.id, {
      ttlDays: 7,
      maxUses: 1,
      role: "ORGANIZER",
    });
    await acceptInvitation(token, guest.id);
    await expect(requireTripAccess(trip.id, guest.id)).resolves.toMatchObject({
      role: "ORGANIZER",
    });
  });

  it("rejects expired, revoked, used-up, and unknown links without revealing anything", async () => {
    const { owner, guest, trip } = await setup();
    const past = new Date(Date.now() - 10 * 86_400_000);
    const expired = await createInvitation(
      trip.id,
      owner.id,
      { ttlDays: 1, maxUses: null },
      past,
    );
    await expect(
      inspectInvitation(expired.token, { id: guest.id }),
    ).resolves.toMatchObject({ status: "expired", tripTitle: "Lisbon" });
    await expect(acceptInvitation(expired.token, guest.id)).rejects.toThrow(
      /expired/,
    );

    const revoked = await createInvitation(trip.id, owner.id, {
      ttlDays: 7,
      maxUses: null,
    });
    await revokeInvitation(trip.id, owner.id, revoked.invitation.id);
    await expect(
      inspectInvitation(revoked.token, { id: guest.id }),
    ).resolves.toEqual({ status: "revoked" });
    await expect(acceptInvitation(revoked.token, guest.id)).rejects.toThrow(
      /revoked/,
    );

    const single = await createInvitation(trip.id, owner.id, {
      ttlDays: 7,
      maxUses: 1,
    });
    await acceptInvitation(single.token, (await createUser("First")).id);
    await expect(
      inspectInvitation(single.token, { id: guest.id }),
    ).resolves.toMatchObject({ status: "used_up" });
    await expect(acceptInvitation(single.token, guest.id)).rejects.toThrow(
      /limit/,
    );

    const unknown = "x".repeat(43);
    await expect(inspectInvitation(unknown, { id: guest.id })).resolves.toEqual(
      { status: "invalid" },
    );
    await expect(inspectInvitation("short", null)).resolves.toEqual({
      status: "invalid",
    });
    await expect(acceptInvitation(unknown, guest.id)).rejects.toBeInstanceOf(
      DomainError,
    );

    expect(await db.tripMember.count({ where: { tripId: trip.id } })).toBe(2);
    const listed = await listInvitations(
      await requireTripAccess(trip.id, owner.id),
    );
    expect(listed.links).toHaveLength(0);
  });

  it("enforces a use limit even when people join at the same time", async () => {
    const { owner, trip } = await setup();
    const { token } = await createInvitation(trip.id, owner.id, {
      ttlDays: 7,
      maxUses: 1,
    });
    const guests = await Promise.all([
      createUser("G1"),
      createUser("G2"),
      createUser("G3"),
    ]);
    const results = await Promise.allSettled(
      guests.map((guest) => acceptInvitation(token, guest.id)),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(await db.tripMember.count({ where: { tripId: trip.id } })).toBe(2);
  });

  it("limits how many links one person creates", async () => {
    const { owner, trip } = await setup();
    for (let i = 0; i < INVITE_RATE_LIMITS.create.limit; i += 1)
      await createInvitation(trip.id, owner.id, { ttlDays: 1, maxUses: 1 });
    await expectCode(
      createInvitation(trip.id, owner.id, { ttlDays: 1, maxUses: 1 }),
      "RATE_LIMITED",
    );
  });
});

describe("who can invite", () => {
  it("only lets organizers invite until they allow members to", async () => {
    const { owner, guest, trip } = await setup();
    await addMember(trip.id, guest.id);
    const memberAccess = await requireTripAccess(trip.id, guest.id);

    await expectCode(
      createInvitation(trip.id, guest.id, { ttlDays: 7, maxUses: null }),
      "FORBIDDEN",
    );
    await expectCode(
      inviteByEmail(
        trip.id,
        guest.id,
        { emails: ["friend@example.test"], ttlDays: 7 },
        { appUrl: APP_URL, email: null },
      ),
      "FORBIDDEN",
    );
    await expectCode(setMembersCanInvite(trip.id, guest.id, true), "FORBIDDEN");
    await expect(listInvitations(memberAccess)).resolves.toEqual({
      links: [],
      emails: [],
    });

    await setMembersCanInvite(trip.id, owner.id, true);
    const own = await createInvitation(trip.id, guest.id, {
      ttlDays: 7,
      maxUses: null,
    });
    // Members can't hand out the organizer role.
    await expectCode(
      createInvitation(trip.id, guest.id, {
        ttlDays: 7,
        maxUses: null,
        role: "ORGANIZER",
      }),
      "FORBIDDEN",
    );

    // A member sees and manages only the invitations they created.
    const ownerLink = await createInvitation(trip.id, owner.id, {
      ttlDays: 7,
      maxUses: null,
    });
    const listed = await listInvitations(memberAccess);
    expect(listed.links.map((link) => link.id)).toEqual([own.invitation.id]);
    await expectCode(
      revokeInvitation(trip.id, guest.id, ownerLink.invitation.id),
      "FORBIDDEN",
    );
    await revokeInvitation(trip.id, guest.id, own.invitation.id);

    // Turning the setting off takes the permission away again.
    await setMembersCanInvite(trip.id, owner.id, false);
    await expectCode(
      createInvitation(trip.id, guest.id, { ttlDays: 7, maxUses: null }),
      "FORBIDDEN",
    );
    expect(
      await db.activityLog.count({
        where: { tripId: trip.id, type: "INVITE_SETTINGS_CHANGED" },
      }),
    ).toBe(2);
  });

  it("keeps invitations scoped to their own trip", async () => {
    const { owner, trip } = await setup();
    const other = await createManualTrip(owner.id, {
      title: "Other",
      destination: null,
      startDate: null,
      endDate: null,
    });
    const { invitation } = await createInvitation(trip.id, owner.id, {
      ttlDays: 7,
      maxUses: null,
    });
    await expectCode(
      revokeInvitation(other.id, owner.id, invitation.id),
      "NOT_FOUND",
    );
    const stranger = await createUser("Stranger");
    await expectCode(
      revokeInvitation(trip.id, stranger.id, invitation.id),
      "NOT_FOUND",
    );
  });
});

describe("email invitations", () => {
  it("emails an invitation that only the matching verified account can accept", async () => {
    const { owner, trip } = await setup();
    const email = new RecordingEmail();
    const { results, emailConfigured } = await inviteByEmail(
      trip.id,
      owner.id,
      { emails: ["Jamie@Example.test"], ttlDays: 7 },
      { appUrl: APP_URL, email },
    );
    expect(emailConfigured).toBe(true);
    expect(results).toEqual([
      expect.objectContaining({ email: "jamie@example.test", outcome: "sent" }),
    ]);
    expect(results[0]).not.toHaveProperty("url");
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]!.to).toBe("jamie@example.test");
    expect(email.sent[0]!.subject).toContain("Lisbon");
    const token = tokenFromEmail(email.sent[0]!);

    const intruder = await createUser("Intruder");
    await expect(
      inspectInvitation(token, { id: intruder.id }),
    ).resolves.toMatchObject({
      status: "wrong_account",
      reason: "different",
      preview: { invitedEmail: "ja***@example.test" },
    });
    await expectCode(acceptInvitation(token, intruder.id), "FORBIDDEN");

    // Same address, but Google hasn't confirmed it for this account.
    const unverified = await createUser("Jamie", {
      email: "jamie@example.test",
      verified: false,
    });
    await expect(
      inspectInvitation(token, { id: unverified.id }),
    ).resolves.toMatchObject({ status: "wrong_account", reason: "unverified" });
    await expectCode(acceptInvitation(token, unverified.id), "FORBIDDEN");

    await db.user.update({
      where: { id: unverified.id },
      data: { emailVerified: new Date() },
    });
    await expect(acceptInvitation(token, unverified.id)).resolves.toEqual({
      tripId: trip.id,
      joined: true,
    });

    const listed = await listInvitations(
      await requireTripAccess(trip.id, owner.id),
    );
    expect(listed.emails).toEqual([
      expect.objectContaining({
        email: "jamie@example.test",
        status: "accepted",
        sendCount: 1,
        acceptedBy: { name: "Jamie" },
      }),
    ]);
    const types = (
      await db.activityLog.findMany({
        where: { tripId: trip.id },
        select: { type: true, summary: true },
      })
    ).map((entry) => entry.type);
    expect(types).toEqual(
      expect.arrayContaining([
        "INVITE_CREATED",
        "INVITE_SENT",
        "INVITE_ACCEPTED",
      ]),
    );
    // The activity feed never shows the full address of someone who isn't a member.
    const summaries = await db.activityLog.findMany({
      where: {
        tripId: trip.id,
        type: { in: ["INVITE_CREATED", "INVITE_SENT"] },
      },
      select: { summary: true },
    });
    for (const entry of summaries)
      expect(entry.summary).not.toContain("jamie@example.test");
  });

  it("creates the invitation and returns its link when email isn't configured", async () => {
    const { owner, guest, trip } = await setup();
    const { results, emailConfigured } = await inviteByEmail(
      trip.id,
      owner.id,
      { emails: ["sam@example.test", guest.email!], ttlDays: 3 },
      { appUrl: APP_URL, email: null },
    );
    expect(emailConfigured).toBe(false);
    const sam = results.find((result) => result.email === "sam@example.test");
    expect(sam).toMatchObject({ outcome: "not_sent" });
    expect(sam && "url" in sam ? sam.url : "").toMatch(
      new RegExp(`^${APP_URL}/invite/[A-Za-z0-9_-]{40,}$`),
    );
    const stored = await db.tripInvitation.findFirstOrThrow({
      where: { tripId: trip.id, email: "sam@example.test" },
    });
    expect(stored).toMatchObject({
      sendCount: 0,
      lastSentAt: null,
      maxUses: 1,
    });
    expect(
      await db.activityLog.count({
        where: { tripId: trip.id, type: "INVITE_SENT" },
      }),
    ).toBe(0);
  });

  it("skips people who are already members", async () => {
    const { owner, guest, trip } = await setup();
    await addMember(trip.id, guest.id);
    const { results } = await inviteByEmail(
      trip.id,
      owner.id,
      { emails: [guest.email!.toUpperCase()], ttlDays: 7 },
      { appUrl: APP_URL, email: null },
    );
    expect(results).toEqual([
      { email: guest.email!.toLowerCase(), outcome: "already_member" },
    ]);
    expect(await db.tripInvitation.count({ where: { tripId: trip.id } })).toBe(
      0,
    );
  });

  it("reports a failed email honestly and keeps the link", async () => {
    const { owner, trip } = await setup();
    const { results } = await inviteByEmail(
      trip.id,
      owner.id,
      { emails: ["sam@example.test"], ttlDays: 7 },
      { appUrl: APP_URL, email: new RecordingEmail(true) },
    );
    expect(results[0]).toMatchObject({
      outcome: "failed",
      error: "The email service is down.",
    });
    expect(results[0] && "url" in results[0]).toBe(true);
    const stored = await db.tripInvitation.findFirstOrThrow({
      where: { tripId: trip.id },
    });
    expect(stored.lastSentAt).toBeNull();
  });

  it("renews a pending invitation instead of duplicating it, and resending replaces the link", async () => {
    const { owner, trip } = await setup();
    const email = new RecordingEmail();
    await inviteByEmail(
      trip.id,
      owner.id,
      { emails: ["sam@example.test"], ttlDays: 7 },
      { appUrl: APP_URL, email },
    );
    await inviteByEmail(
      trip.id,
      owner.id,
      { emails: ["sam@example.test"], ttlDays: 7 },
      { appUrl: APP_URL, email },
    );
    expect(await db.tripInvitation.count({ where: { tripId: trip.id } })).toBe(
      1,
    );
    const first = tokenFromEmail(email.sent[0]!);
    const second = tokenFromEmail(email.sent[1]!);
    await expect(inspectInvitation(first, null)).resolves.toEqual({
      status: "invalid",
    });

    const invitation = await db.tripInvitation.findFirstOrThrow({
      where: { tripId: trip.id },
    });
    const resent = await resendInvitation(trip.id, owner.id, invitation.id, {
      appUrl: APP_URL,
      email,
    });
    expect(resent).toMatchObject({ outcome: "sent" });
    const third = tokenFromEmail(email.sent[2]!);
    await expect(inspectInvitation(second, null)).resolves.toEqual({
      status: "invalid",
    });
    await expect(inspectInvitation(third, null)).resolves.toMatchObject({
      status: "valid",
    });
    expect(
      (
        await db.tripInvitation.findUniqueOrThrow({
          where: { id: invitation.id },
        })
      ).sendCount,
    ).toBe(3);

    // Without email configured, resending hands back a fresh link to copy.
    const copied = await resendInvitation(trip.id, owner.id, invitation.id, {
      appUrl: APP_URL,
      email: null,
    });
    expect(copied).toMatchObject({ outcome: "not_sent" });
    await expect(inspectInvitation(third, null)).resolves.toEqual({
      status: "invalid",
    });
    if (copied.outcome === "not_sent")
      await expect(
        inspectInvitation(tokenFrom(copied.url), null),
      ).resolves.toMatchObject({ status: "valid" });
  });

  it("can't be accepted after it is revoked or expires", async () => {
    const { owner, trip } = await setup();
    const invitee = await createUser("Sam", { email: "sam@example.test" });
    const past = new Date(Date.now() - 10 * 86_400_000);
    const expired = await inviteByEmail(
      trip.id,
      owner.id,
      { emails: ["sam@example.test"], ttlDays: 1 },
      { appUrl: APP_URL, email: null, now: past },
    );
    const expiredUrl =
      expired.results[0] && "url" in expired.results[0]
        ? expired.results[0].url
        : "";
    await expect(
      inspectInvitation(tokenFrom(expiredUrl), { id: invitee.id }),
    ).resolves.toMatchObject({ status: "expired" });
    await expectCode(
      acceptInvitation(tokenFrom(expiredUrl), invitee.id),
      "FORBIDDEN",
    );

    const listed = await listInvitations(
      await requireTripAccess(trip.id, owner.id),
    );
    expect(listed.emails[0]).toMatchObject({ status: "expired" });
    await revokeInvitation(trip.id, owner.id, listed.emails[0]!.id);
    await expectCode(
      acceptInvitation(tokenFrom(expiredUrl), invitee.id),
      "FORBIDDEN",
    );
    await expectCode(
      resendInvitation(trip.id, owner.id, listed.emails[0]!.id, {
        appUrl: APP_URL,
        email: null,
      }),
      "VALIDATION",
    );
    expect(
      (await listInvitations(await requireTripAccess(trip.id, owner.id)))
        .emails[0],
    ).toMatchObject({ status: "revoked" });
  });

  it("limits how many invitation emails one person sends", async () => {
    const { owner, trip } = await setup();
    const email = new RecordingEmail();
    const addresses = Array.from(
      { length: INVITE_RATE_LIMITS.email.limit },
      (_, index) => `friend${index}@example.test`,
    );
    await inviteByEmail(
      trip.id,
      owner.id,
      { emails: addresses.slice(0, 20), ttlDays: 7 },
      { appUrl: APP_URL, email },
    );
    await expectCode(
      inviteByEmail(
        trip.id,
        owner.id,
        { emails: ["one.more@example.test"], ttlDays: 7 },
        { appUrl: APP_URL, email },
      ),
      "RATE_LIMITED",
    );
    expect(email.sent).toHaveLength(INVITE_RATE_LIMITS.email.limit);
  });
});
