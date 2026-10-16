"use client";

import { AlertCircle, Link2, Mail, RotateCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmAction } from "@/components/shared/confirm-button";
import {
  FieldShell,
  NativeSelect,
  useFieldId,
} from "@/components/shared/form-fields";
import { Pill, type Tone } from "@/components/shared/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { MemberRole } from "@/generated/prisma/enums";
import { useAction } from "@/hooks/use-action";
import { formatDateOnly, formatRelativeTime } from "@/lib/dates";
import {
  MAX_EMAILS_PER_REQUEST,
  parseEmailList,
  type InvitationStatus,
} from "@/lib/domain/invitations";
import { INVITE_TTL_CHOICES } from "@/lib/validation/invitation";
import {
  createInvitationAction,
  inviteByEmailAction,
  resendInvitationAction,
  revokeInvitationAction,
  setMembersCanInviteAction,
} from "@/server/actions/members";
import type { EmailOutcome } from "@/server/services/invitations";

import { CopyLink } from "./copy-link";

export type InviteLinkView = {
  id: string;
  role: MemberRole;
  expiresAt: string;
  maxUses: number | null;
  useCount: number;
  createdAt: string;
  createdByName: string | null;
  canManage: boolean;
};

export type EmailInviteView = {
  id: string;
  email: string;
  role: MemberRole;
  status: InvitationStatus;
  expiresAt: string;
  lastSentAt: string | null;
  createdAt: string;
  createdByName: string | null;
  acceptedByName: string | null;
  canManage: boolean;
};

export type InviteSettings = {
  tripId: string;
  tripTitle: string;
  isOrganizer: boolean;
  membersCanInvite: boolean;
  defaultTtlDays: number;
  emailConfigured: boolean;
};

const STATUS: Record<InvitationStatus, { label: string; tone: Tone }> = {
  pending: { label: "Pending", tone: "suggestion" },
  accepted: { label: "Accepted", tone: "confirmed" },
  expired: { label: "Expired", tone: "neutral" },
  revoked: { label: "Revoked", tone: "muted" },
  used_up: { label: "Used up", tone: "neutral" },
};

function ttlChoice(days: number) {
  return (INVITE_TTL_CHOICES as readonly number[]).includes(days) ? days : 7;
}

export function InviteDialog({
  open,
  onOpenChange,
  settings,
  links,
  emails,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: InviteSettings;
  links: InviteLinkView[];
  emails: EmailInviteView[];
}) {
  const [tab, setTab] = useState("link");
  // Remounting the forms on close clears links that were shown once.
  const [session, setSession] = useState(0);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setSession((value) => value + 1);
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Invite people to {settings.tripTitle}</DialogTitle>
          <DialogDescription>
            People you invite sign in with Google and join as members. You can
            revoke an invitation at any time.
          </DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={setTab} key={session}>
          <TabsList className="w-full">
            <TabsTrigger value="link">
              <Link2 aria-hidden />
              Share a link
            </TabsTrigger>
            <TabsTrigger value="email">
              <Mail aria-hidden />
              Invite by email
            </TabsTrigger>
          </TabsList>
          {/* Both forms stay mounted so a link shown once survives switching tabs. */}
          <TabsContent
            value="link"
            forceMount
            className="pt-2 data-[state=inactive]:hidden"
          >
            <LinkForm settings={settings} />
          </TabsContent>
          <TabsContent
            value="email"
            forceMount
            className="pt-2 data-[state=inactive]:hidden"
          >
            <EmailForm settings={settings} />
          </TabsContent>
        </Tabs>

        <ActiveLinks tripId={settings.tripId} links={links} />
        <EmailInvitations
          tripId={settings.tripId}
          emails={emails}
          emailConfigured={settings.emailConfigured}
        />
        {settings.isOrganizer ? (
          <MembersCanInviteSetting
            tripId={settings.tripId}
            value={settings.membersCanInvite}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RoleSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: MemberRole;
  onChange: (role: MemberRole) => void;
}) {
  return (
    <FieldShell label="Join as" htmlFor={id}>
      <NativeSelect
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as MemberRole)}
      >
        <option value="MEMBER">Member</option>
        <option value="ORGANIZER">Organizer</option>
      </NativeSelect>
    </FieldShell>
  );
}

function TtlSelect({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (days: number) => void;
}) {
  return (
    <FieldShell label={label} htmlFor={id}>
      <NativeSelect
        id={id}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        {INVITE_TTL_CHOICES.map((days) => (
          <option key={days} value={days}>
            {days} {days === 1 ? "day" : "days"}
          </option>
        ))}
      </NativeSelect>
    </FieldShell>
  );
}

