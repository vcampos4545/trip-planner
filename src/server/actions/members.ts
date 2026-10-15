"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { MemberRole } from "@/generated/prisma/enums";
import type { ActionResult } from "@/lib/action-result";
import { createInvitationSchema } from "@/lib/validation/invitation";
import { requireActionUser } from "@/server/auth/session";
import { checkRateLimit } from "@/server/rate-limit";
import {
  acceptInvitation,
  changeMemberRole,
  createInvitation,
  leaveTrip,
  removeMember,
  revokeInvitation,
} from "@/server/services/members";

import { revalidateTrip } from "./revalidate";
import { runAction, toFailure } from "./run-action";

const id = z.string().min(1).max(64);

async function appOrigin() {
  const configured = process.env.AUTH_URL?.replace(/\/$/, "");
  if (configured) return configured;
  const list = await headers();
  const host =
    list.get("x-forwarded-host") ?? list.get("host") ?? "localhost:3000";
  const proto =
    list.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function createInvitationAction(
  tripId: string,
  raw: unknown,
): Promise<ActionResult<{ url: string; expiresAt: string }>> {
  return runAction(async (user) => {
    checkRateLimit(`invite-create:${user.id}`, 20, 60 * 60_000);
    const input = createInvitationSchema.parse(raw);
    const { token, invitation } = await createInvitation(
      id.parse(tripId),
      user.id,
      input,
    );
    revalidateTrip(tripId);
    return {
      url: `${await appOrigin()}/invite/${token}`,
      expiresAt: invitation.expiresAt.toISOString(),
    };
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
