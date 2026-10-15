import { MessageSquareText, Plane, Plus } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { DraftList } from "@/components/trips/draft-list";
import { TripCard, type TripCardData } from "@/components/trips/trip-card";
import { Button } from "@/components/ui/button";
import { toDateOnly } from "@/lib/dates";
import { nextAction } from "@/lib/domain/next-action";
import { deriveTitle } from "@/lib/domain/trip-details";
import { requireUser } from "@/server/auth/session";
import {
  draftOf,
  listDraftConversations,
} from "@/server/services/conversations";
import {
  DASHBOARD_TRIP_LIMIT,
  listTripsForUser,
} from "@/server/services/trips";

export const metadata: Metadata = { title: "Trips" };

export default async function TripsPage() {
  const user = await requireUser("/trips");
  const [trips, drafts] = await Promise.all([
    listTripsForUser(user.id),
    listDraftConversations(user.id),
  ]);

  const cards: TripCardData[] = trips.map(({ trip, progress }) => ({
    id: trip.id,
    title: trip.title,
    destination: trip.destination,
    destinationConfirmed: trip.destinationConfirmed,
    startDate: trip.startDate ? toDateOnly(trip.startDate) : null,
    endDate: trip.endDate ? toDateOnly(trip.endDate) : null,
    dateNotes: trip.dateNotes,
    stage: trip.stage,
    isSample: trip.isSample,
    members: trip.members.map((member) => member.user),
    nextAction: nextAction(progress),
  }));

  const draftItems = drafts.map((draft) => {
    const data = draftOf(draft);
    return {
      id: draft.id,
      title: deriveTitle(data, draft.startMode),
      startMode: draft.startMode,
      lastMessageAt: draft.lastMessageAt.toISOString(),
      messageCount: draft._count.messages,
    };
  });

  return (
    <main className="mx-auto w-full max-w-7xl space-y-8 px-4 py-8 sm:px-6">
      <PageHeader
        title="Trips"
        description="Every trip you're planning with your group."
        actions={
          <Button asChild>
            <Link href="/trips/new">
              <Plus aria-hidden />
              New trip
            </Link>
          </Button>
        }
      />

      {draftItems.length > 0 ? (
        <section aria-labelledby="drafts-heading" className="space-y-3">
          <h2
            id="drafts-heading"
            className="flex items-center gap-2 text-sm font-semibold"
          >
            <MessageSquareText
              className="size-4 text-muted-foreground"
              aria-hidden
            />
            Unfinished trip ideas
          </h2>
          <DraftList drafts={draftItems} />
        </section>
      ) : null}

      {cards.length === 0 ? (
        <EmptyState
          icon={Plane}
          title="Plan your first trip"
          description="Start with a place, a vibe, or no idea at all. Atlas helps turn it into a plan your group can share."
          action={
            <Button asChild>
              <Link href={"/trips/new" as Route}>
                <Plus aria-hidden />
                Create a trip
              </Link>
            </Button>
          }
        />
      ) : (
        <section aria-label="Your trips" className="space-y-3">
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((trip) => (
              <li key={trip.id}>
                <TripCard trip={trip} />
              </li>
            ))}
          </ul>
          {cards.length >= DASHBOARD_TRIP_LIMIT ? (
            <p className="text-xs text-muted-foreground">
              Showing your {DASHBOARD_TRIP_LIMIT} most recently updated trips.
            </p>
          ) : null}
        </section>
      )}
    </main>
  );
}