function LinkForm({ settings }: { settings: InviteSettings }) {
  const [ttlDays, setTtlDays] = useState(ttlChoice(settings.defaultTtlDays));
  const [maxUses, setMaxUses] = useState("");
  const [role, setRole] = useState<MemberRole>("MEMBER");
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(
    null,
  );
  const { run, pending } = useAction();
  const ttlId = useFieldId("ttl");
  const usesId = useFieldId("uses");
  const roleId = useFieldId("role");
  const linkId = useFieldId("link");

  if (link) {
    return (
      <div className="grid gap-3">
        <FieldShell
          label="Invite link"
          htmlFor={linkId}
          hint={`Expires ${new Date(link.expiresAt).toLocaleString()}. Save it now: for security it's shown only once.`}
        >
          <CopyLink
            id={linkId}
            url={link.url}
            shareTitle={`Join "${settings.tripTitle}"`}
            testId="invite-link"
          />
        </FieldShell>
        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={() => setLink(null)}>
            Create another link
          </Button>
        </div>
      </div>
    );
  }

  return (
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
            createInvitationAction(settings.tripId, {
              ttlDays,
              maxUses: uses,
              role,
            }),
          { onSuccess: (data) => setLink(data) },
        );
      }}
    >
      <p className="text-sm text-muted-foreground">
        Anyone signed in with this link can join until it expires or reaches its
        use limit. Share it only with your group.
      </p>
      <div
        className={
          settings.isOrganizer
            ? "grid gap-3 sm:grid-cols-3"
            : "grid gap-3 sm:grid-cols-2"
        }
      >
        {settings.isOrganizer ? (
          <RoleSelect id={roleId} value={role} onChange={setRole} />
        ) : null}
        <TtlSelect
          id={ttlId}
          label="Link expires after"
          value={ttlDays}
          onChange={setTtlDays}
        />
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
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          <Link2 aria-hidden />
          {pending ? "Creating..." : "Create invite link"}
        </Button>
      </div>
    </form>
  );
}

function EmailForm({ settings }: { settings: InviteSettings }) {
  const [text, setText] = useState("");
  const [ttlDays, setTtlDays] = useState(ttlChoice(settings.defaultTtlDays));
  const [role, setRole] = useState<MemberRole>("MEMBER");
  const [results, setResults] = useState<EmailOutcome[] | null>(null);
  const [touched, setTouched] = useState(false);
  const { run, pending } = useAction();
  const emailsId = useFieldId("emails");
  const ttlId = useFieldId("email-ttl");
  const roleId = useFieldId("email-role");
  const parsed = parseEmailList(text);
  const error =
    parsed.invalid.length > 0
      ? `Not an email address: ${parsed.invalid.slice(0, 3).join(", ")}${parsed.invalid.length > 3 ? "..." : ""}`
      : parsed.valid.length > MAX_EMAILS_PER_REQUEST
        ? `Invite up to ${MAX_EMAILS_PER_REQUEST} addresses at a time.`
        : touched && parsed.valid.length === 0
          ? "Add at least one email address."
          : undefined;

  if (results) {
    return (
      <div className="grid gap-3" data-testid="invite-email-results">
        <EmailResults
          results={results}
          tripTitle={settings.tripTitle}
          emailConfigured={settings.emailConfigured}
        />
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setResults(null);
              setText("");
              setTouched(false);
            }}
          >
            Invite more people
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="grid gap-3"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setTouched(true);
        if (error || parsed.valid.length === 0) return;
        run(
          () =>
            inviteByEmailAction(settings.tripId, {
              emails: parsed.valid,
              ttlDays,
              role,
            }),
          { onSuccess: (data) => setResults(data.results) },
        );
      }}
    >
      {settings.emailConfigured ? null : (
        <Alert data-testid="email-not-configured">
          <AlertCircle aria-hidden />
          <AlertTitle>Email sending isn&apos;t set up</AlertTitle>
          <AlertDescription>
            Invitations are still created for each address, and you get a link
            to send each person yourself. Nothing is emailed.
          </AlertDescription>
        </Alert>
      )}
      <FieldShell
        label="Email addresses"
        htmlFor={emailsId}
        error={error}
        hint="Separate addresses with commas or new lines. Each invitation only works for the Google account with that address."
      >
        <Textarea
          id={emailsId}
          value={text}
          rows={3}
          placeholder="jamie@example.com, sam@example.com"
          aria-invalid={error ? true : undefined}
          onChange={(event) => setText(event.target.value)}
          onBlur={() => setTouched(text.trim() !== "")}
        />
      </FieldShell>
      <div
        className={
          settings.isOrganizer ? "grid gap-3 sm:grid-cols-2" : "grid gap-3"
        }
      >
        {settings.isOrganizer ? (
          <RoleSelect id={roleId} value={role} onChange={setRole} />
        ) : null}
        <TtlSelect
          id={ttlId}
          label="Invitations expire after"
          value={ttlDays}
          onChange={setTtlDays}
        />
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          <Mail aria-hidden />
          {pending
            ? "Inviting..."
            : settings.emailConfigured
              ? `Send ${parsed.valid.length > 1 ? `${parsed.valid.length} invitations` : "invitation"}`
              : `Create ${parsed.valid.length > 1 ? `${parsed.valid.length} invitations` : "invitation"}`}
        </Button>
      </div>
    </form>
  );
}

