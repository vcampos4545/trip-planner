import { CalendarDays, CalendarRange, List, Plus } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";

import { EventFormDialog } from "@/components/itinerary/event-form-dialog";
import { ItineraryView } from "@/components/itinerary/itinerary-view";
import { WeekView } from "@/components/itinerary/week-view";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Pill } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { ASSISTANT_NAME } from "@/config/brand";
import { toDateOnly, todayDateOnly } from "@/lib/dates";
import { serialize } from "@/lib/serialize";
import { cn } from "@/lib/utils";
import { emptyEvent } from "@/lib/validation/form-defaults";
import { requireTripAccess } from "@/server/access";
import { requireUser } from "@/server/auth/session";
import { getAiStatus } from "@/server/ai/config";
import { db } from "@/server/db";
import { orNotFound } from "@/server/not-found";
import { listEvents } from "@/server/services/itinerary";
import { listStops } from "@/server/services/stops";

export const metadata: Metadata = { title: "Itinerary" };

export default async function ItineraryPage({
  params,
  searchParams,
}: PageProps<"/trips/[tripId]/itinerary">) {
  const { tripId } = await params;
  const query = await searchParams;
  const user = await requireUser(`/trips/${tripId}/itinerary`);
  const access = await orNotFound(requireTripAccess(tripId, user.id));
  const view = query.view === "list" ? "list" : "week";
  const [events, trip, options, bookings, stops] = await Promise.all([
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
      orderBy: [
        { startDate: { sort: "asc", nulls: "last" } },
        { startMinute: { sort: "asc", nulls: "last" } },
      ],
      select: {
        id: true,
        title: true,
        category: true,
        status: true,
        provider: true,
        startDate: true,
        startMinute: true,
        endDate: true,
        endMinute: true,
        fromLocation: true,
        toLocation: true,
        locationName: true,
        participants: {
          orderBy: { createdAt: "asc" },
          select: {
            status: true,
            member: { select: { user: { select: { name: true } } } },
          },
        },
      },
      take: 200,
    }),
    listStops(access),
  ]);
  const tripStart = trip.startDate ? toDateOnly(trip.startDate) : null;
  const tripEnd = trip.endDate ? toDateOnly(trip.endDate) : null;
  const links = {
    options,
    bookings: bookings.map((booking) => ({
      id: booking.id,
      title: booking.title,
    })),
  };
  const ai = getAiStatus();
  const defaultDate = tripStart ?? todayDateOnly();
  const datedBookings = bookings.filter((booking) => booking.startDate);
  const calendarBookings = datedBookings.map((booking) => ({
    id: booking.id,
    title: booking.title,
    category: booking.category,
    status: booking.status,
    provider: booking.provider,
    startDate: booking.startDate ? toDateOnly(booking.startDate) : null,
    startMinute: booking.startMinute,
    endDate: booking.endDate ? toDateOnly(booking.endDate) : null,
    endMinute: booking.endMinute,
    fromLocation: booking.fromLocation,
    toLocation: booking.toLocation,
    locationName: booking.locationName,
    participants: booking.participants.map((participant) => ({
      status: participant.status,
      name: participant.member.user.name ?? "Member",
    })),
  }));
  const nothingToShow =
    events.length === 0 &&
    (!tripStart || !tripEnd) &&
    (view === "list" || datedBookings.length === 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Itinerary"
        description={
          <span className="inline-flex flex-wrap items-center gap-1.5">
            {view === "week"
              ? "Plans, flights, rides, and stays, in local time."
              : "Day by day, in local time."}
            {view === "week" ? (
              <>
                <Pill tone="confirmed">Booked</Pill>
                <Pill tone="considering">Considering</Pill>
              </>
            ) : (
              <Pill tone="confirmed">Confirmed</Pill>
            )}
            <Pill tone="neutral">Planned</Pill>
            <Pill tone="suggestion">Suggestion</Pill>
          </span>
        }
        actions={
          <>
            <nav
              aria-label="Itinerary view"
              className="inline-flex rounded-lg border p-0.5"
            >
              {(
                [
                  ["week", "Week", CalendarDays],
                  ["list", "List", List],
                ] as const
              ).map(([value, label, Icon]) => (
                <Link
                  key={value}
                  href={
                    (value === "week"
                      ? `/trips/${tripId}/itinerary`
                      : `/trips/${tripId}/itinerary?view=list`) as Route
                  }
                  aria-current={view === value ? "page" : undefined}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                    view === value
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="size-3.5" aria-hidden />
                  {label}
                </Link>
              ))}
            </nav>
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
          </>
        }
      />
      {!tripStart || !tripEnd ? (
        <p className="rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground">
          The trip doesn&apos;t have exact dates yet, so only days with plans
          are shown. Add dates in the trip details to see every day.
        </p>
      ) : null}
      {nothingToShow ? (
        <EmptyState
          icon={CalendarRange}
          title="No plans yet"
          description={`Add the first item, or ask ${ASSISTANT_NAME} to suggest activities once dates are set.`}
        />
      ) : view === "week" ? (
        <WeekView
          tripId={tripId}
          events={serialize(events)}
          bookings={calendarBookings}
          stops={stops}
          tripStart={tripStart}
          tripEnd={tripEnd}
          links={links}
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
