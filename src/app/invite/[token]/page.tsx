import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  Clock,
  Link2Off,
  ShieldX,
  Users,
} from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { signInWithGoogle } from "@/app/signin/actions";
import { isGoogleAuthConfigured } from "@/auth";
import { BrandMark } from "@/components/brand-mark";
import { JoinTripButton } from "@/components/trips/join-trip-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatDateRange, formatTimestamp } from "@/lib/dates";
import { getCurrentUser } from "@/server/auth/session";
import { switchAccountAction } from "@/server/actions/session";
import {
  inspectInvitation,
  type InvitePreview,
} from "@/server/services/invitations";

export const metadata: Metadata = {
  title: "Trip invitation",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const PROBLEMS = {
  invalid: {
    icon: Link2Off,
    title: "This invite link isn't valid",
    body: "Check that you copied the whole link, or ask the organizer to send a new one.",
  },
  expired: {
    icon: Clock,
    title: "This invitation has expired",
    body: "Ask the organizer to send you a new invitation.",
  },
  revoked: {
    icon: ShieldX,
    title: "This invitation was revoked",
    body: "The organizer turned this invitation off. Ask them for a new one.",
  },
  used_up: {
    icon: Users,
    title: "This invite link has been used up",
    body: "It reached its limit. Ask the organizer for a new link.",
  },
  accepted: {
    icon: CheckCircle2,
    title: "This invitation was already accepted",
    body: "Each email invitation works once. If that wasn't you, ask the organizer for a new one.",
  },
} as const;

export default async function InvitePage({
  params,
}: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const user = await getCurrentUser();
  const state = await inspectInvitation(token, user ? { id: user.id } : null);
  if (state.status === "member") redirect(`/trips/${state.tripId}` as Route);
  const invitePath = `/invite/${token}`;

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-7xl items-center px-4 sm:px-6">
          <Link
            href={user ? "/trips" : "/"}
            className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <BrandMark />
          </Link>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-16">
        <div className="rounded-xl border bg-card p-6 text-center shadow-xs sm:p-8">
          {state.status === "valid" ? (
            <div className="space-y-5">
              <Preview preview={state.preview} />
              {user ? (
                <JoinTripButton token={token} />
              ) : (
                <SignInToJoin
                  callbackUrl={invitePath}
                  invitedEmail={state.preview.invitedEmail}
                />
              )}
              <p className="text-xs text-muted-foreground">
                Members can see the trip details, options, tasks, itinerary, and
                bookings.
              </p>
            </div>
          ) : state.status === "wrong_account" ? (
            <div className="space-y-5">
              <Preview preview={state.preview} />
              <Alert variant="destructive" className="text-left">
                <AlertCircle aria-hidden />
                <AlertTitle>
                  {state.reason === "unverified"
                    ? "Confirm your email to join"
                    : "This invitation is for a different account"}
                </AlertTitle>
                <AlertDescription>
                  {state.reason === "unverified"
                    ? "Sign in with Google again so we can confirm your email address, then open this link again."
                    : `It was sent to ${state.preview.invitedEmail}, and you're signed in as ${state.signedInAs ?? "an account without an email"}. Sign in with the Google account for that address to accept it.`}
                </AlertDescription>
              </Alert>
              <form action={switchAccountAction}>
                <input type="hidden" name="callbackUrl" value={invitePath} />
                <Button type="submit" className="w-full" size="lg">
                  Sign in with a different account
                </Button>
              </form>
            </div>
          ) : (
            <Problem
              {...PROBLEMS[state.status]}
              tripTitle={"tripTitle" in state ? state.tripTitle : undefined}
              signedIn={user !== null}
            />
          )}
        </div>
      </main>
    </div>
  );
}

function Preview({ preview }: { preview: InvitePreview }) {
  const dates = formatDateRange(preview.startDate, preview.endDate);
  return (
    <>
      <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <Users className="size-5" aria-hidden />
      </span>
      <div className="space-y-1.5">
        <p className="text-sm text-muted-foreground">
          {preview.organizerName
            ? `${preview.organizerName} invited you to plan`
            : "You're invited to plan"}
        </p>
        <h1
          className="text-xl font-semibold tracking-tight"
          data-testid="invite-trip-title"
        >
          {preview.tripTitle}
        </h1>
        <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <CalendarDays className="size-3.5" aria-hidden />
          {dates ?? "Dates not set yet"}
        </p>
        <p
          className="text-sm text-muted-foreground"
          data-testid="invite-summary"
        >
          {preview.memberCount}{" "}
          {preview.memberCount === 1 ? "person is" : "people are"} planning this
          trip.
          {preview.role === "ORGANIZER"
            ? " You'll join as an organizer."
            : ""}{" "}
          {preview.invitedEmail
            ? `This invitation is for ${preview.invitedEmail} and expires`
            : "Link expires"}{" "}
          {formatTimestamp(preview.expiresAt)}.
        </p>
      </div>
    </>
  );
}

function SignInToJoin({
  callbackUrl,
  invitedEmail,
}: {
  callbackUrl: string;
  invitedEmail: string | null;
}) {
  const configured = isGoogleAuthConfigured();
  return (
    <div className="space-y-3">
      <form action={signInWithGoogle}>
        <input type="hidden" name="callbackUrl" value={callbackUrl} />
        <Button
          type="submit"
          className="w-full"
          size="lg"
          disabled={!configured}
        >
          Sign in with Google to join
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">
        {configured
          ? invitedEmail
            ? `Use the Google account for ${invitedEmail}. You'll come back here to join.`
            : "You'll come back here to join after you sign in."
          : "Google sign-in isn't configured on this server yet."}
      </p>
    </div>
  );
}

function Problem({
  icon: Icon,
  title,
  body,
  tripTitle,
  signedIn,
}: {
  icon: typeof Clock;
  title: string;
  body: string;
  tripTitle?: string;
  signedIn: boolean;
}) {
  return (
    <div className="space-y-4">
      <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">{title}</h1>
        {tripTitle ? (
          <p className="text-sm text-muted-foreground">Trip: {tripTitle}</p>
        ) : null}
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
      <Button asChild variant="outline">
        <Link href={signedIn ? "/trips" : "/signin"}>
          {signedIn ? "Go to your trips" : "Sign in"}
        </Link>
      </Button>
    </div>
  );
}
