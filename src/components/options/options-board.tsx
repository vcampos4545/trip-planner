"use client";

import {
  Bed,
  Car,
  ExternalLink,
  Landmark,
  MapPin,
  MessageSquare,
  MoreHorizontal,
  Package,
  Pencil,
  Plane,
  Ticket,
  Trash2,
  Utensils,
  Vote,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useState } from "react";

import { ConfirmAction } from "@/components/shared/confirm-button";
import {
  OptionStatusBadge,
  OriginBadge,
} from "@/components/shared/status-badge";
import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import type {
  MemberRole,
  OptionCategory,
  OptionStatus,
  RecordOrigin,
} from "@/generated/prisma/enums";
import { useAction } from "@/hooks/use-action";
import { formatRelativeTime, formatTimestamp } from "@/lib/dates";
import { allowedOptionTransitions } from "@/lib/domain/status-rules";
import { OPTION_CATEGORY_LABELS, OPTION_STATUS_LABELS } from "@/lib/labels";
import { formatMoneyValue } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  addOptionNoteAction,
  deleteOptionAction,
  setOptionStatusAction,
} from "@/server/actions/research";

import { CompareDialog } from "./compare-dialog";
import { OptionFormDialog } from "./option-form-dialog";

export type OptionView = {
  id: string;
  category: OptionCategory;
  title: string;
  description: string | null;
  url: string | null;
  sourceName: string | null;
  origin: RecordOrigin;
  status: OptionStatus;
  priceAmount: string | null;
  priceCurrency: string | null;
  priceUnit: string | null;
  priceNote: string | null;
  locationName: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  rationale: string | null;
  retrievedAt: string | null;
  version: number;
  updatedAt: string;
  createdBy: { id: string; name: string | null } | null;
  updatedBy: { id: string; name: string | null } | null;
  notes: {
    id: string;
    body: string;
    createdAt: string;
    author: { id: string; name: string | null; image: string | null } | null;
  }[];
  bookings: { id: string; status: string; title: string }[];
};

function hostnameOf(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return "Source";
  }
}

export const CATEGORY_ICONS: Record<OptionCategory, typeof Bed> = {
  DESTINATION: Landmark,
  LODGING: Bed,
  FLIGHT: Plane,
  TRANSPORT: Car,
  ACTIVITY: Ticket,
  FOOD: Utensils,
  OTHER: Package,
};

const ACTION_LABELS: Partial<Record<OptionStatus, string>> = {
  SUGGESTED: "Move back to suggested",
  SHORTLISTED: "Shortlist",
  APPROVED: "Approve",
  REJECTED: "Reject",
  CANCELLED: "Cancel",
};

