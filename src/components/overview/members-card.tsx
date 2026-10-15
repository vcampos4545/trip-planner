"use client";

import { Check, Copy, Link2, MoreHorizontal, UserPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmAction } from "@/components/shared/confirm-button";
import {
  FieldShell,
  NativeSelect,
  useFieldId,
} from "@/components/shared/form-fields";
import { Pill } from "@/components/shared/status-badge";
import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { MemberRole } from "@/generated/prisma/enums";
import { useAction } from "@/hooks/use-action";
import { formatDateOnly, formatRelativeTime } from "@/lib/dates";
import { MEMBER_ROLE_LABELS } from "@/lib/labels";
import { INVITE_TTL_CHOICES } from "@/lib/validation/invitation";
import {
  changeMemberRoleAction,
  createInvitationAction,
  removeMemberAction,
  revokeInvitationAction,
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

export type InvitationView = {
  id: string;
  expiresAt: string;
  maxUses: number | null;
  useCount: number;
  createdAt: string;
};

export function MembersCard({
  tripId,
  members,
  invitations,
  currentUserId,
  isOrganizer,
  defaultTtlDays,
}: {
  tripId: string;
  members: MemberView[];
  invitations: InvitationView[];
  currentUserId: string;
  isOrganizer: boolean;
  defaultTtlDays: number;
}) {
  const { run, pending } = useAction();
  return (
    <section
      aria-labelledby="members-heading"
      className="rounded-xl border bg-card p-5"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id="members-heading" className="text-sm font-semibold">
          Group members
        </h2>
        {isOrganizer ? (
          <InviteDialog tripId={tripId} defaultTtlDays={defaultTtlDays} />
        ) : null}
      </div>
      <ul className="mt-3 space-y-2.5" data-testid="member-list">
        {members.map((member) => (
          <li key={member.id} className="flex items-center gap-3">
            <UserAvatar
              name={member.user.name}
              email={member.user.email}
              image={member.user.image}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {member.user.name ?? member.user.email ?? "Member"}
                {member.user.id === currentUserId ? (
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
            {isOrganizer && member.user.id !== currentUserId ? (
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
                  <ConfirmAction
                    title={`Remove ${member.user.name ?? "this member"}?`}
                    description="They will lose access to this trip. Bookings they were part of keep their history."
                    confirmLabel="Remove"
                    onConfirm={() =>
                      run(() => removeMemberAction(tripId, member.id), {
                        success: "Member removed",
                      })
                    }
                    trigger={
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={(event) => event.preventDefault()}
                      >
                        Remove from trip
                      </DropdownMenuItem>
                    }
                  />
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </li>
        ))}
      </ul>

      {isOrganizer && invitations.length > 0 ? (
        <div className="mt-4 border-t pt-3">
          <p className="text-xs font-medium text-muted-foreground">
            Active invite links
          </p>
          <ul className="mt-2 space-y-2">
            {invitations.map((invite) => (
              <li
                key={invite.id}
                className="flex items-center justify-between gap-2 text-xs"
              >
                <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                  <Link2 className="size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">
                    Expires{" "}
                    {formatDateOnly(invite.expiresAt.slice(0, 10), "short")} ·
                    used {invite.useCount}
                    {invite.maxUses ? ` of ${invite.maxUses}` : ""} · created{" "}
                    {formatRelativeTime(invite.createdAt)}
                  </span>
                </span>
                <ConfirmAction
                  title="Revoke this invite link?"
                  description="Anyone who has the link won't be able to use it to join. People who already joined stay on the trip."
                  confirmLabel="Revoke"
                  onConfirm={() =>
                    run(() => revokeInvitationAction(tripId, invite.id), {
                      success: "Invite link revoked",
                    })
                  }
                  trigger={
                    <Button variant="ghost" size="xs" disabled={pending}>
                      Revoke
                    </Button>
                  }
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function InviteDialog({
  tripId,
  defaultTtlDays,
}: {
  tripId: string;
  defaultTtlDays: number;
}) {
  const [open, setOpen] = useState(false);
  const [ttlDays, setTtlDays] = useState(
    (INVITE_TTL_CHOICES as readonly number[]).includes(defaultTtlDays)
      ? defaultTtlDays
      : 7,
  );
  const [maxUses, setMaxUses] = useState("");
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(
    null,
  );
  const [copied, setCopied] = useState(false);
  const { run, pending } = useAction();
  const ttlId = useFieldId("ttl");
  const usesId = useFieldId("uses");
  const linkId = useFieldId("link");

  function reset(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      setLink(null);
      setCopied(false);
      setMaxUses("");
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      toast.success("Invite link copied");
    } catch {
      toast.error("Couldn't copy automatically. Select the link and copy it.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <UserPlus aria-hidden />
          Invite
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite people to this trip</DialogTitle>
          <DialogDescription>
            Anyone who signs in with this link joins as a member. Share it only
            with your group. You can revoke it at any time.
          </DialogDescription>
        </DialogHeader>
        {link ? (
          <div className="grid gap-3">
            <FieldShell
              label="Invite link"
              htmlFor={linkId}
              hint={`Expires ${new Date(link.expiresAt).toLocaleString()}. This link is shown only once.`}
            >
              <div className="flex gap-2">
                <Input
                  id={linkId}
                  readOnly
                  value={link.url}
                  onFocus={(event) => event.currentTarget.select()}
                  data-testid="invite-link"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={copy}
                  aria-label="Copy invite link"
                >
                  {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                </Button>
              </div>
            </FieldShell>
            <DialogFooter>
              <Button onClick={() => reset(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              const uses = maxUses.trim() === "" ? null : Number(maxUses);
              if (
                uses !== null &&
                (!Number.isInteger(uses) || uses < 1 || uses > 100)
              ) {
                toast.error("Use limit must be a whole number from 1 to 100.");
                return;
              }
              run(
                () =>
                  createInvitationAction(tripId, { ttlDays, maxUses: uses }),
                { onSuccess: (data) => setLink(data) },
              );
            }}
          >
            <div className="grid grid-cols-2 gap-3">
              <FieldShell label="Link expires after" htmlFor={ttlId}>
                <NativeSelect
                  id={ttlId}
                  value={ttlDays}
                  onChange={(event) => setTtlDays(Number(event.target.value))}
                >
                  {INVITE_TTL_CHOICES.map((days) => (
                    <option key={days} value={days}>
                      {days} {days === 1 ? "day" : "days"}
                    </option>
                  ))}
                </NativeSelect>
              </FieldShell>
              <FieldShell label="Use limit" htmlFor={usesId} optional>
                <Input
                  id={usesId}
                  inputMode="numeric"
                  placeholder="No limit"
                  value={maxUses}
                  onChange={(event) => setMaxUses(event.target.value)}
                />
              </FieldShell>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => reset(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Creating..." : "Create invite link"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
