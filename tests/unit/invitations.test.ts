import { describe, expect, it } from "vitest";

import {
  canGrantRole,
  canInvite,
  emailMatches,
  invitationStatus,
  leaveBlock,
  maskEmail,
  parseEmailList,
} from "@/lib/domain/invitations";
import { nextActionHref, type NextAction } from "@/lib/domain/next-action";
import { emailInvitationSchema } from "@/lib/validation/invitation";
import { hideInviteTokens, withInviteLinks } from "@/server/ai/orchestrator";
import { invitationEmail } from "@/server/email/invitation-email";
import { ResendEmailProvider } from "@/server/email/resend";
import { EmailSendError } from "@/server/email/types";

const NOW = new Date("2026-10-16T12:00:00Z");
const LATER = new Date("2026-10-20T12:00:00Z");
const EARLIER = new Date("2026-10-10T12:00:00Z");

function facts(overrides: Partial<Parameters<typeof invitationStatus>[0]>) {
  return {
    email: null,
    expiresAt: LATER,
    maxUses: null,
    useCount: 0,
    acceptedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

describe("invitationStatus", () => {
  it("covers each state of a link", () => {
    expect(invitationStatus(facts({}), NOW)).toBe("pending");
    expect(invitationStatus(facts({ expiresAt: EARLIER }), NOW)).toBe(
      "expired",
    );
    expect(invitationStatus(facts({ revokedAt: EARLIER }), NOW)).toBe(
      "revoked",
    );
    expect(invitationStatus(facts({ maxUses: 2, useCount: 2 }), NOW)).toBe(
      "used_up",
    );
  });

  it("keeps an accepted email invitation accepted after it expires", () => {
    expect(
      invitationStatus(
        facts({
          email: "a@example.com",
          maxUses: 1,
          useCount: 1,
          acceptedAt: EARLIER,
          expiresAt: EARLIER,
        }),
        NOW,
      ),
    ).toBe("accepted");
  });
});

describe("invite permissions", () => {
  it("lets organizers invite, and members only when allowed", () => {
    expect(canInvite("ORGANIZER", false)).toBe(true);
    expect(canInvite("MEMBER", false)).toBe(false);
    expect(canInvite("MEMBER", true)).toBe(true);
  });

  it("only lets organizers grant the organizer role", () => {
    expect(canGrantRole("ORGANIZER", "ORGANIZER")).toBe(true);
    expect(canGrantRole("MEMBER", "MEMBER")).toBe(true);
    expect(canGrantRole("MEMBER", "ORGANIZER")).toBe(false);
  });
});

describe("leaveBlock", () => {
  it("blocks the only member and the only organizer", () => {
    expect(
      leaveBlock({ role: "ORGANIZER", memberCount: 1, organizerCount: 1 }),
    ).toBe("sole_member");
    expect(
      leaveBlock({ role: "ORGANIZER", memberCount: 3, organizerCount: 1 }),
    ).toBe("only_organizer");
    expect(
      leaveBlock({ role: "ORGANIZER", memberCount: 3, organizerCount: 2 }),
    ).toBeNull();
    expect(
      leaveBlock({ role: "MEMBER", memberCount: 2, organizerCount: 1 }),
    ).toBeNull();
  });
});

describe("email addresses", () => {
  it("parses a pasted list, with display names and duplicates", () => {
    expect(
      parseEmailList(
        "Jamie Doe <Jamie@Example.com>, sam@example.com;\nsam@example.com  not-an-email",
      ),
    ).toEqual({
      valid: ["jamie@example.com", "sam@example.com"],
      invalid: ["not-an-email"],
    });
    expect(parseEmailList("   ")).toEqual({ valid: [], invalid: [] });
    expect(parseEmailList("a@b")).toEqual({ valid: [], invalid: ["a@b"] });
  });

  it("validates and normalizes on the server too", () => {
    expect(
      emailInvitationSchema.parse({ emails: [" A@Example.COM "], ttlDays: 7 }),
    ).toEqual({ emails: ["a@example.com"], ttlDays: 7, role: "MEMBER" });
    expect(
      emailInvitationSchema.safeParse({ emails: ["nope"], ttlDays: 7 }).success,
    ).toBe(false);
    expect(
      emailInvitationSchema.safeParse({ emails: [], ttlDays: 7 }).success,
    ).toBe(false);
    expect(
      emailInvitationSchema.safeParse({
        emails: Array.from({ length: 21 }, (_, i) => `p${i}@example.com`),
        ttlDays: 7,
      }).success,
    ).toBe(false);
  });

  it("masks an address", () => {
    expect(maskEmail("jamie.doe@example.com")).toBe("ja***@example.com");
    expect(maskEmail("a@example.com")).toBe("a***@example.com");
  });

  it("matches only a verified address, ignoring case", () => {
    expect(
      emailMatches("jamie@example.com", {
        email: "Jamie@Example.com",
        emailVerified: NOW,
      }),
    ).toBe(true);
    expect(
      emailMatches("jamie@example.com", {
        email: "jamie@example.com",
        emailVerified: null,
      }),
    ).toBe(false);
    expect(
      emailMatches("jamie@example.com", {
        email: "other@example.com",
        emailVerified: NOW,
      }),
    ).toBe(false);
  });
});

describe("nextActionHref", () => {
  const base: NextAction = {
    key: "x",
    title: "x",
    description: "x",
    tab: "overview",
  };
  it("opens dialogs and never adds an anchor that does nothing", () => {
    expect(nextActionHref("t1", { ...base, open: "invite" })).toBe(
      "/trips/t1?open=invite",
    );
    expect(nextActionHref("t1", { ...base, open: "details" })).toBe(
      "/trips/t1?open=details",
    );
    expect(nextActionHref("t1", { ...base, anchor: "proposals" })).toBe(
      "/trips/t1#proposals",
    );
    expect(nextActionHref("t1", base)).toBe("/trips/t1");
    expect(nextActionHref("t1", { ...base, tab: "tasks" })).toBe(
      "/trips/t1/tasks",
    );
  });
});

describe("Atlas invite links", () => {
  const url = `https://trips.example.test/invite/${"a".repeat(43)}`;
  it("adds links under the reply and hides tokens from later model turns", () => {
    const text = withInviteLinks("Here you go.", [
      { label: "Invite link (expires Oct 23)", url },
    ]);
    expect(text).toBe(`Here you go.\n\nInvite link (expires Oct 23): ${url}`);
    expect(withInviteLinks("Hi", [])).toBe("Hi");
    expect(hideInviteTokens(text)).not.toContain("a".repeat(43));
    expect(hideInviteTokens(text)).toContain("/invite/[link hidden]");
  });
});

describe("invitation email", () => {
  it("escapes names and titles in the HTML", () => {
    const message = invitationEmail({
      to: "sam@example.com",
      inviterName: "<b>Eve</b>",
      tripTitle: 'Ski "trip" & <script>',
      url: "https://trips.example.test/invite/abc",
      expiresAt: LATER,
    });
    expect(message.html).not.toContain("<script>");
    expect(message.html).toContain("&lt;b&gt;Eve&lt;/b&gt;");
    expect(message.text).toContain("https://trips.example.test/invite/abc");
    expect(message.text).toContain("sam@example.com");
    expect(message.subject).toContain('Ski "trip"');
  });
});

describe("ResendEmailProvider", () => {
  const message = {
    to: "sam@example.com",
    subject: "Hi",
    text: "Hello",
    html: "<p>Hello</p>",
  };

  it("posts the message to Resend with the API key", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const provider = new ResendEmailProvider({
      apiKey: "re_test",
      from: "Trips <trips@example.com>",
      apiUrl: "https://resend.test/",
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ id: "email_1" }), {
          status: 200,
        });
      }) as typeof fetch,
    });
    await expect(provider.send(message)).resolves.toEqual({ id: "email_1" });
    expect(calls[0]!.url).toBe("https://resend.test/emails");
    expect(
      (calls[0]!.init.headers as Record<string, string>).Authorization,
    ).toBe("Bearer re_test");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      from: "Trips <trips@example.com>",
      to: ["sam@example.com"],
      subject: "Hi",
      text: "Hello",
      html: "<p>Hello</p>",
    });
  });

  it("turns failures into safe errors", async () => {
    const failing = (status: number) =>
      new ResendEmailProvider({
        apiKey: "re_test",
        from: "trips@example.com",
        fetch: (async () =>
          new Response("{}", { status })) as unknown as typeof fetch,
      });
    await expect(failing(401).send(message)).rejects.toThrow(/API key/);
    await expect(failing(429).send(message)).rejects.toThrow(/rate limiting/);
    await expect(failing(500).send(message)).rejects.toBeInstanceOf(
      EmailSendError,
    );
    const offline = new ResendEmailProvider({
      apiKey: "re_test",
      from: "trips@example.com",
      fetch: (async () => {
        throw new TypeError("network down");
      }) as typeof fetch,
    });
    await expect(offline.send(message)).rejects.toThrow(/could not be reached/);
  });
});
