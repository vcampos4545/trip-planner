import { CalendarDays, MapPin, Plane } from "lucide-react";
import { Suspense } from "react";

import { AtlasPanelProvider } from "@/components/atlas/atlas-panel";
import { AtlasSourcesInfo } from "@/components/atlas/atlas-sources-info";
import { toChatMessages } from "@/components/atlas/message-mapping";

import {
  InviteButton,
  InviteProvider,
} from "@/components/members/invite-provider";
import { Pill, StageBadge } from "@/components/shared/status-badge";
import { TripDetailsEditButton } from "@/components/trips/details-editors";
import { StopsEditorButton } from "@/components/trips/stops-editor";
import { toTripDetailsFormInput } from "@/lib/validation/form-defaults";
import { AvatarStack } from "@/components/user-avatar";
import { TripMenu } from "@/components/workspace/trip-menu";
import { TripTabs } from "@/components/workspace/trip-tabs";
import { formatDateRange } from "@/lib/dates";
import { canInvite } from "@/lib/domain/invitations";
import { describeAirports, describeStop } from "@/lib/domain/stops";
import { requireUser } from "@/server/auth/session";
import { getAiStatus } from "@/server/ai/config";
import { inviteDefaultTtlDays } from "@/server/config";
import { db } from "@/server/db";
import { getEmailStatus } from "@/server/email";
import { getFlightSearchStatus } from "@/server/flights";
import { orNotFound } from "@/server/not-found";
import { getResearchProvider } from "@/server/research";
import {
  getOrCreateTripConversation,
  listMessages,
} from "@/server/services/conversations";
import { listInvitations } from "@/server/services/invitations";
import { leaveStatus } from "@/server/services/members";
import { tripToDetails } from "@/server/services/trip-mapping";
import { getTripWorkspace } from "@/server/services/trips";

const QUICK_PROMPTS = [
  "Suggest tasks for what we still need to figure out",
  "Propose an activity for a free afternoon",
  "Compare the options we've saved so far",
  "What decisions are still open?",
];

export default async function TripLayout({
  children,
  params,
}: LayoutProps<"/trips/[tripId]">) {
  const { tripId } = await params;
  const user = await requireUser(`/trips/${tripId}`);
  const { access, trip, stops } = await orNotFound(
    getTripWorkspace(tripId, user.id),
  );
  const conversation = await getOrCreateTripConversation(access);
  const [
    suggestedTasks,
    suggestedEvents,
    proposals,
    messages,
    optionCount,
    openTaskCount,
    eventCount,
    bookingCount,
    invitations,
    leaveBlock,
  ] = await Promise.all([
    db.task.count({ where: { tripId, status: "SUGGESTED" } }),
    db.itineraryEvent.count({ where: { tripId, status: "SUGGESTED" } }),
    db.tripDetailProposal.findMany({
      where: { tripId, status: "PENDING" },
      select: { id: true },
      take: 50,
    }),
    listMessages(conversation.id),
    db.researchOption.count({
      where: { tripId, status: { notIn: ["REJECTED", "CANCELLED"] } },
    }),
    db.task.count({
      where: { tripId, status: { in: ["OPEN", "IN_PROGRESS"] } },
    }),
    db.itineraryEvent.count({
      where: { tripId, status: { not: "CANCELLED" } },
    }),
    db.booking.count({ where: { tripId, status: { not: "CANCELLED" } } }),
    listInvitations(access),
    leaveStatus(access),
  ]);
  const mayInvite = canInvite(access.role, trip.membersCanInvite);
  const ai = getAiStatus();
  const research = getResearchProvider();
  const flights = getFlightSearchStatus();
  const solo = trip.members.length === 1;
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
    <Suspense>
      <AtlasPanelProvider
        tripId={trip.id}
        conversationId={conversation.id}
        messages={toChatMessages(messages)}
        aiConfigured={ai.configured}
        aiReason={ai.configured ? undefined : ai.reason}
        quickPrompts={QUICK_PROMPTS}
        inlineProposalIds={solo ? proposals.map((proposal) => proposal.id) : []}
        info={
          <AtlasSourcesInfo
            route={
              stops.length > 0
                ? stops.map((stop) => stop.name).join(", then ")
                : (trip.destination ?? "Not decided")
            }
            dates={
              formatDateRange(details.startDate, details.endDate) ??
              trip.dateNotes ??
              "Not set"
            }
            counts={{
              options: optionCount,
              openTasks: openTaskCount,
              itinerary: eventCount,
              bookings: bookingCount,
            }}
            research={{
              configured: research.isConfigured,
              label: research.label,
              unavailableReason: research.unavailableReason ?? undefined,
            }}
            flights={
              flights.configured
                ? {
                    configured: true,
                    label: flights.label,
                    testMode: flights.testMode,
                  }
                : { configured: false }
            }
          />
        }
      >
        <InviteProvider
          canInvite={mayInvite}
          settings={{
            tripId: trip.id,
            tripTitle: trip.title,
            isOrganizer: access.isOrganizer,
            membersCanInvite: trip.membersCanInvite,
            defaultTtlDays: inviteDefaultTtlDays(),
            emailConfigured: getEmailStatus().configured,
          }}
          links={invitations.links.map((link) => ({
            id: link.id,
            role: link.role,
            expiresAt: link.expiresAt.toISOString(),
            maxUses: link.maxUses,
            useCount: link.useCount,
            createdAt: link.createdAt.toISOString(),
            createdByName: link.createdBy.name,
            canManage: link.canManage,
          }))}
          emails={invitations.emails.map((invite) => ({
            id: invite.id,
            email: invite.email ?? "",
            role: invite.role,
            status: invite.status,
            expiresAt: invite.expiresAt.toISOString(),
            lastSentAt: invite.lastSentAt?.toISOString() ?? null,
            createdAt: invite.createdAt.toISOString(),
            createdByName: invite.createdBy.name,
            acceptedByName: invite.acceptedBy?.name ?? null,
            canManage: invite.canManage,
          }))}
        >
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
                      {trip.isSample ? (
                        <Pill tone="warning">Sample data</Pill>
                      ) : null}
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
                        {route &&
                        stops.length <= 1 &&
                        !trip.destinationConfirmed
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
                    <InviteButton />
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
                      leaveBlock={leaveBlock}
                    />
                  </div>
                </div>
                <div className="mt-4">
                  <TripTabs
                    tripId={trip.id}
                    counts={{
                      overview: proposals.length,
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
        </InviteProvider>
      </AtlasPanelProvider>
    </Suspense>
  );
}
