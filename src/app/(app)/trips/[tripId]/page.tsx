import { CheckSquare, Vote } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";

import { ActivityFeed } from "@/components/overview/activity-feed";
import { MembersCard } from "@/components/overview/members-card";
import { NextStepCard } from "@/components/overview/next-step-card";
import { PreferencesCard } from "@/components/overview/preferences-card";
import { ProposalsCard } from "@/components/overview/proposals-card";
import { SectionHeader } from "@/components/shared/page-header";
import { TripDetailsSummary } from "@/components/trips/trip-details-summary";
import { nextAction } from "@/lib/domain/next-action";
import { formatMoney } from "@/lib/money";
import { summarizeBudget } from "@/lib/domain/budget";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { orNotFound } from "@/server/not-found";
import { listRecentActivity } from "@/server/services/activity";
import { listStops } from "@/server/services/stops";
import { listInvitations } from "@/server/services/invitations";
import { leaveStatus, listMembers } from "@/server/services/members";
import {
  getTripDetails,
  getTripProgress,
  listPendingProposals,
  listPreferences,
} from "@/server/services/trips";
import { requireTripAccess } from "@/server/access";

export const metadata: Metadata = { title: "Trip overview" };

export default async function TripOverviewPage({
  params,
}: PageProps<"/trips/[tripId]">) {
  const { tripId } = await params;
  const user = await requireUser(`/trips/${tripId}`);
  const access = await orNotFound(requireTripAccess(tripId, user.id));
  const [
    { details, trip },
    progress,
    proposals,
    preferences,
    members,
    invitations,
    activity,
    openDecisions,
    unassignedTasks,
    bookings,
    candidates,
    stops,
    leaveBlock,
  ] = await Promise.all([
    getTripDetails(access),
    getTripProgress(access),
    listPendingProposals(access),
    listPreferences(access),
    listMembers(access),
    listInvitations(access),
    listRecentActivity(access, 12),
    db.decision.findMany({
      where: { tripId, status: "OPEN" },
      select: { id: true, title: true, _count: { select: { votes: true } } },
      orderBy: { createdAt: "asc" },
      take: 5,
    }),
    db.task.findMany({
      where: {
        tripId,
        status: { in: ["OPEN", "IN_PROGRESS"] },
        assigneeMemberId: null,
      },
      select: { id: true, title: true, priority: true },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      take: 5,
    }),
    db.booking.findMany({
      where: { tripId },
      select: {
        id: true,
        title: true,
        category: true,
        status: true,
        costAmount: true,
        currency: true,
        costIsEstimate: true,
        costSplit: true,
        participants: {
          select: { memberId: true, shareAmount: true, status: true },
        },
      },
    }),
    db.researchOption.findMany({
      where: {
        tripId,
        category: "DESTINATION",
        status: { notIn: ["REJECTED", "CANCELLED"] },
      },
      select: { title: true, rationale: true },
      take: 8,
    }),
    listStops(access),
    leaveStatus(access),
  ]);

  const budget = summarizeBudget(
    bookings,
    members.map((member) => member.id),
    trip.currency,
  );
  const primaryBudget = budget.currencies[0];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-6">
        <NextStepCard tripId={tripId} action={nextAction(progress)} />
        <ProposalsCard
          tripId={tripId}
          solo={members.length === 1}
          proposals={proposals.map((proposal) => ({
            id: proposal.id,
            createdAt: proposal.createdAt.toISOString(),
            proposedBy: { name: proposal.proposedBy.name },
            changes: proposal.changes.map((change) => ({
              label: change.label,
            })),
          }))}
        />

        <div className="grid items-start gap-6 md:grid-cols-2">
          <section
            aria-labelledby="summary-heading"
            className="rounded-xl border bg-card p-5 md:row-span-2"
          >
            <h2 id="summary-heading" className="mb-1 text-sm font-semibold">
              Trip summary
            </h2>
            {trip.summary ? (
              <p className="mb-4 text-sm text-muted-foreground">
                {trip.summary}
              </p>
            ) : (
              <div className="mb-3" />
            )}
            <TripDetailsSummary
              details={details}
              stops={stops}
              candidateDestinations={candidates.map((candidate) => ({
                name: candidate.title,
                reason: candidate.rationale,
              }))}
            />
          </section>

          <section
            aria-labelledby="outstanding-heading"
            className="space-y-4 rounded-xl border bg-card p-5"
          >
            <SectionHeader
              title={<span id="outstanding-heading">Outstanding</span>}
              description="Open decisions and tasks nobody owns yet."
            />
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Vote className="size-3.5" aria-hidden /> Open decisions
              </p>
              {openDecisions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No open decisions.
                </p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {openDecisions.map((decision) => (
                    <li
                      key={decision.id}
                      className="flex justify-between gap-2"
                    >
                      <Link
                        href={
                          `/trips/${tripId}/tasks#decision-${decision.id}` as Route
                        }
                        className="truncate hover:text-primary"
                      >
                        {decision.title}
                      </Link>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {decision._count.votes}{" "}
                        {decision._count.votes === 1 ? "vote" : "votes"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <CheckSquare className="size-3.5" aria-hidden /> Unassigned
                tasks
              </p>
              {unassignedTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Every open task has an owner.
                </p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {unassignedTasks.map((task) => (
                    <li key={task.id} className="truncate">
                      <Link
                        href={`/trips/${tripId}/tasks` as Route}
                        className="hover:text-primary"
                      >
                        {task.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section
            aria-labelledby="budget-heading"
            className="space-y-2 rounded-xl border bg-card p-5"
          >
            <SectionHeader
              title={<span id="budget-heading">Budget estimate</span>}
              actions={
                <Link
                  href={`/trips/${tripId}/bookings` as Route}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Details
                </Link>
              }
            />
            {primaryBudget ? (
              <div>
                <p className="text-2xl font-semibold tracking-tight">
                  {formatMoney(primaryBudget.total, primaryBudget.currency)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatMoney(primaryBudget.actual, primaryBudget.currency)}{" "}
                  actual ·{" "}
                  {formatMoney(primaryBudget.estimated, primaryBudget.currency)}{" "}
                  estimated
                  {budget.currencies.length > 1
                    ? ` · plus costs in ${budget.currencies.length - 1} other currenc${budget.currencies.length === 2 ? "y" : "ies"}`
                    : ""}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No priced bookings yet.
              </p>
            )}
            {budget.unpriced.length > 0 ? (
              <p className="text-xs text-amber-800">
                {budget.unpriced.length} booking
                {budget.unpriced.length === 1 ? " has" : "s have"} no price yet
                and {budget.unpriced.length === 1 ? "isn't" : "aren't"} counted.
              </p>
            ) : null}
          </section>
        </div>

        <PreferencesCard
          tripId={tripId}
          members={members.map((member) => ({
            id: member.id,
            name: member.user.name ?? member.user.email ?? "Member",
          }))}
          preferences={preferences.map((preference) => ({
            id: preference.id,
            kind: preference.kind,
            strength: preference.strength,
            description: preference.description,
            origin: preference.origin,
            memberName: preference.member?.user.name ?? null,
          }))}
        />
      </div>

      <aside className="space-y-6">
        <MembersCard
          tripId={tripId}
          currentUserId={user.id}
          isOrganizer={access.isOrganizer}
          leaveBlock={leaveBlock}
          pendingInvites={
            invitations.emails.filter((invite) => invite.status === "pending")
              .length
          }
          members={members.map((member) => ({
            id: member.id,
            role: member.role,
            user: member.user,
          }))}
        />
        <section
          aria-labelledby="activity-heading"
          className="rounded-xl border bg-card p-5"
        >
          <h2 id="activity-heading" className="mb-3 text-sm font-semibold">
            Recent activity
          </h2>
          <ActivityFeed
            items={activity.map((item) => ({
              id: item.id,
              summary: item.summary,
              createdAt: item.createdAt.toISOString(),
              actor: item.actor,
            }))}
          />
        </section>
      </aside>
    </div>
  );
}
