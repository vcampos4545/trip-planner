"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { MemberRole } from "@/generated/prisma/enums";
import type { ActionResult } from "@/lib/action-result";
import {
  createInvitationSchema,
  emailInvitationSchema,
} from "@/lib/validation/invitation";
import { appOrigin, inviteUrl } from "@/server/app-url";
import { requireActionUser } from "@/server/auth/session";
import { getEmailProvider } from "@/server/email";
import { checkRateLimit } from "@/server/rate-limit";
import {
  acceptInvitation,
  createInvitation,
  inviteByEmail,
  resendInvitation,
  revokeInvitation,
  setMembersCanInvite,
  type EmailOutcome,
} from "@/server/services/invitations";
import {
  changeMemberRole,
  leaveTrip,
  removeMember,
  transferOrganizer,
} from "@/server/services/members";

import { revalidateTrip } from "./revalidate";
import { runAction, toFailure } from "./run-action";

const id = z.string().min(1).max(64);

export async function createInvitationAction(
  tripId: string,
  raw: unknown,
): Promise<ActionResult<{ url: string; expiresAt: string }>> {
  return runAction(async (user) => {
    const input = createInvitationSchema.parse(raw);
    const { token, invitation } = await createInvitation(
      id.parse(tripId),
      user.id,
      input,
    );
    revalidateTrip(tripId);
    return {
      url: inviteUrl(await appOrigin(), token),
      expiresAt: invitation.expiresAt.toISOString(),
    };
  });
}

export async function inviteByEmailAction(
  tripId: string,
  raw: unknown,
): Promise<
  ActionResult<{ results: EmailOutcome[]; emailConfigured: boolean }>
> {
  return runAction(async (user) => {
    const input = emailInvitationSchema.parse(raw);
    const result = await inviteByEmail(id.parse(tripId), user.id, input, {
      appUrl: await appOrigin(),
      email: getEmailProvider(),
    });
    revalidateTrip(tripId);
    return result;
  });
}

export async function resendInvitationAction(
  tripId: string,
  invitationId: string,
): Promise<ActionResult<EmailOutcome>> {
  return runAction(async (user) => {
    const result = await resendInvitation(
      id.parse(tripId),
      user.id,
      id.parse(invitationId),
      { appUrl: await appOrigin(), email: getEmailProvider() },
    );
    revalidateTrip(tripId);
    return result;
  });
}

export async function revokeInvitationAction(
  tripId: string,
  invitationId: string,
): Promise<ActionResult> {
  return runAction(async (user) => {
    await revokeInvitation(id.parse(tripId), user.id, id.parse(invitationId));
    revalidateTrip(tripId);
    return null;
  });
}

export async function setMembersCanInviteAction(
  tripId: string,
  allowed: unknown,
): Promise<ActionResult> {
  return runAction(async (user) => {
    await setMembersCanInvite(
      id.parse(tripId),
      user.id,
      z.boolean().parse(allowed),
    );
    revalidateTrip(tripId);
    return null;
  });
}

export async function acceptInvitationAction(
  token: string,
): Promise<ActionResult<never>> {
  let tripId: string;
  try {
    const user = await requireActionUser();
    checkRateLimit(`invite-accept:${user.id}`, 10, 60_000);
    const result = await acceptInvitation(
      z.string().max(128).parse(token),
      user.id,
    );
    tripId = result.tripId;
  } catch (error) {
    return toFailure(error);
  }
  revalidateTrip(tripId);
  redirect(`/trips/${tripId}`);
}

export async function removeMemberAction(
  tripId: string,
  memberId: string,
): Promise<ActionResult> {
  return runAction(async (user) => {
    await removeMember(id.parse(tripId), user.id, id.parse(memberId));
    revalidateTrip(tripId);
    return null;
  });
}

export async function changeMemberRoleAction(
  tripId: string,
  memberId: string,
  role: unknown,
): Promise<ActionResult> {
  return runAction(async (user) => {
    await changeMemberRole(
      id.parse(tripId),
      user.id,
      id.parse(memberId),
      z.enum(MemberRole).parse(role),
    );
    revalidateTrip(tripId);
    return null;
  });
}

export async function transferOrganizerAction(
  tripId: string,
  memberId: string,
): Promise<ActionResult> {
  return runAction(async (user) => {
    await transferOrganizer(id.parse(tripId), user.id, id.parse(memberId));
    revalidateTrip(tripId);
    return null;
  });
}

export async function leaveTripAction(
  tripId: string,
): Promise<ActionResult<never>> {
  try {
    const user = await requireActionUser();
    await leaveTrip(id.parse(tripId), user.id);
  } catch (error) {
    return toFailure(error);
  }
  redirect("/trips");
}
