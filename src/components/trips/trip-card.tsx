import { ArrowRight, CalendarDays, MapPin } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";

import { AvatarStack } from "@/components/user-avatar";
import { Pill, StageBadge } from "@/components/shared/status-badge";
import type { TripStage } from "@/generated/prisma/enums";
import { formatDateRange } from "@/lib/dates";
import type { NextAction } from "@/lib/domain/next-action";

export type TripCardData = {
  id: string;
  title: string;
  destination: string | null;
  destinationConfirmed: boolean;
  startDate: string | null;
  endDate: string | null;
  dateNotes: string | null;
  stage: TripStage;
  isSample: boolean;
  members: {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
  }[];
  nextAction: NextAction;
};

export function TripCard({ trip }: { trip: TripCardData }) {
  const dates =
    formatDateRange(trip.startDate, trip.endDate) ??
    trip.dateNotes ??
    "Dates not set";
  const href = (
    trip.nextAction.tab === "overview"
      ? `/trips/${trip.id}`
      : `/trips/${trip.id}/${trip.nextAction.tab}`
  ) as Route;
  return (
    <article className="group relative flex flex-col rounded-xl border bg-card p-5 transition-shadow focus-within:ring-3 focus-within:ring-ring/40 hover:shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 text-base font-semibold tracking-tight">
          <Link
            href={`/trips/${trip.id}` as Route}
            className="outline-none after:absolute after:inset-0 after:rounded-xl"
          >
            <span className="line-clamp-2">{trip.title}</span>
          </Link>
        </h3>
        <div className="flex shrink-0 items-center gap-1.5">
          {trip.isSample ? <Pill tone="warning">Sample</Pill> : null}
          <StageBadge stage={trip.stage} />
        </div>
      </div>
      <dl className="mt-3 space-y-1.5 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <dt className="sr-only">Destination</dt>
          <MapPin className="size-3.5 shrink-0" aria-hidden />
          <dd className="truncate">
            {trip.destination ?? "Destination not decided"}
            {trip.destination && !trip.destinationConfirmed ? (
              <span className="text-xs"> (tentative)</span>
            ) : null}
          </dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="sr-only">Dates</dt>
          <CalendarDays className="size-3.5 shrink-0" aria-hidden />
          <dd className="truncate">{dates}</dd>
        </div>
      </dl>
      <div className="mt-5 flex items-end justify-between gap-3 border-t pt-4">
        <div className="min-w-0">
          <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            Next step
          </p>
          <Link
            href={href}
            className="relative z-10 mt-0.5 inline-flex max-w-full items-center gap-1 text-sm font-medium text-foreground hover:text-primary"
          >
            <span className="truncate">{trip.nextAction.title}</span>
            <ArrowRight className="size-3.5 shrink-0" aria-hidden />
          </Link>
        </div>
        <AvatarStack people={trip.members} max={4} />
      </div>
    </article>
  );
}