function EmailResults({
  results,
  tripTitle,
  emailConfigured,
}: {
  results: EmailOutcome[];
  tripTitle: string;
  emailConfigured: boolean;
}) {
  const sent = results.filter((result) => result.outcome === "sent").length;
  const unsent = results.filter(
    (result) => result.outcome === "not_sent" || result.outcome === "failed",
  ).length;
  return (
    <>
      <p className="text-sm" role="status">
        {sent > 0 ? `Emailed ${sent} invitation${sent === 1 ? "" : "s"}. ` : ""}
        {unsent > 0
          ? emailConfigured
            ? `${unsent} invitation${unsent === 1 ? " wasn't" : "s weren't"} emailed. Copy ${unsent === 1 ? "its link" : "their links"} and send ${unsent === 1 ? "it" : "them"} yourself.`
            : `Email sending isn't set up, so nothing was emailed. Copy each link and send it yourself.`
          : ""}
      </p>
      <ul className="grid gap-3">
        {results.map((result) => (
          <li key={result.email} className="grid gap-1.5">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate font-medium">{result.email}</span>
              {result.outcome === "sent" ? (
                <Pill tone="confirmed">Email sent</Pill>
              ) : result.outcome === "already_member" ? (
                <Pill tone="neutral">Already a member</Pill>
              ) : result.outcome === "failed" ? (
                <Pill tone="warning">Email failed</Pill>
              ) : (
                <Pill tone="suggestion">Not emailed</Pill>
              )}
            </div>
            {result.outcome === "failed" && result.error ? (
              <p className="text-xs text-destructive">{result.error}</p>
            ) : null}
            {result.outcome === "not_sent" || result.outcome === "failed" ? (
              <CopyLink
                url={result.url}
                label={`invite link for ${result.email}`}
                shareTitle={`Join "${tripTitle}"`}
                testId="invite-email-link"
              />
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}

function ActiveLinks({
  tripId,
  links,
}: {
  tripId: string;
  links: InviteLinkView[];
}) {
  const { run, pending } = useAction();
  if (links.length === 0) return null;
  return (
    <section className="border-t pt-3" aria-labelledby="active-links-heading">
      <h3
        id="active-links-heading"
        className="text-xs font-medium text-muted-foreground"
      >
        Active invite links
      </h3>
      <ul className="mt-2 space-y-2" data-testid="invite-links-list">
        {links.map((link) => (
          <li
            key={link.id}
            className="flex items-center justify-between gap-2 text-xs"
          >
            <span className="flex min-w-0 items-start gap-1.5 text-muted-foreground">
              <Link2 className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                {link.role === "ORGANIZER" ? "Organizer link · " : ""}
                Created by {link.createdByName ?? "a member"}{" "}
                {formatRelativeTime(link.createdAt)} · expires{" "}
                {formatDateOnly(link.expiresAt.slice(0, 10), "short")} · used{" "}
                {link.useCount}
                {link.maxUses ? ` of ${link.maxUses}` : ""}
              </span>
            </span>
            {link.canManage ? (
              <ConfirmAction
                title="Revoke this invite link?"
                description="Anyone who has the link won't be able to use it to join. People who already joined stay on the trip."
                confirmLabel="Revoke"
                onConfirm={() =>
                  run(() => revokeInvitationAction(tripId, link.id), {
                    success: "Invite link revoked",
                  })
                }
                trigger={
                  <Button variant="ghost" size="xs" disabled={pending}>
                    Revoke
                  </Button>
                }
              />
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function EmailInvitations({
  tripId,
  emails,
  emailConfigured,
}: {
  tripId: string;
  emails: EmailInviteView[];
  emailConfigured: boolean;
}) {
  const { run, pending } = useAction();
  const [fresh, setFresh] = useState<Record<string, string>>({});
  if (emails.length === 0) return null;
  return (
    <section className="border-t pt-3" aria-labelledby="email-invites-heading">
      <h3
        id="email-invites-heading"
        className="text-xs font-medium text-muted-foreground"
      >
        Email invitations
      </h3>
      <ul className="mt-2 space-y-2.5" data-testid="invite-emails-list">
        {emails.map((invite) => {
          const status = STATUS[invite.status];
          const open =
            invite.status === "pending" || invite.status === "expired";
          return (
            <li key={invite.id} className="grid gap-1.5 text-xs">
              <div className="flex items-center gap-2">
                <Mail
                  className="size-3.5 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate text-sm">
                  {invite.email}
                </span>
                <Pill tone={status.tone}>{status.label}</Pill>
                {invite.canManage && open ? (
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={pending}
                    aria-label={`Resend invitation to ${invite.email}`}
                    onClick={() =>
                      run(() => resendInvitationAction(tripId, invite.id), {
                        onSuccess: (result) => {
                          if (result.outcome === "sent") {
                            toast.success(`Invitation emailed again`);
                          } else if (
                            result.outcome === "not_sent" ||
                            result.outcome === "failed"
                          ) {
                            setFresh((current) => ({
                              ...current,
                              [invite.id]: result.url,
                            }));
                            toast.warning(
                              result.outcome === "failed"
                                ? `Not emailed: ${result.error ?? "the email failed"}. Copy the new link instead.`
                                : "Email sending isn't set up. Copy the new link instead.",
                            );
                          }
                        },
                      })
                    }
                  >
                    <RotateCw aria-hidden />
                    {emailConfigured ? "Resend" : "New link"}
                  </Button>
                ) : null}
                {invite.canManage && invite.status === "pending" ? (
                  <ConfirmAction
                    title={`Revoke the invitation for ${invite.email}?`}
                    description="Their link stops working. You can invite them again later."
                    confirmLabel="Revoke"
                    onConfirm={() =>
                      run(() => revokeInvitationAction(tripId, invite.id), {
                        success: "Invitation revoked",
                      })
                    }
                    trigger={
                      <Button
                        variant="ghost"
                        size="xs"
                        disabled={pending}
                        aria-label={`Revoke invitation to ${invite.email}`}
                      >
                        Revoke
                      </Button>
                    }
                  />
                ) : null}
              </div>
              <p className="pl-5.5 text-muted-foreground">
                {invite.role === "ORGANIZER" ? "As organizer · " : ""}
                {invite.status === "accepted"
                  ? `Accepted${invite.acceptedByName ? ` by ${invite.acceptedByName}` : ""}`
                  : invite.lastSentAt
                    ? `Emailed ${formatRelativeTime(invite.lastSentAt)}`
                    : "Not emailed"}
                {" · "}invited by {invite.createdByName ?? "a member"}
                {invite.status === "pending"
                  ? ` · expires ${formatDateOnly(invite.expiresAt.slice(0, 10), "short")}`
                  : ""}
              </p>
              {fresh[invite.id] ? (
                <div className="pl-5.5">
                  <CopyLink
                    url={fresh[invite.id]!}
                    label={`invite link for ${invite.email}`}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function MembersCanInviteSetting({
  tripId,
  value,
}: {
  tripId: string;
  value: boolean;
}) {
  const { run, pending } = useAction();
  const id = useFieldId("members-can-invite");
  return (
    <div className="flex items-start gap-2.5 border-t pt-3">
      <Checkbox
        id={id}
        checked={value}
        disabled={pending}
        onCheckedChange={(checked) =>
          run(() => setMembersCanInviteAction(tripId, checked === true), {
            success:
              checked === true
                ? "Members can now invite people"
                : "Only organizers can invite people now",
          })
        }
      />
      <div className="grid gap-0.5">
        <Label htmlFor={id} className="text-sm">
          Let members invite people
        </Label>
        <p className="text-xs text-muted-foreground">
          When this is off, only organizers can create links and send
          invitations.
        </p>
      </div>
    </div>
  );
}
