import { CalendarDays, MapPin, Plane } from "lucide-react";

import { Pill, StageBadge } from "@/components/shared/status-badge";
import { TripDetailsEditButton } from "@/components/trips/details-editors";
import { StopsEditorButton } from "@/components/trips/stops-editor";
import { toTripDetailsFormInput } from "@/lib/validation/form-defaults";
import { AvatarStack } from "@/components/user-avatar";
import { TripMenu } from "@/components/workspace/trip-menu";
import { TripTabs } from "@/components/workspace/trip-tabs";
import { formatDateRange } from "@/lib/dates";
import { describeAirports, describeStop } from "@/lib/domain/stops";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { orNotFound } from "@/server/not-found";
import { tripToDetails } from "@/server/services/trip-mapping";
import { getTripWorkspace } from "@/server/services/trips";

export default async function TripLayout({
  children,
  params,
}: LayoutProps<"/trips/[tripId]">) {
  const { tripId } = await params;
  const user = await requireUser(`/trips/${tripId}`);
  const { access, trip, stops } = await orNotFound(
    getTripWorkspace(tripId, user.id),
  );
  const [suggestedTasks, suggestedEvents, proposals] = await Promise.all([
    db.task.count({ where: { tripId, status: "SUGGESTED" } }),
    db.itineraryEvent.count({ where: { tripId, status: "SUGGESTED" } }),
    db.tripDetailProposal.count({ where: { tripId, status: "PENDING" } }),
  ]);
  const details = tripToDetails(trip);
  const dates =
    formatDateRange(details.startDate, details.endDate) ??
    trip.dateNotes ??
    "Dates not set";
  const route =
    stops.length > 1
      ? stops.map((stop) => stop.name).join(" → ")
      : (trip.destination ?? stops[0]?.name ?? null);
  const airports = describeAirports(trip.flyIntoAirport, trip.flyOutOfAirport);

  return (
    <div className="flex flex-1 flex-col">
      <div className="border-b bg-card/60">
        <div className="mx-auto w-full max-w-7xl px-4 pt-6 sm:px-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h1
                  className="text-xl font-semibold tracking-tight sm:text-2xl"
                  data-testid="trip-title"
                >
                  {trip.title}
                </h1>
                <StageBadge stage={trip.stage} />
                {trip.isSample ? <Pill tone="warning">Sample data</Pill> : null}
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span
                  className="inline-flex items-center gap-1.5"
                  data-testid="trip-route"
                  title={
                    stops.length > 1
                      ? stops.map(describeStop).join(", then ")
                      : undefined
                  }
                >
                  <MapPin className="size-3.5" aria-hidden />
                  {route ?? "Destination not decided"}
                  {route && stops.length <= 1 && !trip.destinationConfirmed
                    ? " (tentative)"
                    : ""}
                </span>
                {airports ? (
                  <span
                    className="inline-flex items-center gap-1.5"
                    data-testid="trip-airports"
                  >
                    <Plane className="size-3.5" aria-hidden />
                    {airports}
                  </span>
                ) : null}
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays className="size-3.5" aria-hidden />
                  {dates}
                </span>
                <span className="inline-flex items-center gap-2">
                  <AvatarStack
                    people={trip.members.map((member) => member.user)}
                    max={5}
                    size="size-6"
                  />
                  <span>
                    {trip.members.length}{" "}
                    {trip.members.length === 1 ? "member" : "members"}
                  </span>
                </span>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <StopsEditorButton
                tripId={trip.id}
                version={trip.version}
                initial={{
                  flyIntoAirport: trip.flyIntoAirport ?? "",
                  flyOutOfAirport: trip.flyOutOfAirport ?? "",
                  stops: stops.map((stop) => ({
                    name: stop.name,
                    startDate: stop.startDate ?? "",
                    endDate: stop.endDate ?? "",
                  })),
                }}
              />
              <TripDetailsEditButton
                tripId={trip.id}
                version={trip.version}
                initial={toTripDetailsFormInput(details, trip.title)}
              />
              <TripMenu
                tripId={trip.id}
                title={trip.title}
                stage={trip.stage}
                isOrganizer={access.isOrganizer}
              />
            </div>
          </div>
          <div className="mt-4">
            <TripTabs
              tripId={trip.id}
              counts={{
                overview: proposals,
                tasks: suggestedTasks,
                itinerary: suggestedEvents,
              }}
            />
          </div>
        </div>
      </div>
      <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        {children}
      </div>
    </div>
  );
}
