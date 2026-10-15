import { Clock, Link2Off, ShieldX, Users } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { JoinTripButton } from "@/components/trips/join-trip-button";
import { Button } from "@/components/ui/button";
import { formatTimestamp } from "@/lib/dates";
import { requireUser } from "@/server/auth/session";
import { inspectInvitation } from "@/server/services/members";

export const metadata: Metadata = {
  title: "Trip invitation",
  robots: { index: false, follow: false },
};

const PROBLEMS = {
  invalid: {
    icon: Link2Off,
    title: "This invite link isn't valid",
    body: "Check that you copied the whole link, or ask the organizer to send a new one.",
  },
  expired: {
    icon: Clock,
    title: "This invite link has expired",
    body: "Ask the organizer to create a new invite link.",
  },
  revoked: {
    icon: ShieldX,
    title: "This invite link was revoked",
    body: "The organizer turned this link off. Ask them for a new one.",
  },
  used_up: {
    icon: Users,
    title: "This invite link has been used up",
    body: "It reached its limit. Ask the organizer for a new link.",
  },
} as const;

export default async function InvitePage({
  params,
}: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const user = await requireUser(`/invite/${token}`);
  const state = await inspectInvitation(token, user.id);
  if (state.status === "member") redirect(`/trips/${state.tripId}` as Route);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-16">
      <div className="rounded-xl border bg-card p-6 text-center shadow-xs sm:p-8">
        {state.status === "valid" ? (
          <div className="space-y-5">
            <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-accent text-accent-foreground">
              <Users className="size-5" aria-hidden />
            </span>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">
                {state.organizerName
                  ? `${state.organizerName} invited you to plan`
                  : "You're invited to plan"}
              </p>
              <h1
                className="text-xl font-semibold tracking-tight"
                data-testid="invite-trip-title"
              >
                {state.tripTitle}
              </h1>
              <p className="text-sm text-muted-foreground">
                {state.memberCount}{" "}
                {state.memberCount === 1 ? "person is" : "people are"} planning
                this trip. Link expires {formatTimestamp(state.expiresAt)}.
              </p>
            </div>
            <JoinTripButton token={token} />
            <p className="text-xs text-muted-foreground">
              Members can see the trip details, options, tasks, itinerary, and
              bookings.
            </p>
          </div>
        ) : (
          <Problem
            {...PROBLEMS[state.status]}
            tripTitle={"tripTitle" in state ? state.tripTitle : undefined}
          />
        )}
      </div>
    </main>
  );
}

function Problem({
  icon: Icon,
  title,
  body,
  tripTitle,
}: {
  icon: typeof Clock;
  title: string;
  body: string;
  tripTitle?: string;
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
        <Link href="/trips">Go to your trips</Link>
      </Button>
    </div>
  );
}
