import { CalendarRange, Plus } from "lucide-react";
import type { Metadata } from "next";

import { EventFormDialog } from "@/components/itinerary/event-form-dialog";
import { ItineraryView } from "@/components/itinerary/itinerary-view";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Pill } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { ASSISTANT_NAME } from "@/config/brand";
import { toDateOnly, todayDateOnly } from "@/lib/dates";
import { serialize } from "@/lib/serialize";
import { emptyEvent } from "@/lib/validation/form-defaults";
import { requireTripAccess } from "@/server/access";
import { requireUser } from "@/server/auth/session";
import { getAiStatus } from "@/server/ai/config";
import { db } from "@/server/db";
import { orNotFound } from "@/server/not-found";
import { listEvents } from "@/server/services/itinerary";

export const metadata: Metadata = { title: "Itinerary" };

export default async function ItineraryPage({
  params,
}: PageProps<"/trips/[tripId]/itinerary">) {
  const { tripId } = await params;
  const user = await requireUser(`/trips/${tripId}/itinerary`);
  const access = await orNotFound(requireTripAccess(tripId, user.id));
  const [events, trip, options, bookings] = await Promise.all([
    listEvents(access),
    db.trip.findUniqueOrThrow({
      where: { id: tripId },
      select: { startDate: true, endDate: true },
    }),
    db.researchOption.findMany({
      where: { tripId, status: { notIn: ["REJECTED", "CANCELLED"] } },
      select: { id: true, title: true },
      take: 100,
    }),
    db.booking.findMany({
      where: { tripId, status: { not: "CANCELLED" } },
      select: { id: true, title: true },
      take: 100,
    }),
  ]);
  const tripStart = trip.startDate ? toDateOnly(trip.startDate) : null;
  const tripEnd = trip.endDate ? toDateOnly(trip.endDate) : null;
  const links = { options, bookings };
  const ai = getAiStatus();
  const defaultDate = tripStart ?? todayDateOnly();

  return (
    <div className="space-y-5">
      <PageHeader
        title="Itinerary"
        description={
          <span className="inline-flex flex-wrap items-center gap-1.5">
            Day by day, in local time.
            <Pill tone="confirmed">Confirmed</Pill>
            <Pill tone="neutral">Planned</Pill>
            <Pill tone="suggestion">Suggestion</Pill>
          </span>
        }
        actions={
          <EventFormDialog
            tripId={tripId}
            initial={emptyEvent(defaultDate)}
            links={links}
            tripStart={tripStart}
            tripEnd={tripEnd}
            trigger={
              <Button>
                <Plus aria-hidden />
                Add to itinerary
              </Button>
            }
          />
        }
      />
      {!tripStart || !tripEnd ? (
        <p className="rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground">
          The trip doesn&apos;t have exact dates yet, so only days with plans
          are shown. Add dates in the trip details to see every day.
        </p>
      ) : null}
      {events.length === 0 && (!tripStart || !tripEnd) ? (
        <EmptyState
          icon={CalendarRange}
          title="No plans yet"
          description={`Add the first item, or ask ${ASSISTANT_NAME} to suggest activities once dates are set.`}
        />
      ) : (
        <ItineraryView
          tripId={tripId}
          events={serialize(events)}
          tripStart={tripStart}
          tripEnd={tripEnd}
          links={links}
          aiConfigured={ai.configured}
        />
      )}
    </div>
  );
}
