"use client";

import { DoorOpen, Mail, MoreHorizontal } from "lucide-react";
import { useState } from "react";

import { InviteButton, useInvite } from "@/components/members/invite-provider";
import { ConfirmAction } from "@/components/shared/confirm-button";
import { Pill } from "@/components/shared/status-badge";
import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { MemberRole } from "@/generated/prisma/enums";
import { useAction } from "@/hooks/use-action";
import {
  LEAVE_BLOCK_MESSAGES,
  type LeaveBlock,
} from "@/lib/domain/invitations";
import { MEMBER_ROLE_LABELS } from "@/lib/labels";
import {
  changeMemberRoleAction,
  leaveTripAction,
  removeMemberAction,
  transferOrganizerAction,
} from "@/server/actions/members";

export type MemberView = {
  id: string;
  role: MemberRole;
  user: {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
  };
};

type Pending =
  | { kind: "remove" | "transfer"; member: MemberView }
  | { kind: "leave" }
  | null;

function nameOf(member: MemberView) {
  return member.user.name ?? member.user.email ?? "this member";
}

export function MembersCard({
  tripId,
  members,
  currentUserId,
  isOrganizer,
  leaveBlock,
  pendingInvites,
}: {
  tripId: string;
  members: MemberView[];
  currentUserId: string;
  isOrganizer: boolean;
  leaveBlock: LeaveBlock | null;
  pendingInvites: number;
}) {
  const { run, pending } = useAction();
  const { canInvite, openInvite } = useInvite();
  const [confirm, setConfirm] = useState<Pending>(null);
  const organizerCount = members.filter(
    (member) => member.role === "ORGANIZER",
  ).length;

  return (
    <section
      aria-labelledby="members-heading"
      className="rounded-xl border bg-card p-5"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id="members-heading" className="text-sm font-semibold">
          Group members
        </h2>
        <InviteButton />
      </div>
      <ul className="mt-3 space-y-2.5" data-testid="member-list">
        {members.map((member) => {
          const self = member.user.id === currentUserId;
          const canStepDown =
            self && member.role === "ORGANIZER" && organizerCount > 1;
          const manageable = isOrganizer && (!self || canStepDown);
          return (
            <li
              key={member.id}
              className="flex items-center gap-3"
              data-testid="member-row"
            >
              <UserAvatar
                name={member.user.name}
                email={member.user.email}
                image={member.user.image}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {member.user.name ?? member.user.email ?? "Member"}
                  {self ? (
                    <span className="font-normal text-muted-foreground">
                      {" "}
                      (you)
                    </span>
                  ) : null}
                </p>
                {member.user.email ? (
                  <p className="truncate text-xs text-muted-foreground">
                    {member.user.email}
                  </p>
                ) : null}
              </div>
              {member.role === "ORGANIZER" ? (
                <Pill tone="info">{MEMBER_ROLE_LABELS.ORGANIZER}</Pill>
              ) : null}
              {manageable ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Manage ${member.user.name ?? "member"}`}
                      disabled={pending}
                    >
                      <MoreHorizontal aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {self ? (
                      <DropdownMenuItem
                        onSelect={() =>
                          run(
                            () =>
                              changeMemberRoleAction(
                                tripId,
                                member.id,
                                "MEMBER",
                              ),
                            { success: "You're a regular member now" },
                          )
                        }
                      >
                        Step down as organizer
                      </DropdownMenuItem>
                    ) : (
                      <>
                        <DropdownMenuItem
                          onSelect={() =>
                            run(
                              () =>
                                changeMemberRoleAction(
                                  tripId,
                                  member.id,
                                  member.role === "ORGANIZER"
                                    ? "MEMBER"
                                    : "ORGANIZER",
                                ),
                              { success: "Role updated" },
                            )
                          }
                        >
                          {member.role === "ORGANIZER"
                            ? "Make regular member"
                            : "Make organizer"}
                        </DropdownMenuItem>
                        {member.role === "MEMBER" ? (
                          <DropdownMenuItem
                            onSelect={() =>
                              setConfirm({ kind: "transfer", member })
                            }
                          >
                            Transfer organizer role
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() =>
                            setConfirm({ kind: "remove", member })
                          }
                        >
                          Remove from trip
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </li>
          );
        })}
      </ul>

      {canInvite && pendingInvites > 0 ? (
        <button
          type="button"
          onClick={openInvite}
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
        >
          <Mail className="size-3.5" aria-hidden />
          {pendingInvites} pending invitation{pendingInvites === 1 ? "" : "s"}
        </button>
      ) : null}

      <div className="mt-4 border-t pt-3">
        {leaveBlock ? (
          <div className="space-y-1.5">
            <Button variant="ghost" size="xs" disabled>
              <DoorOpen aria-hidden />
              Leave trip
            </Button>
            <p
              className="text-xs text-muted-foreground"
              data-testid="leave-blocked"
            >
              {LEAVE_BLOCK_MESSAGES[leaveBlock]}
            </p>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="xs"
            disabled={pending}
            onClick={() => setConfirm({ kind: "leave" })}
          >
            <DoorOpen aria-hidden />
            Leave trip
          </Button>
        )}
      </div>

      <ConfirmAction
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={
          confirm?.kind === "remove"
            ? `Remove ${nameOf(confirm.member)}?`
            : confirm?.kind === "transfer"
              ? `Make ${nameOf(confirm.member)} the organizer?`
              : "Leave this trip?"
        }
        description={
          confirm?.kind === "remove"
            ? "They will lose access to this trip. Bookings they were part of keep their history."
            : confirm?.kind === "transfer"
              ? "They become an organizer and you become a regular member. Only an organizer can make you an organizer again."
              : "You'll lose access to this trip until someone invites you again."
        }
        confirmLabel={
          confirm?.kind === "remove"
            ? "Remove"
            : confirm?.kind === "transfer"
              ? "Transfer role"
              : "Leave trip"
        }
        destructive={confirm?.kind !== "transfer"}
        onConfirm={() => {
          const target = confirm;
          if (!target) return;
          if (target.kind === "remove")
            run(() => removeMemberAction(tripId, target.member.id), {
              success: "Member removed",
            });
          if (target.kind === "transfer")
            run(() => transferOrganizerAction(tripId, target.member.id), {
              success: "Organizer role transferred",
            });
          if (target.kind === "leave") run(() => leaveTripAction(tripId));
        }}
      />
    </section>
  );
}
