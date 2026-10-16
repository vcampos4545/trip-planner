"use client";

import {
  Bed,
  Car,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Coffee,
  ExternalLink,
  Pencil,
  Plane,
  Ticket,
  Utensils,
  X,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useAction } from "@/hooks/use-action";
import {
  addDays,
  formatDateOnly,
  formatMinutes,
  formatTimeRange,
} from "@/lib/dates";
import {
  calendarItemsFrom,
  calendarRange,
  flightsByTraveler,
  layoutAllDay,
  layoutSegments,
  pageStart,
  timedSegmentsOn,
  visibleDays,
  type CalendarBookingInput,
  type CalendarItem,
  type CalendarItemKind,
  type CalendarItemStatus,
} from "@/lib/domain/calendar";
import { stopOnDate, type TripStopInput } from "@/lib/domain/stops";
import { cn } from "@/lib/utils";
import { reviewEventSuggestionAction } from "@/server/actions/itinerary";

import { EventFormDialog } from "./event-form-dialog";
import { eventToFormInput, type EventView } from "./itinerary-view";

const HOUR_HEIGHT = 44;
const RANGES = [
  { size: 7, label: "Week" },
  { size: 3, label: "3 days" },
  { size: 1, label: "Day" },
] as const;
type RangeSize = (typeof RANGES)[number]["size"];

const KIND_ICONS: Record<CalendarItemKind, typeof Plane> = {
  flight: Plane,
  ground: Car,
  stay: Bed,
  activity: Ticket,
  meal: Utensils,
  free: Coffee,
  other: CircleDot,
};

const KIND_LABELS: Record<CalendarItemKind, string> = {
  flight: "Flight",
  ground: "Ground transport",
  stay: "Stay",
  activity: "Activity",
  meal: "Meal",
  free: "Free time",
  other: "Other",
};

const STATUS_LABELS: Record<CalendarItemStatus, string> = {
  suggested: "Suggestion",
  planned: "Planned",
  confirmed: "Confirmed",
  booked: "Booked",
  considering: "Considering",
  mixed: "Some booked",
};

/** Same color meanings as the status pills: amber suggestion, sky considering, emerald booked. */
const STATUS_STYLES: Record<CalendarItemStatus, string> = {
  suggested:
    "border-amber-300 border-dashed bg-amber-50/90 text-amber-950 hover:bg-amber-100",
  planned:
    "border-border bg-secondary text-secondary-foreground hover:bg-muted",
  confirmed:
    "border-emerald-200 bg-emerald-50 text-emerald-950 hover:bg-emerald-100",
  booked:
    "border-emerald-400 bg-emerald-50 text-emerald-950 hover:bg-emerald-100",
  considering:
    "border-sky-300 border-dashed bg-sky-50 text-sky-950 hover:bg-sky-100",
  mixed:
    "border-sky-300 bg-gradient-to-r from-emerald-50 to-sky-50 text-sky-950 hover:to-sky-100",
};

export type CalendarBookingView = CalendarBookingInput;