export function OptionsBoard({
  tripId,
  options,
  role,
  currentUserId,
  defaultCurrency,
}: {
  tripId: string;
  options: OptionView[];
  role: MemberRole;
  currentUserId: string;
  defaultCurrency: string;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const selectedOptions = options.filter((option) =>
    selected.includes(option.id),
  );
  return (
    <div className="space-y-4">
      {selected.length > 0 ? (
        <div className="sticky top-16 z-20 flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card/95 px-4 py-2.5 shadow-sm backdrop-blur">
          <p className="text-sm">
            {selected.length} selected{" "}
            <span className="text-muted-foreground">to compare or vote on</span>
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
              Clear
            </Button>
            <CompareDialog
              tripId={tripId}
              options={selectedOptions}
              trigger={
                <Button size="sm" disabled={selected.length < 2}>
                  <Vote aria-hidden />
                  Compare and vote
                </Button>
              }
              onCreated={() => setSelected([])}
            />
          </div>
        </div>
      ) : null}
      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {options.map((option) => (
          <li key={option.id}>
            <OptionCard
              tripId={tripId}
              option={option}
              role={role}
              currentUserId={currentUserId}
              defaultCurrency={defaultCurrency}
              selected={selected.includes(option.id)}
              onSelectedChange={(checked) =>
                setSelected((current) =>
                  checked
                    ? [...current, option.id]
                    : current.filter((id) => id !== option.id),
                )
              }
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function OptionCard({
  tripId,
  option,
  role,
  currentUserId,
  defaultCurrency,
  selected,
  onSelectedChange,
}: {
  tripId: string;
  option: OptionView;
  role: MemberRole;
  currentUserId: string;
  defaultCurrency: string;
  selected: boolean;
  onSelectedChange: (checked: boolean) => void;
}) {
  const { run, pending } = useAction();
  const [showNotes, setShowNotes] = useState(false);
  const [dialog, setDialog] = useState<"edit" | "delete" | null>(null);
  const Icon = CATEGORY_ICONS[option.category];
  const price = formatMoneyValue(option.priceAmount, option.priceCurrency);
  const transitions = allowedOptionTransitions(option.status, role);
  const inactive =
    option.status === "REJECTED" || option.status === "CANCELLED";
  const canDelete =
    role === "ORGANIZER" || option.createdBy?.id === currentUserId;
  const selectable = !inactive;

  return (
    <article
      className={cn(
        "flex h-full flex-col rounded-xl border bg-card p-4 transition-shadow",
        selected && "ring-2 ring-primary/50",
        inactive && "opacity-70",
        option.origin === "ATLAS" &&
          option.status === "SUGGESTED" &&
          "border-dashed",
      )}
      data-testid="option-card"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            {OPTION_CATEGORY_LABELS[option.category]}
          </p>
          <h3 className="text-sm leading-snug font-semibold break-words">
            {option.title}
          </h3>
        </div>
        {selectable ? (
          <Checkbox
            checked={selected}
            onCheckedChange={(value) => onSelectedChange(value === true)}
            aria-label={`Select ${option.title} to compare`}
          />
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <OptionStatusBadge status={option.status} />
        <OriginBadge origin={option.origin} short />
      </div>

      {option.description ? (
        <p className="mt-3 line-clamp-3 text-sm text-foreground/80">
          {option.description}
        </p>
      ) : null}
      {option.rationale ? (
        <p className="mt-2 rounded-md bg-accent/50 px-2.5 py-1.5 text-xs text-accent-foreground">
          <span className="font-medium">Why it fits: </span>
          {option.rationale}
        </p>
      ) : null}

      <dl className="mt-3 mb-4 space-y-1 text-xs text-muted-foreground">
        <div className="flex gap-1.5">
          <dt className="sr-only">Price</dt>
          <dd className={cn(price ? "font-medium text-foreground" : "italic")}>
            {price
              ? `${price}${option.priceUnit ? ` per ${option.priceUnit}` : ""}`
              : "No price recorded"}
            {option.priceNote ? (
              <span className="font-normal text-muted-foreground">
                {" "}
                · {option.priceNote}
              </span>
            ) : null}
          </dd>
        </div>
        {option.locationName || option.address ? (
          <div className="flex items-center gap-1">
            <dt className="sr-only">Location</dt>
            <MapPin className="size-3 shrink-0" aria-hidden />
            <dd className="truncate">
              {[option.locationName, option.address].filter(Boolean).join(", ")}
            </dd>
          </div>
        ) : null}
        <div>
          <dt className="sr-only">Source</dt>
          <dd className="flex flex-wrap items-center gap-x-1.5">
            {option.url ? (
              <a
                href={option.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                {option.sourceName ?? hostnameOf(option.url)}
                <ExternalLink className="size-3" aria-hidden />
              </a>
            ) : (
              <span>
                {option.origin === "ATLAS"
                  ? "From Atlas's general knowledge, not verified"
                  : "No source link"}
              </span>
            )}
            {option.retrievedAt ? (
              <span>· retrieved {formatTimestamp(option.retrievedAt)}</span>
            ) : null}
          </dd>
        </div>
        {option.bookings.length > 0 ? (
          <div>
            <dt className="sr-only">Booking</dt>
            <dd>
              <Link
                href={`/trips/${tripId}/bookings` as Route}
                className="text-primary hover:underline"
              >
                Linked booking: {option.bookings[0]!.title}
              </Link>
            </dd>
          </div>
        ) : null}
      </dl>

      <div className="mt-auto flex items-center justify-between gap-2 border-t pt-3">
        <p className="truncate text-[11px] text-muted-foreground">
          {option.updatedBy?.name
            ? `Updated by ${option.updatedBy.name}`
            : "Updated"}{" "}
          {formatRelativeTime(option.updatedAt)}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowNotes((value) => !value)}
            aria-expanded={showNotes}
            aria-label={`Notes on ${option.title}`}
          >
            <MessageSquare aria-hidden />
            {option.notes.length}
          </Button>
          {option.status === "SUGGESTED" ? (
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() =>
                run(
                  () => setOptionStatusAction(tripId, option.id, "SHORTLISTED"),
                  { success: "Shortlisted" },
                )
              }
            >
              Shortlist
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`More actions for ${option.title}`}
                disabled={pending}
              >
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel className="text-xs">
                Status: {OPTION_STATUS_LABELS[option.status]}
              </DropdownMenuLabel>
              {transitions.map((status) => (
                <DropdownMenuItem
                  key={status}
                  onSelect={() =>
                    run(
                      () => setOptionStatusAction(tripId, option.id, status),
                      {
                        success: `Marked as ${OPTION_STATUS_LABELS[status].toLowerCase()}`,
                      },
                    )
                  }
                >
                  {ACTION_LABELS[status] ?? OPTION_STATUS_LABELS[status]}
                </DropdownMenuItem>
              ))}
              {option.status === "APPROVED" ? (
                <DropdownMenuItem asChild>
                  <Link
                    href={
                      `/trips/${tripId}/bookings?option=${option.id}` as Route
                    }
                  >
                    Record a booking
                  </Link>
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setDialog("edit")}>
                <Pencil aria-hidden />
                Edit
              </DropdownMenuItem>
              {canDelete ? (
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => setDialog("delete")}
                >
                  <Trash2 aria-hidden />
                  Delete
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
          <OptionFormDialog
            tripId={tripId}
            defaultCurrency={defaultCurrency}
            editing={{ id: option.id, version: option.version }}
            initial={{
              category: option.category,
              title: option.title,
              description: option.description ?? "",
              url: option.url ?? "",
              sourceName: option.sourceName ?? "",
              priceAmount: option.priceAmount ?? "",
              priceCurrency: option.priceCurrency ?? "",
              priceUnit: option.priceUnit ?? "",
              priceNote: option.priceNote ?? "",
              locationName: option.locationName ?? "",
              address: option.address ?? "",
              latitude: option.latitude?.toString() ?? "",
              longitude: option.longitude?.toString() ?? "",
            }}
            open={dialog === "edit"}
            onOpenChange={(open) => setDialog(open ? "edit" : null)}
          />
          {canDelete ? (
            <ConfirmAction
              open={dialog === "delete"}
              onOpenChange={(open) => setDialog(open ? "delete" : null)}
              title={`Delete "${option.title}"?`}
              description="It will be removed for everyone. Votes that used it keep their label."
              onConfirm={() =>
                run(() => deleteOptionAction(tripId, option.id), {
                  success: "Option deleted",
                })
              }
            />
          ) : null}
        </div>
      </div>

      {showNotes ? <OptionNotes tripId={tripId} option={option} /> : null}
    </article>
  );
}

function OptionNotes({
  tripId,
  option,
}: {
  tripId: string;
  option: OptionView;
}) {
  const [body, setBody] = useState("");
  const { run, pending } = useAction();
  return (
    <div className="mt-3 space-y-3 border-t pt-3">
      {option.notes.length === 0 ? (
        <p className="text-xs text-muted-foreground">No notes yet.</p>
      ) : null}
      <ul className="space-y-2.5">
        {option.notes.map((note) => (
          <li key={note.id} className="flex gap-2 text-sm">
            <UserAvatar
              name={note.author?.name}
              image={note.author?.image}
              className="size-6"
            />
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {note.author?.name ?? "Someone"}
                </span>{" "}
                · {formatRelativeTime(note.createdAt)}
              </p>
              <p className="break-words whitespace-pre-wrap">{note.body}</p>
            </div>
          </li>
        ))}
      </ul>
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!body.trim()) return;
          run(() => addOptionNoteAction(tripId, option.id, { body }), {
            onSuccess: () => setBody(""),
          });
        }}
      >
        <label htmlFor={`note-${option.id}`} className="sr-only">
          Add a note
        </label>
        <Textarea
          id={`note-${option.id}`}
          rows={2}
          maxLength={1000}
          placeholder="Add a short note"
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={pending || !body.trim()}>
            Add note
          </Button>
        </div>
      </form>
    </div>
  );
}
