import type { Metadata } from "next";

import { DecisionsPanel } from "@/components/tasks/decisions-panel";
import { TasksPanel } from "@/components/tasks/tasks-panel";
import { serialize } from "@/lib/serialize";
import { requireTripAccess } from "@/server/access";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { orNotFound } from "@/server/not-found";
import { listMembers } from "@/server/services/members";
import { listDecisions } from "@/server/services/research";
import { listTasks } from "@/server/services/tasks";

export const metadata: Metadata = { title: "Tasks & decisions" };

export default async function TasksPage({
  params,
}: PageProps<"/trips/[tripId]/tasks">) {
  const { tripId } = await params;
  const user = await requireUser(`/trips/${tripId}/tasks`);
  const access = await orNotFound(requireTripAccess(tripId, user.id));
  const [tasks, decisions, members, options, bookings, events] =
    await Promise.all([
      listTasks(access),
      listDecisions(access),
      listMembers(access),
      db.researchOption.findMany({
        where: { tripId, status: { notIn: ["REJECTED", "CANCELLED"] } },
        select: { id: true, title: true },
        orderBy: { updatedAt: "desc" },
        take: 100,
      }),
      db.booking.findMany({
        where: { tripId },
        select: { id: true, title: true },
        take: 100,
      }),
      db.itineraryEvent.findMany({
        where: { tripId, status: { not: "CANCELLED" } },
        select: { id: true, title: true },
        orderBy: { date: "asc" },
        take: 100,
      }),
    ]);
  const choices = {
    members: members.map((member) => ({
      id: member.id,
      name: member.user.name ?? member.user.email ?? "Member",
    })),
    options,
    bookings,
    events,
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <TasksPanel
        tripId={tripId}
        tasks={serialize(tasks)}
        choices={choices}
        currentMemberId={access.memberId}
        currentUserId={user.id}
        role={access.role}
      />
      <DecisionsPanel
        tripId={tripId}
        decisions={serialize(decisions)}
        currentUserId={user.id}
        isOrganizer={access.isOrganizer}
        memberCount={members.length}
        options={options}
      />
    </div>
  );
}
