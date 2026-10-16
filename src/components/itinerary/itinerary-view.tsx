"use client";

import {
  ArrowDown,
  Bed,
  CalendarPlus,
  Check,
  CircleDot,
  Coffee,
  ExternalLink,
  MapPin,
  MoreHorizontal,
  Pencil,
  Plane,
  Sparkles,
  Ticket,
  Trash2,
  Utensils,
  X,
} from "lucide-react";
import { useState } from "react";

import { useAtlasPanel } from "@/components/atlas/atlas-panel";
import { ConfirmAction } from "@/components/shared/confirm-button";
import { EventStatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ASSISTANT_NAME } from "@/config/brand";
import type { EventKind, EventStatus } from "@/generated/prisma/enums";
import { useAction } from "@/hooks/use-action";
import {
  formatDateOnly,
  formatMinutes,
  formatTimeRange,
  minutesToTime,
} from "@/lib/dates";
import { findGaps, groupByDay, partOfDay } from "@/lib/domain/itinerary";
import { EVENT_KIND_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import {
  confirmEventAction,
  deleteEventAction,
  reviewEventSuggestionAction,
} from "@/server/actions/itinerary";

import { emptyEvent } from "@/lib/validation/form-defaults";

import { EventFormDialog } from "./event-form-dialog";

export type EventView = {
  id: string;
  title: string;
  kind: EventKind;
  status: EventStatus;
  date: string;
  startMinute: number | null;
  endMinute: number | null;
  locationName: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  url: string | null;
  notes: string | null;
  rationale: string | null;
  caveats: string | null;
  version: number;
  origin: string;
  researchOption: { id: string; title: string; url: string | null } | null;
  booking: { id: string; title: string; status: string } | null;
  updatedBy: { name: string | null } | null;
};

type Links = {
  options: { id: string; title: string }[];
  bookings: { id: string; title: string }[];
};

const KIND_ICONS: Record<EventKind, typeof Ticket> = {
  ACTIVITY: Ticket,
  MEAL: Utensils,
  TRANSFER: ArrowDown,
  FLIGHT: Plane,
  LODGING: Bed,
  FREE_TIME: Coffee,
  OTHER: CircleDot,
};

function mapsLink(event: EventView) {
  if (event.latitude !== null && event.longitude !== null) {
    return `https://www.openstreetmap.org/?mlat=${event.latitude}&mlon=${event.longitude}#map=16/${event.latitude}/${event.longitude}`;
  }
  const query = [event.locationName, event.address].filter(Boolean).join(", ");
  return query
    ? `https://www.openstreetmap.org/search?query=${encodeURIComponent(query)}`
    : null;
}

export function eventToFormInput(event: EventView) {
  return {
    title: event.title,
    kind: event.kind,
    status:
      event.status === "CONFIRMED"
        ? ("CONFIRMED" as const)
        : ("PLANNED" as const),
    date: event.date.slice(0, 10),
    startTime:
      event.startMinute !== null ? minutesToTime(event.startMinute) : "",
    endTime: event.endMinute !== null ? minutesToTime(event.endMinute) : "",
    locationName: event.locationName ?? "",
    address: event.address ?? "",
    latitude: event.latitude?.toString() ?? "",
    longitude: event.longitude?.toString() ?? "",
    url: event.url ?? "",
    notes: event.notes ?? "",
    researchOptionId: event.researchOption?.id ?? "",
    bookingId: event.booking?.id ?? "",
  };
}

export function ItineraryView({
  tripId,
  events,
  tripStart,
  tripEnd,
  links,
  aiConfigured,
}: {
  tripId: string;
  events: EventView[];
  tripStart: string | null;
  tripEnd: string | null;
  links: Links;
  aiConfigured: boolean;
}) {
  const suggestions = events.filter((event) => event.status === "SUGGESTED");
  const planned = events.filter((event) => event.status !== "SUGGESTED");
  const days = groupByDay(planned, tripStart, tripEnd);
  const dayIndex = (date: string) =>
    tripStart
      ? Math.round((Date.parse(date) - Date.parse(tripStart)) / 86_400_000) + 1
      : null;

  return (
    <div className="space-y-6">
      {suggestions.length > 0 ? (
        <section
          aria-labelledby="suggestions-heading"
          className="rounded-xl border border-dashed border-amber-300 bg-amber-50/50 p-4"
          data-testid="itinerary-suggestions"
        >
          <h2
            id="suggestions-heading"
            className="flex items-center gap-1.5 text-sm font-semibold text-amber-950"
          >
            <Sparkles className="size-4" aria-hidden />
            Suggestions from {ASSISTANT_NAME}
          </h2>
          <p className="text-xs text-amber-900/80">
            Not part of the plan until someone accepts them. Details are not
            verified.
          </p>
          <ul className="mt-3 space-y-2">
            {suggestions.map((event) => (
              <SuggestionRow
                key={event.id}
                tripId={tripId}
                event={event}
                links={links}
                tripStart={tripStart}
                tripEnd={tripEnd}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {days.length === 0 ? null : (
        <ol className="space-y-5">
          {days.map((day) => {
            const gaps = day.inTrip ? findGaps(day.items) : [];
            const index = dayIndex(day.date);
            return (
              <li
                key={day.date}
                aria-labelledby={`day-${day.date}`}
                className="rounded-xl border bg-card"
              >
                <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
                  <h2 id={`day-${day.date}`} className="text-sm font-semibold">
                    {index !== null && day.inTrip ? (
                      <span className="text-muted-foreground">
                        Day {index} ·{" "}
                      </span>
                    ) : null}
                    {formatDateOnly(day.date, "long")}
                    {!day.inTrip ? (
                      <span className="ml-2 text-xs font-normal text-amber-700">
                        Outside the trip dates
                      </span>
                    ) : null}
                  </h2>
                  <EventFormDialog
                    tripId={tripId}
                    initial={emptyEvent(day.date)}
                    links={links}
                    tripStart={tripStart}
                    tripEnd={tripEnd}
                    trigger={
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Add to ${formatDateOnly(day.date, "weekday")}`}
                      >
                        <CalendarPlus aria-hidden />
                        <span className="hidden sm:inline">Add</span>
                      </Button>
                    }
                  />
                </div>
                {day.items.length === 0 ? (
                  <div className="flex flex-col items-start gap-2 px-4 py-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                    <p>Nothing planned yet.</p>
                    {aiConfigured ? (
                      <AskAtlasLink
                        tripId={tripId}
                        prompt={`Suggest something to do on ${formatDateOnly(day.date, "weekday")}`}
                      />
                    ) : null}
                  </div>
                ) : (
                  <ul className="divide-y">
                    {day.items.map((event) => (
                      <EventRow
                        key={event.id}
                        tripId={tripId}
                        event={event}
                        links={links}
                        tripStart={tripStart}
                        tripEnd={tripEnd}
                      />
                    ))}
                  </ul>
                )}
                {gaps.length > 0 && day.items.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-2 border-t bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
                    <Coffee className="size-3.5" aria-hidden />
                    {gaps
                      .map(
                        (gap) =>
                          `Open ${formatMinutes(gap.start)} to ${formatMinutes(gap.end)}`,
                      )
                      .join(" · ")}
                    {aiConfigured ? (
                      <AskAtlasLink
                        tripId={tripId}
                        prompt={`Suggest an activity for the ${partOfDay(gaps[0]!.start)} of ${formatDateOnly(day.date, "weekday")}`}
                      />
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function AskAtlasLink({ prompt }: { tripId: string; prompt: string }) {
  const atlas = useAtlasPanel();
  if (!atlas) return null;
  return (
    <button
      type="button"
      onClick={() => atlas.openAtlas(prompt)}
      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
    >
      <Sparkles className="size-3" aria-hidden />
      Ask {ASSISTANT_NAME} for ideas
    </button>
  );
}

function EventMeta({ event }: { event: EventView }) {
  const map = mapsLink(event);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {event.locationName || event.address ? (
        <span className="inline-flex items-center gap-1">
          <MapPin className="size-3" aria-hidden />
          {map ? (
            <a
              href={map}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground hover:underline"
            >
              {[event.locationName, event.address].filter(Boolean).join(", ")}
            </a>
          ) : (
            [event.locationName, event.address].filter(Boolean).join(", ")
          )}
        </span>
      ) : null}
      {event.url ? (
        <a
          href={event.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="inline-flex items-center gap-1 text-primary hover:underline"
        >
          Link
          <ExternalLink className="size-3" aria-hidden />
        </a>
      ) : null}
      {event.booking ? <span>Booking: {event.booking.title}</span> : null}
      {event.researchOption ? (
        <span>Option: {event.researchOption.title}</span>
      ) : null}
    </div>
  );
}

function EventRow({
  tripId,
  event,
  links,
  tripStart,
  tripEnd,
}: {
  tripId: string;
  event: EventView;
  links: Links;
  tripStart: string | null;
  tripEnd: string | null;
}) {
  const [dialog, setDialog] = useState<"edit" | "delete" | null>(null);
  const { run, pending } = useAction();
  const Icon = KIND_ICONS[event.kind];
  const time = formatTimeRange(event.startMinute, event.endMinute);
  const transfer = event.kind === "TRANSFER";
  return (
    <li
      className={cn("flex gap-3 px-4 py-3", transfer && "bg-muted/30 py-2")}
      data-testid="itinerary-event"
    >
      <div className="w-20 shrink-0 pt-0.5 text-xs font-medium text-muted-foreground tabular-nums sm:w-28">
        {time ?? "Any time"}
      </div>
      <span
        className={cn(
          "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full",
          event.status === "CONFIRMED"
            ? "bg-emerald-100 text-emerald-800"
            : "bg-muted text-muted-foreground",
        )}
        aria-hidden
      >
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <p
            className={cn(
              "text-sm font-medium",
              transfer && "text-muted-foreground",
            )}
          >
            {event.title}
          </p>
          <EventStatusBadge status={event.status} />
          <span className="text-[11px] text-muted-foreground">
            {EVENT_KIND_LABELS[event.kind]}
          </span>
        </div>
        <EventMeta event={event} />
        {event.notes ? (
          <p className="text-xs whitespace-pre-wrap text-foreground/80">
            {event.notes}
          </p>
        ) : null}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Actions for ${event.title}`}
            disabled={pending}
          >
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {event.status === "PLANNED" ? (
            <DropdownMenuItem
              onSelect={() =>
                run(() => confirmEventAction(tripId, event.id), {
                  success: "Marked as confirmed",
                })
              }
            >
              <Check aria-hidden />
              Mark confirmed
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={() => setDialog("edit")}>
            <Pencil aria-hidden />
            Edit
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => setDialog("delete")}
          >
            <Trash2 aria-hidden />
            Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <EventFormDialog
        tripId={tripId}
        initial={eventToFormInput(event)}
        editing={{ id: event.id, version: event.version }}
        links={links}
        tripStart={tripStart}
        tripEnd={tripEnd}
        open={dialog === "edit"}
        onOpenChange={(open) => setDialog(open ? "edit" : null)}
      />
      <ConfirmAction
        open={dialog === "delete"}
        onOpenChange={(open) => setDialog(open ? "delete" : null)}
        title={`Remove "${event.title}"?`}
        description="It will be removed from the itinerary for everyone."
        confirmLabel="Remove"
        onConfirm={() =>
          run(() => deleteEventAction(tripId, event.id), {
            success: "Removed from itinerary",
          })
        }
      />
    </li>
  );
}

function SuggestionRow({
  tripId,
  event,
  links,
  tripStart,
  tripEnd,
}: {
  tripId: string;
  event: EventView;
  links: Links;
  tripStart: string | null;
  tripEnd: string | null;
}) {
  const { run, pending } = useAction();
  const time = formatTimeRange(event.startMinute, event.endMinute);
  return (
    <li
      className="rounded-lg border border-amber-200 bg-card p-3"
      data-testid="itinerary-suggestion"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-medium text-muted-foreground">
            {formatDateOnly(event.date, "weekday")}
            {time ? ` · ${time}` : ""} · {EVENT_KIND_LABELS[event.kind]}
          </p>
          <p className="text-sm font-medium">{event.title}</p>
          <EventMeta event={event} />
          {event.rationale ? (
            <p className="text-xs text-foreground/80">{event.rationale}</p>
          ) : null}
          {event.caveats ? (
            <p className="text-xs text-amber-800">
              Not verified: {event.caveats}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() =>
              run(() => reviewEventSuggestionAction(tripId, event.id, false), {
                success: "Suggestion dismissed",
              })
            }
          >
            <X aria-hidden />
            Reject
          </Button>
          <EventFormDialog
            tripId={tripId}
            initial={eventToFormInput(event)}
            editing={{ id: event.id, version: event.version }}
            isSuggestion
            links={links}
            tripStart={tripStart}
            tripEnd={tripEnd}
            trigger={
              <Button size="sm" variant="outline" disabled={pending}>
                <Pencil aria-hidden />
                Modify
              </Button>
            }
          />
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              run(() => reviewEventSuggestionAction(tripId, event.id, true), {
                success: "Added to the itinerary",
              })
            }
          >
            <Check aria-hidden />
            Accept
          </Button>
        </div>
      </div>
    </li>
  );
}