export function WeekView({
  tripId,
  events,
  bookings,
  stops,
  tripStart,
  tripEnd,
  links,
}: {
  tripId: string;
  events: EventView[];
  bookings: CalendarBookingView[];
  stops: TripStopInput[];
  tripStart: string | null;
  tripEnd: string | null;
  links: {
    options: { id: string; title: string }[];
    bookings: { id: string; title: string }[];
  };
}) {
  const items = useMemo(
    () => calendarItemsFrom({ events, bookings }),
    [events, bookings],
  );
  const range = calendarRange(items, tripStart, tripEnd);
  // Small screens start on a three-day view so each column stays readable.
  const small = useMediaQuery("(max-width: 767px)");
  const [chosen, setChosen] = useState<RangeSize | null>(null);
  const size: RangeSize = chosen ?? (small ? 3 : 7);
  const [anchor, setAnchor] = useState<string | null>(null);
  const first = range
    ? pageStart(range.start, anchor ?? range.start, size)
    : null;
  const scrollRef = useRef<HTMLDivElement>(null);
  const eventsById = useMemo(
    () => new Map(events.map((event) => [event.id, event])),
    [events],
  );
  const [editing, setEditing] = useState<EventView | null>(null);

  const days = first ? visibleDays(first, size) : [];
  const timedToday = days.flatMap((day) => timedSegmentsOn(items, day));
  const earliest = Math.min(
    7 * 60,
    ...timedToday.map((segment) => segment.start),
  );

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTop = Math.max((earliest / 60 - 0.5) * HOUR_HEIGHT, 0);
  }, [earliest, first, size]);

  if (!range || !first) return null;

  const last = days[days.length - 1]!;
  const canGoBack = first > range.start;
  const canGoForward = last < range.end;
  const allDay = layoutAllDay(items, days);
  const allDayRows = Math.max(...allDay.map((item) => item.row + 1), 0);
  const travelers = flightsByTraveler(items);
  const columns = `3rem repeat(${days.length}, minmax(0, 1fr))`;

  return (
    <div className="space-y-4" data-testid="week-view">
      {travelers.length > 0 ? (
        <section
          aria-labelledby="who-flies-heading"
          className="rounded-xl border bg-card p-4"
          data-testid="traveler-flights"
        >
          <h2 id="who-flies-heading" className="text-sm font-semibold">
            Who&apos;s flying when
          </h2>
          <ul className="mt-2 space-y-2">
            {travelers.map((traveler) => (
              <li
                key={traveler.name}
                className="flex flex-col gap-1.5 sm:flex-row sm:items-start"
              >
                <span className="w-28 shrink-0 text-sm font-medium">
                  {traveler.name}
                </span>
                <ul className="flex flex-wrap gap-1.5">
                  {traveler.flights.map(({ item, status }) => (
                    <li
                      key={item.id}
                      className={cn(
                        "inline-flex flex-wrap items-center gap-1 rounded-md border px-2 py-0.5 text-xs",
                        STATUS_STYLES[
                          status === "BOOKED" ? "booked" : "considering"
                        ],
                      )}
                    >
                      <Plane className="size-3" aria-hidden />
                      {formatDateOnly(item.startDate, "weekday")}
                      {item.startMinute !== null
                        ? `, ${formatMinutes(item.startMinute)}`
                        : ""}
                      {item.detail ? ` · ${item.detail}` : ""}
                      <span className="font-medium">
                        · {status === "BOOKED" ? "Booked" : "Considering"}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="rounded-xl border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Earlier days"
              disabled={!canGoBack}
              onClick={() => setAnchor(addDays(first, -size))}
            >
              <ChevronLeft aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Later days"
              disabled={!canGoForward}
              onClick={() => setAnchor(addDays(first, size))}
            >
              <ChevronRight aria-hidden />
            </Button>
            <p className="ml-1 text-sm font-medium" data-testid="week-range">
              {size === 1
                ? formatDateOnly(first, "long")
                : `${formatDateOnly(first, "short")} to ${formatDateOnly(last, "medium")}`}
            </p>
          </div>
          <div
            role="group"
            aria-label="Days shown"
            className="inline-flex rounded-lg border p-0.5"
          >
            {RANGES.map((option) => (
              <button
                key={option.size}
                type="button"
                aria-pressed={size === option.size}
                onClick={() => setChosen(option.size)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  size === option.size
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid border-b" style={{ gridTemplateColumns: columns }}>
          <div />
          {days.map((day) => {
            const stop = stopOnDate(stops, day);
            const outside =
              (tripStart && day < tripStart) || (tripEnd && day > tripEnd);
            return (
              <div
                key={day}
                className={cn(
                  "min-w-0 border-l px-1.5 py-2 text-center",
                  outside && "bg-muted/40",
                )}
                data-testid="week-day"
                data-date={day}
              >
                <p className="text-[11px] font-medium text-muted-foreground uppercase">
                  {formatDateOnly(day, "weekday").split(",")[0]}
                </p>
                <p className="text-lg leading-tight font-semibold">
                  {Number(day.slice(8, 10))}
                </p>
                {stop ? (
                  <p className="truncate text-[11px] text-muted-foreground">
                    {stop.name}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>

        {allDayRows > 0 ? (
          <div
            className="grid border-b"
            style={{ gridTemplateColumns: columns }}
            data-testid="all-day-lane"
          >
            <div className="py-1.5 pr-1 text-right text-[10px] text-muted-foreground">
              All day
            </div>
            <div
              className="grid gap-y-1 border-l py-1.5"
              style={{
                gridColumn: `2 / span ${days.length}`,
                gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
              }}
            >
              {allDay.map((placement) => (
                <div
                  key={placement.item.id}
                  className="min-w-0 px-0.5"
                  style={{
                    gridColumn: `${placement.startIndex + 1} / span ${placement.span}`,
                    gridRow: placement.row + 1,
                  }}
                >
                  <ItemButton
                    tripId={tripId}
                    item={placement.item}
                    compact
                    event={eventsById.get(placement.item.sourceId)}
                    onEdit={setEditing}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div
          ref={scrollRef}
          className="max-h-[32rem] overflow-y-auto"
          data-testid="week-hours"
        >
          <div
            className="relative grid"
            style={{
              gridTemplateColumns: columns,
              height: HOUR_HEIGHT * 24,
            }}
          >
            <div className="relative">
              {Array.from({ length: 23 }, (_, index) => index + 1).map(
                (hour) => (
                  <span
                    key={hour}
                    className="absolute right-1 -translate-y-1/2 text-[10px] text-muted-foreground tabular-nums"
                    style={{ top: hour * HOUR_HEIGHT }}
                  >
                    {formatMinutes(hour * 60).replace(":00", "")}
                  </span>
                ),
              )}
            </div>
            {days.map((day) => (
              <div
                key={day}
                className="relative min-w-0 border-l"
                style={{
                  backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_HEIGHT - 1}px, var(--border) ${HOUR_HEIGHT - 1}px, var(--border) ${HOUR_HEIGHT}px)`,
                }}
              >
                {layoutSegments(timedSegmentsOn(items, day)).map((segment) => (
                  <div
                    key={`${segment.item.id}-${day}`}
                    className="absolute px-0.5"
                    style={{
                      top: (segment.start / 60) * HOUR_HEIGHT,
                      height: Math.max(
                        ((segment.end - segment.start) / 60) * HOUR_HEIGHT,
                        18,
                      ),
                      left: `${(segment.column / segment.columns) * 100}%`,
                      width: `${100 / segment.columns}%`,
                    }}
                  >
                    <ItemButton
                      tripId={tripId}
                      item={segment.item}
                      segment={segment}
                      event={eventsById.get(segment.item.sourceId)}
                      onEdit={setEditing}
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {editing ? (
        <EventFormDialog
          tripId={tripId}
          initial={eventToFormInput(editing)}
          editing={{ id: editing.id, version: editing.version }}
          isSuggestion={editing.status === "SUGGESTED"}
          links={links}
          tripStart={tripStart}
          tripEnd={tripEnd}
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
        />
      ) : null}
    </div>
  );
}

function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

function timeLabel(item: CalendarItem) {
  if (item.allDay) {
    return item.startDate === item.endDate
      ? formatDateOnly(item.startDate, "weekday")
      : `${formatDateOnly(item.startDate, "weekday")} to ${formatDateOnly(item.endDate, "weekday")}`;
  }
  const start = formatDateOnly(item.startDate, "weekday");
  if (item.startDate !== item.endDate && item.endMinute !== null)
    return `${start}, ${formatMinutes(item.startMinute!)} to ${formatDateOnly(item.endDate, "weekday")}, ${formatMinutes(item.endMinute)}`;
  return `${start}, ${formatTimeRange(item.startMinute, item.endMinute)}`;
}

function travelerLabel(item: CalendarItem) {
  return item.travelers
    .map(
      (traveler) =>
        `${traveler.name} ${traveler.status === "BOOKED" ? "booked" : "considering"}`,
    )
    .join(", ");
}

function ItemButton({
  tripId,
  item,
  segment,
  compact = false,
  event,
  onEdit,
}: {
  tripId: string;
  item: CalendarItem;
  segment?: { start: number; end: number; continuesBefore: boolean };
  compact?: boolean;
  event?: EventView;
  onEdit: (event: EventView) => void;
}) {
  const Icon = KIND_ICONS[item.kind];
  const [open, setOpen] = useState(false);
  const { run, pending } = useAction();
  const short = segment ? segment.end - segment.start < 75 : true;
  const label = [
    item.title,
    KIND_LABELS[item.kind],
    STATUS_LABELS[item.status],
    timeLabel(item),
    item.travelers.length > 0 ? travelerLabel(item) : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          data-testid="calendar-item"
          data-kind={item.kind}
          data-status={item.status}
          className={cn(
            "flex h-full w-full min-w-0 flex-col overflow-hidden rounded-md border border-l-4 px-1.5 text-left text-[11px] leading-tight transition-colors",
            compact ? "py-0.5" : "py-1",
            STATUS_STYLES[item.status],
          )}
        >
          <span className="flex min-w-0 items-center gap-1 font-medium">
            <Icon className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{item.title}</span>
          </span>
          {!compact && !short ? (
            <>
              {item.startMinute !== null &&
              segment &&
              !segment.continuesBefore ? (
                <span className="truncate opacity-80">
                  {formatTimeRange(item.startMinute, item.endMinute)}
                </span>
              ) : null}
              {item.detail ? (
                <span className="truncate opacity-80">{item.detail}</span>
              ) : null}
            </>
          ) : null}
          {!compact && item.travelers.length > 0 ? (
            <span className="mt-auto flex min-w-0 flex-wrap gap-0.5">
              {item.travelers.map((traveler) => (
                <span
                  key={traveler.name}
                  className={cn(
                    "truncate rounded px-1 text-[10px] font-medium",
                    traveler.status === "BOOKED"
                      ? "bg-emerald-200/70 text-emerald-950"
                      : "bg-sky-200/70 text-sky-950",
                  )}
                >
                  {traveler.name.split(/\s+/)[0]} ·{" "}
                  {traveler.status === "BOOKED" ? "Booked" : "Considering"}
                </span>
              ))}
            </span>
          ) : null}
          {item.status === "suggested" && !short && !compact ? (
            <span className="mt-auto text-[10px] font-medium">Suggestion</span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80"
        data-testid="calendar-item-details"
      >
        <div className="space-y-2">
          <div>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Icon className="size-3.5" aria-hidden />
              {KIND_LABELS[item.kind]} · {STATUS_LABELS[item.status]}
            </p>
            <p className="font-medium">{item.title}</p>
          </div>
          <p className="text-xs text-muted-foreground">
            {timeLabel(item)} (local time)
          </p>
          {item.detail ? <p className="text-sm">{item.detail}</p> : null}
          {item.travelers.length > 0 ? (
            <ul className="space-y-0.5 text-sm">
              {item.travelers.map((traveler) => (
                <li key={traveler.name} className="flex justify-between gap-2">
                  <span>{traveler.name}</span>
                  <span
                    className={cn(
                      "text-xs font-medium",
                      traveler.status === "BOOKED"
                        ? "text-emerald-700"
                        : "text-sky-700",
                    )}
                  >
                    {traveler.status === "BOOKED" ? "Booked" : "Considering"}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {item.status === "suggested" ? (
            <p className="text-xs text-amber-800">
              Not part of the plan until someone accepts it. Details are not
              verified.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2 border-t pt-2">
            {item.source === "booking" ? (
              <Button asChild size="sm" variant="outline">
                <Link
                  href={
                    `/trips/${tripId}/bookings?edit=${item.sourceId}` as Route
                  }
                >
                  <ExternalLink aria-hidden />
                  Open in Bookings
                </Link>
              </Button>
            ) : null}
            {event ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setOpen(false);
                  onEdit(event);
                }}
              >
                <Pencil aria-hidden />
                {item.status === "suggested" ? "Modify" : "Edit"}
              </Button>
            ) : null}
            {item.status === "suggested" && event ? (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() =>
                    run(
                      () =>
                        reviewEventSuggestionAction(tripId, event.id, false),
                      { success: "Suggestion dismissed" },
                    )
                  }
                >
                  <X aria-hidden />
                  Reject
                </Button>
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    run(
                      () => reviewEventSuggestionAction(tripId, event.id, true),
                      { success: "Added to the itinerary" },
                    )
                  }
                >
                  <Check aria-hidden />
                  Accept
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
