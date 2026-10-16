"use client";

import {
  ArrowRight,
  Bed,
  Bus,
  ExternalLink,
  MoreHorizontal,
  Package,
  Pencil,
  Plane,
  Plus,
  Ticket,
  Trash2,
  UserCheck,
  UserMinus,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { ConfirmAction } from "@/components/shared/confirm-button";
import { BookingStatusBadge, Pill } from "@/components/shared/status-badge";
import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type {
  BookingCategory,
  BookingStatus,
  CostSplit,
  ParticipantStatus,
} from "@/generated/prisma/enums";
import { useAction } from "@/hooks/use-action";
import { formatDateOnly, formatMinutes, minutesToTime } from "@/lib/dates";
import {
  BOOKING_CATEGORY_LABELS,
  COST_SPLIT_LABELS,
  PARTICIPANT_STATUS_LABELS,
} from "@/lib/labels";
import { formatMoneyValue } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { BookingFormInput } from "@/lib/validation/booking";
import {
  deleteBookingAction,
  setOwnParticipationAction,
} from "@/server/actions/bookings";

import { emptyBooking } from "@/lib/validation/form-defaults";

import { BookingFormDialog } from "./booking-form-dialog";

export type BookingView = {
  id: string;
  category: BookingCategory;
  title: string;
  provider: string | null;
  url: string | null;
  reference: string | null;
  status: BookingStatus;
  startDate: string | null;
  startMinute: number | null;
  endDate: string | null;
  endMinute: number | null;
  fromLocation: string | null;
  toLocation: string | null;
  locationName: string | null;
  address: string | null;
  costAmount: string | null;
  currency: string | null;
  costIsEstimate: boolean;
  costSplit: CostSplit;
  notes: string | null;
  version: number;
  createdBy: { id: string; name: string | null } | null;
  researchOption: { id: string; title: string; status: string } | null;
  participants: {
    id: string;
    status: ParticipantStatus;
    shareAmount: string | null;
    roomAssignment: string | null;
    member: {
      id: string;
      user: {
        id: string;
        name: string | null;
        image: string | null;
        email: string | null;
      };
    };
  }[];
};

const CATEGORY_ICONS: Record<BookingCategory, typeof Plane> = {
  FLIGHT: Plane,
  ACCOMMODATION: Bed,
  GROUND_TRANSPORT: Bus,
  ACTIVITY: Ticket,
  OTHER: Package,
};

const CATEGORY_ORDER: BookingCategory[] = [
  "FLIGHT",
  "ACCOMMODATION",
  "GROUND_TRANSPORT",
  "ACTIVITY",
  "OTHER",
];

const EMPTY_HINTS: Record<BookingCategory, string> = {
  FLIGHT:
    "No flights recorded. Each person can add theirs, or join a flight someone else added.",
  ACCOMMODATION:
    "No stays recorded. Add each place separately if the group splits up.",
  GROUND_TRANSPORT: "No transfers, rentals, or trains recorded.",
  ACTIVITY: "No tours, tickets, or reservations recorded.",
  OTHER: "Anything else worth tracking, like travel insurance.",
};

function toFormInput(booking: BookingView): BookingFormInput {
  return {
    category: booking.category,
    title: booking.title,
    provider: booking.provider ?? "",
    url: booking.url ?? "",
    reference: booking.reference ?? "",
    status: booking.status,
    startDate: booking.startDate?.slice(0, 10) ?? "",
    startTime:
      booking.startMinute !== null ? minutesToTime(booking.startMinute) : "",
    endDate: booking.endDate?.slice(0, 10) ?? "",
    endTime: booking.endMinute !== null ? minutesToTime(booking.endMinute) : "",
    fromLocation: booking.fromLocation ?? "",
    toLocation: booking.toLocation ?? "",
    locationName: booking.locationName ?? "",
    address: booking.address ?? "",
    costAmount: booking.costAmount ?? "",
    currency: booking.currency ?? "",
    costIsEstimate: booking.costIsEstimate,
    costSplit: booking.costSplit,
    notes: booking.notes ?? "",
    researchOptionId: booking.researchOption?.id ?? "",
    participants: booking.participants.map((participant) => ({
      memberId: participant.member.id,
      status: participant.status,
      shareAmount: participant.shareAmount ?? "",
      roomAssignment: participant.roomAssignment ?? "",
    })),
  };
}

function when(date: string | null, minute: number | null) {
  if (!date) return null;
  return `${formatDateOnly(date, "weekday")}${minute !== null ? `, ${formatMinutes(minute)}` : ""}`;
}

export function BookingsView({
  tripId,
  bookings,
  members,
  options,
  currentMemberId,
  currentUserId,
  isOrganizer,
  currency,
  prefill,
  editId = null,
  flightSearch,
}: {
  tripId: string;
  bookings: BookingView[];
  members: { id: string; name: string }[];
  options: { id: string; title: string }[];
  currentMemberId: string;
  currentUserId: string;
  isOrganizer: boolean;
  currency: string;
  prefill: BookingFormInput | null;
  /** A booking to open for editing, for example from Atlas's "Edit" link. */
  editId?: string | null;
  /** Flight search, shown at the top of the Flights section. */
  flightSearch?: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <div className="space-y-6">
      {prefill ? (
        <BookingFormDialog
          tripId={tripId}
          initial={prefill}
          members={members}
          options={options}
          defaultOpen
          onOpenChange={(open) => {
            if (!open) router.replace(`/trips/${tripId}/bookings`);
          }}
        />
      ) : null}
      {CATEGORY_ORDER.map((category) => {
        const items = bookings.filter(
          (booking) => booking.category === category,
        );
        const Icon = CATEGORY_ICONS[category];
        return (
          <section
            key={category}
            id={category === "FLIGHT" ? "flights" : undefined}
            aria-labelledby={`bookings-${category}`}
            className="scroll-mt-20 space-y-3"
            data-testid={`bookings-section-${category.toLowerCase()}`}
          >
            <div className="flex items-center justify-between gap-2">
              <h2
                id={`bookings-${category}`}
                className="flex items-center gap-2 text-sm font-semibold"
              >
                <Icon className="size-4 text-muted-foreground" aria-hidden />
                {BOOKING_CATEGORY_LABELS[category]}
                <span className="text-xs font-normal text-muted-foreground">
                  {items.length || ""}
                </span>
              </h2>
              <BookingFormDialog
                tripId={tripId}
                initial={emptyBooking(category, currency)}
                members={members}
                options={options}
                trigger={
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Add ${BOOKING_CATEGORY_LABELS[category].toLowerCase()}`}
                  >
                    <Plus aria-hidden />
                    Add
                  </Button>
                }
              />
            </div>
            {category === "FLIGHT" ? flightSearch : null}
            {items.length === 0 ? (
              <p className="rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
                {EMPTY_HINTS[category]}
              </p>
            ) : (
              <ul className="grid gap-3 md:grid-cols-2">
                {items.map((booking) => (
                  <BookingCard
                    key={booking.id}
                    tripId={tripId}
                    booking={booking}
                    members={members}
                    options={options}
                    currentMemberId={currentMemberId}
                    canDelete={
                      isOrganizer || booking.createdBy?.id === currentUserId
                    }
                    startEditing={booking.id === editId}
                    onEditClosed={() =>
                      router.replace(`/trips/${tripId}/bookings`)
                    }
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function BookingCard({
  tripId,
  booking,
  members,
  options,
  currentMemberId,
  canDelete,
  startEditing = false,
  onEditClosed,
}: {
  tripId: string;
  booking: BookingView;
  members: { id: string; name: string }[];
  options: { id: string; title: string }[];
  currentMemberId: string;
  canDelete: boolean;
  startEditing?: boolean;
  onEditClosed?: () => void;
}) {
  const [dialog, setDialog] = useState<"edit" | "delete" | null>(
    startEditing ? "edit" : null,
  );
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (startEditing) ref.current?.scrollIntoView({ block: "center" });
  }, [startEditing]);
  const { run, pending } = useAction();
  const cost = formatMoneyValue(booking.costAmount, booking.currency);
  const start = when(booking.startDate, booking.startMinute);
  const end = when(booking.endDate, booking.endMinute);
  const mine = booking.participants.find(
    (participant) => participant.member.id === currentMemberId,
  );
  const isFlight = booking.category === "FLIGHT";
  const cancelled = booking.status === "CANCELLED";

  return (
    <li
      ref={ref}
      id={`booking-${booking.id}`}
      className={cn(
        "flex scroll-mt-20 flex-col rounded-xl border bg-card p-4",
        cancelled && "opacity-60",
      )}
      data-testid="booking-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold break-words">{booking.title}</h3>
          <p className="text-xs text-muted-foreground">
            {[
              booking.provider,
              booking.reference ? `Ref ${booking.reference}` : null,
            ]
              .filter(Boolean)
              .join(" · ") || "No provider recorded"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <BookingStatusBadge status={booking.status} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Actions for ${booking.title}`}
                disabled={pending}
              >
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setDialog("edit")}>
                <Pencil aria-hidden />
                Edit
              </DropdownMenuItem>
              {canDelete ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => setDialog("delete")}
                  >
                    <Trash2 aria-hidden />
                    Delete
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
          <BookingFormDialog
            tripId={tripId}
            initial={toFormInput(booking)}
            editing={{ id: booking.id, version: booking.version }}
            members={members}
            options={options}
            open={dialog === "edit"}
            onOpenChange={(open) => {
              setDialog(open ? "edit" : null);
              if (!open && startEditing) onEditClosed?.();
            }}
          />
          {canDelete ? (
            <ConfirmAction
              open={dialog === "delete"}
              onOpenChange={(open) => setDialog(open ? "delete" : null)}
              title={`Delete "${booking.title}"?`}
              description="This only removes the record here. It does not cancel anything with the provider."
              onConfirm={() =>
                run(() => deleteBookingAction(tripId, booking.id), {
                  success: "Booking deleted",
                })
              }
            />
          ) : null}
        </div>
      </div>

      <dl className="mt-3 space-y-1 text-sm">
        {booking.fromLocation || booking.toLocation ? (
          <div className="flex items-center gap-1.5">
            <dt className="sr-only">Route</dt>
            <dd className="flex items-center gap-1.5 font-medium">
              {booking.fromLocation ?? "?"}
              <ArrowRight
                className="size-3.5 text-muted-foreground"
                aria-label="to"
              />
              {booking.toLocation ?? "?"}
            </dd>
          </div>
        ) : null}
        {booking.locationName || booking.address ? (
          <div>
            <dt className="sr-only">Location</dt>
            <dd className="text-muted-foreground">
              {[booking.locationName, booking.address]
                .filter(Boolean)
                .join(", ")}
            </dd>
          </div>
        ) : null}
        {start || end ? (
          <div>
            <dt className="sr-only">When</dt>
            <dd className="text-muted-foreground">
              {[start, end].filter(Boolean).join(" to ")}
            </dd>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-1.5">
          <dt className="sr-only">Cost</dt>
          <dd
            className={cn(cost ? "font-medium" : "text-amber-800 italic")}
            data-testid="booking-cost"
          >
            {cost ? cost : "No price yet, not counted in the budget"}
          </dd>
          {cost ? (
            <dd className="flex items-center gap-1">
              <Pill tone={booking.costIsEstimate ? "suggestion" : "confirmed"}>
                {booking.costIsEstimate ? "Estimate" : "Actual"}
              </Pill>
              <span className="text-xs text-muted-foreground">
                {COST_SPLIT_LABELS[booking.costSplit]}
              </span>
            </dd>
          ) : null}
        </div>
        {booking.url ? (
          <div>
            <dt className="sr-only">Link</dt>
            <dd>
              <a
                href={booking.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                Open with provider
                <ExternalLink className="size-3" aria-hidden />
              </a>
            </dd>
          </div>
        ) : null}
        {booking.researchOption ? (
          <div>
            <dt className="sr-only">Linked option</dt>
            <dd className="text-xs text-muted-foreground">
              From option: {booking.researchOption.title}
            </dd>
          </div>
        ) : null}
      </dl>
      {booking.notes ? (
        <p className="mt-2 text-xs whitespace-pre-wrap text-foreground/80">
          {booking.notes}
        </p>
      ) : null}

      <div className="mt-auto pt-3">
        <div className="border-t pt-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            {booking.participants.length === 0
              ? "No travelers linked yet"
              : `${booking.participants.length} traveler${booking.participants.length === 1 ? "" : "s"}`}
          </p>
          <ul
            className="flex flex-wrap gap-1.5"
            data-testid="booking-travelers"
          >
            {booking.participants.map((participant) => (
              <li
                key={participant.id}
                className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 py-0.5 pr-2 pl-0.5 text-xs"
              >
                <UserAvatar
                  name={participant.member.user.name}
                  image={participant.member.user.image}
                  className="size-5"
                />
                {participant.member.user.name ?? "Member"}
                {participant.status === "CONSIDERING" ? (
                  <span className="text-muted-foreground">
                    ({PARTICIPANT_STATUS_LABELS.CONSIDERING.toLowerCase()})
                  </span>
                ) : null}
                {participant.roomAssignment ? (
                  <span className="text-muted-foreground">
                    · {participant.roomAssignment}
                  </span>
                ) : null}
                {booking.costSplit === "CUSTOM" && participant.shareAmount ? (
                  <span className="text-muted-foreground">
                    ·{" "}
                    {formatMoneyValue(
                      participant.shareAmount,
                      booking.currency,
                    )}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          {!cancelled ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {mine ? (
                <>
                  {mine.status === "CONSIDERING" ? (
                    <Button
                      variant="outline"
                      size="xs"
                      disabled={pending}
                      onClick={() =>
                        run(
                          () =>
                            setOwnParticipationAction(
                              tripId,
                              booking.id,
                              "BOOKED",
                            ),
                          { success: "Marked as booked for you" },
                        )
                      }
                    >
                      <UserCheck aria-hidden />I booked this
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={pending}
                    onClick={() =>
                      run(
                        () =>
                          setOwnParticipationAction(tripId, booking.id, null),
                        { success: "Removed you" },
                      )
                    }
                  >
                    <UserMinus aria-hidden />
                    Remove me
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={pending}
                    onClick={() =>
                      run(
                        () =>
                          setOwnParticipationAction(
                            tripId,
                            booking.id,
                            "BOOKED",
                          ),
                        { success: "Added you as booked" },
                      )
                    }
                  >
                    <UserCheck aria-hidden />
                    {isFlight ? "I'm on this flight" : "I'm booked on this"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={pending}
                    onClick={() =>
                      run(
                        () =>
                          setOwnParticipationAction(
                            tripId,
                            booking.id,
                            "CONSIDERING",
                          ),
                        { success: "Marked as considering" },
                      )
                    }
                  >
                    Considering
                  </Button>
                </>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}
