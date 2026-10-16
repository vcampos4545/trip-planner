/**
 * Pure rules for trip invitations and membership changes. Services enforce them on the server;
 * the UI uses the same functions to decide what to show.
 */

export type InviteRole = "ORGANIZER" | "MEMBER";

export type InvitationStatus =
  "pending" | "accepted" | "expired" | "revoked" | "used_up";

export type InvitationFacts = {
  email: string | null;
  expiresAt: Date;
  maxUses: number | null;
  useCount: number;
  acceptedAt: Date | null;
  revokedAt: Date | null;
};

/** The most important fact first: an accepted email invitation stays "accepted" after it expires. */
export function invitationStatus(
  invitation: InvitationFacts,
  now = new Date(),
): InvitationStatus {
  if (invitation.acceptedAt && invitation.email) return "accepted";
  if (invitation.revokedAt) return "revoked";
  if (invitation.maxUses !== null && invitation.useCount >= invitation.maxUses)
    return invitation.email ? "accepted" : "used_up";
  if (invitation.expiresAt <= now) return "expired";
  return "pending";
}

/** Organizers can always invite. Other members can only when the organizers allow it. */
export function canInvite(role: InviteRole, membersCanInvite: boolean) {
  return role === "ORGANIZER" || membersCanInvite;
}

/** Only organizers can hand out the organizer role. */
export function canGrantRole(inviterRole: InviteRole, role: InviteRole) {
  return role === "MEMBER" || inviterRole === "ORGANIZER";
}

export type LeaveBlock = "sole_member" | "only_organizer";

/**
 * Why a member can't leave, or null when they can. The only member can't leave (they delete the
 * trip instead), and an organizer can't leave until someone else holds the organizer role.
 */
export function leaveBlock(input: {
  role: InviteRole;
  memberCount: number;
  organizerCount: number;
}): LeaveBlock | null {
  if (input.memberCount <= 1) return "sole_member";
  if (input.role === "ORGANIZER" && input.organizerCount <= 1)
    return "only_organizer";
  return null;
}

export const LEAVE_BLOCK_MESSAGES: Record<LeaveBlock, string> = {
  sole_member:
    "You're the only member, so you can't leave this trip. Invite someone and make them an organizer first, or delete the trip.",
  only_organizer:
    "You're the only organizer. Make another member an organizer (or transfer the organizer role) before you leave.",
};

export const MAX_EMAILS_PER_REQUEST = 20;

const EMAIL_PATTERN =
  /^[^\s@<>(),;:"[\]]+@[^\s@<>(),;:"[\]]+\.[^\s@<>(),;:"[\]]{2,}$/;

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function isEmailAddress(value: string) {
  return value.length <= 254 && EMAIL_PATTERN.test(value);
}

/**
 * Splits a pasted list of addresses (commas, semicolons, spaces, or new lines; "Name <a@b.c>"
 * also works between commas) into unique normalized addresses and the entries that aren't addresses.
 */
export function parseEmailList(text: string) {
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const segment of text.split(/[,;\n]+/)) {
    // "Jane Doe <jane@example.com>" names one address; otherwise each word must be one.
    const angled = /<([^>]*)>/.exec(segment);
    const entries = angled ? [angled[1]!] : segment.split(/\s+/);
    for (const raw of entries) {
      const entry = raw.trim();
      if (!entry) continue;
      const email = normalizeEmail(entry);
      if (!isEmailAddress(email)) invalid.push(entry);
      else if (!valid.includes(email)) valid.push(email);
    }
  }
  return { valid, invalid };
}

/** "jane.doe@example.com" becomes "ja***@example.com", enough to recognize without exposing it. */
export function maskEmail(email: string) {
  const [local = "", domain = ""] = email.split("@");
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${visible}***@${domain}`;
}

/** Email-bound invitations only work for a signed-in user whose verified address matches. */
export function emailMatches(
  invitationEmail: string,
  user: { email: string | null; emailVerified: Date | null },
) {
  return (
    user.email !== null &&
    user.emailVerified !== null &&
    normalizeEmail(user.email) === normalizeEmail(invitationEmail)
  );
}
